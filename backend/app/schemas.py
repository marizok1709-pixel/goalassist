from datetime import date, datetime

from pydantic import BaseModel, ConfigDict, EmailStr, Field

from .models import GoalStatus


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

class GoalCreate(BaseModel):
    title: str = Field(min_length=1, max_length=200)
    description: str | None = None
    category: str | None = None
    deadline: date
    start_date: date | None = None


class GoalUpdate(BaseModel):
    title: str | None = None
    description: str | None = None
    category: str | None = None
    deadline: date | None = None
    status: GoalStatus | None = None


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
    total_quantity: float = Field(gt=0)
    unit: str = Field(min_length=1, max_length=40)
    # Starting point: how much of this material is already done at creation.
    already_completed: float = Field(default=0, ge=0)


class MaterialProgressUpdate(BaseModel):
    completed_quantity: float = Field(ge=0)


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
