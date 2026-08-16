"""Does this fit? — asked before the mission exists.

The old reality report could only speak about a persisted Goal, so the product
could only tell a student their plan was impossible *after* they had committed
to it. That is the wrong order: the moment the brand claim is earned or lost is
the moment before creation, and by then the arithmetic is already knowable.

The verdict is computed here, server-side, once. The client must not carry a
second implementation of it — two answers to "does this fit" is exactly the kind
of contradiction this product exists not to have.

Nothing is written. The student can go back, change the deadline, cut the scope,
raise their availability, or start anyway, and only that last choice persists.
"""

from datetime import timedelta

from fastapi import APIRouter, Depends
from sqlalchemy import select
from sqlalchemy.orm import Session

from ..database import get_db
from ..deps import get_current_user
from ..models import Goal, GoalStatus, User
from ..schemas import FeasibilityOut, FeasibilityRequest
from ..services import adapter, clock, params
from ..services.planner import CapacityIn, MaterialIn, MissionIn, plan

router = APIRouter(tags=["planning"])

# The id given to the hypothetical mission. Negative so it can never collide
# with a real goal in the same portfolio.
DRAFT_ID = -1


@router.post("/plan/preview", response_model=FeasibilityOut)
def preview(
    payload: FeasibilityRequest,
    user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    today = clock.today_for(user)

    capacity = (
        CapacityIn({d: float(h or 0.0) * 60.0 for d, h in payload.availability.items()})
        if payload.availability is not None
        else adapter.capacity_of(user)
    )

    draft = MissionIn(
        id=DRAFT_ID,
        title=payload.title or "New mission",
        deadline=payload.deadline,
        start_date=today,
        materials=tuple(
            MaterialIn(
                id=-(i + 1),
                name=m.name,
                unit=m.unit,
                total_units=m.total_quantity,
                completed_units=min(m.already_completed, m.total_quantity),
                minutes_per_unit=m.minutes_per_unit,
            )
            for i, m in enumerate(payload.materials)
        ),
    )

    # Feasibility is a property of the student, not of a mission — so the draft
    # is planned alongside everything already competing for the same hours.
    existing = db.scalars(
        select(Goal)
        .where(Goal.user_id == user.id, Goal.status == GoalStatus.active)
        .order_by(Goal.deadline)
    ).all()
    missions = [adapter.mission_of(g) for g in existing] + [draft]
    result = plan(missions, capacity, adapter.history_of(db, user), today)
    mp = result.for_mission(DRAFT_ID)

    return FeasibilityOut(
        verdict=mp.verdict,
        projected_finish=mp.projected_finish,
        deadline=payload.deadline,
        days_late=mp.days_late,
        required_minutes=mp.required_minutes,
        available_minutes=mp.allocated_minutes,
        daily_cap_minutes=result.daily_cap_minutes,
        required_units_per_hour=mp.required_units_per_hour,
        uses_minutes=mp.uses_minutes,
        suggested_deadline=mp.projected_finish if mp.days_late > 0 else None,
        suggested_scope=_scope_that_fits(mp, payload),
        suggested_weekly_hours=_hours_that_fit(mp, capacity),
        competing_missions=[g.title for g in existing],
    )


def _scope_that_fits(mp, payload: FeasibilityRequest) -> dict | None:
    """How much of the work the available time actually covers.

    Expressed in the student's own units so the trade is concrete — "420 of
    1,400 problems" rather than a percentage of an abstraction.
    """
    if mp.days_late <= 0 or mp.required_minutes <= params.EPS:
        return None
    fraction = min(mp.allocated_minutes / mp.required_minutes, 1.0)
    if fraction <= 0:
        return None
    first = payload.materials[0]
    remaining = max(first.total_quantity - first.already_completed, 0.0)
    return {
        "unit": first.unit,
        "units": round(first.already_completed + remaining * fraction),
        "of": first.total_quantity,
    }


def _hours_that_fit(mp, capacity: CapacityIn) -> float | None:
    """Weekly hours that would make the deadline, at the same rhythm.

    Scaled from what the current week already provides, then rounded up to the
    half hour — a number a student can act on rather than 11.63.
    """
    if mp.days_late <= 0 or mp.allocated_minutes <= params.EPS:
        return None
    weekly = capacity.weekly_total_minutes
    if weekly <= params.EPS:
        return None
    needed = weekly * (mp.required_minutes / mp.allocated_minutes)
    hours = needed / 60.0
    capped = 7 * params.DAILY_EFFECTIVE_CAP_MINUTES / 60.0
    if hours > capped:
        # More hours than a capped week contains; raising availability is not
        # the lever here, and offering it would be a lie.
        return None
    return round(hours * 2) / 2


@router.post("/goals/{goal_id}/acknowledge", response_model=dict)
def acknowledge(
    goal_id: int,
    user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    """The student has seen that the plan got heavier. Reset the quiet threshold.

    Until this is called the same change keeps being surfaced; after it, the
    plan is free to drift again by the same margin without interrupting.
    """
    goal = db.get(Goal, goal_id)
    if goal is None or goal.user_id != user.id:
        return {"ok": False}
    today = clock.today_for(user)
    result = adapter.plan_for(db, user, today)
    mp = result.for_mission(goal.id)
    if mp is not None:
        goal.acknowledged_load = _daily_load(mp, today)
    db.commit()
    return {"ok": True, "acknowledged_load": goal.acknowledged_load}


def _daily_load(mission_plan, today) -> float:
    """Minutes per remaining study day this plan is asking for."""
    days = {a.date for a in mission_plan.days if a.date >= today}
    if not days:
        return 0.0
    return round(sum(a.minutes for a in mission_plan.days if a.date >= today) / len(days), 2)


def load_changed(goal: Goal, mission_plan, today) -> bool:
    """Has the daily ask grown past what was last acknowledged?

    A metric that lurches on one missed Tuesday gets ignored within a fortnight,
    so a small rise is absorbed in silence — the plan simply holds more tomorrow.
    Only a real change earns an interruption.
    """
    if mission_plan is None:
        return False
    current = _daily_load(mission_plan, today)
    baseline = goal.acknowledged_load
    if baseline is None or baseline <= params.EPS:
        return False
    return current / baseline - 1.0 > params.LOAD_CHANGE_THRESHOLD
