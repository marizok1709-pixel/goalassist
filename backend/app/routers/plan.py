from datetime import datetime, timedelta, timezone

from fastapi import APIRouter, Depends, HTTPException, status
from sqlalchemy import inspect, select
from sqlalchemy.orm import Session

from ..database import get_db
from ..deps import get_current_user, get_own_goal
from ..models import (
    DayStatus,
    ExecutionRecord,
    Goal,
    GoalStatus,
    Material,
    ProgressUnit,
    ScheduledTask,
    User,
)
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
from ..services import adapter, clock, engine
from . import feasibility

router = APIRouter(tags=["planning"])


def _today(user: User | None = None):
    """The student's today, not the server's. See `services/clock.py`."""
    return clock.today_for(user)


def _sync_schedule(db: Session, goal: Goal, today) -> None:
    """Bring a mission's schedule up to date with the calendar before reading it.

    Two cases. A goal with materials and no schedule gets one built. A goal that
    has let a day go by unreported gets caught up — that day's work is still
    owed, and until the plan absorbs it every row after it is quoting a position
    the mission never reached.

    This is a write on a read path, which is why it is gated to once per day per
    mission by `goal.replanned_on` rather than run on every request.
    """
    if not goal.materials:
        return
    has_any = db.scalar(select(ScheduledTask.id).where(ScheduledTask.goal_id == goal.id))
    if has_any is None:
        engine.rebuild_schedule(db, goal, today)
        db.commit()
    elif engine.needs_replan(db, goal, today):
        engine.rebuild_schedule(db, goal, today)
        db.commit()


def _enrich(report, goal: Goal, portfolio, today):
    """Put the planner's answer on the report the screens already read.

    The percentages stay for now so nothing breaks mid-cutover, but they are no
    longer the headline: a projected finish date is checkable against a calendar,
    and "37% done" is not checkable against anything. Where the planner has no
    minutes to work from it says so rather than inventing a date.
    """
    mp = portfolio.for_mission(goal.id) if portfolio is not None else None
    if mp is None:
        return report
    if goal.acknowledged_load is None:
        # First sight of this mission. Record what it is asking for now, so the
        # threshold has a baseline and the student is never told the plan "got
        # heavier" than a plan they have never seen.
        goal.acknowledged_load = feasibility._daily_load(mp, today)
    report.verdict = mp.verdict
    report.projected_finish = mp.projected_finish
    report.days_late = mp.days_late
    report.required_units_per_hour = mp.required_units_per_hour
    report.pace_planned_units = mp.pace_planned_units
    report.pace_actual_units = mp.pace_actual_units
    report.minutes_today = round(sum(a.minutes for a in mp.days if a.date == today), 2)
    report.load_changed = feasibility.load_changed(goal, mp, today)
    if mp.projected_finish is not None:
        # Tone: state the date and the gap. No WARNING, no WILL, no capitals —
        # a metric that shouts gets tuned out, and the number is enough.
        if mp.days_late > 0:
            report.message = (
                f"At this pace you finish {mp.projected_finish:%b %-d} — "
                f"{mp.days_late} days after your deadline."
            )
        else:
            report.message = f"On pace to finish {mp.projected_finish:%b %-d}, inside your deadline."
    elif mp.required_units_per_hour:
        report.message = (
            f"No time estimate yet. Hitting the deadline means about "
            f"{round(mp.required_units_per_hour)} per hour of study."
        )
    return report


def _upcoming(db: Session, goal: Goal, today) -> list[ScheduledTask]:
    """Every row this mission still has ahead of it, in the order it will happen.

    The cursor walk in `derive_descriptions` has to see the whole tail, not the
    slice a given screen is showing — a range is only correct relative to what
    comes before it.
    """
    return list(
        db.scalars(
            select(ScheduledTask)
            .where(ScheduledTask.goal_id == goal.id, ScheduledTask.date >= today)
            .order_by(ScheduledTask.date, ScheduledTask.id)
        )
    )


@router.get("/goals/{goal_id}/plan", response_model=PlanOut)
def get_plan(goal: Goal = Depends(get_own_goal), db: Session = Depends(get_db)):
    today = _today(goal.user)
    portfolio = adapter.plan_for(db, goal.user, today)
    return PlanOut(
        goal=GoalOut.model_validate(goal),
        materials=engine.build_material_plans(goal, today),
        reality=_enrich(engine.build_reality_report(goal, today), goal, portfolio, today),
    )


def _today_payload(db: Session, user: User) -> TodayOut:
    today = _today(user)
    goals = db.scalars(
        select(Goal)
        .where(Goal.user_id == user.id, Goal.status == GoalStatus.active)
        .order_by(Goal.deadline)
    ).all()
    missions = []
    for g in goals:
        _sync_schedule(db, g, today)
    # One planner call for the whole portfolio, not one per mission: two missions
    # asked separately both answer "fine" while together needing double the hours
    # that exist.
    portfolio = adapter.plan_for(db, user, today)
    for g in goals:
        tasks = db.scalars(
            select(ScheduledTask)
            .where(ScheduledTask.goal_id == g.id, ScheduledTask.date == today)
            .order_by(ScheduledTask.id)
        ).all()
        r = _enrich(engine.build_reality_report(g, today), g, portfolio, today)
        plans = {p.material_id: p for p in engine.build_material_plans(g, today)}
        ranges = engine.derive_descriptions(g, _upcoming(db, g, today), today)
        outs = []
        # Minutes the planner budgeted for each material today, so a task can
        # say how long it should take rather than only how much it is.
        minutes_by_material: dict[int, float] = {}
        mp = portfolio.for_mission(g.id) if portfolio else None
        if mp is not None:
            for a in mp.days:
                if a.date == today:
                    minutes_by_material[a.material_id] = (
                        minutes_by_material.get(a.material_id, 0.0) + a.minutes
                    )
        for t in tasks:
            out = ScheduledTaskOut.model_validate(t)
            out.description = _display(db, t, ranges)
            out.minutes = round(minutes_by_material.get(t.material_id, 0.0), 1)
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
    today = _today(user)
    goals = db.scalars(
        select(Goal).where(Goal.user_id == user.id, Goal.status == GoalStatus.active)
    ).all()
    ranges: dict[int, str] = {}
    for g in goals:
        _sync_schedule(db, g, today)
        ranges.update(engine.derive_descriptions(g, _upcoming(db, g, today), today))
    tasks = db.scalars(
        select(ScheduledTask)
        .join(Goal, ScheduledTask.goal_id == Goal.id)
        .where(Goal.user_id == user.id, ScheduledTask.date >= start_d, ScheduledTask.date <= end_d)
        .order_by(ScheduledTask.date, ScheduledTask.id)
    ).all()
    out = []
    for t in tasks:
        row = ScheduledTaskOut.model_validate(t).model_dump()
        row["description"] = _display(db, t, ranges)
        out.append(CalendarTaskOut(**row, goal_title=t.goal.title))
    return out


@router.get("/today", response_model=TodayOut)
def today_all(user: User = Depends(get_current_user), db: Session = Depends(get_db)):
    """The execution view: today's tasks across all active missions."""
    return _today_payload(db, user)


# `POST /today/more` ("wanna do more?") used to live here. It moved the next
# scheduled day's rows onto today by reassigning `task.date`, which is how work
# ended up on a Saturday the owner had declared a zero-hour day, carrying a range
# computed for a different date. It could not be made correct: the schedule is a
# function of position, availability and deadline, and a row dragged forward
# changes none of those, so the work it names is still owed by the future too and
# the next rebuild schedules it twice. Doing more than planned is already said
# properly by logging more than planned — `actual_quantity` above the row's
# quantity spills into the following units and shrinks the rest of the week.


def _fmt_qty(x: float) -> str:
    return f"{x:.1f}".rstrip("0").rstrip(".")


def _display(db: Session, task: ScheduledTask, ranges: dict[int, str]) -> str:
    """What a row says on screen. Every read path must agree, or they contradict.

    Two sources, in order: the derived range for a day still ahead and unspoken
    for, and the settled reading for everything else. Reaching past them to the
    stored `description` is what let /today keep claiming "pages 24-26" while the
    calendar had already moved on.
    """
    return ranges.get(task.id) or _settled_description(db, task)


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

    A day that was reported but not finished reads the same way whatever its
    date. Today's row is the one case the rebuild cannot rewrite — it starts at
    tomorrow, or it would delete the row being logged — so on 2026-08-15 a
    Saturday reported at one page kept saying "pages 24-26" beside a correctly
    re-planned Sunday saying "pages 22-24". The shortfall is already back in the
    future by then; the row's job is to say what happened, not what it names.
    """
    if task.completed:
        return task.description
    if task.actual_quantity is None and task.date >= _today(task.goal.user):
        # Still ahead and unreported: `derive_descriptions` owns this one.
        return task.description
    unit = db.get(ProgressUnit, task.progress_unit_id) if task.progress_unit_id else None
    if unit is None or unit.material is None or task.quantity >= unit.quantity - engine.EPS:
        return task.description
    m = unit.material
    owed = f"{m.name}: {_fmt_qty(task.quantity)} {m.unit}"
    if task.actual_quantity is None:
        # Never opened, as distinct from opened and reported at zero. "not done"
        # read as a quantity — the owner took "139 points — not done" to mean he
        # had stopped at 139 — so say which of the two it is.
        return f"{owed} — missed"
    if task.actual_quantity <= engine.EPS:
        return f"{owed} — logged none"
    return f"{m.name}: logged {_fmt_qty(task.actual_quantity)} of {_fmt_qty(task.quantity)} {m.unit}"


def _record_day(db: Session, task: ScheduledTask, payload, actual: float) -> None:
    """Write what happened on this day. Never what is going to happen.

    One row per mission per reported day, upserted so a correction rewrites the
    record rather than filing a second one. Un-ticking removes it: the day goes
    back to never-reported, and an execution record that says nothing happened is
    a different claim from no record at all.
    """
    existing = db.scalar(
        select(ExecutionRecord).where(
            ExecutionRecord.goal_id == task.goal_id, ExecutionRecord.date == task.date
        )
    )
    if not payload.completed:
        if existing is not None:
            db.delete(existing)
        return

    if actual <= engine.EPS:
        day_status = DayStatus.skipped
    elif actual >= task.quantity - engine.EPS:
        day_status = DayStatus.completed
    else:
        day_status = DayStatus.partial

    record = existing or ExecutionRecord(goal_id=task.goal_id, date=task.date)
    record.material_id = task.material_id
    record.planned_units = task.quantity
    record.actual_units = actual
    record.status = day_status
    record.reported_at = datetime.now(timezone.utc)
    # Only ever what the student told us. Deriving it from the plan would
    # manufacture the one measurement this column exists to collect.
    if getattr(payload, "actual_minutes", None) is not None:
        record.actual_minutes = payload.actual_minutes
    material = db.get(Material, task.material_id) if task.material_id else None
    if material is not None and material.minutes_per_unit:
        record.planned_minutes = task.quantity * material.minutes_per_unit
    if existing is None:
        db.add(record)


@router.patch("/tasks/{task_id}", response_model=TaskUpdateOut)
def update_task(
    task_id: int,
    payload: ScheduledTaskUpdate,
    user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    """Report a day by row id.

    Superseded by `PATCH /goals/{goal_id}/days/{day}`, which names the day
    instead of a row — a row id only exists because the forward plan is still
    persisted, and it is the last thing forcing that. Kept working so a deployed
    client kicks on through the cutover; both call the same function, so the two
    cannot drift.
    """
    task = db.get(ScheduledTask, task_id)
    if task is None or task.goal.user_id != user.id:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Task not found")
    return _report_day(db, user, task, payload)


@router.patch("/goals/{goal_id}/days/{day}", response_model=TaskUpdateOut)
def update_day(
    goal_id: int,
    day: str,
    payload: ScheduledTaskUpdate,
    user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    """Report one day of one mission, named by the day itself.

    The identity a report actually has: a student says what happened on a date,
    not what happened to a database row. While the forward plan is still stored
    this resolves to that row and shares `_report_day` with the endpoint above;
    when the rows go, only the resolution changes.
    """
    from datetime import date as date_cls

    try:
        target = date_cls.fromisoformat(day)
    except ValueError:
        raise HTTPException(status.HTTP_422_UNPROCESSABLE_ENTITY, "Day must be YYYY-MM-DD")

    goal = db.get(Goal, goal_id)
    if goal is None or goal.user_id != user.id:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Mission not found")

    _sync_schedule(db, goal, _today(user))
    task = db.scalar(
        select(ScheduledTask)
        .where(ScheduledTask.goal_id == goal.id, ScheduledTask.date == target)
        .order_by(ScheduledTask.id)
    )
    if task is None:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Nothing planned for that day")
    return _report_day(db, user, task, payload)


def _report_day(db: Session, user: User, task: ScheduledTask, payload: ScheduledTaskUpdate):
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

    _record_day(db, task, payload, actual)

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
    today = _today(user)
    # Read the row out *before* redistributing. Un-ticking a day that has not
    # arrived yet puts it back to never-reported, which is exactly the state the
    # rebuild is entitled to delete — so the row the response describes can stop
    # existing halfway through this function. It used to be refreshed after the
    # rebuild and raised `InvalidRequestError`, i.e. a 500 on the calendar's own
    # "I did not actually do this" control. The answer is the row's last true
    # state, not a row id that survived.
    answer = ScheduledTaskOut.model_validate(task)
    if task.date >= today:
        engine.rebuild_schedule(db, task.goal, today, from_date=today + timedelta(days=1))
    else:
        engine.rebuild_schedule(db, task.goal, today)
    db.commit()
    if inspect(task).persistent:
        db.refresh(task)
        answer = ScheduledTaskOut.model_validate(task)
    return TaskUpdateOut(task=answer, overshoot=round(overshoot, 2), message=message)


@router.get("/goals/{goal_id}/schedule", response_model=list[ScheduledTaskOut])
def get_schedule(
    days: int = 14,
    goal: Goal = Depends(get_own_goal),
    db: Session = Depends(get_db),
):
    """Upcoming schedule, starting today."""
    today = _today(goal.user)
    _sync_schedule(db, goal, today)
    tasks = db.scalars(
        select(ScheduledTask)
        .where(ScheduledTask.goal_id == goal.id, ScheduledTask.date >= today)
        .order_by(ScheduledTask.date, ScheduledTask.id)
    ).all()
    ranges = engine.derive_descriptions(goal, list(tasks), today)
    cutoff_seen: set = set()
    out = []
    for t in tasks:
        cutoff_seen.add(t.date)
        if len(cutoff_seen) > days:
            break
        row = ScheduledTaskOut.model_validate(t)
        row.description = _display(db, t, ranges)
        out.append(row)
    return out


@router.post("/goals/{goal_id}/schedule/rebuild", response_model=list[ScheduledTaskOut])
def rebuild(goal: Goal = Depends(get_own_goal), db: Session = Depends(get_db)):
    today = _today(goal.user)
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
        .where(ScheduledTask.goal_id == goal.id, ScheduledTask.date < _today(goal.user))
        .order_by(ScheduledTask.date.desc(), ScheduledTask.id)
    ).all()
    out = []
    for t in tasks:
        row = ScheduledTaskOut.model_validate(t)
        row.description = _display(db, t, {})
        out.append(row)
    return out


@router.get("/dashboard", response_model=DashboardOut)
def dashboard(user: User = Depends(get_current_user), db: Session = Depends(get_db)):
    goals = db.scalars(
        select(Goal)
        .where(Goal.user_id == user.id, Goal.status == GoalStatus.active)
        .order_by(Goal.deadline)
    ).all()
    today = _today(user)
    out = []
    for g in goals:
        _sync_schedule(db, g, today)
    portfolio = adapter.plan_for(db, user, today)
    for g in goals:
        todays = db.scalars(
            select(ScheduledTask)
            .where(ScheduledTask.goal_id == g.id, ScheduledTask.date == today)
            .order_by(ScheduledTask.id)
        ).all()
        ranges = engine.derive_descriptions(g, _upcoming(db, g, today), today)
        next_move = next(
            (_display(db, t, ranges) for t in todays if not t.completed), None
        )
        out.append(
            DashboardGoal(
                goal=GoalOut.model_validate(g),
                progress_pct=round(engine.overall_progress_pct(g), 1),
                days_remaining=engine.days_remaining(g, today),
                reality=_enrich(engine.build_reality_report(g, today), g, portfolio, today),
                next_move=next_move,
                today_total=len(todays),
                today_done=sum(1 for t in todays if t.completed),
            )
        )
    return DashboardOut(user=UserOut.model_validate(user), goals=out)
