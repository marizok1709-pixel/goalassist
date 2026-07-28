"use client";

import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { useEffect, useState } from "react";
import { motion } from "motion/react";
import { clearToken, getToken, TrajectoryStatus } from "@/lib/api";

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
  const [theme, setTheme] = useState<"dark" | "light">("dark");

  useEffect(() => {
    // Token lives in localStorage (client-only), so it can only be read after
    // mount — deliberate, mirrors the app's other auth-aware nav.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setAuthed(getToken() !== null);
  }, [pathname]);

  useEffect(() => {
    // Theme is also client-only state; re-applying on mount keeps every page
    // consistent after a hard navigation.
    const saved = localStorage.getItem("goalassist_theme") === "light" ? "light" : "dark";
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setTheme(saved);
    document.documentElement.dataset.theme = saved;
  }, []);

  function toggleTheme() {
    const next = theme === "dark" ? "light" : "dark";
    setTheme(next);
    localStorage.setItem("goalassist_theme", next);
    document.documentElement.dataset.theme = next;
  }

  function logout() {
    clearToken();
    router.push("/onboarding");
  }

  return (
    <div className="flex flex-wrap items-center justify-between gap-x-6 gap-y-3 px-8 py-6 text-sm font-medium text-white/80">
      <div className="flex flex-wrap items-center gap-x-6 gap-y-2">
        {MARKETING.map((m) => (
          <Link key={m.href} href={m.href} className="transition-colors hover:text-white">
            {m.label}
          </Link>
        ))}
      </div>
      <div className="flex items-center gap-5">
        {authed && (
          <nav className="flex items-center gap-5 text-white/65">
            <Link href="/" className="transition-colors hover:text-white">
              dashboard
            </Link>
            <Link href="/today" className="transition-colors hover:text-white">
              today
            </Link>
            <Link href="/calendar" className="transition-colors hover:text-white">
              calendar
            </Link>
            <button onClick={logout} className="transition-colors hover:text-white">
              logout
            </button>
          </nav>
        )}
        <button onClick={toggleTheme} className="text-white/80 transition-colors hover:text-white">
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
  AHEAD: { label: "AHEAD", icon: "▲", cls: "text-emerald-300" },
  ON_TRACK: { label: "ON TRACK", icon: "●", cls: "text-emerald-300" },
  AT_RISK: { label: "AT RISK", icon: "◆", cls: "text-amber-300" },
  OFF_TRACK: { label: "OFF TRACK", icon: "✕", cls: "text-red-300" },
  FAILED: { label: "DEADLINE MISSED", icon: "✕", cls: "text-red-300" },
  COMPLETED: { label: "COMPLETE", icon: "✓", cls: "text-emerald-300" },
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
      <span className="text-sm font-semibold text-white">{label}</span>
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
        <span className="text-[11px] uppercase tracking-wide text-white/50">{active ? "hours" : "rest"}</span>
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
