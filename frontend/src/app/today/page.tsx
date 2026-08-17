"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useCallback, useEffect, useState } from "react";
import { api, getToken, ScheduledTask, Today } from "@/lib/api";
import { DarkShell } from "@/components/darkchrome";
import { PageLoading } from "@/components/ui";
import { analytics } from "@/lib/analytics";

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

/** A day of work's identity: mission + date + material.
 *
 * This used to be a row id from the database. The forward plan is computed now,
 * so there is no row and no id — and this is the identity the work always had.
 */
function dayKey(t: { goal_id: number; date: string; material_id: number | null }) {
  return `${t.goal_id}:${t.date}:${t.material_id ?? "x"}`;
}

export default function TodayPage() {
  const router = useRouter();
  const [data, setData] = useState<Today | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [flash, setFlash] = useState<string | null>(null);
  const [praise, setPraise] = useState<string | null>(null);
  const [whyOpen, setWhyOpen] = useState<string | null>(null);
  const [logOpen, setLogOpen] = useState<string | null>(null);
  const [logValue, setLogValue] = useState("");
  // How long it took. Optional on purpose — a student who does not answer must
  // not be blocked — but it is the only measurement of real pace the product
  // ever takes, and without it calibration has nothing to calibrate from.
  const [logMinutes, setLogMinutes] = useState("");

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
        <PageLoading />
      </DarkShell>
    );
  }

  const allTasks = data.missions.flatMap((m) => m.tasks);
  const openTasks = allTasks.filter((t) => !t.completed);
  const doneCount = allTasks.length - openTasks.length;
  const dayComplete = allTasks.length > 0 && openTasks.length === 0;

  async function finishTask(
    task: ScheduledTask,
    completed: boolean,
    actual?: number,
    minutes?: number
  ) {
    setBusy(dayKey(task));
    try {
      const res = await api.updateDay(task.goal_id, task.date, {
        completed,
        material_id: task.material_id,
        actual_quantity: actual,
        actual_minutes: minutes,
      });
      analytics.track(actual === undefined ? "task_completed" : "task_logged", { completed });
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
    if (logOpen === dayKey(task)) {
      setLogOpen(null);
      return;
    }
    setLogValue(String(task.quantity));
    setLogMinutes(task.minutes ? String(Math.round(task.minutes)) : "");
    setLogOpen(dayKey(task));
    setWhyOpen(null);
  }

  function submitLog(task: ScheduledTask) {
    const value = Number(logValue);
    if (logValue.trim() === "" || Number.isNaN(value) || value < 0) return;
    const mins = Number(logMinutes);
    const minutes =
      logMinutes.trim() === "" || Number.isNaN(mins) || mins < 0 ? undefined : mins;
    setLogOpen(null);
    finishTask(task, true, value, minutes);
  }

  return (
    <DarkShell>
      <div className="pt-6">
        <p className="text-xs font-semibold uppercase tracking-[0.2em] text-ink-muted">
          Today ·{" "}
          {new Date(`${data.date}T00:00:00`).toLocaleDateString("en-US", {
            weekday: "long",
            month: "long",
            day: "numeric",
          })}
        </p>

        {flash && (
          <div className="ob-glass mt-4 rounded-2xl px-4 py-3 text-sm text-ink">{flash}</div>
        )}

        {allTasks.length === 0 && (
          <div className="mt-14 text-center">
            <p className="text-2xl font-bold text-ink">Nothing scheduled today.</p>
            <p className="mt-2 text-sm text-ink-muted">
              Rest day, or no missions yet. Staying ahead is always allowed.
            </p>
            <div className="mt-6 flex flex-col items-center justify-center gap-3 sm:flex-row sm:gap-4">
              <Link href="/missions/new" className="py-2 text-sm text-ink-2 hover:text-ink">
                + New mission
              </Link>
            </div>
          </div>
        )}

        {dayComplete && (
          <div className="ob-glass mt-10 rounded-3xl p-5 text-center sm:p-7">
            <p className="text-xs font-semibold uppercase tracking-[0.2em] text-good">✓ Day complete</p>
            <p className="mx-auto mt-3 max-w-md text-xl font-semibold text-ink sm:text-2xl">
              {praise ?? praiseFor(doneCount)}
            </p>
            <p className="mt-3 text-xs text-ink-muted tnum">
              {doneCount} {doneCount === 1 ? "task" : "tasks"} completed
            </p>
            <div className="mt-5">
              <p className="text-sm text-ink-2">
                Feeling good? Log more than the day asked for and the rest of your week shrinks.
              </p>
            </div>
          </div>
        )}

        <div className="mt-6 space-y-8">
          {data.missions
            .filter((m) => m.tasks.length > 0)
            .map((m) => (
              <section key={m.goal_id}>
                <div className="flex items-baseline justify-between gap-3 px-1">
                  <Link
                    href={`/missions/${m.goal_id}`}
                    className="-my-2 min-w-0 truncate py-2 text-xs font-semibold uppercase tracking-[0.15em] text-ink-muted hover:text-ink"
                  >
                    {m.title}
                  </Link>
                  {m.days_behind > 0 && (
                    <span className="shrink-0 text-xs font-semibold text-warn">
                      ◆ {m.days_behind}d behind
                    </span>
                  )}
                </div>
                <ul className="mt-2 space-y-2">
                  {m.tasks.map((t) => (
                    <li
                      key={dayKey(t)}
                      className={`ob-glass overflow-hidden rounded-2xl transition-colors ${
                        t.completed ? "opacity-60" : "hover:bg-veil/[0.12]"
                      }`}
                    >
                      {/* Wraps on a phone (the two actions drop to their own
                          full-width row), stays a single line from `sm` up. The
                          checkbox sits in a padded label so the tap target is
                          ~44px without the control itself being oversized. */}
                      <div className="flex flex-wrap items-center gap-x-2 px-2 py-1 sm:flex-nowrap sm:gap-x-3 sm:px-4 sm:py-3.5">
                        <label className="grid shrink-0 cursor-pointer place-items-center p-3 sm:-m-2">
                          <input
                            type="checkbox"
                            checked={t.completed}
                            disabled={busy === dayKey(t)}
                            onChange={(e) => finishTask(t, e.target.checked)}
                            className="ga-check"
                          />
                          <span className="sr-only">
                            Mark &quot;{t.description}&quot; {t.completed ? "not done" : "done"}
                          </span>
                        </label>
                        <span className="min-w-0 flex-1 py-2 text-[15px] sm:py-0">
                          <span className={t.completed ? "text-ink-muted line-through" : "text-ink"}>
                            {t.description}
                          </span>
                          {/* Time, not just amount. "Three pages" is a quantity;
                              "three pages, about 18 minutes" is something a
                              student can fit into an actual evening. */}
                          {t.minutes > 0 && !t.completed && (
                            <span className="ml-2 text-[11px] text-ink-muted tnum">
                              ~{Math.round(t.minutes)} min
                            </span>
                          )}
                          {/* A reported day that is not a finished day. Without
                              this the row is indistinguishable from one nobody
                              has touched, which is how a logged zero used to
                              read as "done". */}
                          {t.actual_quantity !== null && !t.completed && (
                            <span className="mt-0.5 block text-[11px] text-warn">
                              logged <span className="tnum">{t.actual_quantity}</span> of{" "}
                              <span className="tnum">{t.quantity}</span> — the rest is back in your
                              plan
                            </span>
                          )}
                        </span>
                        {!t.completed && (
                          <div className="flex w-full shrink-0 items-center gap-1 border-t border-veil/10 pl-1 sm:w-auto sm:gap-3 sm:border-0 sm:pl-0">
                            {t.why && (
                              <button
                                onClick={() => {
                                  setWhyOpen(whyOpen === dayKey(t) ? null : dayKey(t));
                                  setLogOpen(null);
                                }}
                                className={`px-2 py-3 text-xs sm:p-0 ${whyOpen === dayKey(t) ? "text-ink" : "text-ink-muted hover:text-ink"}`}
                              >
                                Why?
                              </button>
                            )}
                            <button
                              onClick={() => toggleLog(t)}
                              title="Did more or less than planned? Log the real amount"
                              className={`px-2 py-3 text-xs sm:p-0 ${logOpen === dayKey(t) ? "text-ink" : "text-ink-muted hover:text-ink"}`}
                            >
                              did more/less
                            </button>
                          </div>
                        )}
                      </div>
                      {whyOpen === dayKey(t) && t.why && (
                        <p className="border-t border-veil/10 bg-veil/[0.04] px-4 py-2.5 text-[13px] leading-relaxed text-ink-2">
                          {t.why}
                        </p>
                      )}
                      {logOpen === dayKey(t) && (
                        <div className="border-t border-veil/10 bg-veil/[0.04] px-4 py-3">
                          <p className="text-[13px] text-ink-2">
                            Planned: <span className="tnum">{t.quantity}</span>. How much did you actually do?
                          </p>
                          <div className="mt-2.5 flex flex-wrap items-center gap-2.5">
                            <input
                              autoFocus
                              type="number"
                              inputMode="decimal"
                              min="0"
                              aria-label="How much did you do?"
                              value={logValue}
                              onChange={(e) => setLogValue(e.target.value)}
                              onKeyDown={(e) => {
                                if (e.key === "Enter") submitLog(t);
                                if (e.key === "Escape") setLogOpen(null);
                              }}
                              className="ob-glass w-28 rounded-xl px-4 py-2 text-center text-sm text-ink tnum"
                            />
                            <label className="flex items-center gap-2 text-[13px] text-ink-2">
                              <input
                                type="number"
                                inputMode="numeric"
                                min="0"
                                placeholder="min"
                                aria-label="How long did it take, in minutes?"
                                value={logMinutes}
                                onChange={(e) => setLogMinutes(e.target.value)}
                                onKeyDown={(e) => {
                                  if (e.key === "Enter") submitLog(t);
                                  if (e.key === "Escape") setLogOpen(null);
                                }}
                                className="ob-glass w-20 rounded-xl px-3 py-2 text-center text-sm text-ink tnum"
                              />
                              min
                            </label>
                            <button
                              onClick={() => submitLog(t)}
                              disabled={busy === dayKey(t) || logValue.trim() === "" || Number(logValue) < 0 || Number.isNaN(Number(logValue))}
                              className="ob-btn rounded-xl px-5 py-2 text-xs font-semibold disabled:opacity-40"
                            >
                              Log it
                            </button>
                            <button
                              onClick={() => setLogOpen(null)}
                              className="text-xs text-ink-muted hover:text-ink"
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
          <div className="mt-8 flex items-center justify-between border-t border-veil/10 pt-4">
            <span className="text-xs text-ink-muted tnum">
              {doneCount}/{allTasks.length} done
            </span>
            <Link href="/calendar" className="-my-2 py-2 text-xs text-ink-muted hover:text-ink">
              View full calendar →
            </Link>
          </div>
        )}
      </div>
    </DarkShell>
  );
}
