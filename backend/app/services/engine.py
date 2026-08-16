"""Planning Engine + Schedule Engine + Reality Engine. Pure math, no AI.

Definitions:
- Progress is measured per material in its own unit (pages, exams, words...).
- Overall goal progress is the mean of per-material completion percentages,
  so a 400-page book and a 10-exam set weigh equally.
- The Schedule Engine distributes all remaining work evenly over the days from
  a start date through the deadline (inclusive), producing dated ScheduledTasks.
- Days are weighted by the user's weekly availability (hours per weekday);
  a 0-hour day gets no tasks, a 4-hour day gets twice a 2-hour day's load.
- Expected progress at day D is linear between start_date and deadline.
  Missions declare their starting point at creation (start_date +
  already-completed per material), so trajectory is honest from day one.
- Reality Engine states:
    COMPLETED    everything done
    FAILED       deadline passed, work remains
    then trajectory_ratio = actual_pct / expected_pct:
      >= 1.05  AHEAD | >= 0.90 ON_TRACK | >= 0.70 AT_RISK | < 0.70 OFF_TRACK
"""

from datetime import date, timedelta

from sqlalchemy import or_, select
from sqlalchemy.orm import Session

from ..models import Goal, Material, ProgressUnit, ScheduledTask
from ..schemas import MaterialPlan, RealityReport

WEEKDAY_KEYS = ["mon", "tue", "wed", "thu", "fri", "sat", "sun"]


def day_weight(availability: dict | None, d: date) -> float:
    if not availability:
        return 1.0
    try:
        return max(float(availability.get(WEEKDAY_KEYS[d.weekday()], 0.0)), 0.0)
    except (TypeError, ValueError):
        return 1.0


def _material_progress(material: Material) -> tuple[float, float]:
    """Return (completed, total) for a material, in its unit."""
    units = material.progress_units
    if units:
        completed = sum(min(u.completed_quantity, u.quantity) for u in units)
        total = sum(u.quantity for u in units)
        # Sliced units may not cover the whole material yet; the un-sliced
        # remainder still counts as work to do.
        total = max(total, material.total_quantity)
    else:
        completed, total = 0.0, material.total_quantity
    return completed, total


def _human_rate(rate: float, unit: str) -> str:
    if rate <= 0:
        return "done"
    if rate >= 1:
        return f"{rate:.1f} {unit}/day"
    every = 1 / rate
    return f"1 {unit.rstrip('s')} every {every:.0f} days"


def days_remaining(goal: Goal, today: date) -> int:
    return max((goal.deadline - today).days, 0)


def build_material_plans(goal: Goal, today: date) -> list[MaterialPlan]:
    remaining_days = max(days_remaining(goal, today), 1)
    plans = []
    for m in goal.materials:
        completed, total = _material_progress(m)
        remaining = max(total - completed, 0.0)
        rate = remaining / remaining_days
        plans.append(
            MaterialPlan(
                material_id=m.id,
                name=m.name,
                unit=m.unit,
                total=total,
                completed=completed,
                remaining=remaining,
                required_per_day=round(rate, 2),
                human_rate=_human_rate(rate, m.unit),
            )
        )
    return plans


def overall_progress_pct(goal: Goal) -> float:
    """Mean of per-material completion percentages (0-100)."""
    pcts = []
    for m in goal.materials:
        completed, total = _material_progress(m)
        if total > 0:
            pcts.append(100.0 * completed / total)
    if not pcts:
        return 0.0
    return sum(pcts) / len(pcts)


def build_reality_report(goal: Goal, today: date) -> RealityReport:
    total_days = max((goal.deadline - goal.start_date).days, 1)
    elapsed = min(max((today - goal.start_date).days, 0), total_days)
    remaining = days_remaining(goal, today)

    expected_pct = 100.0 * elapsed / total_days
    actual_pct = overall_progress_pct(goal)
    days_behind = max(round((expected_pct - actual_pct) / 100.0 * total_days), 0)

    ratio = actual_pct / expected_pct if expected_pct > 0 else 1.0
    if actual_pct >= 100.0:
        status = "COMPLETED"
        ratio = 1.0
    elif remaining == 0:
        status = "FAILED"
    elif expected_pct <= 0:
        # Day zero — starting point is declared at creation, so this is honest.
        status = "AHEAD" if actual_pct > 0 else "ON_TRACK"
    elif ratio >= 1.05:
        status = "AHEAD"
    elif ratio >= 0.90:
        status = "ON_TRACK"
    elif ratio >= 0.70:
        status = "AT_RISK"
    else:
        status = "OFF_TRACK"

    adjustments: list[str] = []
    if status in ("AT_RISK", "OFF_TRACK") and remaining > 0:
        # For each material: how much harder than the original plan you now
        # have to work to still make the deadline.
        for m in goal.materials:
            completed, total = _material_progress(m)
            material_remaining = max(total - completed, 0.0)
            original_rate = total / total_days
            required_rate = material_remaining / remaining
            delta = required_rate - original_rate
            if delta <= 0:
                continue
            if required_rate < 1:
                # Slow-cadence materials read better as "every N days".
                new_every = round(1 / required_rate)
                old_every = round(1 / original_rate) if original_rate > 0 else None
                if old_every is None or new_every < old_every:
                    adjustments.append(
                        f"{m.name}: 1 {m.unit.rstrip('s')} every {new_every} days "
                        f"(planned: every {old_every} days)"
                    )
            elif _fmt(delta) != "0":
                adjustments.append(
                    f"{m.name}: +{_fmt(delta)} {m.unit}/day "
                    f"(now {_fmt(required_rate)}/day instead of the planned {_fmt(original_rate)}/day)"
                )

    messages = {
        "COMPLETED": "Mission complete. Everything is finished.",
        "FAILED": f"Deadline reached with {actual_pct:.0f}% completed.",
        "AHEAD": f"You are ahead of schedule ({actual_pct:.0f}% done, {expected_pct:.0f}% expected). Keep the pace.",
        "ON_TRACK": f"On track: {actual_pct:.0f}% done vs {expected_pct:.0f}% expected.",
        # Tone. These are the fallbacks now — when the planner has minutes to
        # work with, `_enrich` replaces them with a date. Shouting was the old
        # answer to "the student is not reacting", and a banner that shouts gets
        # tuned out inside a fortnight. The number is enough; the capitals were
        # doing the work the arithmetic should do.
        "AT_RISK": (
            f"You are {days_behind} days behind — {actual_pct:.0f}% done against "
            f"{expected_pct:.0f}% expected. Something has to give."
        ),
        "OFF_TRACK": (
            f"You are {days_behind} days behind — {actual_pct:.0f}% done against "
            f"{expected_pct:.0f}% expected. This deadline does not hold at your current pace."
        ),
    }
    if elapsed == 0:
        # Day zero: "0% expected" is technically true but reads as broken. Speak
        # to the fresh start instead of the linear baseline.
        if status == "ON_TRACK":
            messages["ON_TRACK"] = "Mission launched. Complete today's tasks to bend the curve."
        elif status == "AHEAD":
            messages["AHEAD"] = (
                f"Strong start — {actual_pct:.0f}% already done on day one. Hold this pace."
            )
    message = messages[status]

    return RealityReport(
        goal_id=goal.id,
        days_total=total_days,
        days_elapsed=elapsed,
        days_remaining=remaining,
        days_behind=days_behind,
        expected_progress_pct=round(expected_pct, 1),
        actual_progress_pct=round(actual_pct, 1),
        trajectory_ratio=round(ratio, 3),
        status=status,
        message=message,
        adjustments=adjustments,
    )


def _fmt(x: float) -> str:
    return f"{x:.1f}".rstrip("0").rstrip(".")


# ---------- Schedule Engine ----------

EPS = 1e-9


def build_schedule(
    goal: Goal,
    from_date: date,
    availability: dict | None = None,
    skip_dates: set[date] | None = None,
) -> list[dict]:
    """Distribute all remaining work over from_date..deadline (inclusive),
    weighted by the user's weekly availability.

    Returns dated task dicts. Never schedules beyond the deadline. Zero-hour
    days get nothing; slow-cadence materials (exams) land on spaced days via
    cumulative rounding. A day crossing a unit boundary yields one task per
    unit touched.

    `skip_dates` are days that already carry a row somebody reported on. They
    get zero weight rather than being filtered afterwards: a day that has been
    spoken about is not free capacity, and generating work for it would put a
    second row beside the one that is already there.
    """
    n_days = (goal.deadline - from_date).days + 1
    if n_days <= 0:
        return []

    skip = skip_dates or set()
    weights = [
        0.0 if (from_date + timedelta(days=d)) in skip
        else day_weight(availability, from_date + timedelta(days=d))
        for d in range(n_days)
    ]
    total_weight = sum(weights)
    if total_weight <= 0:
        # Fully blocked week(s) — fall back to even distribution rather than
        # scheduling nothing at all. Reported days stay excluded: they are not
        # blocked, they are done being planned.
        weights = [0.0 if (from_date + timedelta(days=d)) in skip else 1.0 for d in range(n_days)]
        total_weight = sum(weights)
        if total_weight <= 0:
            return []
    cum_weights: list[float] = []
    acc = 0.0
    for w in weights:
        acc += w
        cum_weights.append(acc)

    tasks: list[dict] = []
    for m in goal.materials:
        units = sorted(m.progress_units, key=lambda u: (u.position, u.id))

        # Absolute offset of each unit inside the material (for "pages 81-85").
        offsets: dict[int, float] = {}
        cum = 0.0
        for u in units:
            offsets[u.id] = cum
            cum += u.quantity

        # (unit, start-within-unit, amount) segments of work still to do.
        segments = [
            (u, u.completed_quantity, u.quantity - u.completed_quantity)
            for u in units
            if u.quantity - u.completed_quantity > EPS
        ]
        remaining = sum(s[2] for s in segments)
        if remaining <= EPS:
            continue

        integral = all(float(u.quantity).is_integer() for u in units)
        prev_target = 0.0
        seg_i = 0
        seg_used = 0.0
        for d in range(n_days):
            target = remaining * cum_weights[d] / total_weight
            if integral:
                target = float(round(target))
            amount = target - prev_target
            prev_target = target
            while amount > EPS and seg_i < len(segments):
                unit, seg_start, seg_avail = segments[seg_i]
                take = min(amount, seg_avail - seg_used)
                covers_whole_unit = seg_start == 0 and take >= unit.quantity - EPS
                if covers_whole_unit:
                    description = unit.title
                else:
                    s_abs = offsets[unit.id] + seg_start + seg_used
                    description = (
                        f"{m.name}: {m.unit} {int(s_abs) + 1}-{int(round(s_abs + take))}"
                    )
                tasks.append(
                    {
                        "date": from_date + timedelta(days=d),
                        "goal_id": goal.id,
                        "material_id": m.id,
                        "progress_unit_id": unit.id,
                        "quantity": take,
                        "description": description,
                    }
                )
                amount -= take
                seg_used += take
                if seg_used >= seg_avail - EPS:
                    seg_i += 1
                    seg_used = 0.0

    tasks.sort(key=lambda t: t["date"])
    return tasks


def derive_descriptions(goal: Goal, tasks: list[ScheduledTask], today: date) -> dict[int, str]:
    """Re-derive the range each upcoming row names, from the mission's live position.

    A row's description is written when the row is built and never touched again,
    so it is only true for as long as the position it was computed from holds.
    Two rows built at different moments therefore disagree — Saturday saying
    "pages 24-26" beside Sunday saying "pages 22-24" is two snapshots of a cursor
    that moved between them, not a scheduler walking backwards.

    So the range is not read back from the row; it is recomputed here in one pass
    over one cursor, the same way `build_schedule` lays it down. Contiguity stops
    being something the stored data has to preserve and becomes a property of how
    it is read.

    Only days still ahead take part. A past day is history and a reported day is
    settled — its shortfall has already been redistributed into the days after
    it, so letting it move the cursor would count that work twice.
    """
    upcoming: dict[int, list[ScheduledTask]] = {}
    for t in tasks:
        if t.date < today or t.logged or t.material_id is None:
            continue
        upcoming.setdefault(t.material_id, []).append(t)

    out: dict[int, str] = {}
    for m in goal.materials:
        rows = upcoming.get(m.id)
        if not rows:
            continue
        rows.sort(key=lambda t: (t.date, t.id))

        units = sorted(m.progress_units, key=lambda u: (u.position, u.id))
        offsets: dict[int, float] = {}
        cum = 0.0
        for u in units:
            offsets[u.id] = cum
            cum += u.quantity
        segments = [
            (u, u.completed_quantity, u.quantity - u.completed_quantity)
            for u in units
            if u.quantity - u.completed_quantity > EPS
        ]

        seg_i, seg_used = 0, 0.0
        for t in rows:
            amount = t.quantity
            parts: list[str] = []
            while amount > EPS and seg_i < len(segments):
                unit, seg_start, seg_avail = segments[seg_i]
                take = min(amount, seg_avail - seg_used)
                if seg_start == 0 and take >= unit.quantity - EPS:
                    parts.append(unit.title)
                else:
                    s_abs = offsets[unit.id] + seg_start + seg_used
                    parts.append(
                        f"{m.name}: {m.unit} {int(s_abs) + 1}-{int(round(s_abs + take))}"
                    )
                amount -= take
                seg_used += take
                if seg_used >= seg_avail - EPS:
                    seg_i += 1
                    seg_used = 0.0
            if parts:
                out[t.id] = ", ".join(parts)
    return out


def rebuild_start_date(db: Session, goal: Goal, today: date) -> date:
    """Rebuild from today unless today's plan was already reported on (then tomorrow).

    "Reported on" includes a logged zero, not just a completion — someone who
    opened today and said they did nothing has still spoken about today, and
    redistributing it out from under them would erase that.
    """
    worked_today = db.scalar(
        select(ScheduledTask.id).where(
            ScheduledTask.goal_id == goal.id,
            ScheduledTask.date == today,
            or_(ScheduledTask.completed.is_(True), ScheduledTask.actual_quantity.is_not(None)),
        )
    )
    return today + timedelta(days=1) if worked_today else today


def needs_replan(db: Session, goal: Goal, today: date) -> bool:
    """Has a day gone by that the plan has not yet been told about?

    A missed day changes the plan exactly as much as a logged one does — the
    work it owed is still owed, just with one fewer day to do it in. Nothing
    writes to the database on a day you don't open the app, though, so nothing
    used to notice, and the schedule kept serving rows computed against a
    position the mission left behind. This is the trigger that was missing.
    """
    if goal.replanned_on is not None and goal.replanned_on >= today:
        return False
    missed = db.scalar(
        select(ScheduledTask.id).where(
            ScheduledTask.goal_id == goal.id,
            ScheduledTask.date < today,
            ScheduledTask.completed.is_(False),
            ScheduledTask.actual_quantity.is_(None),
        )
    )
    return missed is not None


def reported_dates(db: Session, goal: Goal, from_date: date) -> set[date]:
    """Days at or after `from_date` that already carry a row somebody reported on."""
    return set(
        db.scalars(
            select(ScheduledTask.date).where(
                ScheduledTask.goal_id == goal.id,
                ScheduledTask.date >= from_date,
                or_(ScheduledTask.completed.is_(True), ScheduledTask.actual_quantity.is_not(None)),
            )
        )
    )


def derive_schedule(db: Session, goal: Goal, today: date) -> list[ScheduledTask]:
    """The forward plan, computed and never written down.

    This is the whole point of the cutover. A stored forward plan is a claim
    about a day that has not happened yet, and the moment reality moves it
    becomes a lie the database keeps repeating — which is how a Friday came to
    owe 139 points beside a Saturday starting at 246.

    The rows come out of `build_schedule`, the same generator `rebuild_schedule`
    used to persist, walking the same unit cursor. Identical by construction:
    what changes is only that nothing is added to the session. The objects are
    transient `ScheduledTask` instances so every reader and serialiser keeps
    working unchanged — they simply have no id, because there is no row.

    Days already spoken about keep their stored row (that is history, and
    history is the one thing that *should* be persisted), so they are skipped
    here rather than generated over.
    """
    if not goal.materials:
        return []
    skip = reported_dates(db, goal, today)
    # `build_schedule` walks one material at a time, so its output is grouped by
    # material. Stored rows came back ordered by (date, id) — date first, and
    # within a date the order they were generated in. A *stable* sort on date
    # alone reproduces exactly that, and every screen depends on it: the first
    # entry for today is the one the day leads with.
    return sorted(
        (
            # `completed=False` explicitly: a column default is applied by the
            # database on insert, and nothing here is ever inserted, so a
            # transient row would otherwise carry None and fail serialisation.
            # A day that has not arrived is not done — say so.
            ScheduledTask(**t, completed=False, actual_quantity=None)
            for t in build_schedule(
                goal, today, availability=goal.user.availability, skip_dates=skip
            )
        ),
        key=lambda t: t.date,
    )


def rebuild_schedule(db: Session, goal: Goal, today: date, from_date: date | None = None) -> None:
    """Delete the unreported future schedule and redistribute remaining work.

    Only rows nobody has spoken about are movable. A completed row is history;
    so is a row logged at zero or part-done — deleting those would throw away a
    fact the user reported in order to re-plan around it.

    Those surviving rows also take their day off the table. Without that, a day
    logged ahead of time from the calendar keeps its row *and* receives a freshly
    generated one, and the same work gets scheduled twice.
    """
    # The session runs with autoflush off, so a caller that has just recorded a
    # log still holds it in memory. Every query below decides what to keep by
    # reading `completed` / `actual_quantity` from the database, and would
    # otherwise judge the row being edited by its state before the edit — and
    # delete the very task that was just reported on.
    db.flush()
    if from_date is None:
        from_date = rebuild_start_date(db, goal, today)
    skip = reported_dates(db, goal, from_date)
    for task in db.scalars(
        select(ScheduledTask).where(
            ScheduledTask.goal_id == goal.id,
            ScheduledTask.date >= from_date,
            ScheduledTask.completed.is_(False),
            ScheduledTask.actual_quantity.is_(None),
        )
    ):
        db.delete(task)
    db.flush()
    for t in build_schedule(
        goal, from_date, availability=goal.user.availability, skip_dates=skip
    ):
        db.add(ScheduledTask(**t))
    goal.replanned_on = today


def apply_progress(
    material: Material,
    amount: float,
    start_unit: ProgressUnit | None = None,
    absolute: bool = False,
) -> None:
    """Record progress on a material, cascading across its units in order.

    absolute=True sets the material's total completed amount ("I'm on page 120");
    otherwise `amount` is added starting at start_unit (a Today task logging
    more than planned spills into the following units).
    """
    from datetime import datetime, timezone

    units = sorted(material.progress_units, key=lambda u: (u.position, u.id))
    now = datetime.now(timezone.utc)

    if absolute:
        left = max(amount, 0.0)
        for u in units:
            u.completed_quantity = min(left, u.quantity)
            left -= u.completed_quantity
            u.completed_at = now if u.is_completed else None
        return

    idx = units.index(start_unit) if start_unit in units else 0
    left = amount
    if left >= 0:
        for u in units[idx:]:
            take = min(left, u.quantity - u.completed_quantity)
            u.completed_quantity += take
            left -= take
            u.completed_at = now if u.is_completed else None
            if left <= EPS:
                break
    else:
        # Unwind from the tail, not from start_unit. Progress across a material's
        # units is a prefix — build_schedule reads completed_quantity as "how far
        # in are we" — so removing from the middle would punch a hole the offset
        # maths then misreads. Taking back the most recently filled work first is
        # the exact inverse of the forward cascade, including any overshoot that
        # spilled into later units.
        remaining = -left
        for u in reversed(units):
            take = min(remaining, u.completed_quantity)
            u.completed_quantity -= take
            remaining -= take
            u.completed_at = now if u.is_completed else None
            if remaining <= EPS:
                break
