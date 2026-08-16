const API_URL = process.env.NEXT_PUBLIC_API_URL ?? "http://localhost:8000";

/**
 * The browser's IANA zone, e.g. "Europe/Berlin". Undefined rather than a guess
 * when the runtime cannot say — the server treats that as "use the server
 * clock", which is the old behaviour and safe.
 */
export function browserTimezone(): string | undefined {
  try {
    return Intl.DateTimeFormat().resolvedOptions().timeZone || undefined;
  } catch {
    return undefined;
  }
}

// ---------- Types (mirror backend schemas) ----------

export interface User {
  id: number;
  email: string;
  name: string;
  university: string | null;
  degree: string | null;
  year: number | null;
  availability: Record<string, number> | null;
  /**
   * True once the student has set real hours per day at /timing. Onboarding's
   * rest-day answer leaves it false, which is what the dashboard nudge keys on.
   */
  availability_refined?: boolean;
  /** IANA zone captured at register. Null on accounts that predate it. */
  timezone?: string | null;
  /** Read-only operator flag. Set only via backend/make_admin.py. */
  is_admin?: boolean;
}

export type GoalStatus = "active" | "completed" | "failed" | "archived";

export interface Goal {
  id: number;
  title: string;
  description: string | null;
  category: string | null;
  deadline: string;
  start_date: string;
  status: GoalStatus;
  created_at: string;
  priority?: "HIGH" | "NORMAL" | "PAUSED";
  /** The student was told this did not fit and started anyway. */
  launched_over_capacity?: boolean;
}

export interface Material {
  id: number;
  goal_id: number;
  name: string;
  type: string | null;
  total_quantity: number;
  unit: string;
  /** How long one unit takes this student. Null = never measured. */
  minutes_per_unit?: number | null;
}

export interface ProgressUnit {
  id: number;
  goal_id: number;
  material_id: number | null;
  title: string;
  quantity: number;
  unit: string;
  completed_quantity: number;
  position: number;
  completed_at: string | null;
  is_completed: boolean;
}

export interface MaterialPlan {
  material_id: number;
  name: string;
  unit: string;
  total: number;
  completed: number;
  remaining: number;
  required_per_day: number;
  human_rate: string;
}

export type TrajectoryStatus =
  | "AHEAD"
  | "ON_TRACK"
  | "AT_RISK"
  | "OFF_TRACK"
  | "FAILED"
  | "COMPLETED";

export interface RealityReport {
  goal_id: number;
  days_total: number;
  days_elapsed: number;
  days_remaining: number;
  days_behind: number;
  expected_progress_pct: number;
  actual_progress_pct: number;
  trajectory_ratio: number;
  status: TrajectoryStatus;
  message: string;
  adjustments: string[];
  /** COMFORTABLE | FEASIBLE | TIGHT | OVER_CAPACITY | NO_ESTIMATE | COMPLETED */
  verdict: Verdict;
  /** The headline. Null when no minutes estimate exists — a date without
   *  measured minutes behind it would be a guess wearing arithmetic. */
  projected_finish: string | null;
  days_late: number;
  required_units_per_hour: number | null;
  pace_planned_units: number;
  pace_actual_units: number | null;
  minutes_today: number;
  /** The daily ask has grown past what the student last acknowledged. */
  load_changed: boolean;
}

export type Verdict =
  | "COMFORTABLE"
  | "FEASIBLE"
  | "TIGHT"
  | "OVER_CAPACITY"
  | "NO_ESTIMATE"
  | "COMPLETED";

/** The answer to "does this fit?", for a mission that does not exist yet. */
export interface Feasibility {
  verdict: Verdict;
  projected_finish: string | null;
  deadline: string;
  days_late: number;
  required_minutes: number;
  available_minutes: number;
  daily_cap_minutes: number;
  required_units_per_hour: number | null;
  uses_minutes: boolean;
  suggested_deadline: string | null;
  suggested_scope: { unit: string; units: number; of: number } | null;
  suggested_weekly_hours: number | null;
  competing_missions: string[];
}

export interface Plan {
  goal: Goal;
  materials: MaterialPlan[];
  reality: RealityReport;
}

export interface ScheduledTask {
  id: number;
  goal_id: number;
  progress_unit_id: number | null;
  material_id: number | null;
  date: string;
  quantity: number;
  description: string;
  completed: boolean;
  /** null = this day was never reported on. A number = what was actually done,
   *  including a deliberate 0. Never derive it from `completed`. */
  actual_quantity: number | null;
  why: string | null;
  /** Expected minutes for this slice. 0 when the material has no estimate. */
  minutes: number;
}

export interface CalendarTask extends ScheduledTask {
  goal_title: string;
}

export interface TodayMission {
  goal_id: number;
  title: string;
  status: TrajectoryStatus;
  days_behind: number;
  message: string;
  tasks: ScheduledTask[];
}

export interface Today {
  date: string;
  missions: TodayMission[];
}

export interface DashboardGoal {
  goal: Goal;
  progress_pct: number;
  days_remaining: number;
  reality: RealityReport;
  next_move: string | null;
  today_total: number;
  today_done: number;
}

export interface Dashboard {
  user: User;
  goals: DashboardGoal[];
}

// ---------- Token handling ----------

export function getToken(): string | null {
  if (typeof window === "undefined") return null;
  return localStorage.getItem("acadassist_token");
}

export function setToken(token: string) {
  localStorage.setItem("acadassist_token", token);
}

export function clearToken() {
  localStorage.removeItem("acadassist_token");
}

// ---------- Fetch wrapper ----------

export class ApiError extends Error {
  status: number;
  constructor(status: number, message: string) {
    super(message);
    this.status = status;
  }
}

async function request<T>(path: string, options: RequestInit = {}): Promise<T> {
  const token = getToken();
  const res = await fetch(`${API_URL}${path}`, {
    ...options,
    headers: {
      "Content-Type": "application/json",
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
      ...options.headers,
    },
  });
  if (res.status === 401 && typeof window !== "undefined") {
    clearToken();
    if (!window.location.pathname.startsWith("/login")) {
      window.location.href = "/login";
    }
  }
  if (!res.ok) {
    let detail = res.statusText;
    try {
      const body = await res.json();
      if (typeof body.detail === "string") {
        detail = body.detail;
      } else if (Array.isArray(body.detail)) {
        // FastAPI/pydantic 422: array of {msg, loc}. Show readable messages.
        detail = body.detail.map((e: { msg?: string }) => e?.msg ?? String(e)).join("; ");
      } else if (body.detail) {
        detail = JSON.stringify(body.detail);
      }
    } catch {
      /* keep statusText */
    }
    throw new ApiError(res.status, detail);
  }
  if (res.status === 204) return undefined as T;
  return res.json();
}

// ---------- Endpoints ----------


// ---------- Admin dashboard ----------

export interface AdminOverview {
  generated_at: string;
  users: {
    total: number; new_today: number; new_7d: number; new_30d: number;
    returning_7d: number; online_now: number; consented_to_analytics: number;
    consent_rate_pct: number;
  };
  engagement: {
    basis: string; dau: number; wau: number; mau: number;
    dau_by_work: number; wau_by_work: number; mau_by_work: number;
  };
  sessions_30d: { anonymous: number; registered: number };
  content: { goals: number; materials: number; scheduled_tasks: number; tasks_completed: number };
  has_data: boolean;
}

export interface AdminActivityPoint {
  date: string; events: number; sessions: number;
  active_users: number; new_users: number; work_completed: number;
}
export interface AdminActivity { days: number; series: AdminActivityPoint[]; has_data: boolean }

export interface AdminSessions {
  days: number; sessions: number; sessions_per_day: number;
  avg_duration_seconds: number; median_duration_seconds: number;
  single_event_sessions: number; has_data: boolean;
}

export interface AdminBucket { key: string; count: number }
export interface AdminFeatures {
  days: number; events: AdminBucket[]; paths: AdminBucket[]; devices: AdminBucket[];
  browsers: AdminBucket[]; languages: AdminBucket[]; countries: AdminBucket[];
  referrers: AdminBucket[];
}

export interface AdminRetention {
  weeks: number; basis: string; has_data: boolean;
  cohorts: { cohort: string; size: number; retained: number[]; retained_pct: number[] }[];
}

export interface AdminUserGoal { title: string; deadline: string }
export interface AdminUserRow {
  id: number;
  email: string;
  name: string;
  note: string | null;
  is_admin: boolean;
  analytics_consent: boolean;
  created_at: string;
  goals: AdminUserGoal[];
  tasks_total: number;
  tasks_completed: number;
  last_active: string | null;
}

export interface AdminInfrastructure {
  api: {
    window_seconds: number; requests_in_window: number; requests_per_minute: number;
    latency_ms: { p50: number; p95: number; p99: number; max: number };
    failed_requests: number; server_errors: number; error_rate_pct: number;
    lifetime: { requests: number; errors: number; uptime_seconds: number };
  };
  database: { ping_ms: number; dialect: string };
  process: {
    memory_rss_mb: number; cpu_count: number | null;
    load_avg_1m: number | null; load_avg_5m: number | null; load_avg_15m: number | null;
    python: string;
  };
  caveat: string;
}

export interface AdminFinance {
  currency: string;
  totals: {
    revenue_cents: number; expense_cents: number; credit_cents: number;
    debit_cents: number; net_cents: number; mrr_cents: number;
  };
  transactions: number; paying_users: number;
  series: { month: string; revenue_cents: number; expense_cents: number; net_cents: number }[];
  has_data: boolean; note: string;
}

export const api = {
  register: (data: {
    email: string;
    password: string;
    name: string;
    university?: string;
  }) =>
    request<{ access_token: string; user: User }>("/auth/register", {
      method: "POST",
      // "Today" has to mean the student's today. The API runs in UTC, so
      // without this a Berlin student between midnight and 02:00 is served
      // yesterday. Sent once, at the only moment we are certainly in their
      // browser; the server ignores anything it cannot resolve.
      body: JSON.stringify({ ...data, timezone: browserTimezone() }),
    }),

  login: (email: string, password: string) =>
    request<{ access_token: string; user: User }>("/auth/login", {
      method: "POST",
      body: JSON.stringify({ email, password }),
    }),

  dashboard: () => request<Dashboard>("/dashboard"),

  me: () => request<User>("/auth/me"),

  updateMe: (data: {
    name?: string;
    university?: string;
    degree?: string;
    year?: number;
    availability?: Record<string, number>;
    availability_refined?: boolean;
    timezone?: string;
  }) => request<User>("/auth/me", { method: "PATCH", body: JSON.stringify(data) }),

  createGoal: (data: {
    title: string;
    description?: string;
    category?: string;
    deadline: string;
    start_date?: string;
    priority?: "HIGH" | "NORMAL" | "PAUSED";
    launched_over_capacity?: boolean;
  }) => request<Goal>("/goals", { method: "POST", body: JSON.stringify(data) }),

  /** Does this fit? Asked before anything is written. */
  previewPlan: (data: {
    title?: string;
    deadline: string;
    materials: {
      name: string;
      total_quantity: number;
      unit: string;
      already_completed?: number;
      minutes_per_unit?: number | null;
    }[];
    availability?: Record<string, number>;
  }) => request<Feasibility>("/plan/preview", { method: "POST", body: JSON.stringify(data) }),

  /** "I have seen that the plan got heavier." Resets the quiet threshold. */
  acknowledgeLoad: (goalId: number) =>
    request<{ ok: boolean }>(`/goals/${goalId}/acknowledge`, { method: "POST" }),

  deleteGoal: (goalId: number) =>
    request<void>(`/goals/${goalId}`, { method: "DELETE" }),

  updateGoal: (goalId: number, data: Partial<Pick<Goal, "title" | "status" | "deadline">>) =>
    request<Goal>(`/goals/${goalId}`, { method: "PATCH", body: JSON.stringify(data) }),

  addMaterial: (
    goalId: number,
    data: {
      name: string;
      type?: string;
      total_quantity: number;
      unit: string;
      already_completed?: number;
      /** How long one unit takes this student. Omitted = no estimate yet. */
      minutes_per_unit?: number;
    }
  ) =>
    request<Material>(`/goals/${goalId}/materials`, {
      method: "POST",
      body: JSON.stringify(data),
    }),

  setMaterialProgress: (goalId: number, materialId: number, completed_quantity: number) =>
    request<Material>(`/goals/${goalId}/materials/${materialId}`, {
      method: "PATCH",
      body: JSON.stringify({ completed_quantity }),
    }),

  /** Correct a material's definition after the mission exists. Send only what changed. */
  editMaterial: (
    goalId: number,
    materialId: number,
    data: { name?: string; total_quantity?: number; unit?: string }
  ) =>
    request<Material>(`/goals/${goalId}/materials/${materialId}`, {
      method: "PUT",
      body: JSON.stringify(data),
    }),

  deleteMaterial: (goalId: number, materialId: number) =>
    request<void>(`/goals/${goalId}/materials/${materialId}`, { method: "DELETE" }),

  /** Mirror the local consent decision onto the account (server enforces it too). */
  setConsent: (analytics_consent: boolean) =>
    request<{ analytics_consent: boolean; updated_at: string | null }>("/me/consent", {
      method: "PUT",
      body: JSON.stringify({ analytics_consent }),
    }),

  getConsent: () =>
    request<{ analytics_consent: boolean; updated_at: string | null }>("/me/consent"),

  /** GDPR access + portability: everything held about this account. */
  exportMyData: () => request<Record<string, unknown>>("/me/export"),

  /** GDPR erasure: irreversible, cascades to every related row. */
  deleteMyAccount: () => request<void>("/me", { method: "DELETE" }),

  // ----- admin (server enforces is_admin; 404 when not an operator) -----
  adminOverview: () => request<AdminOverview>("/admin/overview"),
  adminActivity: (days = 30) => request<AdminActivity>(`/admin/activity?days=${days}`),
  adminSessions: (days = 30) => request<AdminSessions>(`/admin/sessions?days=${days}`),
  adminFeatures: (days = 30) => request<AdminFeatures>(`/admin/features?days=${days}`),
  adminRetention: (weeks = 6) => request<AdminRetention>(`/admin/retention?weeks=${weeks}`),
  adminInfrastructure: () => request<AdminInfrastructure>("/admin/infrastructure"),
  adminFinance: (months = 12) => request<AdminFinance>(`/admin/finance?months=${months}`),
  adminUsers: () => request<AdminUserRow[]>("/admin/users"),
  setUserNote: (userId: number, note: string | null) =>
    request<AdminUserRow>(`/admin/users/${userId}`, {
      method: "PATCH",
      body: JSON.stringify({ note }),
    }),

  plan: (goalId: number) => request<Plan>(`/goals/${goalId}/plan`),

  today: () => request<Today>("/today"),


  calendar: (start: string, end: string) =>
    request<CalendarTask[]>(`/calendar?start=${start}&end=${end}`),

  updateTask: (
    taskId: number,
    // actual_minutes is the only measurement of real pace the product takes.
    data: { completed: boolean; actual_quantity?: number; actual_minutes?: number }
  ) =>
    request<{ task: ScheduledTask; overshoot: number; message: string | null }>(
      `/tasks/${taskId}`,
      { method: "PATCH", body: JSON.stringify(data) }
    ),

  schedule: (goalId: number, days = 14) =>
    request<ScheduledTask[]>(`/goals/${goalId}/schedule?days=${days}`),

  history: (goalId: number) => request<ScheduledTask[]>(`/goals/${goalId}/history`),
};
