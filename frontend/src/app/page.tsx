"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useState } from "react";
import { motion } from "motion/react";
import { api, browserTimezone, Dashboard, DashboardGoal, getToken } from "@/lib/api";
import { DarkFinishBar, DarkShell, DarkVerdictBadge } from "@/components/darkchrome";
import { PageLoading } from "@/components/ui";

function greeting(): string {
  const h = new Date().getHours();
  if (h < 5) return "STILL UP";
  if (h < 12) return "GOOD MORNING";
  if (h < 18) return "GOOD AFTERNOON";
  return "GOOD EVENING";
}

// Worst first. Ordered by the planner's verdict rather than the old trajectory
// status, so the mission that actually needs a decision sits at the top.
const SEVERITY: Record<string, number> = {
  OVER_CAPACITY: 0,
  TIGHT: 1,
  NO_ESTIMATE: 2,
  FEASIBLE: 3,
  COMFORTABLE: 4,
  COMPLETED: 5,
};

export default function DashboardPage() {
  const router = useRouter();
  const [data, setData] = useState<Dashboard | null>(null);

  useEffect(() => {
    if (!getToken()) {
      router.push("/onboarding");
      return;
    }
    api
      .dashboard()
      .then((d) => {
        setData(d);
        // Accounts created before the zone was captured have none, and every
        // date the app reasons about is theirs, not the server's. Backfill it
        // silently on first sight; failure is harmless, the server clock stands.
        if (!d.user.timezone) {
          const tz = browserTimezone();
          if (tz) api.updateMe({ timezone: tz }).catch(() => {});
        }
      })
      .catch(() => {});
  }, [router]);

  if (!data) {
    return (
      <DarkShell>
        <PageLoading />
      </DarkShell>
    );
  }

  const goals = [...data.goals].sort(
    (a, b) =>
      (SEVERITY[a.reality.verdict] ?? 9) - (SEVERITY[b.reality.verdict] ?? 9) ||
      a.days_remaining - b.days_remaining
  );
  const hero = goals[0];
  const rest = goals.slice(1);
  // Three states, not two. Onboarding's `rhythm` step now sets every study day
  // to the same default, so "has any non-zero hour" would hide the nudge for
  // everyone the moment they registered. A schedule that only knows rest days
  // is still worth sharpening — and accounts created before that step existed
  // have no availability at all and need the original, stronger prompt.
  //
  // `set` comes from the stored flag, never from reading the hours back: the
  // student who steps every study day to the default value at /timing has
  // answered the question, and an inference cannot tell them apart from
  // someone who never opened the page.
  const av = data.user.availability;
  const hours = av ? Object.values(av) : [];
  const timing: "none" | "coarse" | "set" = data.user.availability_refined
    ? "set"
    : !av || hours.every((v) => v <= 0)
      ? "none"
      : "coarse";

  return (
    <DarkShell>
      <div className="pt-6">
        <p className="text-xs font-semibold tracking-[0.25em] text-ink-muted">
          {greeting()}, {data.user.name.toUpperCase()}
        </p>

        {/* Post-onboarding nudge: the schedule works on a coarse default until
            the student sets real hours per day. */}
        {timing !== "set" && (
          <Link href="/timing">
            <motion.div
              initial={{ opacity: 0, y: 10 }}
              animate={{ opacity: 1, y: 0 }}
              className="ob-glass mt-5 flex items-center justify-between gap-4 rounded-2xl px-5 py-4 transition-colors hover:bg-veil/[0.12]"
            >
              <div>
                <p className="text-sm font-semibold text-ink">
                  {timing === "none" ? "Design your schedule" : "Sharpen your schedule"}
                </p>
                <p className="mt-0.5 text-sm text-ink-2">
                  {timing === "none"
                    ? "Right now work spreads evenly. Tell us when you actually study to sharpen the plan."
                    : "Your rest days are set. Add real hours per day and heavier days will carry more work."}
                </p>
              </div>
              <span className="shrink-0 text-ink-2">→</span>
            </motion.div>
          </Link>
        )}

        {!hero ? (
          <div className="mt-20 text-center">
            <p className="text-lg text-ink-2">No active missions.</p>
            <Link
              href="/missions/new"
              className="ob-btn mt-5 inline-block rounded-2xl px-8 py-3.5 text-base font-semibold"
            >
              Create a mission
            </Link>
          </div>
        ) : (
          <>
            <HeroMission g={hero} />
            {rest.length > 0 && (
              <div className="mt-10 space-y-3">
                <p className="text-[11px] font-semibold uppercase tracking-widest text-ink-muted">
                  Other missions
                </p>
                {rest.map((g) => (
                  <SmallMission key={g.goal.id} g={g} />
                ))}
              </div>
            )}
            <div className="mt-8 text-center">
              <Link href="/missions/new" className="inline-block px-3 py-2.5 text-sm text-ink-muted hover:text-ink">
                + new mission
              </Link>
            </div>
          </>
        )}
      </div>
    </DarkShell>
  );
}

// Two decimals on a headline reads as false precision — the estimate behind it
// is nowhere near that good. Whole numbers once it is big enough to not need
// them.
function fmtRate(n: number): string {
  return n >= 10 ? String(Math.round(n)) : String(Math.round(n * 10) / 10);
}

function fmtDay(iso: string | null): string {
  if (!iso) return "—";
  return new Date(`${iso}T00:00:00`).toLocaleDateString("en-US", {
    month: "short",
    day: "numeric",
  });
}

function HeroMission({ g }: { g: DashboardGoal }) {
  const r = g.reality;

  return (
    <motion.section
      initial={{ opacity: 0, y: 14 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.5, ease: [0.22, 1, 0.36, 1] }}
      className="mt-6"
    >
      <div className="flex items-baseline justify-between gap-3">
        <Link
          href={`/missions/${g.goal.id}`}
          className="min-w-0 truncate text-2xl font-bold tracking-tight text-ink hover:text-ink sm:text-3xl"
        >
          {g.goal.title}
        </Link>
        <span className="shrink-0 text-xs text-ink-muted">
          due {fmtDay(g.goal.deadline)} · <span className="text-ink tnum">{g.days_remaining}d</span>
        </span>
      </div>

      {/* THE number is now a date. "37% done" cannot be checked against
          anything; "finishes Sept 6, six days late" can be checked against a
          calendar, and it is the question the student actually has. */}
      <div className="mt-8 text-center sm:mt-10">
        {r.projected_finish ? (
          <>
            <p className="text-sm text-ink-muted">Projected finish</p>
            <div className="mt-1 text-5xl font-bold tracking-tight sm:text-6xl">
              {fmtDay(r.projected_finish)}
            </div>
            {r.days_late > 0 ? (
              <p className="mt-2 text-sm font-semibold text-warn tnum">
                {r.days_late} days after your deadline
              </p>
            ) : (
              <p className="mt-2 text-sm text-ink-muted">inside your deadline</p>
            )}
          </>
        ) : (
          <>
            <p className="text-sm text-ink-muted">Needed pace</p>
            <div className="mt-1 text-4xl font-bold tracking-tight sm:text-5xl">
              {r.required_units_per_hour ? `${fmtRate(r.required_units_per_hour)}/h` : "—"}
            </div>
            <p className="mt-2 text-sm text-ink-muted">no time estimate yet</p>
          </>
        )}
        <div className="mt-4 flex items-center justify-center">
          <DarkVerdictBadge verdict={r.verdict} />
        </div>
        <p className="mx-auto mt-3 max-w-sm text-sm text-ink-2">{r.message}</p>
      </div>

      {/* The plan may drift under the threshold in silence — a metric that
          lurches on one missed Tuesday gets tuned out within a fortnight. Past
          it, the change is stated once and acknowledged, never applied behind
          the student's back. */}
      {r.load_changed && <LoadChangedCard goalId={g.goal.id} />}

      <div className="mt-8">
        <DarkFinishBar
          startDate={g.goal.start_date}
          deadline={g.goal.deadline}
          projectedFinish={r.projected_finish}
        />
      </div>

      {/* Today's move */}
      <div className="ob-glass mt-8 rounded-2xl p-5 text-center sm:p-6">
        <p className="text-[11px] font-semibold uppercase tracking-widest text-ink-muted">Today&apos;s move</p>
        {g.next_move ? (
          <>
            <p className="mt-2 text-base text-ink sm:text-lg">{g.next_move}</p>
            {r.days_behind > 0 && (
              <p className="mt-1 text-xs text-ink-muted">Because you are currently {r.days_behind} days behind.</p>
            )}
          </>
        ) : g.today_total > 0 ? (
          <p className="mt-2 text-lg text-good">✓ All {g.today_total} tasks done today.</p>
        ) : (
          <p className="mt-2 text-sm text-ink-2">Nothing scheduled today for this mission.</p>
        )}
        <Link
          href="/today"
          className="ob-btn mt-4 inline-block rounded-2xl px-10 py-3 text-sm font-semibold tracking-widest"
        >
          START →
        </Link>
      </div>
    </motion.section>
  );
}

function LoadChangedCard({ goalId }: { goalId: number }) {
  const [dismissed, setDismissed] = useState(false);
  const [busy, setBusy] = useState(false);
  if (dismissed) return null;
  return (
    <div className="ob-glass mt-6 rounded-2xl px-5 py-4">
      <p className="text-sm font-semibold text-ink">Your plan got heavier.</p>
      <p className="mt-1 text-sm text-ink-2">
        Missed days have been folded back in, so the daily ask has gone up since you
        last looked. The dates above already account for it.
      </p>
      <button
        onClick={async () => {
          setBusy(true);
          try {
            await api.acknowledgeLoad(goalId);
            setDismissed(true);
          } finally {
            setBusy(false);
          }
        }}
        disabled={busy}
        className="ob-btn mt-3 rounded-xl px-4 py-2 text-xs font-semibold disabled:opacity-50"
      >
        {busy ? "…" : "Got it"}
      </button>
    </div>
  );
}

function SmallMission({ g }: { g: DashboardGoal }) {
  return (
    <Link
      href={`/missions/${g.goal.id}`}
      className="ob-glass flex items-center justify-between rounded-2xl px-5 py-4 transition-colors hover:bg-veil/[0.12]"
    >
      <div>
        <p className="text-sm font-semibold text-ink">{g.goal.title}</p>
        <p className="mt-0.5 text-[11px] text-ink-muted tnum">
          {g.days_remaining}d left ·{" "}
          {g.reality.projected_finish
            ? `finishes ${fmtDay(g.reality.projected_finish)}`
            : `${g.progress_pct.toFixed(0)}% done`}
        </p>
      </div>
      <DarkVerdictBadge verdict={g.reality.verdict} />
    </Link>
  );
}
