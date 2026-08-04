"use client";

import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { useEffect, useState } from "react";
import { motion } from "motion/react";
import { api, clearToken, getToken, TrajectoryStatus } from "@/lib/api";
import { analytics } from "@/lib/analytics";

// Marketing nav from the Figma — now functional (each links to a real page).
const MARKETING: { href: string; label: string }[] = [
  { href: "/policies", label: "policies and data" },
  { href: "/settings", label: "settings" },
  { href: "/social", label: "social media" },
  { href: "/support", label: "support" },
  { href: "/about", label: "about us" },
];

export function DarkNav() {
  const pathname = usePathname();
  const router = useRouter();
  const [authed, setAuthed] = useState(false);
  const [isAdmin, setIsAdmin] = useState(false);
  const [theme, setTheme] = useState<"dark" | "light">("dark");

  useEffect(() => {
    // Token lives in localStorage (client-only), so it can only be read after
    // mount — deliberate, mirrors the app's other auth-aware nav.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setAuthed(getToken() !== null);
  }, [pathname]);

  useEffect(() => {
    // The admin link only appears for operators. This is convenience, not
    // security — the server 404s /admin/* for everyone else regardless.
    if (!authed) {
      setIsAdmin(false);
      return;
    }
    api
      .me()
      .then((u) => setIsAdmin(Boolean(u.is_admin)))
      .catch(() => setIsAdmin(false));
  }, [authed]);

  useEffect(() => {
    // The pre-paint script in the root layout already put the theme on <html>;
    // read it back rather than re-applying, so the toggle label matches what is
    // actually rendered and no second paint happens.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setTheme(document.documentElement.dataset.theme === "light" ? "light" : "dark");
  }, []);

  function toggleTheme() {
    const next = theme === "dark" ? "light" : "dark";
    setTheme(next);
    analytics.track("theme_changed", { theme: next });
    localStorage.setItem("goalassist_theme", next);
    document.documentElement.dataset.theme = next;
  }

  function logout() {
    clearToken();
    router.push("/onboarding");
  }

  return (
    <div className="flex flex-wrap items-center justify-between gap-x-6 gap-y-3 px-8 py-6 text-sm font-medium text-ink-2">
      <div className="flex flex-wrap items-center gap-x-6 gap-y-2">
        {MARKETING.map((m) => (
          <Link key={m.href} href={m.href} className="transition-colors hover:text-ink">
            {m.label}
          </Link>
        ))}
      </div>
      <div className="flex items-center gap-5">
        {authed && (
          <nav className="flex items-center gap-5 text-ink-2">
            <Link href="/" className="transition-colors hover:text-ink">
              dashboard
            </Link>
            <Link href="/today" className="transition-colors hover:text-ink">
              today
            </Link>
            <Link href="/calendar" className="transition-colors hover:text-ink">
              calendar
            </Link>
            {isAdmin && (
              <Link href="/admin" className="font-semibold text-accent transition-colors hover:text-ink">
                admin
              </Link>
            )}
            <button onClick={logout} className="transition-colors hover:text-ink">
              logout
            </button>
          </nav>
        )}
        <button onClick={toggleTheme} className="transition-colors hover:text-ink">
          {theme === "dark" ? "light mode" : "dark mode"}
        </button>
      </div>
    </div>
  );
}

/** Full-screen dark aurora shell for authed pages (covers the light chrome). */
export function DarkShell({
  children,
  width = "max-w-2xl",
}: {
  children: React.ReactNode;
  width?: string;
}) {
  return (
    <div className="ob-root">
      <DarkNav />
      <main className={`mx-auto w-full px-6 pb-28 ${width}`}>{children}</main>
    </div>
  );
}

// Status colors tuned for the dark theme (icon + label always ship together).
const DARK_STATUS: Record<TrajectoryStatus, { label: string; icon: string; cls: string }> = {
  AHEAD: { label: "AHEAD", icon: "▲", cls: "text-good" },
  ON_TRACK: { label: "ON TRACK", icon: "●", cls: "text-good" },
  AT_RISK: { label: "AT RISK", icon: "◆", cls: "text-warn" },
  OFF_TRACK: { label: "OFF TRACK", icon: "✕", cls: "text-bad" },
  FAILED: { label: "DEADLINE MISSED", icon: "✕", cls: "text-bad" },
  COMPLETED: { label: "COMPLETE", icon: "✓", cls: "text-good" },
};

export function DarkStatusBadge({ status }: { status: TrajectoryStatus }) {
  const s = DARK_STATUS[status];
  return (
    <span className={`inline-flex items-center gap-1.5 text-xs font-semibold uppercase tracking-widest ${s.cls}`}>
      <span aria-hidden>{s.icon}</span>
      {s.label}
    </span>
  );
}

/** Progress bar with a tick marking where you SHOULD be today. */
export function DarkTrajectoryBar({ actualPct, expectedPct }: { actualPct: number; expectedPct: number }) {
  return (
    <div>
      <div className="relative h-2 overflow-hidden rounded-full bg-veil/10">
        <div className="absolute inset-y-0 left-0 rounded-full bg-accent" style={{ width: `${Math.min(actualPct, 100)}%` }} />
        <div
          className="absolute inset-y-0 w-0.5 bg-veil/70"
          style={{ left: `calc(${Math.min(expectedPct, 100)}% - 1px)` }}
          title={`Expected today: ${expectedPct.toFixed(0)}%`}
        />
      </div>
      <div className="mt-1.5 flex justify-between text-[11px] text-ink-muted">
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

/** One weekday's study-hours stepper. Shared by onboarding-era timing + /timing. */
export function DayColumn({
  label,
  hours,
  onStep,
}: {
  label: string;
  hours: number;
  onStep: (delta: number) => void;
}) {
  const active = hours > 0;
  return (
    <motion.div
      whileHover={{ y: -4 }}
      transition={{ type: "spring", stiffness: 320, damping: 24 }}
      className={`ob-glass flex h-52 flex-col items-center rounded-3xl px-2 py-4 ${active ? "" : "opacity-60"}`}
    >
      <span className="text-sm font-semibold text-ink">{label}</span>
      <div className="mt-auto flex flex-col items-center gap-2">
        <button
          className="ob-btn h-8 w-8 rounded-full text-lg leading-none"
          onClick={() => onStep(0.5)}
          aria-label={`Add time on ${label}`}
        >
          +
        </button>
        <motion.span key={hours} initial={{ scale: 1.25 }} animate={{ scale: 1 }} className="text-2xl font-bold tnum">
          {active ? hours : "—"}
        </motion.span>
        <span className="text-[11px] uppercase tracking-wide text-ink-muted">{active ? "hours" : "rest"}</span>
        <button
          className="ob-btn h-8 w-8 rounded-full text-lg leading-none disabled:opacity-30"
          onClick={() => onStep(-0.5)}
          disabled={!active}
          aria-label={`Remove time on ${label}`}
        >
          −
        </button>
      </div>
    </motion.div>
  );
}
