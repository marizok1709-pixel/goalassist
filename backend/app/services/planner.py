"""The planner. Pure: dataclasses in, a Plan out. No DB, no HTTP, no framework.

    plan(missions, capacity, history, today) -> Plan

Note the signature takes a *list* of missions. Feasibility is a property of the
student, not of a mission: one capacity pool, and every mission competes in it.
Asked one at a time, two missions that each fit comfortably will both answer
"fine" while collectively needing double the hours that exist.

Time is the scheduling currency; units are presentation. Everything converts to
minutes internally, which is what lets two missions measured in pages and in
problems compete on one axis at all.

Five stages, each independently testable:

    1. Demand            remaining units x minutes per unit, per mission
    2. Effective capacity raw availability, capped (see params)
    3. Allocation        weekly floor first, then demand-rate share
    4. Feasibility       per mission and portfolio-wide
    5. Schedule          allocated minutes -> units -> contiguous ranges

**The invariant that matters.** Stage 5 allocates in minutes and converts to
units, but a material's position advances through **one cursor**, and the range
belongs to the cursor rather than to the conversion. Rounding per day otherwise
drifts: days would overlap or leave holes, and the schedule would claim pages
the student had already read. That is precisely the defect this product shipped
once — a Saturday saying "pages 24-26" beside a Sunday saying "pages 22-24" —
and it must not return wearing minutes.

The forward plan is **never persisted**. It is recomputed here on every read from
the mission's live position. Nothing downstream stores a future day, so nothing
downstream can go stale.
"""

from __future__ import annotations

from dataclasses import dataclass, field
from datetime import date, timedelta

from . import params

WEEKDAY_KEYS = ["mon", "tue", "wed", "thu", "fri", "sat", "sun"]

PRIORITY_HIGH = "HIGH"
PRIORITY_NORMAL = "NORMAL"
PRIORITY_PAUSED = "PAUSED"

# A HIGH mission's demand counts double when shares are computed. It does not
# get absolute precedence — starving the other mission is what the floor exists
# to prevent.
HIGH_PRIORITY_WEIGHT = 2.0


# ---------- Inputs ----------


@dataclass(frozen=True)
class MaterialIn:
    id: int
    name: str
    unit: str
    total_units: float
    completed_units: float
    minutes_per_unit: float | None = None
    # Sub-ranges of the material, in order, as (id, title, quantity, completed).
    # A mission that declares a mock exam as one indivisible item needs the
    # boundary respected; a 400-page book is a single segment.
    segments: tuple[tuple[int, str, float, float], ...] = ()

    @property
    def remaining_units(self) -> float:
        return max(self.total_units - self.completed_units, 0.0)

    @property
    def effective_minutes_per_unit(self) -> float:
        if self.minutes_per_unit is None or self.minutes_per_unit <= 0:
            return params.NOMINAL_MINUTES_PER_UNIT
        return self.minutes_per_unit

    @property
    def has_estimate(self) -> bool:
        return self.minutes_per_unit is not None and self.minutes_per_unit > 0


@dataclass(frozen=True)
class MissionIn:
    id: int
    title: str
    deadline: date
    start_date: date
    materials: tuple[MaterialIn, ...] = ()
    priority: str = PRIORITY_NORMAL

    @property
    def remaining_minutes(self) -> float:
        return sum(m.remaining_units * m.effective_minutes_per_unit for m in self.materials)

    @property
    def has_estimates(self) -> bool:
        """True only if every material with work left carries a real estimate."""
        pending = [m for m in self.materials if m.remaining_units > params.EPS]
        return bool(pending) and all(m.has_estimate for m in pending)

    @property
    def is_done(self) -> bool:
        return all(m.remaining_units <= params.EPS for m in self.materials)


@dataclass(frozen=True)
class CapacityIn:
    """Weekly rhythm, in minutes per weekday."""

    weekly_minutes: dict[str, float] = field(default_factory=dict)

    def raw_minutes(self, d: date) -> float:
        if not self.weekly_minutes:
            # No rhythm declared: treat every day alike rather than scheduling
            # nothing. The value is arbitrary but consistent, and any mission
            # without minute estimates never presents it as a duration anyway.
            return params.DAILY_EFFECTIVE_CAP_MINUTES
        return max(float(self.weekly_minutes.get(WEEKDAY_KEYS[d.weekday()], 0.0) or 0.0), 0.0)

    def effective_minutes(self, d: date) -> float:
        return min(self.raw_minutes(d), params.DAILY_EFFECTIVE_CAP_MINUTES)

    @property
    def weekly_total_minutes(self) -> float:
        return sum(min(max(v, 0.0), params.DAILY_EFFECTIVE_CAP_MINUTES)
                   for v in self.weekly_minutes.values()) if self.weekly_minutes else 0.0


@dataclass(frozen=True)
class RecordIn:
    """A day that already happened. History, never a plan."""

    mission_id: int
    date: date
    planned_units: float
    actual_units: float
    actual_minutes: float | None = None
    status: str = "COMPLETED"


# ---------- Outputs ----------


@dataclass
class DayAssignment:
    date: date
    mission_id: int
    material_id: int
    units: float
    minutes: float
    label: str
    beyond_deadline: bool = False


@dataclass
class MissionPlan:
    mission_id: int
    title: str
    deadline: date
    verdict: str
    verdict_alone: str
    required_minutes: float
    allocated_minutes: float
    remaining_units: float
    uses_minutes: bool
    projected_finish: date | None
    days_late: int
    required_units_per_hour: float | None
    pace_planned_units: float
    pace_actual_units: float | None
    days: list[DayAssignment] = field(default_factory=list)

    @property
    def fits(self) -> bool:
        return self.verdict not in (params.VERDICT_OVER,)


@dataclass
class Plan:
    today: date
    verdict: str
    required_minutes: float
    available_minutes: float
    daily_cap_minutes: float
    missions: list[MissionPlan] = field(default_factory=list)

    def for_mission(self, mission_id: int) -> MissionPlan | None:
        return next((m for m in self.missions if m.mission_id == mission_id), None)

    def assignments_on(self, d: date) -> list[DayAssignment]:
        return [a for m in self.missions for a in m.days if a.date == d]


# ---------- Stage 4 helper ----------


def verdict_for(available: float, required: float) -> str:
    if required <= params.EPS:
        return params.VERDICT_COMPLETED
    ratio = available / required
    for floor, name in params.VERDICT_BANDS:
        if ratio >= floor:
            return name
    return params.VERDICT_OVER


# ---------- Stage 3 helper ----------


def _week_start(d: date) -> date:
    return d - timedelta(days=d.weekday())


def _allocate_day_shares(
    day: date,
    active: list[MissionIn],
    demand_rate: dict[int, float],
    floor_owner: dict[date, int],
) -> dict[int, float]:
    """What fraction of this day each mission gets.

    A day reserved by the floor goes wholly to its owner. Every other day splits
    by demand rate, so a nearer deadline draws more without a separate rule.
    """
    if not active:
        return {}
    owner = floor_owner.get(day)
    if owner is not None:
        holder = next((m for m in active if m.id == owner), None)
        if holder is not None:
            return {holder.id: 1.0}
    total = sum(demand_rate.get(m.id, 0.0) for m in active)
    if total <= params.EPS:
        share = 1.0 / len(active)
        return {m.id: share for m in active}
    return {m.id: demand_rate.get(m.id, 0.0) / total for m in active}


def _assign_floor_days(
    study_days: list[date], active: list[MissionIn], demand_rate: dict[int, float]
) -> dict[date, int]:
    """Reserve whole study days, one per mission per week.

    Taken from the end of each week so the demand-driven split keeps the early
    days, and handed out least-urgent-first so the mission that would otherwise
    be starved gets the earlier of the reserved days.
    """
    reserved: dict[date, int] = {}
    if len(active) < 2:
        return reserved
    by_week: dict[date, list[date]] = {}
    for d in study_days:
        by_week.setdefault(_week_start(d), []).append(d)
    order = sorted(active, key=lambda m: demand_rate.get(m.id, 0.0))
    for week_days in by_week.values():
        take = min(len(order), len(week_days), len(active) * params.WEEKLY_FLOOR_SLOTS)
        # The last `take` days of the week, earliest of them to the least urgent.
        for i, day in enumerate(week_days[len(week_days) - take:]):
            reserved[day] = order[i % len(order)].id
    return reserved


# ---------- Stage 5 helper ----------


def _segments_of(material: MaterialIn) -> list[list]:
    """Remaining work as ordered [start_offset, available, title, whole] chunks.

    Mirrors the cursor walk the pre-pivot engine used, so ranges stay contiguous
    and a discrete item keeps its own title instead of being sliced into a page
    range that means nothing.
    """
    out: list[list] = []
    if material.segments:
        offset = 0.0
        for _sid, title, qty, done in material.segments:
            left = qty - done
            if left > params.EPS:
                out.append([offset + done, left, title, done <= params.EPS and left >= qty])
            offset += qty
        return out
    left = material.remaining_units
    if left > params.EPS:
        out.append([material.completed_units, left, material.name, material.completed_units <= params.EPS])
    return out


def _label(material: MaterialIn, start_abs: float, take: float, whole: bool, title: str) -> str:
    if whole and take >= (material.total_units if not material.segments else take) - params.EPS:
        return title
    return f"{material.name}: {material.unit} {int(start_abs) + 1}-{int(round(start_abs + take))}"


# ---------- The engine ----------


def plan(
    missions: list[MissionIn],
    capacity: CapacityIn,
    history: list[RecordIn],
    today: date,
) -> Plan:
    active = [m for m in missions if m.priority != PRIORITY_PAUSED and not m.is_done]

    # ---- Stage 1: demand ----
    required = {m.id: m.remaining_minutes for m in missions}

    # ---- Stage 2 + 3 preparation ----
    # Demand rate is minutes-per-study-day-remaining, so a nearer deadline
    # automatically pulls a larger share without a separate urgency rule.
    demand_rate: dict[int, float] = {}
    for m in active:
        days = _study_days_between(capacity, today, m.deadline)
        n = max(len(days), 1)
        rate = required[m.id] / n
        if m.priority == PRIORITY_HIGH:
            rate *= HIGH_PRIORITY_WEIGHT
        demand_rate[m.id] = rate

    horizon_end = max(
        [m.deadline for m in missions] + [today]
    ) + timedelta(days=params.PROJECTION_HORIZON_DAYS)
    all_study_days = _study_days_between(capacity, today, horizon_end)
    floor_owner = _assign_floor_days(all_study_days, active, demand_rate)

    # For each mission, how many study days remain between day i and its
    # deadline. The spread target is recomputed against this every day rather
    # than fixed once: whole-unit rounding loses a fraction most days, and a
    # fixed target lets that shortfall accumulate until the tail slides past the
    # deadline. Dividing what is *left* by the days that are *left* absorbs it —
    # the same self-correction the pre-pivot engine got from cumulative rounding.
    days_left: dict[int, list[int]] = {}
    for m in active:
        counts = [0] * (len(all_study_days) + 1)
        for i in range(len(all_study_days) - 1, -1, -1):
            counts[i] = counts[i + 1] + (1 if all_study_days[i] <= m.deadline else 0)
        days_left[m.id] = counts

    # ---- Stage 5: walk the calendar, one cursor per material ----
    cursors: dict[int, list[list]] = {}
    for m in missions:
        for mat in m.materials:
            cursors[mat.id] = _segments_of(mat)

    assignments: dict[int, list[DayAssignment]] = {m.id: [] for m in missions}
    allocated: dict[int, float] = {m.id: 0.0 for m in missions}
    allocated_by_deadline: dict[int, float] = {m.id: 0.0 for m in missions}
    finished_on: dict[int, date | None] = {m.id: None for m in missions}
    outstanding = {m.id for m in active}

    for day_index, day in enumerate(all_study_days):
        if not outstanding:
            break
        day_minutes = capacity.effective_minutes(day)
        if day_minutes <= params.EPS:
            continue
        live = [m for m in active if m.id in outstanding]
        shares = _allocate_day_shares(day, live, demand_rate, floor_owner)

        # Two passes. First everyone takes the smaller of their fair share and
        # what an even spread would ask for. Then whatever that leaves goes to
        # the missions that wanted more — otherwise a mission held back by its
        # own comfortable deadline would leave capacity idle beside one that is
        # drowning.
        want: dict[int, float] = {}
        budgets: dict[int, float] = {}
        for mission in live:
            left = _remaining_minutes(mission, cursors)
            ahead = days_left[mission.id][day_index]
            # Past the deadline there is no spread left to respect: finish it.
            target = left if ahead <= 0 else left / ahead
            want[mission.id] = min(left, max(target, 0.0))
            budgets[mission.id] = min(day_minutes * shares.get(mission.id, 0.0), want[mission.id])

        leftover = day_minutes - sum(budgets.values())
        if leftover > params.EPS:
            hungry = [m for m in live if want[m.id] - budgets[m.id] > params.EPS]
            total_rate = sum(demand_rate.get(m.id, 0.0) for m in hungry)
            for mission in hungry:
                weight = (
                    demand_rate.get(mission.id, 0.0) / total_rate
                    if total_rate > params.EPS
                    else 1.0 / len(hungry)
                )
                budgets[mission.id] += min(leftover * weight, want[mission.id] - budgets[mission.id])

        for mission in live:
            budget = budgets.get(mission.id, 0.0)
            if budget <= params.EPS:
                continue
            spent = _spend(mission, cursors, budget, day, assignments[mission.id])
            allocated[mission.id] += spent
            if day <= mission.deadline:
                allocated_by_deadline[mission.id] += spent
            if all(
                sum(seg[1] for seg in cursors[mat.id]) <= params.EPS for mat in mission.materials
            ):
                finished_on[mission.id] = day
                outstanding.discard(mission.id)

    # ---- Stage 4: feasibility, per mission and portfolio-wide ----
    pace_actual = _actual_pace(history)
    mission_plans: list[MissionPlan] = []
    for m in missions:
        req = required[m.id]
        alone_available = sum(
            capacity.effective_minutes(d) for d in _study_days_between(capacity, today, m.deadline)
        )
        by_deadline = allocated_by_deadline[m.id]
        uses_minutes = m.has_estimates

        if m.is_done:
            verdict = verdict_alone = params.VERDICT_COMPLETED
        elif not uses_minutes:
            verdict = verdict_alone = params.VERDICT_NO_ESTIMATE
        else:
            verdict = verdict_for(by_deadline, req)
            verdict_alone = verdict_for(alone_available, req)

        finish = finished_on[m.id]
        days_late = max((finish - m.deadline).days, 0) if finish else 0
        remaining_units = sum(mat.remaining_units for mat in m.materials)
        study_days_left = max(len(_study_days_between(capacity, today, m.deadline)), 1)
        uph = (
            remaining_units / (by_deadline / 60.0)
            if by_deadline > params.EPS and remaining_units > params.EPS
            else None
        )

        for a in assignments[m.id]:
            a.beyond_deadline = a.date > m.deadline

        mission_plans.append(
            MissionPlan(
                mission_id=m.id,
                title=m.title,
                deadline=m.deadline,
                verdict=verdict,
                verdict_alone=verdict_alone,
                required_minutes=round(req, 2),
                allocated_minutes=round(by_deadline, 2),
                remaining_units=remaining_units,
                uses_minutes=uses_minutes,
                # A date is only meaningful when the minutes behind it are real.
                projected_finish=finish if uses_minutes else None,
                days_late=days_late if uses_minutes else 0,
                required_units_per_hour=round(uph, 2) if uph is not None else None,
                pace_planned_units=round(remaining_units / study_days_left, 2),
                pace_actual_units=pace_actual,
                days=assignments[m.id],
            )
        )

    total_required = sum(required[m.id] for m in active)
    total_available = sum(allocated_by_deadline[m.id] for m in active)
    rated = [p for p in mission_plans if p.verdict not in
             (params.VERDICT_COMPLETED, params.VERDICT_NO_ESTIMATE)]
    if not rated:
        portfolio = mission_plans[0].verdict if mission_plans else params.VERDICT_COMPLETED
    else:
        # The portfolio is only as feasible as its worst mission — that is what
        # makes two individually-fine missions read as over capacity together.
        order = [params.VERDICT_OVER, "TIGHT", "FEASIBLE", "COMFORTABLE"]
        portfolio = min(rated, key=lambda p: order.index(p.verdict)).verdict

    return Plan(
        today=today,
        verdict=portfolio,
        required_minutes=round(total_required, 2),
        available_minutes=round(total_available, 2),
        daily_cap_minutes=params.DAILY_EFFECTIVE_CAP_MINUTES,
        missions=mission_plans,
    )


def _spend(
    mission: MissionIn,
    cursors: dict[int, list[list]],
    budget: float,
    day: date,
    out: list[DayAssignment],
) -> float:
    """Turn a minute budget into whole units of work, advancing the cursor.

    Materials are taken in declaration order; the cursor is the authority on
    which units those minutes buy, so consecutive days can never overlap or skip.
    """
    spent = 0.0
    for mat in mission.materials:
        segs = cursors[mat.id]
        mpu = mat.effective_minutes_per_unit
        while budget > params.EPS and segs:
            start_abs, available, title, whole = segs[0]
            affordable = budget / mpu
            take = min(available, affordable)
            # Whole units only — half a page is not an instruction. Round to the
            # nearest unit, but never round a real budget down to nothing or the
            # walk stalls and the projection never terminates.
            take = float(round(take)) if take >= 0.5 else (min(1.0, available) if affordable >= 0.5 else 0.0)
            if take <= params.EPS:
                break
            take = min(take, available)
            out.append(
                DayAssignment(
                    date=day,
                    mission_id=mission.id,
                    material_id=mat.id,
                    units=take,
                    minutes=round(take * mpu, 2),
                    label=_label(mat, start_abs, take, whole, title),
                )
            )
            cost = take * mpu
            budget -= cost
            spent += cost
            segs[0][0] = start_abs + take
            segs[0][1] = available - take
            segs[0][3] = False
            if segs[0][1] <= params.EPS:
                segs.pop(0)
    return spent


def _remaining_minutes(mission: MissionIn, cursors: dict[int, list[list]]) -> float:
    """Work still unscheduled for this mission, in minutes, as the walk stands."""
    return sum(
        sum(seg[1] for seg in cursors[mat.id]) * mat.effective_minutes_per_unit
        for mat in mission.materials
    )


def _study_days_between(capacity: CapacityIn, start: date, end: date) -> list[date]:
    if end < start:
        return []
    out = []
    d = start
    while d <= end:
        if capacity.effective_minutes(d) > params.EPS:
            out.append(d)
        d += timedelta(days=1)
    return out


def _actual_pace(history: list[RecordIn]) -> float | None:
    """Observed units per study day over the trailing window.

    Only days that were actually reported on count. A day nobody spoke about is
    absence of evidence, and averaging a zero into it would report a slowdown
    that may never have happened.
    """
    reported = sorted(
        (r for r in history if r.status in ("COMPLETED", "PARTIAL")),
        key=lambda r: r.date,
        reverse=True,
    )[: params.PACE_WINDOW_STUDY_DAYS]
    if not reported:
        return None
    return round(sum(r.actual_units for r in reported) / len(reported), 2)
