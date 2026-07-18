const API_URL = process.env.NEXT_PUBLIC_API_URL ?? "http://localhost:8000";

// ---------- Types (mirror backend schemas) ----------

export interface User {
  id: number;
  email: string;
  name: string;
  university: string | null;
  degree: string | null;
  year: number | null;
  availability: Record<string, number> | null;
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
}

export interface Material {
  id: number;
  goal_id: number;
  name: string;
  type: string | null;
  total_quantity: number;
  unit: string;
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
  why: string | null;
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
      detail = typeof body.detail === "string" ? body.detail : JSON.stringify(body.detail);
    } catch {
      /* keep statusText */
    }
    throw new ApiError(res.status, detail);
  }
  if (res.status === 204) return undefined as T;
  return res.json();
}

// ---------- Endpoints ----------

export const api = {
  register: (data: {
    email: string;
    password: string;
    name: string;
    university?: string;
  }) =>
    request<{ access_token: string; user: User }>("/auth/register", {
      method: "POST",
      body: JSON.stringify(data),
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
  }) => request<User>("/auth/me", { method: "PATCH", body: JSON.stringify(data) }),

  createGoal: (data: {
    title: string;
    description?: string;
    category?: string;
    deadline: string;
    start_date?: string;
  }) => request<Goal>("/goals", { method: "POST", body: JSON.stringify(data) }),

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

  plan: (goalId: number) => request<Plan>(`/goals/${goalId}/plan`),

  today: () => request<Today>("/today"),

  todayMore: () => request<Today>("/today/more", { method: "POST" }),

  calendar: (start: string, end: string) =>
    request<CalendarTask[]>(`/calendar?start=${start}&end=${end}`),

  updateTask: (taskId: number, data: { completed: boolean; actual_quantity?: number }) =>
    request<{ task: ScheduledTask; overshoot: number; message: string | null }>(
      `/tasks/${taskId}`,
      { method: "PATCH", body: JSON.stringify(data) }
    ),

  schedule: (goalId: number, days = 14) =>
    request<ScheduledTask[]>(`/goals/${goalId}/schedule?days=${days}`),

  history: (goalId: number) => request<ScheduledTask[]>(`/goals/${goalId}/history`),
};
