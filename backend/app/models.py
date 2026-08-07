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
    # Whether the hours above are real numbers the student chose, or just the
    # coarse study-day/rest-day default onboarding writes. The dashboard nudges
    # towards /timing until this is true. It cannot be inferred from the hours
    # themselves — a student who genuinely picks the default value on every
    # study day is byte-identical to one who never answered.
    availability_refined: Mapped[bool] = mapped_column(Boolean, default=False)
    created_at: Mapped[datetime] = mapped_column(DateTime, default=utcnow)

    # Operator flag. Deliberately has no self-service path: nothing in the API
    # can set it, so an admin is only ever created by a direct DB update.
    is_admin: Mapped[bool] = mapped_column(Boolean, default=False)

    # Product-analytics consent. Defaults to False and stays False until the
    # user actively opts in — no analytics event is accepted before that.
    analytics_consent: Mapped[bool] = mapped_column(Boolean, default=False)
    consent_updated_at: Mapped[datetime | None] = mapped_column(DateTime, default=None)

    # Operator-only free-text note about this account (e.g. "my friend, found
    # the mobile bug"). Admin-authored, never shown to the user. Nullable.
    note: Mapped[str | None] = mapped_column(String(500), default=None)

    goals: Mapped[list["Goal"]] = relationship(back_populates="user", cascade="all, delete-orphan")
    events: Mapped[list["AnalyticsEvent"]] = relationship(
        back_populates="user", cascade="all, delete-orphan"
    )


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


class AnalyticsEvent(Base):
    """One product-analytics event.

    Deliberately narrow. What is NOT here matters as much as what is: no IP
    address, no user agent string, no free-text from the user, no page URL with
    query parameters. Location is a two-letter country at most. `user_id` is a
    foreign key rather than an email, so the row is pseudonymous on its own and
    disappears with the account (cascade delete).

    `props` is a small JSON bag for event-specific numbers/enums. Anything
    identifying belongs nowhere near it — see PRIVACY.md.
    """

    __tablename__ = "analytics_events"

    id: Mapped[int] = mapped_column(primary_key=True)
    # Null for logged-out visitors, who are only ever counted, never identified.
    user_id: Mapped[int | None] = mapped_column(
        ForeignKey("users.id", ondelete="CASCADE"), index=True, default=None
    )
    # Rotating client-side id so a visit can be stitched into a session without
    # knowing who the person is. Not stable across days.
    session_id: Mapped[str] = mapped_column(String(64), index=True)

    name: Mapped[str] = mapped_column(String(64), index=True)
    props: Mapped[dict | None] = mapped_column(JSON, default=None)

    # Coarse context, all low-cardinality by design.
    path: Mapped[str | None] = mapped_column(String(120), default=None)
    device: Mapped[str | None] = mapped_column(String(16), default=None)  # mobile|tablet|desktop
    browser: Mapped[str | None] = mapped_column(String(24), default=None)
    viewport_w: Mapped[int | None] = mapped_column(default=None)
    language: Mapped[str | None] = mapped_column(String(12), default=None)
    country: Mapped[str | None] = mapped_column(String(2), default=None)
    referrer_host: Mapped[str | None] = mapped_column(String(120), default=None)

    created_at: Mapped[datetime] = mapped_column(DateTime, default=utcnow, index=True)

    user: Mapped["User | None"] = relationship(back_populates="events")


class TransactionKind(str, enum.Enum):
    revenue = "revenue"
    expense = "expense"
    credit = "credit"
    debit = "debit"


class Transaction(Base):
    """Money in and out.

    GoalAssist has no payments yet — premium is deliberately deferred until
    retention is proven — so this table is empty and the finance dashboard reads
    genuine zeros from it. It exists now so that when billing does arrive the
    dashboard needs a writer, not a rewrite.

    Amounts are integer minor units (cents). Floats have no business in money.
    """

    __tablename__ = "transactions"

    id: Mapped[int] = mapped_column(primary_key=True)
    kind: Mapped[TransactionKind] = mapped_column(Enum(TransactionKind), index=True)
    amount_cents: Mapped[int] = mapped_column()
    currency: Mapped[str] = mapped_column(String(3), default="EUR")

    # Nullable so platform costs (hosting, database) can be recorded too.
    user_id: Mapped[int | None] = mapped_column(
        ForeignKey("users.id", ondelete="SET NULL"), index=True, default=None
    )
    description: Mapped[str | None] = mapped_column(String(200), default=None)
    # Id from whatever processor eventually handles this, for reconciliation.
    external_ref: Mapped[str | None] = mapped_column(String(120), default=None)
    # True while a subscription is live — what MRR is summed from.
    is_recurring: Mapped[bool] = mapped_column(Boolean, default=False)

    occurred_at: Mapped[datetime] = mapped_column(DateTime, default=utcnow, index=True)
