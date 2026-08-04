from datetime import datetime, timezone

from fastapi import APIRouter, Depends, HTTPException, status
from sqlalchemy import select
from sqlalchemy.orm import Session

from ..database import get_db
from ..deps import get_current_user, get_own_goal
from ..models import Goal, Material, ProgressUnit, ScheduledTask, User
from ..services import engine
from ..schemas import (
    GoalCreate,
    GoalOut,
    GoalUpdate,
    MaterialCreate,
    MaterialEdit,
    MaterialOut,
    MaterialProgressUpdate,
    ProgressUnitCreate,
    ProgressUnitOut,
    ProgressUnitUpdate,
)

router = APIRouter(prefix="/goals", tags=["goals"])


@router.post("", response_model=GoalOut, status_code=status.HTTP_201_CREATED)
def create_goal(
    payload: GoalCreate,
    user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    data = payload.model_dump(exclude_unset=True)
    goal = Goal(user_id=user.id, **data)
    if goal.deadline <= (goal.start_date or datetime.now().date()):
        raise HTTPException(status.HTTP_422_UNPROCESSABLE_ENTITY, "Deadline must be in the future")
    db.add(goal)
    db.commit()
    db.refresh(goal)
    return goal


@router.get("", response_model=list[GoalOut])
def list_goals(user: User = Depends(get_current_user), db: Session = Depends(get_db)):
    return db.scalars(
        select(Goal).where(Goal.user_id == user.id).order_by(Goal.deadline)
    ).all()


@router.get("/{goal_id}", response_model=GoalOut)
def get_goal(goal: Goal = Depends(get_own_goal)):
    return goal


@router.patch("/{goal_id}", response_model=GoalOut)
def update_goal(
    payload: GoalUpdate,
    goal: Goal = Depends(get_own_goal),
    db: Session = Depends(get_db),
):
    data = payload.model_dump(exclude_unset=True)
    for field, value in data.items():
        setattr(goal, field, value)
    if "deadline" in data:
        engine.rebuild_schedule(db, goal, datetime.now().date())
    db.commit()
    db.refresh(goal)
    return goal


@router.delete("/{goal_id}", status_code=status.HTTP_204_NO_CONTENT)
def delete_goal(goal: Goal = Depends(get_own_goal), db: Session = Depends(get_db)):
    db.delete(goal)
    db.commit()


# ---------- Materials ----------

# Continuous quantities are tracked as one running amount; anything else that
# comes in a countable number of natural pieces (exams, sets, essays, lectures)
# becomes one checkable unit per piece. Users never see or choose this.
CONTINUOUS_UNITS = {
    "page", "pages", "seite", "seiten",
    "word", "words", "wort", "wörter", "woerter",
    "minute", "minutes", "min", "hour", "hours", "stunde", "stunden",
    "km", "cards", "karten",
}
MAX_PIECES = 100


def _is_countable(material: Material) -> bool:
    total = material.total_quantity
    unit_l = material.unit.strip().lower()
    return unit_l not in CONTINUOUS_UNITS and float(total).is_integer() and 1 <= total <= MAX_PIECES


def _unit_title(material: Material, position: int) -> str:
    """The title a unit at `position` should carry for this material."""
    if not _is_countable(material):
        return material.name
    singular = material.unit.rstrip("s") or material.unit
    return f"{material.name}: {singular} #{position + 1}"


def _auto_slice(material: Material) -> list[ProgressUnit]:
    """Slice a material into progress units automatically — no user input."""
    total = material.total_quantity
    countable = _is_countable(material)
    if countable:
        singular = material.unit.rstrip("s") or material.unit
        return [
            ProgressUnit(
                goal_id=material.goal_id,
                material=material,
                title=f"{material.name}: {singular} #{i + 1}",
                quantity=1,
                unit=material.unit,
                position=i,
            )
            for i in range(int(total))
        ]
    return [
        ProgressUnit(
            goal_id=material.goal_id,
            material=material,
            title=material.name,
            quantity=total,
            unit=material.unit,
            position=0,
        )
    ]


@router.post("/{goal_id}/materials", response_model=MaterialOut, status_code=status.HTTP_201_CREATED)
def add_material(
    payload: MaterialCreate,
    goal: Goal = Depends(get_own_goal),
    db: Session = Depends(get_db),
):
    material = Material(
        goal_id=goal.id,
        name=payload.name,
        type=payload.type,
        total_quantity=payload.total_quantity,
        unit=payload.unit,
    )
    db.add(material)
    db.add_all(_auto_slice(material))
    db.flush()
    db.refresh(material)
    if payload.already_completed > 0:
        engine.apply_progress(material, payload.already_completed, absolute=True)
    db.refresh(goal)
    engine.rebuild_schedule(db, goal, datetime.now().date())
    db.commit()
    db.refresh(material)
    return material


@router.get("/{goal_id}/materials", response_model=list[MaterialOut])
def list_materials(goal: Goal = Depends(get_own_goal)):
    return goal.materials


@router.patch("/{goal_id}/materials/{material_id}", response_model=MaterialOut)
def update_material_progress(
    material_id: int,
    payload: MaterialProgressUpdate,
    goal: Goal = Depends(get_own_goal),
    db: Session = Depends(get_db),
):
    """Set where you actually are in a material ("I'm on page 120")."""
    material = db.get(Material, material_id)
    if material is None or material.goal_id != goal.id:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Material not found")
    engine.apply_progress(
        material, min(payload.completed_quantity, material.total_quantity), absolute=True
    )
    today = datetime.now().date()
    # Sync today's tasks for this material with the new position.
    for task in db.scalars(
        select(ScheduledTask).where(
            ScheduledTask.material_id == material.id, ScheduledTask.date == today
        )
    ):
        unit = db.get(ProgressUnit, task.progress_unit_id) if task.progress_unit_id else None
        task.completed = bool(unit and unit.is_completed)
    db.flush()
    engine.rebuild_schedule(db, goal, today)
    db.commit()
    db.refresh(material)
    return material


@router.put("/{goal_id}/materials/{material_id}", response_model=MaterialOut)
def edit_material(
    material_id: int,
    payload: MaterialEdit,
    goal: Goal = Depends(get_own_goal),
    db: Session = Depends(get_db),
):
    """Correct a material after the mission was created (typo'd name, wrong
    page count, wrong unit). Materials were previously write-once, which left
    users stuck with whatever they typed during onboarding.
    """
    material = db.get(Material, material_id)
    if material is None or material.goal_id != goal.id:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Material not found")

    # How much is done today, so it survives whatever we do to the slicing.
    done = sum(u.completed_quantity for u in material.progress_units)

    reslice = (
        payload.total_quantity is not None and payload.total_quantity != material.total_quantity
    ) or (payload.unit is not None and payload.unit.strip() != material.unit)

    if payload.name is not None:
        material.name = payload.name.strip()
    if payload.total_quantity is not None:
        material.total_quantity = payload.total_quantity
    if payload.unit is not None:
        material.unit = payload.unit.strip()

    today = datetime.now().date()

    if reslice:
        # Amount/unit changed → the old units no longer describe the work.
        # Completed *past* tasks stay as honest history; they just lose their
        # link to units that no longer exist (the column is nullable).
        old_unit_ids = [u.id for u in material.progress_units]
        if old_unit_ids:
            for task in db.scalars(
                select(ScheduledTask).where(ScheduledTask.progress_unit_id.in_(old_unit_ids))
            ):
                task.progress_unit_id = None
        for unit in list(material.progress_units):
            db.delete(unit)
        db.flush()
        db.refresh(material)
        db.add_all(_auto_slice(material))
        db.flush()
        db.refresh(material)
        engine.apply_progress(material, min(done, material.total_quantity), absolute=True)
    else:
        # Rename only — keep the units (and their completed_at history) and
        # just re-derive their titles from the new name.
        for unit in material.progress_units:
            unit.title = _unit_title(material, unit.position)
            unit.unit = material.unit

    db.flush()
    db.refresh(goal)
    engine.rebuild_schedule(db, goal, today)
    db.commit()
    db.refresh(material)
    return material


@router.delete("/{goal_id}/materials/{material_id}", status_code=status.HTTP_204_NO_CONTENT)
def delete_material(
    material_id: int,
    goal: Goal = Depends(get_own_goal),
    db: Session = Depends(get_db),
):
    material = db.get(Material, material_id)
    if material is None or material.goal_id != goal.id:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Material not found")
    for task in db.scalars(select(ScheduledTask).where(ScheduledTask.material_id == material.id)):
        db.delete(task)
    db.delete(material)
    db.flush()
    db.expire(goal)
    engine.rebuild_schedule(db, goal, datetime.now().date())
    db.commit()


# ---------- Progress Units ----------

@router.post("/{goal_id}/units", response_model=ProgressUnitOut, status_code=status.HTTP_201_CREATED)
def add_unit(
    payload: ProgressUnitCreate,
    goal: Goal = Depends(get_own_goal),
    db: Session = Depends(get_db),
):
    if payload.material_id is not None:
        material = db.get(Material, payload.material_id)
        if material is None or material.goal_id != goal.id:
            raise HTTPException(status.HTTP_404_NOT_FOUND, "Material not found")
    max_pos = max((u.position for u in goal.progress_units), default=-1)
    unit = ProgressUnit(goal_id=goal.id, position=max_pos + 1, **payload.model_dump())
    db.add(unit)
    db.commit()
    db.refresh(unit)
    return unit


@router.get("/{goal_id}/units", response_model=list[ProgressUnitOut])
def list_units(goal: Goal = Depends(get_own_goal)):
    return sorted(goal.progress_units, key=lambda u: (u.material_id or 0, u.position, u.id))


@router.patch("/{goal_id}/units/{unit_id}", response_model=ProgressUnitOut)
def update_unit(
    unit_id: int,
    payload: ProgressUnitUpdate,
    goal: Goal = Depends(get_own_goal),
    db: Session = Depends(get_db),
):
    unit = db.get(ProgressUnit, unit_id)
    if unit is None or unit.goal_id != goal.id:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Progress unit not found")

    if payload.completed is not None:
        unit.completed_quantity = unit.quantity if payload.completed else 0.0
    if payload.completed_quantity is not None:
        unit.completed_quantity = min(payload.completed_quantity, unit.quantity)

    unit.completed_at = datetime.now(timezone.utc) if unit.is_completed else None

    # Keep today's scheduled tasks for this unit in sync, then redistribute.
    today = datetime.now().date()
    for task in db.scalars(
        select(ScheduledTask).where(
            ScheduledTask.progress_unit_id == unit.id,
            ScheduledTask.date == today,
        )
    ):
        task.completed = unit.is_completed
    db.flush()
    engine.rebuild_schedule(db, goal, today)

    db.commit()
    db.refresh(unit)
    return unit
