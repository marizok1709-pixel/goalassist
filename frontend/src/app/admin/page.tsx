"use client";

import { useCallback, useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import {
  api,
  ApiError,
  getToken,
  type AdminActivity,
  type AdminFeatures,
  type AdminFinance,
  type AdminInfrastructure,
  type AdminOverview,
  type AdminRetention,
  type AdminSessions,
} from "@/lib/api";
import { DarkShell } from "@/components/darkchrome";
import { EmptyState, PageLoading, SectionLabel, StatTile, TabButton } from "@/components/ui";
import { BarList, ChartFrame, GroupedColumns, RetentionGrid, TimeSeries } from "@/components/charts";
import { AdminUsers } from "./users-table";

const RANGES = [7, 30, 90] as const;

function euro(cents: number): string {
  return `€${(cents / 100).toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
}

function duration(seconds: number): string {
  if (seconds < 60) return `${Math.round(seconds)}s`;
  const m = Math.floor(seconds / 60);
  return m < 60 ? `${m}m ${Math.round(seconds % 60)}s` : `${Math.floor(m / 60)}h ${m % 60}m`;
}

/** Short axis label: "Aug 4" from "2026-08-04", without a date library. */
function shortDay(iso: string): string {
  const d = new Date(`${iso}T00:00:00`);
  return d.toLocaleDateString("en-US", { month: "short", day: "numeric" });
}

export default function AdminPage() {
  const router = useRouter();
  const [days, setDays] = useState<(typeof RANGES)[number]>(30);
  const [denied, setDenied] = useState(false);
  const [error, setError] = useState("");

  const [overview, setOverview] = useState<AdminOverview | null>(null);
  const [activity, setActivity] = useState<AdminActivity | null>(null);
  const [sessions, setSessions] = useState<AdminSessions | null>(null);
  const [features, setFeatures] = useState<AdminFeatures | null>(null);
  const [retention, setRetention] = useState<AdminRetention | null>(null);
  const [infra, setInfra] = useState<AdminInfrastructure | null>(null);
  const [finance, setFinance] = useState<AdminFinance | null>(null);

  const load = useCallback(async () => {
    // Nothing is set before the first await on purpose: a synchronous setState
    // inside an effect kicks off a cascading render.
    try {
      const [o, a, s, f, r, i, fin] = await Promise.all([
        api.adminOverview(),
        api.adminActivity(days),
        api.adminSessions(days),
        api.adminFeatures(days),
        api.adminRetention(6),
        api.adminInfrastructure(),
        api.adminFinance(12),
      ]);
      setError("");
      setOverview(o);
      setActivity(a);
      setSessions(s);
      setFeatures(f);
      setRetention(r);
      setInfra(i);
      setFinance(fin);
    } catch (err) {
      // The API answers 404 for non-admins so the surface stays invisible;
      // treat that as "not for you" rather than "broken".
      if (err instanceof ApiError && (err.status === 404 || err.status === 401)) setDenied(true);
      else setError(err instanceof ApiError ? err.message : "Cannot reach the server");
    }
  }, [days]);

  useEffect(() => {
    if (!getToken()) {
      router.push("/login");
      return;
    }
    load();
  }, [load, router]);

  if (denied) {
    return (
      <DarkShell width="max-w-3xl">
        <div className="pt-16">
          <EmptyState
            title="Not found"
            body="This page does not exist for your account."
          />
        </div>
      </DarkShell>
    );
  }

  if (!overview || !activity || !sessions || !features || !retention || !infra || !finance) {
    return (
      <DarkShell width="max-w-6xl">
        {error ? (
          <div className="pt-16">
            <EmptyState title="Could not load the dashboard" body={error} />
          </div>
        ) : (
          <PageLoading rows={4} />
        )}
      </DarkShell>
    );
  }

  const labels = activity.series.map((p) => shortDay(p.date));

  return (
    <DarkShell width="max-w-6xl">
      <div className="pt-6">
        <div className="flex flex-wrap items-end justify-between gap-4">
          <div>
            <SectionLabel>Operations</SectionLabel>
            <h1 className="mt-1 text-3xl font-bold tracking-tight text-ink">Dashboard</h1>
            <p className="mt-1 text-sm text-ink-muted">
              Generated {new Date(overview.generated_at).toLocaleString()}
            </p>
          </div>
          <div className="flex gap-2">
            {RANGES.map((r) => (
              <TabButton key={r} active={days === r} onClick={() => setDays(r)}>
                {r}d
              </TabButton>
            ))}
          </div>
        </div>

        {/* ---------------- Users ---------------- */}
        <section className="mt-8">
          <SectionLabel>Users</SectionLabel>
          <div className="mt-3 grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-6">
            <StatTile label="Total" value={String(overview.users.total)} />
            <StatTile label="Online now" value={String(overview.users.online_now)} sub="last 5 min" />
            <StatTile label="New today" value={String(overview.users.new_today)} />
            <StatTile label="New 7d" value={String(overview.users.new_7d)} />
            <StatTile label="Returning 7d" value={String(overview.users.returning_7d)} />
            <StatTile
              label="Consent"
              value={`${overview.users.consent_rate_pct}%`}
              sub={`${overview.users.consented_to_analytics} opted in`}
            />
          </div>

          <div className="mt-3 grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-6">
            <StatTile label="DAU" value={String(overview.engagement.dau)} sub="consented" />
            <StatTile label="WAU" value={String(overview.engagement.wau)} sub="consented" />
            <StatTile label="MAU" value={String(overview.engagement.mau)} sub="consented" />
            <StatTile label="DAU (work)" value={String(overview.engagement.dau_by_work)} sub="all users" />
            <StatTile label="WAU (work)" value={String(overview.engagement.wau_by_work)} sub="all users" />
            <StatTile label="MAU (work)" value={String(overview.engagement.mau_by_work)} sub="all users" />
          </div>
          <p className="mt-2 text-xs text-ink-muted">
            DAU/WAU/MAU count users who opted into analytics. The “(work)” figures come from
            completed study units instead, so they cover everyone — use those while the consent
            rate is low.
          </p>
        </section>

        {/* ---------------- Users roster ---------------- */}
        <AdminUsers />

        {/* ---------------- Activity ---------------- */}
        <section className="mt-12 grid gap-4 lg:grid-cols-2">
          <ChartFrame title="People per day" hint="Active users and signups — same unit, one axis.">
            <TimeSeries
              labels={labels}
              series={[
                { label: "Active users", values: activity.series.map((p) => p.active_users) },
                { label: "New users", values: activity.series.map((p) => p.new_users) },
              ]}
            />
          </ChartFrame>

          <ChartFrame title="Sessions per day" hint="Distinct visits, anonymous and signed-in.">
            <TimeSeries
              labels={labels}
              series={[{ label: "Sessions", values: activity.series.map((p) => p.sessions) }]}
            />
          </ChartFrame>

          <ChartFrame title="Work completed per day" hint="Study units finished. Independent of consent.">
            <TimeSeries
              labels={labels}
              series={[{ label: "Units completed", values: activity.series.map((p) => p.work_completed) }]}
            />
          </ChartFrame>

          <ChartFrame title="Events per day" hint="Raw analytics volume — a load signal, not a product metric.">
            <TimeSeries
              labels={labels}
              series={[{ label: "Events", values: activity.series.map((p) => p.events) }]}
            />
          </ChartFrame>
        </section>

        {/* ---------------- Sessions ---------------- */}
        <section className="mt-12">
          <SectionLabel>Sessions · last {sessions.days} days</SectionLabel>
          <div className="mt-3 grid grid-cols-2 gap-3 lg:grid-cols-5">
            <StatTile label="Sessions" value={String(sessions.sessions)} />
            <StatTile label="Per day" value={String(sessions.sessions_per_day)} />
            <StatTile label="Avg duration" value={duration(sessions.avg_duration_seconds)} />
            <StatTile label="Median" value={duration(sessions.median_duration_seconds)} />
            <StatTile label="Single-event" value={String(sessions.single_event_sessions)} sub="bounced" />
          </div>
        </section>

        {/* ---------------- Feature usage ---------------- */}
        <section className="mt-12 grid gap-4 lg:grid-cols-2">
          <ChartFrame title="Feature usage" hint={`Events recorded in the last ${features.days} days.`}>
            <BarList rows={features.events} emptyLabel="No events yet — nobody has opted in." />
          </ChartFrame>
          <ChartFrame title="Screens" hint="Where people actually spend time.">
            <BarList rows={features.paths} emptyLabel="No page views yet." />
          </ChartFrame>
          <ChartFrame title="Devices" hint="The first beta user was on a phone.">
            <BarList rows={features.devices} emptyLabel="No device data yet." />
          </ChartFrame>
          <ChartFrame title="Languages and countries">
            <BarList rows={[...features.languages, ...features.countries]} emptyLabel="No locale data yet." />
          </ChartFrame>
        </section>

        {/* ---------------- Retention ---------------- */}
        <section className="mt-12">
          <ChartFrame
            title="Weekly retention by signup cohort"
            hint="Share of each cohort still completing work in later weeks. Computed from study activity, so it covers every user regardless of consent — this is the beta's success metric (50% weekly over 30 days)."
          >
            <RetentionGrid cohorts={retention.cohorts} />
          </ChartFrame>
        </section>

        {/* ---------------- Infrastructure ---------------- */}
        <section className="mt-12">
          <SectionLabel>Infrastructure</SectionLabel>
          <div className="mt-3 grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-6">
            <StatTile label="p50" value={`${infra.api.latency_ms.p50}ms`} sub="API latency" />
            <StatTile label="p95" value={`${infra.api.latency_ms.p95}ms`} />
            <StatTile label="p99" value={`${infra.api.latency_ms.p99}ms`} />
            <StatTile label="Error rate" value={`${infra.api.error_rate_pct}%`} sub={`${infra.api.server_errors} 5xx`} />
            <StatTile label="Failed" value={String(infra.api.failed_requests)} sub="4xx + 5xx" />
            <StatTile label="Req/min" value={String(infra.api.requests_per_minute)} />
          </div>
          <div className="mt-3 grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-6">
            <StatTile label="DB ping" value={`${infra.database.ping_ms}ms`} sub={infra.database.dialect} />
            <StatTile label="Memory" value={`${infra.process.memory_rss_mb}MB`} sub="RSS" />
            <StatTile label="CPUs" value={String(infra.process.cpu_count ?? "—")} />
            <StatTile label="Load 1m" value={infra.process.load_avg_1m?.toString() ?? "—"} />
            <StatTile label="Load 5m" value={infra.process.load_avg_5m?.toString() ?? "—"} />
            <StatTile label="Uptime" value={duration(infra.api.lifetime.uptime_seconds)} />
          </div>
          <p className="mt-2 text-xs text-ink-muted">{infra.caveat}</p>
        </section>

        {/* ---------------- Finance ---------------- */}
        <section className="mt-12">
          <SectionLabel>Finance</SectionLabel>
          <div className="mt-3 grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-6">
            <StatTile label="Revenue" value={euro(finance.totals.revenue_cents)} sub="all time" />
            <StatTile label="MRR" value={euro(finance.totals.mrr_cents)} sub="recurring, 30d" />
            <StatTile label="Expenses" value={euro(finance.totals.expense_cents)} />
            <StatTile label="Net" value={euro(finance.totals.net_cents)} />
            <StatTile label="Credit" value={euro(finance.totals.credit_cents)} />
            <StatTile label="Debit" value={euro(finance.totals.debit_cents)} />
          </div>
          <div className="mt-3 grid grid-cols-2 gap-3 lg:grid-cols-4">
            <StatTile label="Transactions" value={String(finance.transactions)} />
            <StatTile label="Paying users" value={String(finance.paying_users)} />
          </div>

          <div className="mt-4">
            <ChartFrame title="Revenue and expenses by month" hint={finance.note}>
              <GroupedColumns
                labels={finance.series.map((m) => m.month)}
                series={[
                  { label: "Revenue", values: finance.series.map((m) => m.revenue_cents / 100) },
                  { label: "Expenses", values: finance.series.map((m) => m.expense_cents / 100) },
                ]}
                formatValue={(v) => `€${v}`}
              />
            </ChartFrame>
          </div>
        </section>

        <div className="h-16" />
      </div>
    </DarkShell>
  );
}
