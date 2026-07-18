"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useCallback, useEffect, useState } from "react";
import { api, getToken, ScheduledTask, Today } from "@/lib/api";
import { Spinner } from "@/components/ui";

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

  const load = useCallback(() => api.today().then(setData).catch(() => {}), []);

  useEffect(() => {
    if (!getToken()) {
      router.push("/login");
      return;
    }
    load();
  }, [router, load]);

  if (!data) return <Spinner />;

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

  function logActual(task: ScheduledTask) {
    const raw = window.prompt(
      `Planned: ${task.quantity}. How much did you actually do?`,
      String(task.quantity)
    );
    if (raw === null) return;
    const value = Number(raw);
    if (Number.isNaN(value) || value < 0) return;
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
    <div className="mx-auto max-w-xl">
      <p className="text-xs font-medium uppercase tracking-[0.2em] text-ink-muted">
        Today ·{" "}
        {new Date(`${data.date}T00:00:00`).toLocaleDateString("en-US", {
          weekday: "long",
          month: "long",
          day: "numeric",
        })}
      </p>

      {flash && (
        <div className="mt-4 rounded-lg border border-accent/40 bg-accent-wash px-4 py-3 text-sm text-ink">
          {flash}
        </div>
      )}

      {allTasks.length === 0 && (
        <div className="mt-16 text-center">
          <p className="font-serif text-2xl font-semibold text-ink">Nothing scheduled today.</p>
          <p className="mt-2 text-sm text-ink-muted">
            Rest day, or no missions yet. Staying ahead is always allowed.
          </p>
          <div className="mt-5 flex items-center justify-center gap-4">
            <button
              onClick={borrowTomorrow}
              disabled={pullingMore}
              className="rounded-lg bg-accent px-5 py-2.5 text-sm font-medium text-white hover:bg-accent-deep disabled:opacity-50"
            >
              {pullingMore ? "…" : "Borrow tomorrow's work"}
            </button>
            <Link href="/missions/new" className="text-sm text-accent hover:underline">
              + New mission
            </Link>
          </div>
        </div>
      )}

      {dayComplete && (
        <div className="mt-10 rounded-xl border border-good/40 bg-surface p-7 text-center shadow-sm">
          <p className="text-xs font-semibold uppercase tracking-[0.2em] text-good">
            ✓ Day complete
          </p>
          <p className="mx-auto mt-3 max-w-md font-serif text-2xl text-ink">
            {praise ?? praiseFor(doneCount)}
          </p>
          <p className="mt-3 text-xs text-ink-muted tnum">
            {doneCount} {doneCount === 1 ? "task" : "tasks"} completed
          </p>
          <div className="mt-5">
            <p className="text-sm text-ink-2">Feeling good?</p>
            <button
              onClick={borrowTomorrow}
              disabled={pullingMore}
              className="mt-2 rounded-lg border border-accent px-6 py-2.5 text-sm font-medium text-accent hover:bg-accent hover:text-white disabled:opacity-50 transition-colors"
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
                  className="text-xs font-medium uppercase tracking-[0.15em] text-ink-muted hover:text-ink-2"
                >
                  {m.title}
                </Link>
                {m.days_behind > 0 && (
                  <span className="text-xs font-medium text-warning">
                    ◆ {m.days_behind} days behind
                  </span>
                )}
              </div>
              <ul className="mt-2 space-y-2">
                {m.tasks.map((t) => (
                  <li
                    key={t.id}
                    className={`rounded-xl border transition-colors ${
                      t.completed
                        ? "border-line bg-surface-2 opacity-70"
                        : "border-line bg-surface shadow-sm hover:border-accent/50"
                    }`}
                  >
                    <div className="flex items-center gap-3 px-4 py-3.5">
                      <input
                        type="checkbox"
                        checked={t.completed}
                        disabled={busy === t.id}
                        onChange={(e) => finishTask(t, e.target.checked)}
                        className="h-5 w-5 shrink-0 accent-[#2a78d6]"
                      />
                      <span
                        className={`flex-1 text-[15px] ${
                          t.completed ? "text-ink-muted line-through" : "text-ink"
                        }`}
                      >
                        {t.description}
                      </span>
                      {!t.completed && (
                        <>
                          {t.why && (
                            <button
                              onClick={() => setWhyOpen(whyOpen === t.id ? null : t.id)}
                              className={`shrink-0 text-xs ${
                                whyOpen === t.id ? "text-accent" : "text-ink-muted hover:text-accent"
                              }`}
                            >
                              Why?
                            </button>
                          )}
                          <button
                            onClick={() => logActual(t)}
                            title="Did more or less than planned? Log the real amount"
                            className="shrink-0 text-xs text-ink-muted hover:text-accent"
                          >
                            did more/less
                          </button>
                        </>
                      )}
                    </div>
                    {whyOpen === t.id && t.why && (
                      <p className="border-t border-line bg-accent-wash px-4 py-2.5 text-[13px] leading-relaxed text-ink-2 rounded-b-xl">
                        {t.why}
                      </p>
                    )}
                  </li>
                ))}
              </ul>
            </section>
          ))}
      </div>

      {allTasks.length > 0 && (
        <div className="mt-8 flex items-center justify-between border-t border-line pt-4">
          <span className="text-xs text-ink-muted tnum">
            {doneCount}/{allTasks.length} done
          </span>
          <Link href="/calendar" className="text-xs text-ink-muted hover:text-accent">
            View full calendar →
          </Link>
        </div>
      )}
    </div>
  );
}
