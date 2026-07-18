"use client";

import { RealityReport, TrajectoryStatus } from "@/lib/api";

// Status is never color-alone: icon + label always ship together.
export const STATUS: Record<TrajectoryStatus, { label: string; icon: string; color: string }> = {
  AHEAD: { label: "AHEAD", icon: "▲", color: "text-good" },
  ON_TRACK: { label: "ON TRACK", icon: "●", color: "text-good" },
  AT_RISK: { label: "AT RISK", icon: "◆", color: "text-warning" },
  OFF_TRACK: { label: "OFF TRACK", icon: "✕", color: "text-critical" },
  FAILED: { label: "DEADLINE MISSED", icon: "✕", color: "text-critical" },
  COMPLETED: { label: "COMPLETE", icon: "✓", color: "text-good" },
};

export function StatusBadge({ status }: { status: TrajectoryStatus }) {
  const s = STATUS[status];
  return (
    <span
      className={`inline-flex items-center gap-1.5 font-mono text-xs tracking-widest ${s.color}`}
    >
      <span aria-hidden>{s.icon}</span>
      {s.label}
    </span>
  );
}

/** Progress bar with a tick marking where you SHOULD be today. */
export function TrajectoryBar({
  actualPct,
  expectedPct,
}: {
  actualPct: number;
  expectedPct: number;
}) {
  return (
    <div>
      <div className="relative h-2 rounded-[4px] bg-grid overflow-hidden">
        <div
          className="absolute inset-y-0 left-0 rounded-r-[4px] bg-accent"
          style={{ width: `${Math.min(actualPct, 100)}%` }}
        />
        <div
          className="absolute inset-y-0 w-[2px] bg-ink-2"
          style={{ left: `calc(${Math.min(expectedPct, 100)}% - 1px)` }}
          title={`Expected today: ${expectedPct.toFixed(0)}%`}
        />
      </div>
      <div className="mt-1.5 flex justify-between font-mono text-[11px] text-ink-muted">
        <span>
          <span className="text-ink-2 tnum">{actualPct.toFixed(0)}%</span> done
        </span>
        <span>
          expected <span className="tnum">{expectedPct.toFixed(0)}%</span>
        </span>
      </div>
    </div>
  );
}

export function StatTile({ label, value, sub }: { label: string; value: string; sub?: string }) {
  return (
    <div className="rounded-md border border-line bg-surface px-4 py-3">
      <div className="font-mono text-[11px] uppercase tracking-widest text-ink-muted">{label}</div>
      <div className="mt-1 text-2xl font-semibold text-ink tnum">{value}</div>
      {sub && <div className="mt-0.5 text-xs text-ink-2">{sub}</div>}
    </div>
  );
}

export function RealityPanel({ reality }: { reality: RealityReport }) {
  const border =
    reality.status === "OFF_TRACK"
      ? "border-critical/50"
      : reality.status === "AT_RISK"
        ? "border-warning/50"
        : "border-line";
  return (
    <div className={`rounded-md border ${border} bg-surface-2 px-4 py-3`}>
      <div className="flex items-center justify-between">
        <span className="font-mono text-[11px] uppercase tracking-widest text-ink-muted">
          Reality Engine
        </span>
        <StatusBadge status={reality.status} />
      </div>
      <p className="mt-2 text-sm text-ink-2">{reality.message}</p>
      {reality.adjustments.length > 0 && (
        <ul className="mt-2 space-y-1">
          {reality.adjustments.map((a) => (
            <li key={a} className="text-sm text-ink">
              <span className="text-warning" aria-hidden>
                →{" "}
              </span>
              {a}
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

export function Spinner() {
  return (
    <div className="flex justify-center py-16 font-mono text-sm text-ink-muted">loading…</div>
  );
}

export function ErrorNote({ message }: { message: string }) {
  return (
    <p className="rounded-md border border-critical/50 bg-surface px-3 py-2 text-sm text-critical">
      ✕ {message}
    </p>
  );
}

export const inputCls =
  "w-full rounded-md border border-line bg-surface-2 px-3 py-2 text-sm text-ink placeholder:text-ink-muted focus:border-accent focus:outline-none";

export const btnPrimary =
  "rounded-md bg-accent px-4 py-2 text-sm font-medium text-white hover:bg-accent-deep disabled:opacity-50 transition-colors";

export const btnGhost =
  "rounded-md border border-line px-4 py-2 text-sm text-ink-2 hover:bg-surface-2 transition-colors";
