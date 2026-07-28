"use client";

import { useRouter } from "next/navigation";
import { useCallback, useEffect, useState } from "react";
import { api, CalendarTask, getToken } from "@/lib/api";
import { DarkShell } from "@/components/darkchrome";

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

  const load = useCallback(async () => {
    const first = view === "week" ? weekStart : new Date(year, month, 1);
    const last = view === "week" ? addDays(weekStart, 6) : new Date(year, month + 1, 0);
    setTasks(await api.calendar(iso(first), iso(last)));
  }, [view, weekStart, year, month]);

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
          <h1 className="text-2xl font-bold tracking-tight text-white tnum">{title}</h1>
          <div className="flex gap-1.5">
            <button
              onClick={() => switchView(view === "week" ? "month" : "week")}
              className="ob-btn rounded-xl px-3.5 py-1.5 text-sm"
            >
              {view === "week" ? "month view" : "week view"}
            </button>
            <button
              onClick={() => shift(-1)}
              aria-label={view === "week" ? "Previous week" : "Previous month"}
              className="ob-btn rounded-xl px-3.5 py-1.5 text-sm"
            >
              ←
            </button>
            <button onClick={goToday} className="ob-btn rounded-xl px-3.5 py-1.5 text-sm">
              Today
            </button>
            <button
              onClick={() => shift(1)}
              aria-label={view === "week" ? "Next week" : "Next month"}
              className="ob-btn rounded-xl px-3.5 py-1.5 text-sm"
            >
              →
            </button>
          </div>
        </div>

        {!tasks ? (
          <p className="py-24 text-center text-white/50">loading…</p>
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
          <p className="text-xs font-semibold uppercase tracking-[0.2em] text-white/50">
            {new Date(`${selected}T00:00:00`).toLocaleDateString("en-US", {
              weekday: "long",
              month: "long",
              day: "numeric",
            })}
          </p>
          {selectedTasks.length === 0 ? (
            <p className="mt-2 text-sm text-white/50">Nothing scheduled — rest day.</p>
          ) : (
            <ul className="mt-3 space-y-2">
              {selectedTasks.map((t) => (
                <li key={t.id} className="ob-glass flex items-center gap-2.5 rounded-2xl px-4 py-3 text-sm">
                  <span
                    className={
                      t.completed ? "text-emerald-300" : t.date < todayIso ? "text-red-300" : "text-white/50"
                    }
                    aria-hidden
                  >
                    {t.completed ? "✓" : t.date < todayIso ? "✕" : "○"}
                  </span>
                  <span className={t.completed ? "text-white/45 line-through" : "text-white"}>
                    {t.description}
                  </span>
                  <span className="ml-auto shrink-0 text-[11px] text-white/45">{t.goal_title}</span>
                </li>
              ))}
            </ul>
          )}
        </section>
      </div>
    </DarkShell>
  );
}

/** The planning view: 7 full-height day columns, every task visible. */
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
    <div className="mt-5 grid grid-cols-7 gap-1.5">
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
            className={`flex min-h-64 flex-col rounded-xl border p-2 text-left transition-colors ${
              isSelected
                ? "border-white/40 bg-white/[0.14]"
                : "border-white/10 bg-white/[0.05] hover:bg-white/[0.1]"
            }`}
          >
            <div className="flex items-center justify-between">
              <span className="text-[11px] font-semibold uppercase tracking-wider text-white/45">
                {d.toLocaleDateString("en-US", { weekday: "short" })}
              </span>
              <span
                className={`inline-flex h-6 w-6 items-center justify-center rounded-full text-xs tnum ${
                  isToday ? "bg-white font-semibold text-black" : "text-white/70"
                }`}
              >
                {d.getDate()}
              </span>
            </div>
            <div className="mt-2 space-y-1">
              {dayTasks.map((t) => (
                <p
                  key={t.id}
                  className={`rounded px-1.5 py-1 text-[11px] leading-snug ${
                    t.completed
                      ? "bg-white/[0.04] text-white/40 line-through"
                      : missed && !t.completed
                        ? "bg-red-400/15 text-red-300"
                        : "bg-white/10 text-white/85"
                  }`}
                >
                  {t.description}
                </p>
              ))}
              {dayTasks.length === 0 && <p className="px-1.5 text-[11px] text-white/30">rest</p>}
            </div>
            {dayTasks.length > 0 && (
              <p className="mt-auto pt-2 text-[10px] text-white/40 tnum">
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
    <div className="mt-5 grid grid-cols-7 gap-1.5">
      {["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"].map((d) => (
        <div
          key={d}
          className="px-2 py-1.5 text-center text-[11px] font-semibold uppercase tracking-wider text-white/45"
        >
          {d}
        </div>
      ))}
      {cells.map((date, i) => {
        if (date === null) return <div key={`b${i}`} className="min-h-20" />;
        const dayTasks = byDate.get(date) ?? [];
        const done = dayTasks.filter((t) => t.completed).length;
        const missed = date < todayIso && done < dayTasks.length;
        const isToday = date === todayIso;
        const isSelected = date === selected;
        return (
          <button
            key={date}
            onClick={() => onSelect(date)}
            className={`min-h-20 rounded-xl border p-1.5 text-left align-top transition-colors ${
              isSelected
                ? "border-white/40 bg-white/[0.14]"
                : "border-white/10 bg-white/[0.05] hover:bg-white/[0.1]"
            }`}
          >
            <span
              className={`inline-flex h-6 w-6 items-center justify-center rounded-full text-xs tnum ${
                isToday ? "bg-white font-semibold text-black" : "text-white/70"
              }`}
            >
              {Number(date.slice(8))}
            </span>
            <div className="mt-1 space-y-0.5">
              {dayTasks.slice(0, 2).map((t) => (
                <p
                  key={t.id}
                  className={`truncate rounded px-1 py-0.5 text-[10px] leading-tight ${
                    t.completed
                      ? "bg-white/[0.04] text-white/40 line-through"
                      : missed
                        ? "bg-red-400/15 text-red-300"
                        : "bg-white/10 text-white/85"
                  }`}
                >
                  {t.description}
                </p>
              ))}
              {dayTasks.length > 2 && (
                <p className="px-1 text-[10px] text-white/45">+{dayTasks.length - 2} more</p>
              )}
            </div>
          </button>
        );
      })}
    </div>
  );
}
