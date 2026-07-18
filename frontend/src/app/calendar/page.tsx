"use client";

import { useRouter } from "next/navigation";
import { useCallback, useEffect, useState } from "react";
import { api, CalendarTask, getToken } from "@/lib/api";
import { Spinner } from "@/components/ui";

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
      router.push("/login");
      return;
    }
    load().catch(() => {});
  }, [router, load]);

  if (!tasks) return <Spinner />;

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
    <div className="mx-auto max-w-3xl">
      <div className="flex items-center justify-between">
        <h1 className="font-serif text-2xl font-semibold text-ink">
          {first.toLocaleDateString("en-US", { month: "long", year: "numeric" })}
        </h1>
        <div className="flex gap-1">
          <button
            onClick={() => shift(-1)}
            aria-label="Previous month"
            className="rounded-lg border border-line px-3 py-1.5 text-sm text-ink-2 hover:bg-surface-2"
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
            className="rounded-lg border border-line px-3 py-1.5 text-sm text-ink-2 hover:bg-surface-2"
          >
            Today
          </button>
          <button
            onClick={() => shift(1)}
            aria-label="Next month"
            className="rounded-lg border border-line px-3 py-1.5 text-sm text-ink-2 hover:bg-surface-2"
          >
            →
          </button>
        </div>
      </div>

      <div className="mt-4 grid grid-cols-7 gap-px overflow-hidden rounded-xl border border-line bg-line">
        {["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"].map((d) => (
          <div
            key={d}
            className="bg-surface-2 px-2 py-1.5 text-center text-[11px] font-medium uppercase tracking-wider text-ink-muted"
          >
            {d}
          </div>
        ))}
        {cells.map((date, i) => {
          if (date === null) return <div key={`b${i}`} className="min-h-20 bg-surface" />;
          const dayTasks = byDate.get(date) ?? [];
          const done = dayTasks.filter((t) => t.completed).length;
          const missed = date < todayIso && done < dayTasks.length;
          const isToday = date === todayIso;
          const isSelected = date === selected;
          return (
            <button
              key={date}
              onClick={() => setSelected(date)}
              className={`min-h-20 bg-surface p-1.5 text-left align-top transition-colors hover:bg-accent-wash ${
                isSelected ? "bg-accent-wash" : ""
              }`}
            >
              <span
                className={`inline-flex h-6 w-6 items-center justify-center rounded-full text-xs tnum ${
                  isToday ? "bg-accent font-semibold text-white" : "text-ink-2"
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
                        ? "bg-surface-2 text-ink-muted line-through"
                        : missed
                          ? "bg-critical/10 text-critical"
                          : "bg-accent-wash text-accent-deep"
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

      <section className="mt-6">
        <p className="text-xs font-medium uppercase tracking-[0.15em] text-ink-muted">
          {new Date(`${selected}T00:00:00`).toLocaleDateString("en-US", {
            weekday: "long",
            month: "long",
            day: "numeric",
          })}
        </p>
        {selectedTasks.length === 0 ? (
          <p className="mt-2 text-sm text-ink-muted">Nothing scheduled — rest day.</p>
        ) : (
          <ul className="mt-2 space-y-1.5">
            {selectedTasks.map((t) => (
              <li
                key={t.id}
                className="flex items-center gap-2.5 rounded-lg border border-line bg-surface px-3 py-2.5 text-sm"
              >
                <span
                  className={
                    t.completed
                      ? "text-good"
                      : t.date < todayIso
                        ? "text-critical"
                        : "text-ink-muted"
                  }
                  aria-hidden
                >
                  {t.completed ? "✓" : t.date < todayIso ? "✕" : "○"}
                </span>
                <span className={t.completed ? "text-ink-muted line-through" : "text-ink"}>
                  {t.description}
                </span>
                <span className="ml-auto shrink-0 text-[11px] text-ink-muted">{t.goal_title}</span>
              </li>
            ))}
          </ul>
        )}
      </section>
    </div>
  );
}
