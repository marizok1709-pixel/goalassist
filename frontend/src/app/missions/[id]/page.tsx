"use client";

import { useRouter } from "next/navigation";
import { use, useCallback, useEffect, useState } from "react";
import { api, Plan, ScheduledTask } from "@/lib/api";
import {
  btnGhost,
  RealityPanel,
  Spinner,
  StatTile,
  StatusBadge,
  TrajectoryBar,
} from "@/components/ui";

export default function MissionPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = use(params);
  const goalId = Number(id);
  const router = useRouter();

  const [plan, setPlan] = useState<Plan | null>(null);
  const [history, setHistory] = useState<ScheduledTask[]>([]);
  const [schedule, setSchedule] = useState<ScheduledTask[]>([]);
  const [tab, setTab] = useState<"schedule" | "history">("schedule");

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

  if (!plan) return <Spinner />;

  const r = plan.reality;

  async function updateProgress(materialId: number, name: string, unit: string, total: number) {
    const raw = window.prompt(`Where are you in "${name}"? Completed ${unit} (of ${total}):`);
    if (raw === null) return;
    const value = Number(raw);
    if (Number.isNaN(value) || value < 0) return;
    await api.setMaterialProgress(goalId, materialId, value);
    await load();
  }

  async function deleteMission() {
    if (!window.confirm(`Delete mission "${plan?.goal.title}" and all its data?`)) return;
    await api.deleteGoal(goalId);
    router.push("/");
  }

  return (
    <div>
      <div className="flex items-start justify-between gap-4">
        <div>
          <p className="font-mono text-[11px] uppercase tracking-widest text-ink-muted">
            Mission {plan.goal.category ? `· ${plan.goal.category}` : ""}
          </p>
          <h1 className="mt-0.5 font-serif text-3xl font-semibold text-ink">{plan.goal.title}</h1>
        </div>
        <StatusBadge status={r.status} />
      </div>

      <div className="mt-5 grid grid-cols-2 gap-3 sm:grid-cols-4">
        <StatTile label="Days left" value={String(r.days_remaining)} sub={`of ${r.days_total}`} />
        <StatTile label="Progress" value={`${r.actual_progress_pct.toFixed(0)}%`} />
        <StatTile label="Expected" value={`${r.expected_progress_pct.toFixed(0)}%`} />
        <StatTile
          label="Trajectory"
          value={`${(r.trajectory_ratio * 100).toFixed(0)}%`}
          sub="actual / expected"
        />
      </div>

      <div className="mt-5">
        <TrajectoryBar actualPct={r.actual_progress_pct} expectedPct={r.expected_progress_pct} />
      </div>

      <div className="mt-5">
        <RealityPanel reality={r} />
      </div>

      <section className="mt-8">
        <p className="font-mono text-[11px] uppercase tracking-widest text-ink-muted">
          Materials · required pace
        </p>
        <div className="mt-2 overflow-x-auto rounded-lg border border-line">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-line bg-surface text-left font-mono text-[11px] uppercase tracking-wider text-ink-muted">
                <th className="px-4 py-2 font-medium">Material</th>
                <th className="px-4 py-2 font-medium text-right">Done</th>
                <th className="px-4 py-2 font-medium text-right">Required pace</th>
                <th className="px-4 py-2" />
              </tr>
            </thead>
            <tbody>
              {plan.materials.map((m) => (
                <tr key={m.material_id} className="border-b border-line last:border-0">
                  <td className="px-4 py-2.5 text-ink">{m.name}</td>
                  <td className="px-4 py-2.5 text-right text-ink-2 tnum">
                    {m.completed} / {m.total} {m.unit}
                  </td>
                  <td className="px-4 py-2.5 text-right font-mono text-xs text-accent">
                    {m.human_rate}
                  </td>
                  <td className="px-4 py-2.5 text-right">
                    <button
                      onClick={() => updateProgress(m.material_id, m.name, m.unit, m.total)}
                      className="font-mono text-[11px] text-ink-muted hover:text-accent"
                    >
                      update
                    </button>
                  </td>
                </tr>
              ))}
              {plan.materials.length === 0 && (
                <tr>
                  <td colSpan={4} className="px-4 py-6 text-center text-ink-muted">
                    No materials yet — add them when creating the mission.
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </section>

      <section className="mt-8">
        <div className="flex gap-2">
          <button
            onClick={() => setTab("schedule")}
            className={`${btnGhost} ${tab === "schedule" ? "border-accent text-ink" : ""}`}
          >
            Next 14 days
          </button>
          <button
            onClick={() => setTab("history")}
            className={`${btnGhost} ${tab === "history" ? "border-accent text-ink" : ""}`}
          >
            History
          </button>
        </div>

        {tab === "schedule" ? (
          <ScheduleList tasks={schedule} />
        ) : (
          <ul className="mt-3 space-y-1">
            {history.map((t) => (
              <li key={t.id} className="flex items-center gap-2.5 px-2 py-1.5 text-sm">
                <span className="font-mono text-[11px] text-ink-muted tnum">{t.date}</span>
                <span className={t.completed ? "text-good" : "text-critical"} aria-hidden>
                  {t.completed ? "✓" : "✕"}
                </span>
                <span className={t.completed ? "text-ink-2" : "text-ink-muted"}>
                  {t.description}
                  {!t.completed && " — missed"}
                </span>
              </li>
            ))}
            {history.length === 0 && (
              <li className="py-4 text-sm text-ink-muted">
                No past days yet. History appears tomorrow.
              </li>
            )}
          </ul>
        )}
      </section>

      <div className="mt-12 border-t border-line pt-4">
        <button onClick={deleteMission} className="text-xs text-ink-muted hover:text-critical">
          Delete mission
        </button>
      </div>
    </div>
  );
}

function ScheduleList({ tasks }: { tasks: ScheduledTask[] }) {
  const byDate = new Map<string, ScheduledTask[]>();
  for (const t of tasks) {
    byDate.set(t.date, [...(byDate.get(t.date) ?? []), t]);
  }
  if (byDate.size === 0) {
    return <p className="mt-3 py-4 text-sm text-ink-muted">Nothing scheduled — add materials.</p>;
  }
  const today = new Date().toISOString().slice(0, 10);
  return (
    <div className="mt-3 space-y-2">
      {[...byDate.entries()].map(([date, dayTasks]) => (
        <div key={date} className="flex gap-3 rounded-md px-2 py-1.5">
          <span
            className={`w-24 shrink-0 font-mono text-[11px] tnum ${
              date === today ? "text-accent" : "text-ink-muted"
            }`}
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
              <p
                key={t.id}
                className={`text-sm ${t.completed ? "text-ink-muted line-through" : "text-ink-2"}`}
              >
                {t.description}
              </p>
            ))}
          </div>
        </div>
      ))}
    </div>
  );
}
