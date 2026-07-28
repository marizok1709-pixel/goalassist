"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useCallback, useEffect, useState } from "react";
import { api, getToken, ScheduledTask, Today } from "@/lib/api";
import { DarkShell } from "@/components/darkchrome";

// Praise shows the reward, not the cheer. Higher tiers earn the big lines.
const PRAISE: string[][] = [
  [
    "You're reducing deadline pressure.",
    "The plan holds. Tomorrow is lighter than it would have been.",
    "The curve bent your way today.",
  ],
  [
    "That's a lighter week you just built.",
    "Your required daily pace just dropped.",
    "You are on the right track — and the track just got shorter.",
  ],
  [
    "You bought yourself a free evening this week.",
    "Champion mentality — and a lighter Thursday.",
    "Mamba mentality. Tomorrow owes you one.",
  ],
  [
    "You are a different animal and the same beast.",
    "What would you do if you didn't win? I guess we never know.",
    "A whole day of buffer, earned in one sitting.",
  ],
];

function praiseFor(done: number): string {
  const tier = done <= 2 ? 0 : done <= 4 ? 1 : done <= 6 ? 2 : 3;
  const pool = PRAISE[tier];
  return pool[Math.floor(Math.random() * pool.length)];
}

export default function TodayPage() {
  const router = useRouter();
  const [data, setData] = useState<Today | null>(null);
  const [busy, setBusy] = useState<number | null>(null);
  const [pullingMore, setPullingMore] = useState(false);
  const [flash, setFlash] = useState<string | null>(null);
  const [praise, setPraise] = useState<string | null>(null);
  const [whyOpen, setWhyOpen] = useState<number | null>(null);
  const [logOpen, setLogOpen] = useState<number | null>(null);
  const [logValue, setLogValue] = useState("");

  const load = useCallback(() => api.today().then(setData).catch(() => {}), []);

  useEffect(() => {
    if (!getToken()) {
      router.push("/onboarding");
      return;
    }
    load();
  }, [router, load]);

  if (!data) {
    return (
      <DarkShell>
        <p className="py-24 text-center text-white/50">loading…</p>
      </DarkShell>
    );
  }

  const allTasks = data.missions.flatMap((m) => m.tasks);
  const openTasks = allTasks.filter((t) => !t.completed);
  const doneCount = allTasks.length - openTasks.length;
  const dayComplete = allTasks.length > 0 && openTasks.length === 0;

  async function finishTask(task: ScheduledTask, completed: boolean, actual?: number) {
    setBusy(task.id);
    try {
      const res = await api.updateTask(task.id, { completed, actual_quantity: actual });
      setFlash(res.message);
      const fresh = await api.today();
      setData(fresh);
      const freshAll = fresh.missions.flatMap((m) => m.tasks);
      if (freshAll.length > 0 && freshAll.every((t) => t.completed)) {
        setPraise(praiseFor(freshAll.length));
      }
    } finally {
      setBusy(null);
    }
  }

  function toggleLog(task: ScheduledTask) {
    if (logOpen === task.id) {
      setLogOpen(null);
      return;
    }
    setLogValue(String(task.quantity));
    setLogOpen(task.id);
    setWhyOpen(null);
  }

  function submitLog(task: ScheduledTask) {
    const value = Number(logValue);
    if (logValue.trim() === "" || Number.isNaN(value) || value < 0) return;
    setLogOpen(null);
    finishTask(task, true, value);
  }

  async function borrowTomorrow() {
    setPullingMore(true);
    setPraise(null);
    setFlash(null);
    try {
      setData(await api.todayMore());
    } finally {
      setPullingMore(false);
    }
  }

  return (
    <DarkShell>
      <div className="pt-6">
        <p className="text-xs font-semibold uppercase tracking-[0.2em] text-white/50">
          Today ·{" "}
          {new Date(`${data.date}T00:00:00`).toLocaleDateString("en-US", {
            weekday: "long",
            month: "long",
            day: "numeric",
          })}
        </p>

        {flash && (
          <div className="ob-glass mt-4 rounded-2xl px-4 py-3 text-sm text-white/90">{flash}</div>
        )}

        {allTasks.length === 0 && (
          <div className="mt-16 text-center">
            <p className="text-2xl font-bold text-white">Nothing scheduled today.</p>
            <p className="mt-2 text-sm text-white/55">
              Rest day, or no missions yet. Staying ahead is always allowed.
            </p>
            <div className="mt-6 flex items-center justify-center gap-4">
              <button
                onClick={borrowTomorrow}
                disabled={pullingMore}
                className="ob-btn rounded-2xl px-6 py-3 text-sm font-semibold disabled:opacity-50"
              >
                {pullingMore ? "…" : "Borrow tomorrow's work"}
              </button>
              <Link href="/missions/new" className="text-sm text-white/60 hover:text-white">
                + New mission
              </Link>
            </div>
          </div>
        )}

        {dayComplete && (
          <div className="ob-glass mt-10 rounded-3xl p-7 text-center">
            <p className="text-xs font-semibold uppercase tracking-[0.2em] text-emerald-300">✓ Day complete</p>
            <p className="mx-auto mt-3 max-w-md text-2xl font-semibold text-white">
              {praise ?? praiseFor(doneCount)}
            </p>
            <p className="mt-3 text-xs text-white/50 tnum">
              {doneCount} {doneCount === 1 ? "task" : "tasks"} completed
            </p>
            <div className="mt-5">
              <p className="text-sm text-white/70">Feeling good?</p>
              <button
                onClick={borrowTomorrow}
                disabled={pullingMore}
                className="ob-btn mt-2 rounded-2xl px-6 py-2.5 text-sm font-semibold disabled:opacity-50"
              >
                {pullingMore ? "…" : "Borrow tomorrow's work"}
              </button>
            </div>
          </div>
        )}

        <div className="mt-6 space-y-8">
          {data.missions
            .filter((m) => m.tasks.length > 0)
            .map((m) => (
              <section key={m.goal_id}>
                <div className="flex items-baseline justify-between">
                  <Link
                    href={`/missions/${m.goal_id}`}
                    className="text-xs font-semibold uppercase tracking-[0.15em] text-white/55 hover:text-white/80"
                  >
                    {m.title}
                  </Link>
                  {m.days_behind > 0 && (
                    <span className="text-xs font-semibold text-amber-300">◆ {m.days_behind} days behind</span>
                  )}
                </div>
                <ul className="mt-2 space-y-2">
                  {m.tasks.map((t) => (
                    <li
                      key={t.id}
                      className={`ob-glass overflow-hidden rounded-2xl transition-colors ${
                        t.completed ? "opacity-60" : "hover:bg-white/[0.12]"
                      }`}
                    >
                      <div className="flex items-center gap-3 px-4 py-3.5">
                        <input
                          type="checkbox"
                          checked={t.completed}
                          disabled={busy === t.id}
                          onChange={(e) => finishTask(t, e.target.checked)}
                          className="h-5 w-5 shrink-0 accent-white"
                        />
                        <span className={`flex-1 text-[15px] ${t.completed ? "text-white/45 line-through" : "text-white"}`}>
                          {t.description}
                        </span>
                        {!t.completed && (
                          <>
                            {t.why && (
                              <button
                                onClick={() => {
                                  setWhyOpen(whyOpen === t.id ? null : t.id);
                                  setLogOpen(null);
                                }}
                                className={`shrink-0 text-xs ${whyOpen === t.id ? "text-white" : "text-white/50 hover:text-white"}`}
                              >
                                Why?
                              </button>
                            )}
                            <button
                              onClick={() => toggleLog(t)}
                              title="Did more or less than planned? Log the real amount"
                              className={`shrink-0 text-xs ${logOpen === t.id ? "text-white" : "text-white/50 hover:text-white"}`}
                            >
                              did more/less
                            </button>
                          </>
                        )}
                      </div>
                      {whyOpen === t.id && t.why && (
                        <p className="border-t border-white/10 bg-white/[0.04] px-4 py-2.5 text-[13px] leading-relaxed text-white/70">
                          {t.why}
                        </p>
                      )}
                      {logOpen === t.id && (
                        <div className="border-t border-white/10 bg-white/[0.04] px-4 py-3">
                          <p className="text-[13px] text-white/70">
                            Planned: <span className="tnum">{t.quantity}</span>. How much did you actually do?
                          </p>
                          <div className="mt-2.5 flex items-center gap-2.5">
                            <input
                              autoFocus
                              type="number"
                              min="0"
                              value={logValue}
                              onChange={(e) => setLogValue(e.target.value)}
                              onKeyDown={(e) => {
                                if (e.key === "Enter") submitLog(t);
                                if (e.key === "Escape") setLogOpen(null);
                              }}
                              className="ob-glass w-28 rounded-xl px-4 py-2 text-center text-sm text-white tnum"
                            />
                            <button
                              onClick={() => submitLog(t)}
                              disabled={busy === t.id || logValue.trim() === "" || Number(logValue) < 0 || Number.isNaN(Number(logValue))}
                              className="ob-btn rounded-xl px-5 py-2 text-xs font-semibold disabled:opacity-40"
                            >
                              Log it
                            </button>
                            <button
                              onClick={() => setLogOpen(null)}
                              className="text-xs text-white/50 hover:text-white"
                            >
                              cancel
                            </button>
                          </div>
                        </div>
                      )}
                    </li>
                  ))}
                </ul>
              </section>
            ))}
        </div>

        {allTasks.length > 0 && (
          <div className="mt-8 flex items-center justify-between border-t border-white/10 pt-4">
            <span className="text-xs text-white/45 tnum">
              {doneCount}/{allTasks.length} done
            </span>
            <Link href="/calendar" className="text-xs text-white/50 hover:text-white">
              View full calendar →
            </Link>
          </div>
        )}
      </div>
    </DarkShell>
  );
}
