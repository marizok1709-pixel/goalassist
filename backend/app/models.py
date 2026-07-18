import enum
from datetime import date, datetime, timezone

from sqlalchemy import JSON, Boolean, Date, DateTime, Enum, Float, ForeignKey, String, Text
from sqlalchemy.orm import Mapped, mapped_column, relationship

from .database import Base


def utcnow() -> datetime:
    return datetime.now(timezone.utc)


class GoalStatus(str, enum.Enum):
    active = "active"
    completed = "completed"
    failed = "failed"
    archived = "archived"


class User(Base):
    __tablename__ = "users"

    id: Mapped[int] = mapped_column(primary_key=True)
    email: Mapped[str] = mapped_column(String(255), unique=True, index=True)
    password_hash: Mapped[str] = mapped_column(String(255))
    name: Mapped[str] = mapped_column(String(120))
    university: Mapped[str | None] = mapped_column(String(120), default=None)
    degree: Mapped[str | None] = mapped_column(String(120), default=None)
    year: Mapped[int | None] = mapped_column(default=None)
    # Weekly study hours: {"mon": 2.0, "tue": 0.0, ...}. None = every day equal.
    availability: Mapped[dict | None] = mapped_column(JSON, default=None)
    created_at: Mapped[datetime] = mapped_column(DateTime, default=utcnow)

    goals: Mapped[list["Goal"]] = relationship(back_populates="user", cascade="all, delete-orphan")


class Goal(Base):
    __tablename__ = "goals"

    id: Mapped[int] = mapped_column(primary_key=True)
    user_id: Mapped[int] = mapped_column(ForeignKey("users.id"), index=True)
    title: Mapped[str] = mapped_column(String(200))
    description: Mapped[str | None] = mapped_column(Text, default=None)
    category: Mapped[str | None] = mapped_column(String(80), default=None)
    deadline: Mapped[date] = mapped_column(Date)
    # Server-local date: "today" must match the user's wall clock, not UTC.
    start_date: Mapped[date] = mapped_column(Date, default=lambda: datetime.now().date())
    status: Mapped[GoalStatus] = mapped_column(Enum(GoalStatus), default=GoalStatus.active)
    created_at: Mapped[datetime] = mapped_column(DateTime, default=utcnow)

    user: Mapped[User] = relationship(back_populates="goals")
    materials: Mapped[list["Material"]] = relationship(back_populates="goal", cascade="all, delete-orphan")
    progress_units: Mapped[list["ProgressUnit"]] = relationship(back_populates="goal", cascade="all, delete-orphan")
    scheduled_tasks: Mapped[list["ScheduledTask"]] = relationship(
        back_populates="goal", cascade="all, delete-orphan"
    )


class Material(Base):
    __tablename__ = "materials"

    id: Mapped[int] = mapped_column(primary_key=True)
    goal_id: Mapped[int] = mapped_column(ForeignKey("goals.id"), index=True)
    name: Mapped[str] = mapped_column(String(200))
    type: Mapped[str | None] = mapped_column(String(80), default=None)
    total_quantity: Mapped[float] = mapped_column(Float)
    unit: Mapped[str] = mapped_column(String(40))

    goal: Mapped[Goal] = relationship(back_populates="materials")
    progress_units: Mapped[list["ProgressUnit"]] = relationship(
        back_populates="material", cascade="all, delete-orphan"
    )


class ProgressUnit(Base):
    __tablename__ = "progress_units"

    id: Mapped[int] = mapped_column(primary_key=True)
    goal_id: Mapped[int] = mapped_column(ForeignKey("goals.id"), index=True)
    material_id: Mapped[int | None] = mapped_column(ForeignKey("materials.id"), index=True, default=None)
    title: Mapped[str] = mapped_column(String(200))
    quantity: Mapped[float] = mapped_column(Float)
    unit: Mapped[str] = mapped_column(String(40))
    completed_quantity: Mapped[float] = mapped_column(Float, default=0.0)
    position: Mapped[int] = mapped_column(default=0)
    completed_at: Mapped[datetime | None] = mapped_column(DateTime, default=None)

    goal: Mapped[Goal] = relationship(back_populates="progress_units")
    material: Mapped[Material | None] = relationship(back_populates="progress_units")

    @property
    def is_completed(self) -> bool:
        return self.completed_quantity >= self.quantity


class ScheduledTask(Base):
    """A Progress Unit says WHAT exists; a ScheduledTask says WHEN it happens.

    One row = one day's slice of work on one unit (a day crossing a unit
    boundary gets two rows). quantity is in the material's unit.
    """

    __tablename__ = "scheduled_tasks"

    id: Mapped[int] = mapped_column(primary_key=True)
    goal_id: Mapped[int] = mapped_column(ForeignKey("goals.id"), index=True)
    progress_unit_id: Mapped[int | None] = mapped_column(
        ForeignKey("progress_units.id"), default=None
    )
    material_id: Mapped[int | None] = mapped_column(ForeignKey("materials.id"), default=None)
    date: Mapped[date] = mapped_column(Date, index=True)
    quantity: Mapped[float] = mapped_column(Float)
    description: Mapped[str] = mapped_column(String(255))
    completed: Mapped[bool] = mapped_column(Boolean, default=False)
    calendar_event_id: Mapped[str | None] = mapped_column(String(255), default=None)

    goal: Mapped[Goal] = relationship(back_populates="scheduled_tasks")
    progress_unit: Mapped[ProgressUnit | None] = relationship()
