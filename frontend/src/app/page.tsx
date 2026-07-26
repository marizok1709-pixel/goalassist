"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useState } from "react";
import { api, Dashboard, DashboardGoal, getToken } from "@/lib/api";
import { Spinner, STATUS, StatusBadge, TrajectoryBar } from "@/components/ui";

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

  if (!data) return <Spinner />;

  const goals = [...data.goals].sort(
    (a, b) =>
      (SEVERITY[a.reality.status] ?? 9) - (SEVERITY[b.reality.status] ?? 9) ||
      a.days_remaining - b.days_remaining
  );
  const hero = goals[0];
  const rest = goals.slice(1);

  return (
    <div className="mx-auto max-w-xl">
      <p className="font-mono text-xs tracking-[0.25em] text-ink-muted">
        {greeting()}, {data.user.name.toUpperCase()}
      </p>

      {!hero ? (
        <div className="mt-16 text-center">
          <p className="text-ink-2">No active missions.</p>
          <Link
            href="/missions/new"
            className="mt-4 inline-block rounded-md bg-accent px-5 py-2.5 text-sm font-medium text-white hover:bg-accent-deep"
          >
            Create your first mission
          </Link>
        </div>
      ) : (
        <>
          <HeroMission g={hero} />
          {rest.length > 0 && (
            <div className="mt-10 space-y-3">
              <p className="font-mono text-[11px] uppercase tracking-widest text-ink-muted">
                Other missions
              </p>
              {rest.map((g) => (
                <SmallMission key={g.goal.id} g={g} />
              ))}
            </div>
          )}
        </>
      )}
    </div>
  );
}

function HeroMission({ g }: { g: DashboardGoal }) {
  const r = g.reality;
  const s = STATUS[r.status];

  return (
    <section className="mt-6">
      <p className="font-mono text-[11px] uppercase tracking-widest text-ink-muted">Your mission</p>
      <div className="mt-1 flex items-baseline justify-between gap-4">
        <Link
          href={`/missions/${g.goal.id}`}
          className="font-serif text-3xl font-semibold text-ink hover:text-accent"
        >
          {g.goal.title}
        </Link>
        <span className="shrink-0 font-mono text-xs text-ink-muted">
          {new Date(`${g.goal.deadline}T00:00:00`).toLocaleDateString("en-US", {
            month: "short",
            day: "numeric",
          })}{" "}
          · <span className="text-ink-2 tnum">{g.days_remaining}d</span>
        </span>
      </div>

      {/* THE number. One dominant figure: trajectory. */}
      <div className="mt-8 text-center">
        <div className={`text-7xl font-semibold tracking-tight ${s.color} tnum`}>
          {Math.round(r.trajectory_ratio * 100)}
          <span className="text-3xl">%</span>
        </div>
        <div className="mt-2 flex items-center justify-center gap-2">
          <StatusBadge status={r.status} />
        </div>
        <p className="mx-auto mt-3 max-w-sm text-sm text-ink-2">{r.message}</p>
        {r.adjustments.length > 0 && (
          <p className="mx-auto mt-2 max-w-sm text-sm text-warning">
            → {r.adjustments[0]}
            {r.adjustments.length > 1 && ` (+${r.adjustments.length - 1} more)`}
          </p>
        )}
      </div>

      <div className="mt-8">
        <TrajectoryBar actualPct={r.actual_progress_pct} expectedPct={r.expected_progress_pct} />
      </div>

      {/* Today's move */}
      <div className="mt-8 rounded-lg border border-line bg-surface p-5 text-center">
        <p className="font-mono text-[11px] uppercase tracking-widest text-ink-muted">
          Today&apos;s move
        </p>
        {g.next_move ? (
          <>
            <p className="mt-2 text-lg text-ink">{g.next_move}</p>
            {r.days_behind > 0 && (
              <p className="mt-1 text-xs text-ink-muted">
                Because you are currently {r.days_behind} days behind.
              </p>
            )}
          </>
        ) : g.today_total > 0 ? (
          <p className="mt-2 text-lg text-good">✓ All {g.today_total} tasks done today.</p>
        ) : (
          <p className="mt-2 text-sm text-ink-2">Nothing scheduled today for this mission.</p>
        )}
        <Link
          href="/today"
          className="mt-4 inline-block rounded-md bg-accent px-10 py-3 font-mono text-sm font-semibold tracking-widest text-white hover:bg-accent-deep"
        >
          START →
        </Link>
      </div>
    </section>
  );
}

function SmallMission({ g }: { g: DashboardGoal }) {
  return (
    <Link
      href={`/missions/${g.goal.id}`}
      className="flex items-center justify-between rounded-lg border border-line bg-surface px-4 py-3 hover:border-accent/50"
    >
      <div>
        <p className="text-sm font-medium text-ink">{g.goal.title}</p>
        <p className="mt-0.5 font-mono text-[11px] text-ink-muted tnum">
          {g.days_remaining}d left · {g.progress_pct.toFixed(0)}% done
        </p>
      </div>
      <StatusBadge status={g.reality.status} />
    </Link>
  );
}
