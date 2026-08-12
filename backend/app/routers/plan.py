from datetime import datetime, timedelta, timezone

from fastapi import APIRouter, Depends, HTTPException, status
from sqlalchemy import func, select
from sqlalchemy.orm import Session

from ..database import get_db
from ..deps import get_current_user, get_own_goal
from ..models import Goal, GoalStatus, ProgressUnit, ScheduledTask, User
from ..schemas import (
    CalendarTaskOut,
    DashboardGoal,
    DashboardOut,
    GoalOut,
    PlanOut,
    ScheduledTaskOut,
    ScheduledTaskUpdate,
    TaskUpdateOut,
    TodayMission,
    TodayOut,
    UserOut,
)
from ..services import engine

router = APIRouter(tags=["planning"])


def _today():
    return datetime.now().date()


def _ensure_schedule(db: Session, goal: Goal, today) -> None:
    """A goal with materials but no schedule yet gets one built on first read."""
    has_any = db.scalar(select(ScheduledTask.id).where(ScheduledTask.goal_id == goal.id))
    if has_any is None and goal.materials:
        engine.rebuild_schedule(db, goal, today)
        db.commit()


@router.get("/goals/{goal_id}/plan", response_model=PlanOut)
def get_plan(goal: Goal = Depends(get_own_goal)):
    today = _today()
    return PlanOut(
        goal=GoalOut.model_validate(goal),
        materials=engine.build_material_plans(goal, today),
        reality=engine.build_reality_report(goal, today),
    )


def _today_payload(db: Session, user: User) -> TodayOut:
    today = _today()
    goals = db.scalars(
        select(Goal)
        .where(Goal.user_id == user.id, Goal.status == GoalStatus.active)
        .order_by(Goal.deadline)
    ).all()
    missions = []
    for g in goals:
        _ensure_schedule(db, g, today)
        tasks = db.scalars(
            select(ScheduledTask)
            .where(ScheduledTask.goal_id == g.id, ScheduledTask.date == today)
            .order_by(ScheduledTask.id)
        ).all()
        r = engine.build_reality_report(g, today)
        plans = {p.material_id: p for p in engine.build_material_plans(g, today)}
        outs = []
        for t in tasks:
            out = ScheduledTaskOut.model_validate(t)
            p = plans.get(t.material_id)
            if p is not None:
                why = (
                    f"{p.name} is at {_fmt_qty(p.completed)}/{_fmt_qty(p.total)} {p.unit}. "
                    f"Hitting the deadline requires {p.human_rate}"
                )
                if r.days_behind > 0:
                    why += (
                        f" — and you are {r.days_behind} days behind, so today's share "
                        f"is {_fmt_qty(t.quantity)} {p.unit}."
                    )
                else:
                    why += f"; today's share is {_fmt_qty(t.quantity)} {p.unit}."
                out.why = why
            outs.append(out)
        missions.append(
            TodayMission(
                goal_id=g.id,
                title=g.title,
                status=r.status,
                days_behind=r.days_behind,
                message=r.message,
                tasks=outs,
            )
        )
    return TodayOut(date=today, missions=missions)


@router.get("/calendar", response_model=list[CalendarTaskOut])
def calendar_view(
    start: str,
    end: str,
    user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    """All scheduled tasks across the user's missions in [start, end] — the in-app calendar."""
    from datetime import date as date_cls

    try:
        start_d, end_d = date_cls.fromisoformat(start), date_cls.fromisoformat(end)
    except ValueError:
        raise HTTPException(status.HTTP_422_UNPROCESSABLE_ENTITY, "Dates must be YYYY-MM-DD")
    today = _today()
    goals = db.scalars(
        select(Goal).where(Goal.user_id == user.id, Goal.status == GoalStatus.active)
    ).all()
    for g in goals:
        _ensure_schedule(db, g, today)
    tasks = db.scalars(
        select(ScheduledTask)
        .join(Goal, ScheduledTask.goal_id == Goal.id)
        .where(Goal.user_id == user.id, ScheduledTask.date >= start_d, ScheduledTask.date <= end_d)
        .order_by(ScheduledTask.date, ScheduledTask.id)
    ).all()
    out = []
    for t in tasks:
        row = ScheduledTaskOut.model_validate(t).model_dump()
        row["description"] = _settled_description(db, t)
        out.append(CalendarTaskOut(**row, goal_title=t.goal.title))
    return out


@router.get("/today", response_model=TodayOut)
def today_all(user: User = Depends(get_current_user), db: Session = Depends(get_db)):
    """The execution view: today's tasks across all active missions."""
    return _today_payload(db, user)


@router.post("/today/more", response_model=TodayOut)
def do_more(user: User = Depends(get_current_user), db: Session = Depends(get_db)):
    """'Wanna do more?' — pull each mission's next scheduled day into today."""
    today = _today()
    goals = db.scalars(
        select(Goal).where(Goal.user_id == user.id, Goal.status == GoalStatus.active)
    ).all()
    for g in goals:
        next_date = db.scalar(
            select(func.min(ScheduledTask.date)).where(
                ScheduledTask.goal_id == g.id,
                ScheduledTask.date > today,
                ScheduledTask.completed.is_(False),
            )
        )
        if next_date is not None:
            for task in db.scalars(
                select(ScheduledTask).where(
                    ScheduledTask.goal_id == g.id, ScheduledTask.date == next_date
                )
            ):
                task.date = today
    db.commit()
    return _today_payload(db, user)


def _fmt_qty(x: float) -> str:
    return f"{x:.1f}".rstrip("0").rstrip(".")


def _settled_description(db: Session, task: ScheduledTask) -> str:
    """How a finished-with day should read once it is in the past.

    A task's description is a snapshot: "pages 23-25" is stamped in when the row
    is built, from the material's position at that moment. For a day that was
    *done*, that range is real history. For a day that was not, the work has
    since been re-planned and those exact pages mean nothing — yet the row keeps
    claiming them, so a missed Tuesday saying "pages 23-25" sits next to a
    correctly re-planned Wednesday saying "pages 21-23" and the app looks like
    it is walking backwards. That is what it looked like to the owner on
    2026-08-12, and the numbers were right the whole time.

    So an unfinished past day states what it owed, not which pages it named.
    Whole discrete items (a mock exam) keep their title — it identifies the
    thing rather than a position, so it cannot go stale.
    """
    if task.completed or task.date >= _today():
        return task.description
    unit = db.get(ProgressUnit, task.progress_unit_id) if task.progress_unit_id else None
    if unit is None or unit.material is None or task.quantity >= unit.quantity - engine.EPS:
        return task.description
    m = unit.material
    owed = f"{m.name}: {_fmt_qty(task.quantity)} {m.unit}"
    return owed if task.actual_quantity is not None else f"{owed} — not done"


@router.patch("/tasks/{task_id}", response_model=TaskUpdateOut)
def update_task(
    task_id: int,
    payload: ScheduledTaskUpdate,
    user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    task = db.get(ScheduledTask, task_id)
    if task is None or task.goal.user_id != user.id:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Task not found")

    overshoot = 0.0
    message: str | None = None
    unit = db.get(ProgressUnit, task.progress_unit_id) if task.progress_unit_id else None
    material = unit.material if unit is not None else None

    # What this row currently claims to have contributed. A row ticked before
    # actual_quantity existed carries no amount, and the only honest reading of
    # it is the full planned quantity.
    previous = task.actual_quantity
    if previous is None:
        previous = task.quantity if task.completed else 0.0

    if payload.completed:
        actual = payload.actual_quantity if payload.actual_quantity is not None else task.quantity
        task.actual_quantity = actual
        # Done means the work is done, not that the day was reported on. A day
        # logged at zero — or at less than planned — is reported, not finished.
        task.completed = actual >= task.quantity - engine.EPS
    else:
        # Untick: the day goes back to never-reported, so a later rebuild is free
        # to move it again.
        actual = 0.0
        task.actual_quantity = None
        task.completed = False

    # Only the difference is applied, which makes re-logging a day a correction
    # rather than a second helping.
    delta = actual - previous
    if material is not None and abs(delta) > engine.EPS:
        engine.apply_progress(material, delta, start_unit=unit)

    if payload.completed and unit is not None and material is not None:
        overshoot = actual - task.quantity
        u = unit.unit
        if actual <= engine.EPS:
            message = (
                f"Logged nothing done. All {_fmt_qty(task.quantity)} {u} "
                "go back into the plan."
            )
        elif overshoot > engine.EPS:
            message = (
                f"Nice — {_fmt_qty(overshoot)} {u} ahead of plan. "
                "I've reduced the rest of your week."
            )
        elif overshoot < -engine.EPS:
            message = (
                f"Logged {_fmt_qty(actual)} {u}. The remaining "
                f"{_fmt_qty(-overshoot)} moved into your future schedule."
            )

    # Progress changed → redistribute. Editing today's row rebuilds from tomorrow,
    # because rebuilding from today would delete or duplicate the row being
    # toggled. Correcting an *earlier* day has to re-evaluate today as well, or
    # today keeps showing a plan computed from a position that no longer holds —
    # which is what let a missed day quietly disappear from the schedule.
    today = _today()
    if task.date >= today:
        engine.rebuild_schedule(db, task.goal, today, from_date=today + timedelta(days=1))
    else:
        engine.rebuild_schedule(db, task.goal, today)
    db.commit()
    db.refresh(task)
    return TaskUpdateOut(
        task=ScheduledTaskOut.model_validate(task), overshoot=round(overshoot, 2), message=message
    )


@router.get("/goals/{goal_id}/schedule", response_model=list[ScheduledTaskOut])
def get_schedule(
    days: int = 14,
    goal: Goal = Depends(get_own_goal),
    db: Session = Depends(get_db),
):
    """Upcoming schedule, starting today."""
    today = _today()
    _ensure_schedule(db, goal, today)
    tasks = db.scalars(
        select(ScheduledTask)
        .where(ScheduledTask.goal_id == goal.id, ScheduledTask.date >= today)
        .order_by(ScheduledTask.date, ScheduledTask.id)
    ).all()
    cutoff_seen: set = set()
    out = []
    for t in tasks:
        cutoff_seen.add(t.date)
        if len(cutoff_seen) > days:
            break
        out.append(t)
    return out


@router.post("/goals/{goal_id}/schedule/rebuild", response_model=list[ScheduledTaskOut])
def rebuild(goal: Goal = Depends(get_own_goal), db: Session = Depends(get_db)):
    today = _today()
    engine.rebuild_schedule(db, goal, today)
    db.commit()
    return db.scalars(
        select(ScheduledTask)
        .where(ScheduledTask.goal_id == goal.id, ScheduledTask.date == today)
        .order_by(ScheduledTask.id)
    ).all()


@router.get("/goals/{goal_id}/history", response_model=list[ScheduledTaskOut])
def history(goal: Goal = Depends(get_own_goal), db: Session = Depends(get_db)):
    tasks = db.scalars(
        select(ScheduledTask)
        .where(ScheduledTask.goal_id == goal.id, ScheduledTask.date < _today())
        .order_by(ScheduledTask.date.desc(), ScheduledTask.id)
    ).all()
    out = []
    for t in tasks:
        row = ScheduledTaskOut.model_validate(t)
        row.description = _settled_description(db, t)
        out.append(row)
    return out


@router.get("/dashboard", response_model=DashboardOut)
def dashboard(user: User = Depends(get_current_user), db: Session = Depends(get_db)):
    goals = db.scalars(
        select(Goal)
        .where(Goal.user_id == user.id, Goal.status == GoalStatus.active)
        .order_by(Goal.deadline)
    ).all()
    today = _today()
    out = []
    for g in goals:
        _ensure_schedule(db, g, today)
        todays = db.scalars(
            select(ScheduledTask)
            .where(ScheduledTask.goal_id == g.id, ScheduledTask.date == today)
            .order_by(ScheduledTask.id)
        ).all()
        next_move = next((t.description for t in todays if not t.completed), None)
        out.append(
            DashboardGoal(
                goal=GoalOut.model_validate(g),
                progress_pct=round(engine.overall_progress_pct(g), 1),
                days_remaining=engine.days_remaining(g, today),
                reality=engine.build_reality_report(g, today),
                next_move=next_move,
                today_total=len(todays),
                today_done=sum(1 for t in todays if t.completed),
            )
        )
    return DashboardOut(user=UserOut.model_validate(user), goals=out)
