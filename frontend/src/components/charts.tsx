"use client";

/**
 * Chart primitives.
 *
 * Hand-rolled SVG rather than a charting dependency: these read the design
 * tokens directly (so light/dark and any future re-theme are free), ship no
 * runtime, and the whole surface is four shapes. A library would be the right
 * call the moment we need zooming, brushing or dual scales — the first two are
 * not needed and the third is forbidden.
 *
 * Rules baked in here, not left to the caller:
 *   - one y-axis, always; two measures of different scale get two charts,
 *   - categorical hues assigned in fixed order and never cycled,
 *   - a legend whenever there is more than one series, so identity is never
 *     carried by colour alone,
 *   - recessive grid and axes; text uses ink tokens, never the series colour,
 *   - a hover layer by default — an SVG chart in a browser is interactive,
 *   - empty data renders an explicit "no data yet" rather than a flat line
 *     that looks like a measurement of zero.
 */

import { useId, useMemo, useState } from "react";
import { SectionLabel } from "@/components/ui";

export const SERIES_COLORS = [
  "var(--chart-1)",
  "var(--chart-2)",
  "var(--chart-3)",
  "var(--chart-4)",
] as const;

const SEQ = ["var(--seq-1)", "var(--seq-2)", "var(--seq-3)", "var(--seq-4)", "var(--seq-5)"];

export interface Series {
  label: string;
  values: number[];
}

function niceCeiling(max: number): number {
  if (max <= 0) return 1;
  const mag = 10 ** Math.floor(Math.log10(max));
  for (const step of [1, 2, 2.5, 5, 10]) {
    if (max <= step * mag) return step * mag;
  }
  return 10 * mag;
}

function EmptyPlot({ label }: { label: string }) {
  return (
    <div className="flex h-[180px] items-center justify-center rounded-xl border border-dashed border-line">
      <p className="text-sm text-ink-muted">{label}</p>
    </div>
  );
}

export function ChartFrame({
  title,
  hint,
  children,
  right,
}: {
  title: string;
  hint?: string;
  children: React.ReactNode;
  right?: React.ReactNode;
}) {
  return (
    <div className="ob-glass rounded-2xl p-5">
      <div className="flex items-start justify-between gap-4">
        <div>
          <SectionLabel>{title}</SectionLabel>
          {hint && <p className="mt-1 text-xs text-ink-muted">{hint}</p>}
        </div>
        {right}
      </div>
      <div className="mt-4">{children}</div>
    </div>
  );
}

function Legend({ series }: { series: Series[] }) {
  if (series.length < 2) return null; // one series is named by the title
  return (
    <ul className="mt-3 flex flex-wrap gap-x-5 gap-y-1.5">
      {series.map((s, i) => (
        <li key={s.label} className="flex items-center gap-2 text-xs text-ink-2">
          <span
            aria-hidden
            className="h-2.5 w-2.5 shrink-0 rounded-full"
            style={{ background: SERIES_COLORS[i % SERIES_COLORS.length] }}
          />
          {s.label}
        </li>
      ))}
    </ul>
  );
}

/* -------------------------------------------------------------------------- */
/* Time series — line (+ optional area for a single series)                    */
/* -------------------------------------------------------------------------- */

export function TimeSeries({
  labels,
  series,
  height = 200,
  formatValue = (v: number) => String(v),
}: {
  labels: string[];
  series: Series[];
  height?: number;
  formatValue?: (v: number) => string;
}) {
  const gradientId = useId();
  const [hover, setHover] = useState<number | null>(null);

  const W = 720;
  const H = height;
  const PAD = { top: 12, right: 12, bottom: 26, left: 40 };
  const plotW = W - PAD.left - PAD.right;
  const plotH = H - PAD.top - PAD.bottom;

  const max = useMemo(
    () => niceCeiling(Math.max(0, ...series.flatMap((s) => s.values))),
    [series],
  );
  const n = labels.length;
  const x = (i: number) => PAD.left + (n <= 1 ? plotW / 2 : (i / (n - 1)) * plotW);
  const y = (v: number) => PAD.top + plotH - (v / max) * plotH;

  const hasAnything = series.some((s) => s.values.some((v) => v > 0));
  if (!n || !hasAnything) return <EmptyPlot label="No activity recorded yet" />;

  const ticks = [0, max / 2, max];
  const single = series.length === 1;

  return (
    <div>
      <svg
        viewBox={`0 0 ${W} ${H}`}
        className="w-full"
        style={{ height }}
        role="img"
        aria-label={`${series.map((s) => s.label).join(", ")} over ${n} days`}
        onMouseLeave={() => setHover(null)}
        onMouseMove={(e) => {
          const rect = e.currentTarget.getBoundingClientRect();
          const px = ((e.clientX - rect.left) / rect.width) * W;
          const idx = Math.round(((px - PAD.left) / plotW) * (n - 1));
          setHover(Math.max(0, Math.min(n - 1, idx)));
        }}
      >
        <defs>
          <linearGradient id={gradientId} x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stopColor={SERIES_COLORS[0]} stopOpacity="0.22" />
            <stop offset="100%" stopColor={SERIES_COLORS[0]} stopOpacity="0" />
          </linearGradient>
        </defs>

        {/* Recessive gridlines + axis labels. */}
        {ticks.map((t) => (
          <g key={t}>
            <line
              x1={PAD.left}
              x2={W - PAD.right}
              y1={y(t)}
              y2={y(t)}
              stroke="var(--chart-grid)"
              strokeWidth="1"
            />
            <text
              x={PAD.left - 8}
              y={y(t) + 4}
              textAnchor="end"
              fontSize="11"
              fill="var(--chart-axis)"
            >
              {formatValue(t)}
            </text>
          </g>
        ))}

        {single && (
          <path
            d={`M ${x(0)} ${y(series[0].values[0])} ${series[0].values
              .map((v, i) => `L ${x(i)} ${y(v)}`)
              .join(" ")} L ${x(n - 1)} ${PAD.top + plotH} L ${x(0)} ${PAD.top + plotH} Z`}
            fill={`url(#${gradientId})`}
          />
        )}

        {series.map((s, si) => (
          <path
            key={s.label}
            d={`M ${x(0)} ${y(s.values[0])} ${s.values.map((v, i) => `L ${x(i)} ${y(v)}`).join(" ")}`}
            fill="none"
            stroke={SERIES_COLORS[si % SERIES_COLORS.length]}
            strokeWidth="2"
            strokeLinecap="round"
            strokeLinejoin="round"
          />
        ))}

        {hover !== null && (
          <>
            <line
              x1={x(hover)}
              x2={x(hover)}
              y1={PAD.top}
              y2={PAD.top + plotH}
              stroke="var(--chart-axis)"
              strokeWidth="1"
              strokeDasharray="3 3"
            />
            {series.map((s, si) => (
              <circle
                key={s.label}
                cx={x(hover)}
                cy={y(s.values[hover])}
                r="4.5"
                fill={SERIES_COLORS[si % SERIES_COLORS.length]}
                /* 2px surface ring keeps overlapping markers readable */
                stroke="var(--surface)"
                strokeWidth="2"
              />
            ))}
          </>
        )}

        {/* First and last x labels only — a label per day collides. */}
        <text x={PAD.left} y={H - 6} fontSize="11" fill="var(--chart-axis)">
          {labels[0]}
        </text>
        <text x={W - PAD.right} y={H - 6} textAnchor="end" fontSize="11" fill="var(--chart-axis)">
          {labels[n - 1]}
        </text>
      </svg>

      <div className="mt-1 min-h-[20px] text-xs text-ink-2" aria-live="polite">
        {hover !== null && (
          <span>
            <span className="text-ink-muted">{labels[hover]}</span>{" "}
            {series.map((s, si) => (
              <span key={s.label} className="ml-3">
                <span
                  aria-hidden
                  className="mr-1.5 inline-block h-2 w-2 rounded-full align-middle"
                  style={{ background: SERIES_COLORS[si % SERIES_COLORS.length] }}
                />
                {s.label} <span className="font-semibold tnum">{formatValue(s.values[hover])}</span>
              </span>
            ))}
          </span>
        )}
      </div>

      <Legend series={series} />
    </div>
  );
}

/* -------------------------------------------------------------------------- */
/* Horizontal bars — magnitude, sequential by rank                             */
/* -------------------------------------------------------------------------- */

export function BarList({
  rows,
  emptyLabel = "Nothing recorded yet",
  formatValue = (v: number) => String(v),
}: {
  rows: { key: string; count: number }[];
  emptyLabel?: string;
  formatValue?: (v: number) => string;
}) {
  if (!rows.length) return <EmptyPlot label={emptyLabel} />;
  const max = Math.max(...rows.map((r) => r.count), 1);

  return (
    <ul className="space-y-2">
      {rows.map((r, i) => (
        <li key={r.key} className="group flex items-center gap-3">
          <span className="w-40 shrink-0 truncate text-xs text-ink-2" title={r.key}>
            {r.key}
          </span>
          <span className="relative h-5 flex-1 overflow-hidden rounded bg-veil/[0.06]">
            <span
              className="absolute inset-y-0 left-0 rounded-r"
              style={{
                width: `${Math.max((r.count / max) * 100, 1.5)}%`,
                // Sequential: darker = larger. Rank maps onto the ramp.
                background: SEQ[Math.min(SEQ.length - 1, SEQ.length - 1 - Math.floor((i / rows.length) * SEQ.length))],
              }}
            />
          </span>
          {/* Direct label — no tooltip needed to read a value. */}
          <span className="w-12 shrink-0 text-right text-xs font-semibold text-ink tnum">
            {formatValue(r.count)}
          </span>
        </li>
      ))}
    </ul>
  );
}

/* -------------------------------------------------------------------------- */
/* Grouped columns — two comparable measures, same unit, one axis              */
/* -------------------------------------------------------------------------- */

export function GroupedColumns({
  labels,
  series,
  height = 200,
  formatValue = (v: number) => String(v),
}: {
  labels: string[];
  series: Series[];
  height?: number;
  formatValue?: (v: number) => string;
}) {
  const [hover, setHover] = useState<number | null>(null);
  const W = 720;
  const H = height;
  const PAD = { top: 12, right: 12, bottom: 26, left: 48 };
  const plotW = W - PAD.left - PAD.right;
  const plotH = H - PAD.top - PAD.bottom;

  const max = niceCeiling(Math.max(0, ...series.flatMap((s) => s.values)));
  const n = labels.length;
  const hasAnything = series.some((s) => s.values.some((v) => v > 0));
  if (!n || !hasAnything) return <EmptyPlot label="No transactions recorded yet" />;

  const groupW = plotW / n;
  const barW = Math.max(3, (groupW - 6) / series.length - 2); // 2px gap between bars

  return (
    <div>
      <svg viewBox={`0 0 ${W} ${H}`} className="w-full" style={{ height }} role="img"
           aria-label={series.map((s) => s.label).join(" and ")}
           onMouseLeave={() => setHover(null)}>
        {[0, max / 2, max].map((t) => (
          <g key={t}>
            <line x1={PAD.left} x2={W - PAD.right} y1={PAD.top + plotH - (t / max) * plotH}
                  y2={PAD.top + plotH - (t / max) * plotH} stroke="var(--chart-grid)" strokeWidth="1" />
            <text x={PAD.left - 8} y={PAD.top + plotH - (t / max) * plotH + 4} textAnchor="end"
                  fontSize="11" fill="var(--chart-axis)">{formatValue(t)}</text>
          </g>
        ))}

        {labels.map((label, i) => (
          <g key={label} onMouseEnter={() => setHover(i)}>
            {/* Full-height hit target: easier to hover than a 3px bar. */}
            <rect x={PAD.left + i * groupW} y={PAD.top} width={groupW} height={plotH} fill="transparent" />
            {series.map((s, si) => {
              const v = s.values[i] ?? 0;
              const h = Math.max((v / max) * plotH, v > 0 ? 2 : 0);
              return (
                <rect
                  key={s.label}
                  x={PAD.left + i * groupW + 3 + si * (barW + 2)}
                  y={PAD.top + plotH - h}
                  width={barW}
                  height={h}
                  rx="2"
                  fill={SERIES_COLORS[si % SERIES_COLORS.length]}
                  opacity={hover === null || hover === i ? 1 : 0.45}
                />
              );
            })}
          </g>
        ))}

        <text x={PAD.left} y={H - 6} fontSize="11" fill="var(--chart-axis)">{labels[0]}</text>
        <text x={W - PAD.right} y={H - 6} textAnchor="end" fontSize="11" fill="var(--chart-axis)">
          {labels[n - 1]}
        </text>
      </svg>

      <div className="mt-1 min-h-[20px] text-xs text-ink-2" aria-live="polite">
        {hover !== null && (
          <span>
            <span className="text-ink-muted">{labels[hover]}</span>
            {series.map((s, si) => (
              <span key={s.label} className="ml-3">
                <span aria-hidden className="mr-1.5 inline-block h-2 w-2 rounded-full align-middle"
                      style={{ background: SERIES_COLORS[si % SERIES_COLORS.length] }} />
                {s.label} <span className="font-semibold tnum">{formatValue(s.values[hover])}</span>
              </span>
            ))}
          </span>
        )}
      </div>

      <Legend series={series} />
    </div>
  );
}

/* -------------------------------------------------------------------------- */
/* Retention grid — sequential heatmap                                         */
/* -------------------------------------------------------------------------- */

export function RetentionGrid({
  cohorts,
}: {
  cohorts: { cohort: string; size: number; retained_pct: number[] }[];
}) {
  const populated = cohorts.filter((c) => c.size > 0);
  if (!populated.length) return <EmptyPlot label="No signup cohorts yet" />;
  const width = Math.max(...populated.map((c) => c.retained_pct.length), 1);

  const shade = (pct: number) => {
    if (pct <= 0) return "var(--seq-1)";
    const idx = Math.min(SEQ.length - 1, Math.floor((pct / 100) * SEQ.length));
    return SEQ[idx];
  };

  return (
    <div className="overflow-x-auto">
      <table className="w-full min-w-[420px] border-separate border-spacing-1 text-xs">
        <thead>
          <tr>
            <th className="w-24 text-left font-medium text-ink-muted">Cohort</th>
            <th className="w-12 text-right font-medium text-ink-muted">n</th>
            {Array.from({ length: width }).map((_, i) => (
              <th key={i} className="font-medium text-ink-muted">
                W{i}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {populated.map((c) => (
            <tr key={c.cohort}>
              <td className="text-ink-2 tnum">{c.cohort}</td>
              <td className="text-right text-ink-2 tnum">{c.size}</td>
              {Array.from({ length: width }).map((_, i) => {
                const pct = c.retained_pct[i];
                if (pct === undefined) return <td key={i} />;
                return (
                  <td key={i}>
                    <div
                      className="rounded px-1.5 py-1 text-center font-semibold tnum"
                      style={{
                        background: shade(pct),
                        // Value is always written, so the cell never relies on
                        // colour alone to be read.
                        color: pct > 55 ? "var(--surface)" : "var(--ink)",
                      }}
                      title={`${c.cohort} · week ${i} · ${pct}%`}
                    >
                      {pct}%
                    </div>
                  </td>
                );
              })}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
