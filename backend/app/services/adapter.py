"""The only place the database meets the planner.

`planner.py` is deliberately ignorant of SQLAlchemy: it takes frozen dataclasses
and returns a Plan. Something has to translate, and confining that to one module
is what keeps the engine testable without a database and keeps ORM lazy-loads out
of the arithmetic.

Nothing here decides anything. If a rule appears in this file, it is in the wrong
file.
"""

from datetime import date

from sqlalchemy import select
from sqlalchemy.orm import Session

from ..models import ExecutionRecord, Goal, GoalStatus, ScheduledTask, User
from .planner import CapacityIn, MaterialIn, MissionIn, Plan, RecordIn, plan


def capacity_of(user: User) -> CapacityIn:
    """Weekly availability, hours to minutes.

    These were relative weights before the pivot and are durations now; the
    schema layer enforces the bounds that makes safe.
    """
    hours = user.availability or {}
    return CapacityIn({day: float(h or 0.0) * 60.0 for day, h in hours.items()})


def material_of(material) -> MaterialIn:
    units = sorted(material.progress_units, key=lambda u: (u.position, u.id))
    completed = sum(min(u.completed_quantity, u.quantity) for u in units)
    # Sliced units may not cover the whole material yet; the un-sliced remainder
    # is still work to do. Mirrors `engine._material_progress`.
    total = max(sum(u.quantity for u in units), material.total_quantity)
    return MaterialIn(
        id=material.id,
        name=material.name,
        unit=material.unit,
        total_units=total,
        completed_units=completed,
        minutes_per_unit=material.minutes_per_unit,
        segments=tuple((u.id, u.title, u.quantity, u.completed_quantity) for u in units),
    )


def mission_of(goal: Goal) -> MissionIn:
    return MissionIn(
        id=goal.id,
        title=goal.title,
        deadline=goal.deadline,
        start_date=goal.start_date,
        materials=tuple(material_of(m) for m in goal.materials),
        priority=goal.priority.value if goal.priority is not None else "NORMAL",
    )


def history_of(db: Session, user: User) -> list[RecordIn]:
    """Days already reported on, newest first is not required — the planner sorts.

    Reads `ExecutionRecord` where it exists and falls back to reported
    `ScheduledTask` rows for missions whose history predates the table, so a
    student mid-mission does not lose their observed pace at the cutover.
    """
    records = db.scalars(
        select(ExecutionRecord)
        .join(Goal, ExecutionRecord.goal_id == Goal.id)
        .where(Goal.user_id == user.id)
    ).all()
    out = [
        RecordIn(
            mission_id=r.goal_id,
            date=r.date,
            planned_units=r.planned_units,
            actual_units=r.actual_units,
            actual_minutes=r.actual_minutes,
            status=r.status.value,
        )
        for r in records
    ]
    covered = {(r.goal_id, r.date) for r in records}
    legacy = db.scalars(
        select(ScheduledTask)
        .join(Goal, ScheduledTask.goal_id == Goal.id)
        .where(Goal.user_id == user.id)
    ).all()
    for t in legacy:
        if (t.goal_id, t.date) in covered or not t.logged:
            continue
        actual = t.actual_quantity if t.actual_quantity is not None else t.quantity
        out.append(
            RecordIn(
                mission_id=t.goal_id,
                date=t.date,
                planned_units=t.quantity,
                actual_units=actual,
                actual_minutes=None,
                status="COMPLETED" if t.completed else "PARTIAL",
            )
        )
    return out


def plan_for(db: Session, user: User, today: date) -> Plan:
    """The student's whole portfolio, planned as one. The public entry point."""
    goals = db.scalars(
        select(Goal)
        .where(Goal.user_id == user.id, Goal.status == GoalStatus.active)
        .order_by(Goal.deadline)
    ).all()
    return plan(
        [mission_of(g) for g in goals],
        capacity_of(user),
        history_of(db, user),
        today,
    )
