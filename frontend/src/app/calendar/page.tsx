"use client";

import { useRouter } from "next/navigation";
import { useCallback, useEffect, useState } from "react";
import { api, CalendarTask, getToken } from "@/lib/api";
import { DarkShell } from "@/components/darkchrome";
import { PageLoading } from "@/components/ui";

function iso(d: Date): string {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(
    d.getDate()
  ).padStart(2, "0")}`;
}

/** Monday of the week containing d (the grid is Monday-first). */
function mondayOf(d: Date): Date {
  const m = new Date(d);
  m.setDate(m.getDate() - ((m.getDay() + 6) % 7));
  return m;
}

function addDays(d: Date, n: number): Date {
  const r = new Date(d);
  r.setDate(r.getDate() + n);
  return r;
}

type View = "week" | "month";

/** A day of work's identity: mission + date + material. See `today/page.tsx` —
 * the row id this replaces only existed because the plan used to be stored. */
function dayKey(t: { goal_id: number; date: string; material_id: number | null }) {
  return `${t.goal_id}:${t.date}:${t.material_id ?? "x"}`;
}

export default function CalendarPage() {
  const router = useRouter();
  const now = new Date();
  // Week view is the default: the page is for planning the week you're in.
  const [view, setView] = useState<View>("week");
  const [weekStart, setWeekStart] = useState<Date>(() => mondayOf(now));
  const [year, setYear] = useState(now.getFullYear());
  const [month, setMonth] = useState(now.getMonth()); // 0-based
  const [tasks, setTasks] = useState<CalendarTask[] | null>(null);
  const [selected, setSelected] = useState<string>(iso(now));

  const [busy, setBusy] = useState<string | null>(null);
  const [logOpen, setLogOpen] = useState<string | null>(null);
  const [logValue, setLogValue] = useState("");
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    const first = view === "week" ? weekStart : new Date(year, month, 1);
    const last = view === "week" ? addDays(weekStart, 6) : new Date(year, month + 1, 0);
    setTasks(await api.calendar(iso(first), iso(last)));
  }, [view, weekStart, year, month]);

  /** Logging anything can move every other task in view — correcting an earlier
   *  day re-plans from today — so the whole range is refetched, never patched
   *  in place. */
  async function commit(task: CalendarTask, body: { completed: boolean; actual_quantity?: number }) {
    setBusy(dayKey(task));
    setError(null);
    try {
      await api.updateDay(task.goal_id, task.date, body);
      setLogOpen(null);
      await load();
    } catch {
      setError("Could not save that. Check your connection and try again.");
    } finally {
      setBusy(null);
    }
  }

  function setDone(task: CalendarTask, completed: boolean) {
    void commit(task, { completed });
  }

  function toggleLog(task: CalendarTask) {
    if (logOpen === dayKey(task)) {
      setLogOpen(null);
      return;
    }
    setLogValue(String(task.actual_quantity ?? task.quantity));
    setLogOpen(dayKey(task));
  }

  const logValid =
    logValue.trim() !== "" && !Number.isNaN(Number(logValue)) && Number(logValue) >= 0;

  function submitLog(task: CalendarTask) {
    if (!logValid) return;
    void commit(task, { completed: true, actual_quantity: Number(logValue) });
  }

  useEffect(() => {
    if (!getToken()) {
      router.push("/onboarding");
      return;
    }
    load().catch(() => {});
  }, [router, load]);

  const todayIso = iso(new Date());

  const byDate = new Map<string, CalendarTask[]>();
  for (const t of tasks ?? []) {
    byDate.set(t.date, [...(byDate.get(t.date) ?? []), t]);
  }

  function shift(delta: number) {
    if (view === "week") {
      setWeekStart(addDays(weekStart, delta * 7));
    } else {
      const d = new Date(year, month + delta, 1);
      setYear(d.getFullYear());
      setMonth(d.getMonth());
    }
  }

  function goToday() {
    const d = new Date();
    setWeekStart(mondayOf(d));
    setYear(d.getFullYear());
    setMonth(d.getMonth());
    setSelected(iso(d));
  }

  function switchView(v: View) {
    if (v === view) return;
    // Land on the period containing the selected day so the context carries over.
    const anchor = new Date(`${selected}T00:00:00`);
    setWeekStart(mondayOf(anchor));
    setYear(anchor.getFullYear());
    setMonth(anchor.getMonth());
    setTasks(null);
    setView(v);
  }

  const weekEnd = addDays(weekStart, 6);
  const title =
    view === "week"
      ? `${weekStart.toLocaleDateString("en-US", { month: "short", day: "numeric" })} – ${weekEnd.toLocaleDateString(
          "en-US",
          weekStart.getMonth() === weekEnd.getMonth()
            ? { day: "numeric" }
            : { month: "short", day: "numeric" }
        )}, ${weekEnd.getFullYear()}`
      : new Date(year, month, 1).toLocaleDateString("en-US", { month: "long", year: "numeric" });

  const selectedTasks = byDate.get(selected) ?? [];

  return (
    <DarkShell width="max-w-4xl">
      <div className="pt-6">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <h1 className="text-xl font-bold tracking-tight text-ink tnum sm:text-2xl">{title}</h1>
          {/* Controls sit on their own line on a phone and stay >=44px tall. */}
          <div className="flex w-full gap-1.5 sm:w-auto">
            <button
              onClick={() => switchView(view === "week" ? "month" : "week")}
              className="ob-btn-quiet flex-1 rounded-xl px-3.5 py-2.5 text-sm sm:flex-none sm:py-1.5"
            >
              {view === "week" ? "month view" : "week view"}
            </button>
            <button
              onClick={() => shift(-1)}
              aria-label={view === "week" ? "Previous week" : "Previous month"}
              className="ob-btn-quiet rounded-xl px-4 py-2.5 text-sm sm:px-3.5 sm:py-1.5"
            >
              ←
            </button>
            <button
              onClick={goToday}
              className="ob-btn-quiet rounded-xl px-3.5 py-2.5 text-sm sm:py-1.5"
            >
              Today
            </button>
            <button
              onClick={() => shift(1)}
              aria-label={view === "week" ? "Next week" : "Next month"}
              className="ob-btn-quiet rounded-xl px-4 py-2.5 text-sm sm:px-3.5 sm:py-1.5"
            >
              →
            </button>
          </div>
        </div>

        {!tasks ? (
          <PageLoading />
        ) : view === "week" ? (
          <WeekGrid
            weekStart={weekStart}
            byDate={byDate}
            todayIso={todayIso}
            selected={selected}
            onSelect={setSelected}
          />
        ) : (
          <MonthGrid
            year={year}
            month={month}
            byDate={byDate}
            todayIso={todayIso}
            selected={selected}
            onSelect={setSelected}
          />
        )}

        <section className="mt-8">
          <p className="text-xs font-semibold uppercase tracking-[0.2em] text-ink-muted">
            {new Date(`${selected}T00:00:00`).toLocaleDateString("en-US", {
              weekday: "long",
              month: "long",
              day: "numeric",
            })}
          </p>
          {selectedTasks.length === 0 ? (
            <p className="mt-2 text-sm text-ink-muted">Nothing scheduled — rest day.</p>
          ) : (
            <ul className="mt-3 space-y-2">
              {selectedTasks.map((t) => {
                const reported = t.actual_quantity !== null;
                return (
                  <li key={dayKey(t)} className="ob-glass overflow-hidden rounded-2xl text-sm">
                    <div className="flex items-start gap-2.5 px-2 py-1 sm:px-4 sm:py-2">
                      {/* Any day is editable, past included — the day you need to
                          correct is almost always one that has already gone. */}
                      <label className="grid shrink-0 cursor-pointer place-items-center p-3 sm:-ml-1">
                        <input
                          type="checkbox"
                          checked={t.completed}
                          disabled={busy === dayKey(t)}
                          onChange={(e) => setDone(t, e.target.checked)}
                          className="ga-check"
                        />
                        <span className="sr-only">
                          Mark &quot;{t.description}&quot; {t.completed ? "not done" : "done"}
                        </span>
                      </label>
                      <span className="min-w-0 flex-1 py-2.5">
                        <span className={t.completed ? "text-ink-muted line-through" : "text-ink"}>
                          {t.description}
                        </span>
                        {/* The mission name wraps under the task on a phone rather
                            than fighting it for the same line. */}
                        <span className="mt-0.5 block text-[11px] text-ink-muted sm:mt-0 sm:inline sm:pl-2">
                          {t.goal_title}
                        </span>
                        {reported && !t.completed && (
                          <span className="mt-1 block text-[11px] text-warn">
                            logged <span className="tnum">{t.actual_quantity}</span> of{" "}
                            <span className="tnum">{t.quantity}</span> — the rest went back into
                            your plan
                          </span>
                        )}
                        {/* No "missed" note here: a past day nobody reported on
                            already reads "…3 pages — not done" in its own
                            description, and saying it twice looks like a bug. */}
                      </span>
                      <button
                        onClick={() => toggleLog(t)}
                        title="Log the amount you actually did"
                        className={`shrink-0 px-2 py-3.5 text-xs ${
                          logOpen === dayKey(t) ? "text-ink" : "text-ink-muted hover:text-ink"
                        }`}
                      >
                        {reported ? "edit" : "log"}
                      </button>
                    </div>
                    {logOpen === dayKey(t) && (
                      <div className="border-t border-veil/10 bg-veil/[0.04] px-4 py-3">
                        <p className="text-[13px] text-ink-2">
                          Planned: <span className="tnum">{t.quantity}</span>. How much did you
                          actually do? Zero is a real answer — the work goes back into the plan.
                        </p>
                        <div className="mt-2.5 flex flex-wrap items-center gap-2.5">
                          <input
                            autoFocus
                            type="number"
                            inputMode="decimal"
                            min="0"
                            value={logValue}
                            onChange={(e) => setLogValue(e.target.value)}
                            onKeyDown={(e) => {
                              if (e.key === "Enter") submitLog(t);
                              if (e.key === "Escape") setLogOpen(null);
                            }}
                            className="ob-glass w-28 rounded-xl px-4 py-2 text-center text-sm text-ink tnum"
                          />
                          <button
                            onClick={() => submitLog(t)}
                            disabled={busy === dayKey(t) || !logValid}
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
                );
              })}
            </ul>
          )}
          {error && <p className="mt-3 text-sm text-bad">{error}</p>}
        </section>
      </div>
    </DarkShell>
  );
}

/**
 * Load dots — the mobile stand-in for a day's task list.
 *
 * Seven columns of readable task titles cannot exist on a 360px screen (each
 * column lands at ~46px and every title breaks one word per line, which is the
 * defect the first beta user reported). The grid keeps its shape and drops to
 * one dot per task, colour-coded by state; the day-detail panel below the grid
 * is where the titles actually live, and always has been.
 */
function LoadDots({
  tasks,
  missed,
  max = 4,
}: {
  tasks: CalendarTask[];
  missed: boolean;
  max?: number;
}) {
  if (tasks.length === 0) {
    return <span className="text-[10px] text-ink-muted">rest</span>;
  }
  return (
    <span className="flex flex-wrap items-center justify-center gap-[3px]">
      {tasks.slice(0, max).map((t) => (
        <span
          key={dayKey(t)}
          className={`h-1.5 w-1.5 rounded-full ${
            t.completed ? "bg-good" : missed ? "bg-bad" : "bg-accent"
          }`}
        />
      ))}
      {tasks.length > max && (
        <span className="text-[9px] leading-none text-ink-muted tnum">+{tasks.length - max}</span>
      )}
    </span>
  );
}

/**
 * The planning view.
 *
 * Desktop: 7 full-height columns with every task title visible.
 * Mobile: the same 7 columns, compacted to date + load dots — tall enough to
 * tap and short enough that the day-detail panel stays on screen.
 */
function WeekGrid({
  weekStart,
  byDate,
  todayIso,
  selected,
  onSelect,
}: {
  weekStart: Date;
  byDate: Map<string, CalendarTask[]>;
  todayIso: string;
  selected: string;
  onSelect: (d: string) => void;
}) {
  const days = Array.from({ length: 7 }, (_, i) => addDays(weekStart, i));
  return (
    <div className="mt-5 grid grid-cols-7 gap-1 sm:gap-1.5">
      {days.map((d) => {
        const date = iso(d);
        const dayTasks = byDate.get(date) ?? [];
        const done = dayTasks.filter((t) => t.completed).length;
        const missed = date < todayIso && done < dayTasks.length;
        const isToday = date === todayIso;
        const isSelected = date === selected;
        return (
          <button
            key={date}
            onClick={() => onSelect(date)}
            aria-pressed={isSelected}
            className={`flex min-h-16 flex-col items-center rounded-xl border p-1.5 transition-colors sm:min-h-64 sm:items-stretch sm:p-2 sm:text-left ${
              isSelected
                ? "border-veil/40 bg-veil/[0.14]"
                : "border-veil/10 bg-veil/[0.05] hover:bg-veil/[0.1]"
            }`}
          >
            <div className="flex flex-col items-center gap-0.5 sm:flex-row sm:items-center sm:justify-between sm:gap-0">
              <span className="text-[10px] font-semibold uppercase tracking-wide text-ink-muted sm:text-[11px] sm:tracking-wider">
                {d.toLocaleDateString("en-US", { weekday: "short" })}
              </span>
              <span
                className={`inline-flex h-6 w-6 items-center justify-center rounded-full text-xs tnum ${
                  isToday ? "bg-accent font-semibold text-accent-contrast" : "text-ink-2"
                }`}
              >
                {d.getDate()}
              </span>
            </div>
            {/* phone: dots */}
            <span className="mt-1.5 sm:hidden">
              <LoadDots tasks={dayTasks} missed={missed} />
            </span>

            {/* desktop: the real list */}
            <div className="mt-2 hidden space-y-1 sm:block">
              {dayTasks.map((t) => (
                <p
                  key={dayKey(t)}
                  className={`rounded px-1.5 py-1 text-[11px] leading-snug ${
                    t.completed
                      ? "bg-veil/[0.04] text-ink-muted line-through"
                      : missed && !t.completed
                        ? "bg-bad/15 text-bad"
                        : "bg-veil/10 text-ink"
                  }`}
                >
                  {t.description}
                </p>
              ))}
              {dayTasks.length === 0 && <p className="px-1.5 text-[11px] text-ink-muted">rest</p>}
            </div>
            {dayTasks.length > 0 && (
              <p className="mt-auto hidden pt-2 text-[10px] text-ink-muted tnum sm:block">
                {done}/{dayTasks.length} done
              </p>
            )}
          </button>
        );
      })}
    </div>
  );
}

function MonthGrid({
  year,
  month,
  byDate,
  todayIso,
  selected,
  onSelect,
}: {
  year: number;
  month: number;
  byDate: Map<string, CalendarTask[]>;
  todayIso: string;
  selected: string;
  onSelect: (d: string) => void;
}) {
  const first = new Date(year, month, 1);
  const daysInMonth = new Date(year, month + 1, 0).getDate();
  const leadingBlanks = (first.getDay() + 6) % 7; // Monday-first grid
  const cells: (string | null)[] = [
    ...Array(leadingBlanks).fill(null),
    ...Array.from({ length: daysInMonth }, (_, i) => iso(new Date(year, month, i + 1))),
  ];
  return (
    <div className="mt-5 grid grid-cols-7 gap-1 sm:gap-1.5">
      {["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"].map((d) => (
        <div
          key={d}
          className="py-1.5 text-center text-[10px] font-semibold uppercase tracking-wide text-ink-muted sm:px-2 sm:text-[11px] sm:tracking-wider"
        >
          {/* One letter is all that fits under 7 columns on a phone. */}
          <span className="sm:hidden">{d.charAt(0)}</span>
          <span className="hidden sm:inline">{d}</span>
        </div>
      ))}
      {cells.map((date, i) => {
        if (date === null) return <div key={`b${i}`} className="min-h-14 sm:min-h-20" />;
        const dayTasks = byDate.get(date) ?? [];
        const done = dayTasks.filter((t) => t.completed).length;
        const missed = date < todayIso && done < dayTasks.length;
        const isToday = date === todayIso;
        const isSelected = date === selected;
        return (
          <button
            key={date}
            onClick={() => onSelect(date)}
            aria-pressed={isSelected}
            className={`flex min-h-14 flex-col items-center rounded-xl border p-1 align-top transition-colors sm:min-h-20 sm:items-stretch sm:p-1.5 sm:text-left ${
              isSelected
                ? "border-veil/40 bg-veil/[0.14]"
                : "border-veil/10 bg-veil/[0.05] hover:bg-veil/[0.1]"
            }`}
          >
            <span
              className={`inline-flex h-6 w-6 shrink-0 items-center justify-center rounded-full text-xs tnum ${
                isToday ? "bg-accent font-semibold text-accent-contrast" : "text-ink-2"
              }`}
            >
              {Number(date.slice(8))}
            </span>

            {/* phone: dots (no room for titles at ~44px per column) */}
            <span className="mt-1 sm:hidden">
              {dayTasks.length > 0 && <LoadDots tasks={dayTasks} missed={missed} max={3} />}
            </span>

            <div className="mt-1 hidden space-y-0.5 sm:block">
              {dayTasks.slice(0, 2).map((t) => (
                <p
                  key={dayKey(t)}
                  className={`truncate rounded px-1 py-0.5 text-[10px] leading-tight ${
                    t.completed
                      ? "bg-veil/[0.04] text-ink-muted line-through"
                      : missed
                        ? "bg-bad/15 text-bad"
                        : "bg-veil/10 text-ink"
                  }`}
                >
                  {t.description}
                </p>
              ))}
              {dayTasks.length > 2 && (
                <p className="px-1 text-[10px] text-ink-muted">+{dayTasks.length - 2} more</p>
              )}
            </div>
          </button>
        );
      })}
    </div>
  );
}
