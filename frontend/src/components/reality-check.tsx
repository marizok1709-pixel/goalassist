"use client";

/**
 * The moment the brand is earned.
 *
 * Before this screen existed the product could only tell a student their plan
 * was impossible *after* they had committed to it — the reality report needed a
 * saved mission. That is the wrong order. The arithmetic is knowable before
 * anything is written, and a warning that arrives after the decision is not a
 * warning, it is a complaint.
 *
 * Four rules it follows, in this order of importance:
 *
 *   1. State the truth. A date, not a mood. "Sept 6, six days late."
 *   2. Default to the honest option — moving the deadline is pre-selected.
 *   3. Never block. "Start anyway" is always there, and it is not buried.
 *   4. Show the assumptions. The daily cap decides the verdict, so the student
 *      gets to see it and argue with it.
 *
 * The verdict is never computed here. One implementation of the arithmetic
 * lives on the server; two answers to "does this fit" is the exact class of
 * contradiction this product exists not to have.
 */

import { useState } from "react";
import type { Feasibility } from "@/lib/api";

export type RealityChoice =
  | { kind: "deadline"; deadline: string }
  | { kind: "scope"; units: number }
  | { kind: "hours"; weeklyHours: number }
  | { kind: "anyway" };

const VERDICT_COPY: Record<string, { label: string; tone: string }> = {
  COMFORTABLE: { label: "This fits comfortably", tone: "text-good" },
  FEASIBLE: { label: "This fits", tone: "text-good" },
  TIGHT: { label: "This is tight", tone: "text-warn" },
  OVER_CAPACITY: { label: "This doesn't fit", tone: "text-warn" },
  NO_ESTIMATE: { label: "No time estimate yet", tone: "text-ink-2" },
  COMPLETED: { label: "Nothing left to do", tone: "text-good" },
};

function fmtDate(iso: string | null): string {
  if (!iso) return "—";
  return new Date(`${iso}T00:00:00`).toLocaleDateString("en-US", {
    month: "short",
    day: "numeric",
    year: "numeric",
  });
}

// Whole numbers on a headline. The estimate behind the figure is not precise
// to two decimals and should not pretend to be.
function fmtRate(n: number): string {
  return n >= 10 ? String(Math.round(n)) : String(Math.round(n * 10) / 10);
}

function fmtHours(minutes: number): string {
  const h = minutes / 60;
  return h >= 10 ? `${Math.round(h)}h` : `${(Math.round(h * 10) / 10).toString()}h`;
}

export function RealityCheck({
  result,
  busy,
  onContinue,
  onBack,
}: {
  result: Feasibility;
  busy?: boolean;
  onContinue: (choice: RealityChoice) => void;
  onBack?: () => void;
}) {
  const fits = result.days_late === 0 && result.verdict !== "OVER_CAPACITY";
  const copy = VERDICT_COPY[result.verdict] ?? VERDICT_COPY.NO_ESTIMATE;

  // Options exist only when there is a real problem to solve. Offering "cut
  // your scope" to someone whose plan already works is noise.
  const options: { id: string; label: string; choice: RealityChoice }[] = [];
  if (!fits) {
    if (result.suggested_deadline) {
      options.push({
        id: "deadline",
        label: `Move the deadline to ${fmtDate(result.suggested_deadline)}`,
        choice: { kind: "deadline", deadline: result.suggested_deadline },
      });
    }
    if (result.suggested_scope) {
      options.push({
        id: "scope",
        label: `Cut the scope to ${result.suggested_scope.units} ${result.suggested_scope.unit}`,
        choice: { kind: "scope", units: result.suggested_scope.units },
      });
    }
    if (result.suggested_weekly_hours) {
      options.push({
        id: "hours",
        label: `Study ${result.suggested_weekly_hours}h a week instead`,
        choice: { kind: "hours", weeklyHours: result.suggested_weekly_hours },
      });
    }
  }
  options.push({ id: "anyway", label: "Start anyway", choice: { kind: "anyway" } });

  // The honest option is the default. It is first in the list and selected on
  // arrival, so the path of least resistance is the truthful one.
  const [selected, setSelected] = useState(options[0]?.id ?? "anyway");
  const chosen = options.find((o) => o.id === selected) ?? options[options.length - 1];

  return (
    <div className="mx-auto w-full max-w-md">
      <p className={`text-xs font-semibold uppercase tracking-[0.2em] ${copy.tone}`}>
        {copy.label}
      </p>

      {/* The number. A date beats a percentage because a date can be checked
          against a calendar. */}
      <div className="mt-5">
        {result.uses_minutes && result.projected_finish ? (
          <>
            <p className="text-sm text-ink-2">
              Deadline <span className="tnum text-ink">{fmtDate(result.deadline)}</span>
            </p>
            <p className="mt-1 text-3xl font-bold tracking-tight text-ink sm:text-4xl">
              Finishes {fmtDate(result.projected_finish)}
            </p>
            {result.days_late > 0 && (
              <p className="mt-1 text-sm font-semibold text-warn tnum">
                {result.days_late} days late
              </p>
            )}
          </>
        ) : (
          <>
            <p className="text-3xl font-bold tracking-tight text-ink sm:text-4xl">
              {result.required_units_per_hour
                ? `${fmtRate(result.required_units_per_hour)} per hour`
                : "Not enough to go on yet"}
            </p>
            <p className="mt-2 text-sm text-ink-2">
              We have no estimate of how long one takes you, so we can&apos;t name a
              finish date. That is the rate the deadline would need.
            </p>
          </>
        )}
      </div>

      {/* Show the working. The claim is math you can check, so the inputs are
          on screen rather than in a config file. */}
      <dl className="ob-glass mt-5 grid grid-cols-2 gap-3 rounded-2xl px-4 py-3 text-sm">
        <div>
          <dt className="text-xs text-ink-muted">Work remaining</dt>
          <dd className="tnum text-ink">{fmtHours(result.required_minutes)}</dd>
        </div>
        <div>
          <dt className="text-xs text-ink-muted">Time available</dt>
          <dd className="tnum text-ink">{fmtHours(result.available_minutes)}</dd>
        </div>
        <div className="col-span-2">
          <dt className="text-xs text-ink-muted">Planned at most</dt>
          <dd className="text-ink">
            <span className="tnum">{fmtHours(result.daily_cap_minutes)}</span> a day of new
            material
            <span className="ml-1 text-ink-muted">
              — nobody does eight productive hours
            </span>
          </dd>
        </div>
        {result.competing_missions.length > 0 && (
          <div className="col-span-2">
            <dt className="text-xs text-ink-muted">Sharing your time with</dt>
            <dd className="text-ink">{result.competing_missions.join(", ")}</dd>
          </div>
        )}
      </dl>

      {options.length > 1 && (
        <fieldset className="mt-5">
          <legend className="sr-only">What would you like to do?</legend>
          <div className="space-y-2">
            {options.map((o) => (
              <label
                key={o.id}
                className={`flex cursor-pointer items-center gap-3 rounded-2xl px-4 py-3 text-sm transition-colors ${
                  selected === o.id ? "ob-glass text-ink" : "text-ink-2 hover:text-ink"
                }`}
              >
                <input
                  type="radio"
                  name="reality"
                  value={o.id}
                  checked={selected === o.id}
                  onChange={() => setSelected(o.id)}
                  className="ga-check"
                />
                <span>{o.label}</span>
              </label>
            ))}
          </div>
        </fieldset>
      )}

      <div className="mt-6 flex flex-col gap-3 sm:flex-row-reverse sm:items-center">
        <button
          onClick={() => onContinue(chosen.choice)}
          disabled={busy}
          className="ob-btn w-full rounded-2xl px-6 py-3.5 text-base font-semibold disabled:opacity-50 sm:w-auto"
        >
          {busy ? "…" : "Create mission"}
        </button>
        {onBack && (
          <button
            onClick={onBack}
            disabled={busy}
            className="py-2 text-sm text-ink-2 hover:text-ink disabled:opacity-50"
          >
            ← change something
          </button>
        )}
      </div>
    </div>
  );
}
