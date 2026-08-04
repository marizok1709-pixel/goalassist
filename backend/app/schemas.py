from datetime import date, datetime

from pydantic import BaseModel, ConfigDict, EmailStr, Field, field_validator

from .models import GoalStatus

# A material can't sensibly hold more than this, and bounding it keeps the
# schedule engine's arithmetic away from float overflow (round(1e308·w) → inf →
# OverflowError). `allow_inf_nan=False` on every quantity field additionally
# rejects NaN/Infinity at validation, so neither can reach the engine or a
# JSON error response. One constant so the cap lives in a single place.
MAX_QUANTITY = 1_000_000.0

# Furthest a deadline may sit in the future. The schedule rebuild loops once per
# day between start and deadline, so an unbounded date (year 9999) turns each
# material write into tens of seconds of CPU. ~30 years covers every real goal.
MAX_DEADLINE_YEARS = 30


# ---------- Auth / User ----------

class UserCreate(BaseModel):
    email: EmailStr
    password: str = Field(min_length=8)
    name: str = Field(min_length=1, max_length=120)
    university: str | None = None
    degree: str | None = None
    year: int | None = None


class UserLogin(BaseModel):
    email: EmailStr
    password: str


class UserOut(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: int
    email: EmailStr
    name: str
    university: str | None
    degree: str | None
    year: int | None
    availability: dict[str, float] | None
    # Read-only: exposed so the UI can show the admin link, never writable.
    # UserUpdate has no such field, so PATCH cannot set it.
    is_admin: bool = False


class UserUpdate(BaseModel):
    name: str | None = None
    university: str | None = None
    degree: str | None = None
    year: int | None = None
    availability: dict[str, float] | None = None


class Token(BaseModel):
    access_token: str
    token_type: str = "bearer"
    user: UserOut


# ---------- Goal ----------

def _bounded_deadline(value: date | None) -> date | None:
    """Reject deadlines absurdly far out, so a schedule rebuild can't loop over
    millions of days. Shared by create and update."""
    if value is not None and value.year > date.today().year + MAX_DEADLINE_YEARS:
        raise ValueError(f"deadline must be within {MAX_DEADLINE_YEARS} years")
    return value


class GoalCreate(BaseModel):
    title: str = Field(min_length=1, max_length=200)
    description: str | None = Field(default=None, max_length=2000)
    category: str | None = Field(default=None, max_length=80)
    deadline: date
    start_date: date | None = None

    _check_deadline = field_validator("deadline")(_bounded_deadline)


class GoalUpdate(BaseModel):
    title: str | None = Field(default=None, min_length=1, max_length=200)
    description: str | None = Field(default=None, max_length=2000)
    category: str | None = Field(default=None, max_length=80)
    deadline: date | None = None
    status: GoalStatus | None = None

    _check_deadline = field_validator("deadline")(_bounded_deadline)


class GoalOut(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: int
    title: str
    description: str | None
    category: str | None
    deadline: date
    start_date: date
    status: GoalStatus
    created_at: datetime


# ---------- Material ----------

class MaterialCreate(BaseModel):
    name: str = Field(min_length=1, max_length=200)
    type: str | None = None
    total_quantity: float = Field(gt=0, le=MAX_QUANTITY, allow_inf_nan=False)
    unit: str = Field(min_length=1, max_length=40)
    # Starting point: how much of this material is already done at creation.
    already_completed: float = Field(default=0, ge=0, le=MAX_QUANTITY, allow_inf_nan=False)


class MaterialProgressUpdate(BaseModel):
    completed_quantity: float = Field(ge=0, le=MAX_QUANTITY, allow_inf_nan=False)


class MaterialEdit(BaseModel):
    """Correct a material's definition after the mission exists.

    Every field is optional — send only what changed. Renaming keeps the
    existing units (and therefore the completed history); changing the amount
    or the unit re-slices the material, carrying the completed amount over.
    """

    name: str | None = Field(default=None, min_length=1, max_length=200)
    total_quantity: float | None = Field(default=None, gt=0, le=MAX_QUANTITY, allow_inf_nan=False)
    unit: str | None = Field(default=None, min_length=1, max_length=40)


class MaterialOut(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: int
    goal_id: int
    name: str
    type: str | None
    total_quantity: float
    unit: str


# ---------- Progress Unit ----------

class ProgressUnitCreate(BaseModel):
    material_id: int | None = None
    title: str = Field(min_length=1, max_length=200)
    quantity: float = Field(gt=0)
    unit: str = Field(min_length=1, max_length=40)


class ProgressUnitUpdate(BaseModel):
    completed_quantity: float | None = Field(default=None, ge=0)
    completed: bool | None = None  # shortcut: mark fully done / not done


class ProgressUnitOut(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: int
    goal_id: int
    material_id: int | None
    title: str
    quantity: float
    unit: str
    completed_quantity: float
    position: int
    completed_at: datetime | None
    is_completed: bool


# ---------- Planning / Reality ----------

class MaterialPlan(BaseModel):
    material_id: int
    name: str
    unit: str
    total: float
    completed: float
    remaining: float
    required_per_day: float
    human_rate: str  # e.g. "3.4 pages/day" or "1 exam every 9 days"


class RealityReport(BaseModel):
    goal_id: int
    days_total: int
    days_elapsed: int
    days_remaining: int
    days_behind: int
    expected_progress_pct: float
    actual_progress_pct: float
    trajectory_ratio: float  # actual / expected
    status: str  # CALIBRATING | AHEAD | ON_TRACK | AT_RISK | OFF_TRACK | FAILED | COMPLETED
    message: str
    adjustments: list[str]


class PlanOut(BaseModel):
    goal: GoalOut
    materials: list[MaterialPlan]
    reality: RealityReport


class ScheduledTaskOut(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: int
    goal_id: int
    progress_unit_id: int | None
    material_id: int | None
    date: date
    quantity: float
    description: str
    completed: bool
    # Filled for today's tasks: the reasoning behind this exact assignment.
    why: str | None = None


class CalendarTaskOut(ScheduledTaskOut):
    goal_title: str


class ScheduledTaskUpdate(BaseModel):
    completed: bool
    # Adaptive completion: the amount actually done, if different from planned.
    actual_quantity: float | None = Field(default=None, ge=0)


class TaskUpdateOut(BaseModel):
    task: ScheduledTaskOut
    overshoot: float  # actual - planned; > 0 means the future got lighter
    message: str | None


class TodayMission(BaseModel):
    goal_id: int
    title: str
    status: str
    days_behind: int
    message: str
    tasks: list[ScheduledTaskOut]


class TodayOut(BaseModel):
    date: date
    missions: list[TodayMission]


class DashboardGoal(BaseModel):
    goal: GoalOut
    progress_pct: float
    days_remaining: int
    reality: RealityReport
    next_move: str | None  # first incomplete task today — "TODAY'S MOVE"
    today_total: int
    today_done: int


class DashboardOut(BaseModel):
    user: UserOut
    goals: list[DashboardGoal]


# ---------- Analytics + privacy ----------

class EventIn(BaseModel):
    """One event as sent by the browser. `name` is validated against a
    server-side allow-list at ingest; `props` is stripped to small scalars."""

    name: str = Field(min_length=1, max_length=64)
    props: dict | None = None
    path: str | None = Field(default=None, max_length=120)


class EventBatch(BaseModel):
    """Events are sent in batches to keep request volume (and battery) low.

    Context that is identical for every event in the batch lives here rather
    than being repeated per event — and is deliberately coarse: no user agent
    string, no full URL, no IP (the server reads country from the edge header).
    """

    session_id: str = Field(min_length=8, max_length=64)
    events: list[EventIn] = Field(default_factory=list, max_length=50)
    device: str | None = Field(default=None, max_length=16)
    browser: str | None = Field(default=None, max_length=24)
    viewport_w: int | None = Field(default=None, ge=0, le=20000)
    language: str | None = Field(default=None, max_length=12)
    referrer: str | None = Field(default=None, max_length=500)


class ConsentUpdate(BaseModel):
    analytics_consent: bool


class ConsentOut(BaseModel):
    analytics_consent: bool
    updated_at: datetime | None = None
