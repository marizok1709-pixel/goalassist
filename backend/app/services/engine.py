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

from sqlalchemy import select
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
        "AT_RISK": (
            f"You are {days_behind} days behind ({actual_pct:.0f}% done vs {expected_pct:.0f}% expected). "
            "At current speed you will miss the deadline unless you adjust."
        ),
        "OFF_TRACK": (
            f"WARNING: {days_behind} days behind — {actual_pct:.0f}% done vs {expected_pct:.0f}% expected. "
            "At current speed you WILL miss your deadline."
        ),
    }
    if status == "ON_TRACK" and elapsed == 0:
        messages["ON_TRACK"] = "Mission launched. Complete today's tasks to bend the curve."
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


def build_schedule(goal: Goal, from_date: date, availability: dict | None = None) -> list[dict]:
    """Distribute all remaining work over from_date..deadline (inclusive),
    weighted by the user's weekly availability.

    Returns dated task dicts. Never schedules beyond the deadline. Zero-hour
    days get nothing; slow-cadence materials (exams) land on spaced days via
    cumulative rounding. A day crossing a unit boundary yields one task per
    unit touched.
    """
    n_days = (goal.deadline - from_date).days + 1
    if n_days <= 0:
        return []

    weights = [day_weight(availability, from_date + timedelta(days=d)) for d in range(n_days)]
    total_weight = sum(weights)
    if total_weight <= 0:
        # Fully blocked week(s) — fall back to even distribution rather than
        # scheduling nothing at all.
        weights = [1.0] * n_days
        total_weight = float(n_days)
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


def rebuild_start_date(db: Session, goal: Goal, today: date) -> date:
    """Rebuild from today unless today's plan was already worked on (then tomorrow)."""
    worked_today = db.scalar(
        select(ScheduledTask.id).where(
            ScheduledTask.goal_id == goal.id,
            ScheduledTask.date == today,
            ScheduledTask.completed.is_(True),
        )
    )
    return today + timedelta(days=1) if worked_today else today


def rebuild_schedule(db: Session, goal: Goal, today: date, from_date: date | None = None) -> None:
    """Delete the not-yet-done future schedule and redistribute remaining work."""
    if from_date is None:
        from_date = rebuild_start_date(db, goal, today)
    for task in db.scalars(
        select(ScheduledTask).where(
            ScheduledTask.goal_id == goal.id,
            ScheduledTask.date >= from_date,
            ScheduledTask.completed.is_(False),
        )
    ):
        db.delete(task)
    db.flush()
    for t in build_schedule(goal, from_date, availability=goal.user.availability):
        db.add(ScheduledTask(**t))


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
        u = units[idx] if units else None
        if u is not None:
            u.completed_quantity = max(u.completed_quantity + left, 0.0)
            u.completed_at = now if u.is_completed else None
