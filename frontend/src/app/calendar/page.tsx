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

export default function CalendarPage() {
  const router = useRouter();
  const now = new Date();
  const [year, setYear] = useState(now.getFullYear());
  const [month, setMonth] = useState(now.getMonth()); // 0-based
  const [tasks, setTasks] = useState<CalendarTask[] | null>(null);
  const [selected, setSelected] = useState<string>(iso(now));

  const load = useCallback(async () => {
    const first = new Date(year, month, 1);
    const last = new Date(year, month + 1, 0);
    setTasks(await api.calendar(iso(first), iso(last)));
  }, [year, month]);

  useEffect(() => {
    if (!getToken()) {
      router.push("/onboarding");
      return;
    }
    load().catch(() => {});
  }, [router, load]);

  if (!tasks) {
    return (
      <DarkShell width="max-w-3xl">
        <p className="py-24 text-center text-white/50">loading…</p>
      </DarkShell>
    );
  }

  const byDate = new Map<string, CalendarTask[]>();
  for (const t of tasks) {
    byDate.set(t.date, [...(byDate.get(t.date) ?? []), t]);
  }

  const first = new Date(year, month, 1);
  const daysInMonth = new Date(year, month + 1, 0).getDate();
  const leadingBlanks = (first.getDay() + 6) % 7; // Monday-first grid
  const todayIso = iso(new Date());
  const cells: (string | null)[] = [
    ...Array(leadingBlanks).fill(null),
    ...Array.from({ length: daysInMonth }, (_, i) => iso(new Date(year, month, i + 1))),
  ];

  function shift(delta: number) {
    const d = new Date(year, month + delta, 1);
    setYear(d.getFullYear());
    setMonth(d.getMonth());
  }

  const selectedTasks = byDate.get(selected) ?? [];

  return (
    <DarkShell width="max-w-3xl">
      <div className="pt-6">
        <div className="flex items-center justify-between">
          <h1 className="text-2xl font-bold tracking-tight text-white">
            {first.toLocaleDateString("en-US", { month: "long", year: "numeric" })}
          </h1>
          <div className="flex gap-1.5">
            <button
              onClick={() => shift(-1)}
              aria-label="Previous month"
              className="ob-btn rounded-xl px-3.5 py-1.5 text-sm"
            >
              ←
            </button>
            <button
              onClick={() => {
                const d = new Date();
                setYear(d.getFullYear());
                setMonth(d.getMonth());
                setSelected(iso(d));
              }}
              className="ob-btn rounded-xl px-3.5 py-1.5 text-sm"
            >
              Today
            </button>
            <button
              onClick={() => shift(1)}
              aria-label="Next month"
              className="ob-btn rounded-xl px-3.5 py-1.5 text-sm"
            >
              →
            </button>
          </div>
        </div>

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
                onClick={() => setSelected(date)}
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
                      t.completed
                        ? "text-emerald-300"
                        : t.date < todayIso
                          ? "text-red-300"
                          : "text-white/50"
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
