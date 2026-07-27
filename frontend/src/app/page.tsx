"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useState } from "react";
import { motion } from "motion/react";
import { api, Dashboard, DashboardGoal, getToken, TrajectoryStatus } from "@/lib/api";
import { DarkShell } from "@/components/darkchrome";

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

// Status colors tuned for the dark theme (icon + label always ship together).
const DARK_STATUS: Record<TrajectoryStatus, { label: string; icon: string; cls: string }> = {
  AHEAD: { label: "AHEAD", icon: "▲", cls: "text-emerald-300" },
  ON_TRACK: { label: "ON TRACK", icon: "●", cls: "text-emerald-300" },
  AT_RISK: { label: "AT RISK", icon: "◆", cls: "text-amber-300" },
  OFF_TRACK: { label: "OFF TRACK", icon: "✕", cls: "text-red-300" },
  FAILED: { label: "DEADLINE MISSED", icon: "✕", cls: "text-red-300" },
  COMPLETED: { label: "COMPLETE", icon: "✓", cls: "text-emerald-300" },
};

function DarkStatusBadge({ status }: { status: TrajectoryStatus }) {
  const s = DARK_STATUS[status];
  return (
    <span className={`inline-flex items-center gap-1.5 text-xs font-semibold uppercase tracking-widest ${s.cls}`}>
      <span aria-hidden>{s.icon}</span>
      {s.label}
    </span>
  );
}

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
        <p className="py-24 text-center text-white/50">loading…</p>
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
        <p className="text-xs font-semibold tracking-[0.25em] text-white/50">
          {greeting()}, {data.user.name.toUpperCase()}
        </p>

        {/* Post-onboarding nudge: the schedule works on an even default until
            the student sets their real weekly rhythm. */}
        {!hasTiming && (
          <Link href="/timing">
            <motion.div
              initial={{ opacity: 0, y: 10 }}
              animate={{ opacity: 1, y: 0 }}
              className="ob-glass mt-5 flex items-center justify-between gap-4 rounded-2xl px-5 py-4 transition-colors hover:bg-white/[0.12]"
            >
              <div>
                <p className="text-sm font-semibold text-white">Connect your calendar</p>
                <p className="mt-0.5 text-sm text-white/60">
                  Right now work spreads evenly. Tell us when you actually study to sharpen the plan.
                </p>
              </div>
              <span className="shrink-0 text-white/70">→</span>
            </motion.div>
          </Link>
        )}

        {!hero ? (
          <div className="mt-20 text-center">
            <p className="text-lg text-white/70">No active missions.</p>
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
              <div className="mt-12 space-y-3">
                <p className="text-[11px] font-semibold uppercase tracking-widest text-white/45">
                  Other missions
                </p>
                {rest.map((g) => (
                  <SmallMission key={g.goal.id} g={g} />
                ))}
              </div>
            )}
            <div className="mt-8 text-center">
              <Link href="/missions/new" className="text-sm text-white/55 hover:text-white/90">
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
      <div className="flex items-baseline justify-between gap-4">
        <Link href={`/missions/${g.goal.id}`} className="text-3xl font-bold tracking-tight text-white hover:text-white/80">
          {g.goal.title}
        </Link>
        <span className="shrink-0 text-xs text-white/50">
          {new Date(`${g.goal.deadline}T00:00:00`).toLocaleDateString("en-US", { month: "short", day: "numeric" })}{" "}
          · <span className="text-white/75 tnum">{g.days_remaining}d</span>
        </span>
      </div>

      {/* THE number: how much is actually done. Trajectory lives in the badge. */}
      <div className="mt-10 text-center">
        <div className="text-8xl font-bold tracking-tight tnum">
          {progress}
          <span className="text-4xl text-white/60">%</span>
        </div>
        <p className="mt-1 text-sm text-white/50">done</p>
        <div className="mt-4 flex items-center justify-center">
          <DarkStatusBadge status={r.status} />
        </div>
        <p className="mx-auto mt-3 max-w-sm text-sm text-white/70">{r.message}</p>
        {r.adjustments.length > 0 && (
          <p className="mx-auto mt-2 max-w-sm text-sm text-amber-300">
            → {r.adjustments[0]}
            {r.adjustments.length > 1 && ` (+${r.adjustments.length - 1} more)`}
          </p>
        )}
      </div>

      <div className="mt-8">
        <TrajectoryBar actualPct={r.actual_progress_pct} expectedPct={r.expected_progress_pct} />
      </div>

      {/* Today's move */}
      <div className="ob-glass mt-8 rounded-2xl p-6 text-center">
        <p className="text-[11px] font-semibold uppercase tracking-widest text-white/50">Today&apos;s move</p>
        {g.next_move ? (
          <>
            <p className="mt-2 text-lg text-white">{g.next_move}</p>
            {r.days_behind > 0 && (
              <p className="mt-1 text-xs text-white/50">Because you are currently {r.days_behind} days behind.</p>
            )}
          </>
        ) : g.today_total > 0 ? (
          <p className="mt-2 text-lg text-emerald-300">✓ All {g.today_total} tasks done today.</p>
        ) : (
          <p className="mt-2 text-sm text-white/60">Nothing scheduled today for this mission.</p>
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

function TrajectoryBar({ actualPct, expectedPct }: { actualPct: number; expectedPct: number }) {
  return (
    <div>
      <div className="relative h-2 overflow-hidden rounded-full bg-white/10">
        <div className="absolute inset-y-0 left-0 rounded-full bg-white" style={{ width: `${Math.min(actualPct, 100)}%` }} />
        <div
          className="absolute inset-y-0 w-0.5 bg-white/70"
          style={{ left: `calc(${Math.min(expectedPct, 100)}% - 1px)` }}
          title={`Expected today: ${expectedPct.toFixed(0)}%`}
        />
      </div>
      <div className="mt-1.5 flex justify-between text-[11px] text-white/45">
        <span>
          <span className="text-white/70 tnum">{actualPct.toFixed(0)}%</span> done
        </span>
        <span>
          expected <span className="tnum">{expectedPct.toFixed(0)}%</span>
        </span>
      </div>
    </div>
  );
}

function SmallMission({ g }: { g: DashboardGoal }) {
  return (
    <Link
      href={`/missions/${g.goal.id}`}
      className="ob-glass flex items-center justify-between rounded-2xl px-5 py-4 transition-colors hover:bg-white/[0.12]"
    >
      <div>
        <p className="text-sm font-semibold text-white">{g.goal.title}</p>
        <p className="mt-0.5 text-[11px] text-white/50 tnum">
          {g.days_remaining}d left · {g.progress_pct.toFixed(0)}% done
        </p>
      </div>
      <DarkStatusBadge status={g.reality.status} />
    </Link>
  );
}
