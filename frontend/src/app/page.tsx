"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useState } from "react";
import { motion } from "motion/react";
import { api, Dashboard, DashboardGoal, getToken } from "@/lib/api";
import { DarkShell, DarkStatusBadge, DarkTrajectoryBar } from "@/components/darkchrome";
import { PageLoading } from "@/components/ui";

function greeting(): string {
  const h = new Date().getHours();
  if (h < 5) return "STILL UP";
  if (h < 12) return "GOOD MORNING";
  if (h < 18) return "GOOD AFTERNOON";
  return "GOOD EVENING";
}

const SEVERITY: Record<string, number> = {
  FAILED: 0,
  OFF_TRACK: 1,
  AT_RISK: 2,
  ON_TRACK: 3,
  AHEAD: 4,
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
    api.dashboard().then(setData).catch(() => {});
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
      (SEVERITY[a.reality.status] ?? 9) - (SEVERITY[b.reality.status] ?? 9) ||
      a.days_remaining - b.days_remaining
  );
  const hero = goals[0];
  const rest = goals.slice(1);
  const av = data.user.availability;
  const hasTiming = !!av && Object.values(av).some((v) => v > 0);

  return (
    <DarkShell>
      <div className="pt-6">
        <p className="text-xs font-semibold tracking-[0.25em] text-ink-muted">
          {greeting()}, {data.user.name.toUpperCase()}
        </p>

        {/* Post-onboarding nudge: the schedule works on an even default until
            the student sets their real weekly rhythm. */}
        {!hasTiming && (
          <Link href="/timing">
            <motion.div
              initial={{ opacity: 0, y: 10 }}
              animate={{ opacity: 1, y: 0 }}
              className="ob-glass mt-5 flex items-center justify-between gap-4 rounded-2xl px-5 py-4 transition-colors hover:bg-veil/[0.12]"
            >
              <div>
                <p className="text-sm font-semibold text-ink">Design your schedule</p>
                <p className="mt-0.5 text-sm text-ink-2">
                  Right now work spreads evenly. Tell us when you actually study to sharpen the plan.
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

function HeroMission({ g }: { g: DashboardGoal }) {
  const r = g.reality;
  const progress = Math.round(r.actual_progress_pct);

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
          {new Date(`${g.goal.deadline}T00:00:00`).toLocaleDateString("en-US", { month: "short", day: "numeric" })}{" "}
          · <span className="text-ink tnum">{g.days_remaining}d</span>
        </span>
      </div>

      {/* THE number: how much is actually done. Trajectory lives in the badge. */}
      <div className="mt-8 text-center sm:mt-10">
        <div className="text-7xl font-bold tracking-tight tnum sm:text-8xl">
          {progress}
          <span className="text-3xl text-ink-2 sm:text-4xl">%</span>
        </div>
        <p className="mt-1 text-sm text-ink-muted">done</p>
        <div className="mt-4 flex items-center justify-center">
          <DarkStatusBadge status={r.status} />
        </div>
        <p className="mx-auto mt-3 max-w-sm text-sm text-ink-2">{r.message}</p>
        {r.adjustments.length > 0 && (
          <p className="mx-auto mt-2 max-w-sm text-sm text-warn">
            → {r.adjustments[0]}
            {r.adjustments.length > 1 && ` (+${r.adjustments.length - 1} more)`}
          </p>
        )}
      </div>

      <div className="mt-8">
        <DarkTrajectoryBar actualPct={r.actual_progress_pct} expectedPct={r.expected_progress_pct} />
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

function SmallMission({ g }: { g: DashboardGoal }) {
  return (
    <Link
      href={`/missions/${g.goal.id}`}
      className="ob-glass flex items-center justify-between rounded-2xl px-5 py-4 transition-colors hover:bg-veil/[0.12]"
    >
      <div>
        <p className="text-sm font-semibold text-ink">{g.goal.title}</p>
        <p className="mt-0.5 text-[11px] text-ink-muted tnum">
          {g.days_remaining}d left · {g.progress_pct.toFixed(0)}% done
        </p>
      </div>
      <DarkStatusBadge status={g.reality.status} />
    </Link>
  );
}
