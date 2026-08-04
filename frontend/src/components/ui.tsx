"use client";

/**
 * Shared presentational primitives.
 *
 * These existed as copies inside individual pages (six hand-rolled "loading…"
 * blocks, two `glassInput` constants, two `DAYS` arrays, a StatTile and a
 * TabButton stranded in the mission page). Centralising them is what keeps the
 * visual system consistent — a spacing or radius decision now has one home.
 */

import type { ReactNode } from "react";

/* -------------------------------------------------------------------------- */
/* tokens shared by form controls                                             */
/* -------------------------------------------------------------------------- */

export const glassInput = "ob-glass w-full rounded-xl px-4 py-2.5 text-sm text-ink";

export const DAYS: { key: string; label: string }[] = [
  { key: "mon", label: "Mon" },
  { key: "tue", label: "Tue" },
  { key: "wed", label: "Wed" },
  { key: "thu", label: "Thu" },
  { key: "fri", label: "Fri" },
  { key: "sat", label: "Sat" },
  { key: "sun", label: "Sun" },
];

/* -------------------------------------------------------------------------- */
/* structure                                                                  */
/* -------------------------------------------------------------------------- */

/** Small uppercase label that opens a section. One type ramp for all of them. */
export function SectionLabel({ children, className = "" }: { children: ReactNode; className?: string }) {
  return (
    <p className={`text-[11px] font-semibold uppercase tracking-[0.18em] text-ink-muted ${className}`}>
      {children}
    </p>
  );
}

export function Card({
  children,
  className = "",
  padded = true,
}: {
  children: ReactNode;
  className?: string;
  padded?: boolean;
}) {
  return <div className={`ob-glass rounded-2xl ${padded ? "p-6" : ""} ${className}`}>{children}</div>;
}

export function StatTile({ label, value, sub }: { label: string; value: string; sub?: string }) {
  return (
    <div className="ob-glass rounded-2xl px-5 py-4">
      <SectionLabel>{label}</SectionLabel>
      <p className="mt-2 text-2xl font-bold tracking-tight text-ink tnum">{value}</p>
      {sub && <p className="mt-0.5 text-xs text-ink-muted tnum">{sub}</p>}
    </div>
  );
}

export function TabButton({
  active,
  onClick,
  children,
}: {
  active: boolean;
  onClick: () => void;
  children: ReactNode;
}) {
  return (
    <button
      onClick={onClick}
      className={`rounded-xl px-4 py-2 text-sm font-semibold transition-colors ${
        active ? "ob-btn" : "ob-btn-quiet"
      }`}
    >
      {children}
    </button>
  );
}

/* -------------------------------------------------------------------------- */
/* loading                                                                    */
/* -------------------------------------------------------------------------- */

export function Skeleton({ className = "" }: { className?: string }) {
  return <div className={`ob-skeleton ${className}`} aria-hidden />;
}

/**
 * Page-level loading. Shows the *shape* of what is coming rather than the word
 * "loading" — the page stops jumping when data lands.
 */
export function PageLoading({ rows = 3 }: { rows?: number }) {
  return (
    <div className="py-10" role="status" aria-busy="true" aria-label="Loading">
      <Skeleton className="h-4 w-40" />
      <Skeleton className="mt-6 h-9 w-72" />
      <div className="mt-8 space-y-3">
        {Array.from({ length: rows }).map((_, i) => (
          <Skeleton key={i} className="h-16 w-full" />
        ))}
      </div>
      <span className="sr-only">Loading…</span>
    </div>
  );
}

/* -------------------------------------------------------------------------- */
/* empty + error                                                              */
/* -------------------------------------------------------------------------- */

/**
 * Empty states say what the space is for and offer the action that fills it,
 * rather than stating that nothing is there.
 */
export function EmptyState({
  title,
  body,
  action,
}: {
  title: string;
  body?: string;
  action?: ReactNode;
}) {
  return (
    <div className="ob-glass rounded-2xl px-6 py-10 text-center">
      <p className="text-[15px] font-semibold text-ink">{title}</p>
      {body && <p className="mx-auto mt-1.5 max-w-sm text-sm text-ink-muted">{body}</p>}
      {action && <div className="mt-5">{action}</div>}
    </div>
  );
}

export function ErrorLine({ msg }: { msg: string }) {
  return (
    <p role="alert" className="mt-4 text-sm text-bad">
      ✕ {msg}
    </p>
  );
}

/* -------------------------------------------------------------------------- */
/* page rhythm                                                                */
/* -------------------------------------------------------------------------- */

/**
 * One vertical rhythm for the whole product.
 *
 * Sections were spaced with whatever `mt-*` felt right at the time (mt-5, mt-8,
 * mt-8, mt-10, mt-10 all appeared). Routing them through one component means a
 * spacing decision is made once and the pages inherit it.
 */
export function Section({
  label,
  children,
  className = "",
}: {
  label?: ReactNode;
  children: ReactNode;
  className?: string;
}) {
  return (
    <section className={`mt-12 ${className}`}>
      {label && <SectionLabel className="mb-3">{label}</SectionLabel>}
      {children}
    </section>
  );
}

/** Title block at the top of a page. One type ramp for every page heading. */
export function PageHeader({
  eyebrow,
  title,
  subtitle,
  actions,
}: {
  eyebrow?: string;
  title: string;
  subtitle?: ReactNode;
  actions?: ReactNode;
}) {
  return (
    <div className="flex flex-wrap items-end justify-between gap-4 pt-6">
      <div>
        {eyebrow && <SectionLabel>{eyebrow}</SectionLabel>}
        <h1 className="mt-1 text-3xl font-bold tracking-tight text-ink">{title}</h1>
        {subtitle && <p className="mt-1.5 text-sm text-ink-2">{subtitle}</p>}
      </div>
      {actions}
    </div>
  );
}

/* -------------------------------------------------------------------------- */
/* forms                                                                      */
/* -------------------------------------------------------------------------- */

/**
 * Label + control + optional hint, wired for accessibility.
 *
 * Labels were previously loose <span>s next to inputs, so clicking one did
 * nothing and screen readers had to guess the association. `htmlFor`/`id` are
 * derived here so callers cannot forget them.
 */
export function Field({
  label,
  hint,
  htmlFor,
  children,
  className = "",
}: {
  label: string;
  hint?: string;
  htmlFor: string;
  children: ReactNode;
  className?: string;
}) {
  return (
    <div className={className}>
      <label
        htmlFor={htmlFor}
        className="mb-1.5 block text-[11px] font-semibold uppercase tracking-[0.18em] text-ink-muted"
      >
        {label}
      </label>
      {children}
      {hint && <p className="mt-1.5 text-xs text-ink-muted">{hint}</p>}
    </div>
  );
}

/* -------------------------------------------------------------------------- */
/* tables                                                                     */
/* -------------------------------------------------------------------------- */

export interface Column<T> {
  key: string;
  header: string;
  /** Right-align numeric columns so digits line up under each other. */
  numeric?: boolean;
  width?: string;
  render: (row: T) => ReactNode;
}

/**
 * A real table for tabular data.
 *
 * Rows of aligned facts were being built as <ul>/<div> stacks, which loses the
 * header association and every bit of built-in table semantics. Horizontal
 * scroll is contained here so a wide table never makes the page scroll
 * sideways on a phone.
 */
export function DataTable<T>({
  columns,
  rows,
  getKey,
  empty,
}: {
  columns: Column<T>[];
  rows: T[];
  getKey: (row: T, index: number) => string | number;
  empty?: ReactNode;
}) {
  if (!rows.length) return <>{empty ?? <EmptyState title="Nothing here yet" />}</>;

  return (
    <div className="overflow-x-auto">
      <table className="w-full border-collapse text-sm">
        <thead>
          <tr className="border-b border-line">
            {columns.map((c) => (
              <th
                key={c.key}
                scope="col"
                style={c.width ? { width: c.width } : undefined}
                className={`pb-2 text-[11px] font-semibold uppercase tracking-[0.18em] text-ink-muted ${
                  c.numeric ? "text-right" : "text-left"
                }`}
              >
                {c.header}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {rows.map((row, i) => (
            <tr key={getKey(row, i)} className="border-b border-line/60 last:border-0">
              {columns.map((c) => (
                <td
                  key={c.key}
                  className={`py-2.5 align-top ${c.numeric ? "text-right tnum" : "text-left"}`}
                >
                  {c.render(row)}
                </td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
