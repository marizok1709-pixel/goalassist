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


class GoalPriority(str, enum.Enum):
    """How this mission competes for the one capacity pool.

    PAUSED is not a status: the mission is still real, still has a deadline and
    still shows its progress. It simply stops taking hours from the others,
    which is the honest lever for a student carrying more than fits.
    """

    high = "HIGH"
    normal = "NORMAL"
    paused = "PAUSED"


class DayStatus(str, enum.Enum):
    """What became of one scheduled day. There is no PENDING.

    A record is written when its day arrives or when it is reported on, never
    ahead of time. Rows for days that have not happened are exactly what made
    the schedule go stale: a plan persisted on Wednesday and read on Saturday
    described a position the mission never reached. The forward plan is derived
    now, so the only thing worth storing is what actually happened.
    """

    completed = "COMPLETED"
    partial = "PARTIAL"
    skipped = "SKIPPED"


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
    # IANA zone, e.g. "Europe/Berlin". "Today" is a claim about the student's
    # wall clock, not the server's: the API runs in UTC on Vercel, so between
    # local midnight and 02:00 a Berlin student was served yesterday's tasks and
    # could tick them. NULL means an account that predates this and keeps the
    # old server-local behaviour.
    timezone: Mapped[str | None] = mapped_column(String(64), default=None)
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
    # Last day the schedule was re-evaluated against reality. A day that passes
    # without being reported on is a change to the plan just as much as a log is,
    # but nothing writes on that day, so nothing used to notice. This gates the
    # catch-up rebuild to once per day per mission.
    replanned_on: Mapped[date | None] = mapped_column(Date, default=None)
    priority: Mapped[GoalPriority] = mapped_column(
        Enum(GoalPriority), default=GoalPriority.normal
    )
    # Set when the student was told this does not fit and chose to start anyway.
    # A quiet permanent marker, never a nag: the engine advises, the student
    # decides, and the record of that decision belongs to them.
    launched_over_capacity: Mapped[bool] = mapped_column(Boolean, default=False)
    # Minutes-per-study-day the student last acknowledged. The plan may grow
    # under it silently; crossing it is what earns an interruption.
    acknowledged_load: Mapped[float | None] = mapped_column(Float, default=None)

    user: Mapped[User] = relationship(back_populates="goals")
    materials: Mapped[list["Material"]] = relationship(back_populates="goal", cascade="all, delete-orphan")
    progress_units: Mapped[list["ProgressUnit"]] = relationship(back_populates="goal", cascade="all, delete-orphan")
    scheduled_tasks: Mapped[list["ScheduledTask"]] = relationship(
        back_populates="goal", cascade="all, delete-orphan"
    )
    execution_records: Mapped[list["ExecutionRecord"]] = relationship(
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
    # How long one unit takes *this* student. NULL means no estimate yet, which
    # is a fact rather than a gap: nothing in the product has ever recorded how
    # long anything took, so any seed value would be a guess presented as
    # arithmetic. Without it the planner states a required units-per-hour rate
    # instead of a finish date. Measurement fills it in later.
    #
    # This lives on the material rather than on a shared library row because
    # `Material.goal_id` already makes it per-mission — the student's own
    # number, not a global average.
    minutes_per_unit: Mapped[float | None] = mapped_column(Float, default=None)

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
    # How much was actually done, once the day has been reported on. NULL means
    # "never touched" — which is a different thing from a reported zero, and the
    # distinction is the whole point of the column: without it, "I sat down and
    # did none of it" is unrepresentable and gets stored as done.
    # `completed` is derived from it (see routers/plan.py), never set alone.
    actual_quantity: Mapped[float | None] = mapped_column(Float, default=None)
    calendar_event_id: Mapped[str | None] = mapped_column(String(255), default=None)

    goal: Mapped[Goal] = relationship(back_populates="scheduled_tasks")
    progress_unit: Mapped[ProgressUnit | None] = relationship()

    @property
    def logged(self) -> bool:
        """Has this day been reported on at all? A reported 0 counts."""
        return self.actual_quantity is not None or self.completed


class ExecutionRecord(Base):
    """One day of one mission, after the fact.

    The counterpart to the derived plan: the planner computes what *should*
    happen from live state on every read, and this table remembers what *did*.
    Nothing here describes the future, which is the property that keeps the two
    from ever disagreeing.

    `actual_minutes` is the only measurement the product has ever taken of how
    long work really takes. Without it, calibration — "we assumed 4.5 min/page,
    you run at 6.2" — has nothing to calibrate from, and `minutes_per_unit`
    stays a guess for ever.
    """

    __tablename__ = "execution_records"

    id: Mapped[int] = mapped_column(primary_key=True)
    goal_id: Mapped[int] = mapped_column(ForeignKey("goals.id"), index=True)
    material_id: Mapped[int | None] = mapped_column(ForeignKey("materials.id"), default=None)
    date: Mapped[date] = mapped_column(Date, index=True)
    planned_units: Mapped[float] = mapped_column(Float, default=0.0)
    planned_minutes: Mapped[float] = mapped_column(Float, default=0.0)
    actual_units: Mapped[float] = mapped_column(Float, default=0.0)
    # NULL means the student reported the amount but not the time. Never
    # inferred from planned_minutes — that would manufacture the very
    # measurement this column exists to collect.
    actual_minutes: Mapped[float | None] = mapped_column(Float, default=None)
    status: Mapped[DayStatus] = mapped_column(Enum(DayStatus), default=DayStatus.partial)
    reported_at: Mapped[datetime | None] = mapped_column(DateTime, default=None)

    goal: Mapped[Goal] = relationship(back_populates="execution_records")


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
