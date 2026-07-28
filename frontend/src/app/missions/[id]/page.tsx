"use client";

import { useRouter } from "next/navigation";
import { use, useCallback, useEffect, useState } from "react";
import { api, Plan, ScheduledTask } from "@/lib/api";
import { DarkShell, DarkStatusBadge, DarkTrajectoryBar } from "@/components/darkchrome";

export default function MissionPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = use(params);
  const goalId = Number(id);
  const router = useRouter();

  const [plan, setPlan] = useState<Plan | null>(null);
  const [history, setHistory] = useState<ScheduledTask[]>([]);
  const [schedule, setSchedule] = useState<ScheduledTask[]>([]);
  const [tab, setTab] = useState<"schedule" | "history">("schedule");
  const [editOpen, setEditOpen] = useState<number | null>(null);
  const [editValue, setEditValue] = useState("");
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [busy, setBusy] = useState(false);

  const load = useCallback(async () => {
    const [p, h, s] = await Promise.all([
      api.plan(goalId),
      api.history(goalId),
      api.schedule(goalId, 14),
    ]);
    setPlan(p);
    setHistory(h);
    setSchedule(s);
  }, [goalId]);

  useEffect(() => {
    load().catch(() => router.push("/"));
  }, [load, router]);

  if (!plan) {
    return (
      <DarkShell width="max-w-3xl">
        <p className="py-24 text-center text-white/50">loading…</p>
      </DarkShell>
    );
  }

  const r = plan.reality;

  function toggleEdit(materialId: number, completed: number) {
    if (editOpen === materialId) {
      setEditOpen(null);
      return;
    }
    setEditValue(String(completed));
    setEditOpen(materialId);
  }

  async function submitEdit(materialId: number) {
    const value = Number(editValue);
    if (editValue.trim() === "" || Number.isNaN(value) || value < 0) return;
    setBusy(true);
    try {
      await api.setMaterialProgress(goalId, materialId, value);
      setEditOpen(null);
      await load();
    } finally {
      setBusy(false);
    }
  }

  async function deleteMission() {
    setBusy(true);
    try {
      await api.deleteGoal(goalId);
      router.push("/");
    } finally {
      setBusy(false);
    }
  }

  return (
    <DarkShell width="max-w-3xl">
      <div className="pt-6">
        <div className="flex items-start justify-between gap-4">
          <div>
            <p className="text-xs font-semibold uppercase tracking-[0.2em] text-white/50">
              Mission{plan.goal.category ? ` · ${plan.goal.category}` : ""}
            </p>
            <h1 className="mt-1 text-3xl font-bold tracking-tight text-white">{plan.goal.title}</h1>
          </div>
          <div className="pt-1">
            <DarkStatusBadge status={r.status} />
          </div>
        </div>

        <div className="mt-6 grid grid-cols-2 gap-3 sm:grid-cols-4">
          <StatTile label="Days left" value={String(r.days_remaining)} sub={`of ${r.days_total}`} />
          <StatTile label="Progress" value={`${r.actual_progress_pct.toFixed(0)}%`} />
          <StatTile label="Expected" value={`${r.expected_progress_pct.toFixed(0)}%`} />
          <StatTile
            label="Trajectory"
            value={`${(r.trajectory_ratio * 100).toFixed(0)}%`}
            sub="actual / expected"
          />
        </div>

        <div className="mt-6">
          <DarkTrajectoryBar actualPct={r.actual_progress_pct} expectedPct={r.expected_progress_pct} />
        </div>

        <div className="ob-glass mt-6 rounded-2xl px-5 py-4">
          <p className="text-sm text-white/80">{r.message}</p>
          {r.adjustments.length > 0 && (
            <ul className="mt-2 space-y-1">
              {r.adjustments.map((a) => (
                <li key={a} className="text-sm text-amber-300">→ {a}</li>
              ))}
            </ul>
          )}
        </div>

        <section className="mt-10">
          <p className="text-xs font-semibold uppercase tracking-[0.2em] text-white/50">
            Materials · required pace
          </p>
          <ul className="mt-3 space-y-2">
            {plan.materials.map((m) => (
              <li key={m.material_id} className="ob-glass overflow-hidden rounded-2xl">
                <div className="flex flex-wrap items-center gap-x-4 gap-y-1 px-5 py-3.5">
                  <span className="flex-1 text-[15px] text-white">{m.name}</span>
                  <span className="text-sm text-white/60 tnum">
                    {m.completed} / {m.total} {m.unit}
                  </span>
                  <span className="text-xs text-white/85 tnum">{m.human_rate}</span>
                  <button
                    onClick={() => toggleEdit(m.material_id, m.completed)}
                    className={`text-xs ${editOpen === m.material_id ? "text-white" : "text-white/50 hover:text-white"}`}
                  >
                    update
                  </button>
                </div>
                {editOpen === m.material_id && (
                  <div className="border-t border-white/10 bg-white/[0.04] px-5 py-3">
                    <p className="text-[13px] text-white/70">
                      Where are you in &quot;{m.name}&quot;? Completed {m.unit} of {m.total}:
                    </p>
                    <div className="mt-2.5 flex items-center gap-2.5">
                      <input
                        autoFocus
                        type="number"
                        min="0"
                        max={m.total}
                        value={editValue}
                        onChange={(e) => setEditValue(e.target.value)}
                        onKeyDown={(e) => {
                          if (e.key === "Enter") submitEdit(m.material_id);
                          if (e.key === "Escape") setEditOpen(null);
                        }}
                        className="ob-glass w-28 rounded-xl px-4 py-2 text-center text-sm text-white tnum"
                      />
                      <button
                        onClick={() => submitEdit(m.material_id)}
                        disabled={busy || editValue.trim() === "" || Number(editValue) < 0 || Number.isNaN(Number(editValue))}
                        className="ob-btn rounded-xl px-5 py-2 text-xs font-semibold disabled:opacity-40"
                      >
                        Save
                      </button>
                      <button onClick={() => setEditOpen(null)} className="text-xs text-white/50 hover:text-white">
                        cancel
                      </button>
                    </div>
                  </div>
                )}
              </li>
            ))}
            {plan.materials.length === 0 && (
              <li className="ob-glass rounded-2xl px-5 py-6 text-center text-sm text-white/50">
                No materials yet — add them when creating the mission.
              </li>
            )}
          </ul>
        </section>

        <section className="mt-10">
          <div className="flex gap-2">
            <TabButton active={tab === "schedule"} onClick={() => setTab("schedule")}>
              Next 14 days
            </TabButton>
            <TabButton active={tab === "history"} onClick={() => setTab("history")}>
              History
            </TabButton>
          </div>

          {tab === "schedule" ? (
            <ScheduleList tasks={schedule} />
          ) : (
            <ul className="mt-4 space-y-1">
              {history.map((t) => (
                <li key={t.id} className="flex items-center gap-2.5 px-2 py-1.5 text-sm">
                  <span className="text-xs text-white/45 tnum">{t.date}</span>
                  <span className={t.completed ? "text-emerald-300" : "text-red-300"} aria-hidden>
                    {t.completed ? "✓" : "✕"}
                  </span>
                  <span className={t.completed ? "text-white/75" : "text-white/45"}>
                    {t.description}
                    {!t.completed && " — missed"}
                  </span>
                </li>
              ))}
              {history.length === 0 && (
                <li className="py-4 text-sm text-white/50">No past days yet. History appears tomorrow.</li>
              )}
            </ul>
          )}
        </section>

        <div className="mt-14 border-t border-white/10 pt-5">
          {confirmDelete ? (
            <div className="ob-glass flex flex-wrap items-center justify-between gap-3 rounded-2xl px-5 py-4">
              <p className="text-sm text-white/85">
                Delete <span className="font-semibold">&quot;{plan.goal.title}&quot;</span> and all its data?
              </p>
              <div className="flex items-center gap-3">
                <button
                  onClick={deleteMission}
                  disabled={busy}
                  className="rounded-xl border border-red-400/40 bg-red-400/10 px-5 py-2 text-xs font-semibold text-red-300 transition-colors hover:bg-red-400/20 disabled:opacity-50"
                >
                  {busy ? "…" : "Delete forever"}
                </button>
                <button onClick={() => setConfirmDelete(false)} className="text-xs text-white/50 hover:text-white">
                  keep it
                </button>
              </div>
            </div>
          ) : (
            <button onClick={() => setConfirmDelete(true)} className="text-xs text-white/40 hover:text-red-300">
              Delete mission
            </button>
          )}
        </div>
      </div>
    </DarkShell>
  );
}

function StatTile({ label, value, sub }: { label: string; value: string; sub?: string }) {
  return (
    <div className="ob-glass rounded-2xl px-4 py-3">
      <div className="text-[11px] font-semibold uppercase tracking-widest text-white/50">{label}</div>
      <div className="mt-1 text-2xl font-bold text-white tnum">{value}</div>
      {sub && <div className="mt-0.5 text-xs text-white/50">{sub}</div>}
    </div>
  );
}

function TabButton({
  active,
  onClick,
  children,
}: {
  active: boolean;
  onClick: () => void;
  children: React.ReactNode;
}) {
  return (
    <button
      onClick={onClick}
      className={`rounded-xl px-4 py-2 text-sm transition-colors ${
        active ? "ob-btn font-semibold" : "text-white/55 hover:text-white"
      }`}
    >
      {children}
    </button>
  );
}

function ScheduleList({ tasks }: { tasks: ScheduledTask[] }) {
  const byDate = new Map<string, ScheduledTask[]>();
  for (const t of tasks) {
    byDate.set(t.date, [...(byDate.get(t.date) ?? []), t]);
  }
  if (byDate.size === 0) {
    return <p className="mt-4 py-4 text-sm text-white/50">Nothing scheduled — add materials.</p>;
  }
  const today = new Date().toISOString().slice(0, 10);
  return (
    <div className="mt-4 space-y-2">
      {[...byDate.entries()].map(([date, dayTasks]) => (
        <div key={date} className="flex gap-3 px-2 py-1.5">
          <span
            className={`w-24 shrink-0 text-xs tnum ${date === today ? "font-semibold text-white" : "text-white/45"}`}
          >
            {date === today
              ? "TODAY"
              : new Date(`${date}T00:00:00`).toLocaleDateString("en-US", {
                  weekday: "short",
                  month: "short",
                  day: "numeric",
                })}
          </span>
          <div className="flex-1 space-y-0.5">
            {dayTasks.map((t) => (
              <p key={t.id} className={`text-sm ${t.completed ? "text-white/40 line-through" : "text-white/80"}`}>
                {t.description}
              </p>
            ))}
          </div>
        </div>
      ))}
    </div>
  );
}
