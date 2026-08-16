from datetime import date, datetime

from pydantic import BaseModel, ConfigDict, EmailStr, Field, field_validator

from .models import GoalPriority, GoalStatus

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
# One unit cannot take longer than a capped day.
MAX_MINUTES_PER_UNIT = 16 * 60.0


# ---------- Auth / User ----------

WEEKDAY_KEYS = frozenset(["mon", "tue", "wed", "thu", "fri", "sat", "sun"])
# A study day longer than this is a data-entry slip, not a plan. The cap exists
# because these hours stopped being relative weights and became real minutes:
# the planner divides work by them, so a stray 100 makes a mission look feasible.
MAX_DAILY_HOURS = 16.0


def _check_availability(value: dict[str, float] | None) -> dict[str, float] | None:
    """Reject a weekly rhythm the planner cannot mean anything by.

    Until the pivot these numbers were only ever *weights* — `build_schedule`
    normalises them to `cum_weights[d] / total_weight`, so {mon: 4, tue: 2} and
    {mon: 2, tue: 1} produced byte-identical schedules and nothing downstream
    cared what the magnitudes were. `day_weight` swallowed unknown keys, strings
    and negatives on that basis. Now they are the capacity the whole feasibility
    verdict divides by, so they have to be real.
    """
    if value is None:
        return None
    unknown = sorted(set(value) - WEEKDAY_KEYS)
    if unknown:
        raise ValueError(f"Unknown weekday keys: {', '.join(unknown)}")
    for day, hours in value.items():
        if not isinstance(hours, (int, float)) or hours != hours:
            raise ValueError(f"{day}: hours must be a number")
        if hours < 0:
            raise ValueError(f"{day}: hours cannot be negative")
        if hours > MAX_DAILY_HOURS:
            raise ValueError(f"{day}: {hours:g}h exceeds the {MAX_DAILY_HOURS:g}h daily maximum")
    if value and not any(h > 0 for h in value.values()):
        raise ValueError("At least one day needs some hours")
    return value


class UserCreate(BaseModel):
    email: EmailStr
    password: str = Field(min_length=8)
    name: str = Field(min_length=1, max_length=120)
    university: str | None = None
    degree: str | None = None
    year: int | None = None
    # Sent by the browser at register from Intl.DateTimeFormat(). Optional so a
    # client that does not send it still registers.
    timezone: str | None = Field(default=None, max_length=64)


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
    availability_refined: bool = False
    timezone: str | None = None
    # Read-only: exposed so the UI can show the admin link, never writable.
    # UserUpdate has no such field, so PATCH cannot set it.
    is_admin: bool = False


class UserUpdate(BaseModel):
    name: str | None = None
    university: str | None = None
    degree: str | None = None
    year: int | None = None
    availability: dict[str, float] | None = None
    timezone: str | None = Field(default=None, max_length=64)

    # Client-declared: /timing sets it when the student saves real hours,
    # onboarding's coarse rest-day answer does not. Writable on purpose — the
    # worst a caller can do with it is silence their own dashboard nudge.
    availability_refined: bool | None = None

    _check_availability = field_validator("availability")(_check_availability)


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
    priority: GoalPriority = GoalPriority.normal
    # The student was shown that this does not fit and started anyway. Recorded
    # because the decision is theirs and the record belongs to them — never used
    # to nag, and never a reason to refuse the mission.
    launched_over_capacity: bool = False

    _check_deadline = field_validator("deadline")(_bounded_deadline)


class GoalUpdate(BaseModel):
    title: str | None = Field(default=None, min_length=1, max_length=200)
    description: str | None = Field(default=None, max_length=2000)
    category: str | None = Field(default=None, max_length=80)
    deadline: date | None = None
    status: GoalStatus | None = None
    # Pausing is the lever for a student carrying more than fits: the mission
    # keeps its deadline and its progress, and stops taking hours from the rest.
    priority: GoalPriority | None = None

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
    priority: GoalPriority = GoalPriority.normal
    launched_over_capacity: bool = False


# ---------- Material ----------

class MaterialCreate(BaseModel):
    name: str = Field(min_length=1, max_length=200)
    type: str | None = None
    total_quantity: float = Field(gt=0, le=MAX_QUANTITY, allow_inf_nan=False)
    unit: str = Field(min_length=1, max_length=40)
    # Starting point: how much of this material is already done at creation.
    already_completed: float = Field(default=0, ge=0, le=MAX_QUANTITY, allow_inf_nan=False)
    # Optional, and left out rather than guessed. A day is capped at 16h, so a
    # single unit taking longer than that is a slip, not a plan.
    minutes_per_unit: float | None = Field(
        default=None, gt=0, le=MAX_MINUTES_PER_UNIT, allow_inf_nan=False
    )


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
    minutes_per_unit: float | None = Field(
        default=None, gt=0, le=MAX_MINUTES_PER_UNIT, allow_inf_nan=False
    )


class MaterialOut(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: int
    goal_id: int
    name: str
    type: str | None
    total_quantity: float
    unit: str
    minutes_per_unit: float | None = None


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
    status: str  # AHEAD | ON_TRACK | AT_RISK | OFF_TRACK | FAILED | COMPLETED
    message: str
    adjustments: list[str]
    # ---- from the planner. The headline is a date, never a band on its own:
    # an early minutes estimate carries roughly ±50% error, so a band boundary
    # is noise wearing the costume of a decision. A date can be checked.
    verdict: str = "NO_ESTIMATE"
    projected_finish: date | None = None
    days_late: int = 0
    required_units_per_hour: float | None = None
    pace_planned_units: float = 0.0
    pace_actual_units: float | None = None
    minutes_today: float = 0.0
    # True once the plan's daily load has grown past what the student last
    # acknowledged. Under the threshold the plan absorbs a miss in silence.
    load_changed: bool = False


# ---------- Feasibility (pre-creation) ----------

class FeasibilityMaterial(BaseModel):
    name: str = Field(min_length=1, max_length=200)
    total_quantity: float = Field(gt=0, le=MAX_QUANTITY, allow_inf_nan=False)
    unit: str = Field(min_length=1, max_length=40)
    already_completed: float = Field(default=0, ge=0, le=MAX_QUANTITY, allow_inf_nan=False)
    minutes_per_unit: float | None = Field(
        default=None, gt=0, le=MAX_MINUTES_PER_UNIT, allow_inf_nan=False
    )


class FeasibilityRequest(BaseModel):
    """A mission that does not exist yet, asked whether it fits.

    The verdict has to arrive *before* anything is written, or the honest option
    is being offered after the student has already committed. Availability is
    optional: onboarding asks for the rhythm in the same breath, and a student
    changing it on the reality-check screen must be able to see the answer move.
    """

    title: str = Field(default="", max_length=200)
    deadline: date
    materials: list[FeasibilityMaterial] = Field(min_length=1)
    availability: dict[str, float] | None = None

    _check_deadline = field_validator("deadline")(_bounded_deadline)
    _check_availability = field_validator("availability")(_check_availability)


class FeasibilityOut(BaseModel):
    verdict: str
    projected_finish: date | None
    deadline: date
    days_late: int
    required_minutes: float
    available_minutes: float
    daily_cap_minutes: float
    required_units_per_hour: float | None
    uses_minutes: bool
    # What the student would have to change for this to fit. Stated, pre-selected
    # in the UI, never enforced.
    suggested_deadline: date | None
    suggested_scope: dict | None
    suggested_weekly_hours: float | None
    # Every other active mission this one would be competing with.
    competing_missions: list[str] = []


class PlanOut(BaseModel):
    goal: GoalOut
    materials: list[MaterialPlan]
    reality: RealityReport


class ScheduledTaskOut(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    # None for a day that is still ahead. The forward plan is computed on every
    # read and never written down, so an upcoming day has no row and therefore
    # no id. Days that have been reported on keep theirs, because those are
    # history. Nothing may identify a day by this — use (goal_id, date).
    id: int | None = None
    goal_id: int
    progress_unit_id: int | None
    material_id: int | None
    date: date
    quantity: float
    description: str
    completed: bool
    # None = this day has never been reported on. A number = what was actually
    # done, including a deliberate 0. Never infer one from `completed`.
    actual_quantity: float | None = None
    # Filled for today's tasks: the reasoning behind this exact assignment.
    why: str | None = None
    # What this slice should take. "Three pages" is a quantity; "three pages,
    # about 18 minutes" is something that fits into an actual evening. 0 when
    # the material carries no estimate yet.
    minutes: float = 0.0


class CalendarTaskOut(ScheduledTaskOut):
    goal_title: str


class ScheduledTaskUpdate(BaseModel):
    # True = reporting on this day, False = putting it back to never-reported.
    # It is NOT the resulting `completed` flag: whether the day counts as done is
    # derived from the amount, so reporting 0 reports a day that is not done.
    completed: bool
    # Adaptive completion: the amount actually done, if different from planned.
    # Absent means "all of it". 0 is a real answer and is stored as one.
    actual_quantity: float | None = Field(default=None, ge=0)
    # How long it actually took. Optional — a student who does not answer must
    # not be blocked — but it is the only measurement of real pace the product
    # ever gets, and calibration has nothing to work from without it.
    actual_minutes: float | None = Field(default=None, ge=0, le=24 * 60)


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


# ---------- Admin: per-user roster ----------

class AdminUserGoal(BaseModel):
    title: str
    deadline: date


class AdminUserRow(BaseModel):
    """One row of the admin users table. Individual PII, admin-only, beta-scoped
    with the testers' agreement — never exposed outside the is_admin gate."""

    id: int
    email: str
    name: str
    note: str | None
    is_admin: bool
    analytics_consent: bool
    created_at: datetime
    goals: list[AdminUserGoal]
    tasks_total: int
    tasks_completed: int
    # Scheduled date of their most recently checked-off task — lights up the
    # moment they engage with a daily task, not only at 100%. Product-derived,
    # so it needs no analytics consent. It's the task's scheduled day, a proxy
    # for recency, not a precise "last seen" timestamp.
    last_active: date | None


class AdminNoteUpdate(BaseModel):
    note: str | None = Field(default=None, max_length=500)
