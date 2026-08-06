"use client";

import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { useEffect, useState } from "react";
import { AnimatePresence, motion } from "motion/react";
import { api, clearToken, getToken, TrajectoryStatus } from "@/lib/api";
import { analytics } from "@/lib/analytics";

/**
 * App chrome.
 *
 * The nav used to be one `flex-wrap` row holding ten links. On a 360px screen
 * that wrapped into four stacked lines and ate the top third of every page —
 * the defect the first beta user reported. It is now two navigations:
 *
 *   mobile  — a 56px top bar (wordmark · theme · menu) plus a bottom tab bar
 *             carrying the core loop. Thumbs reach the bottom of a phone, not
 *             the top, and dashboard/today/calendar are the only destinations
 *             that matter during a study session.
 *   desktop — the original single row, unchanged. It was never the problem.
 *
 * Everything secondary (policies, support, about, social, settings, admin,
 * logout) sits behind the menu on mobile. Those are read once, not daily.
 */

// Marketing nav from the Figma — now functional (each links to a real page).
const MARKETING: { href: string; label: string }[] = [
  { href: "/policies", label: "policies and data" },
  { href: "/settings", label: "settings" },
  { href: "/social", label: "social media" },
  { href: "/support", label: "support" },
  { href: "/about", label: "about us" },
];

/** The core loop. These three are the bottom tab bar on a phone. */
const PRIMARY: { href: string; label: string; icon: React.ReactNode }[] = [
  { href: "/", label: "Dashboard", icon: <path d="M3 10.5 12 3l9 7.5M5.5 9.5V20h13V9.5" /> },
  {
    href: "/today",
    label: "Today",
    icon: (
      <>
        <path d="M4 6.5h16v14H4zM4 10.5h16M8 3v4M16 3v4" />
        <path d="m9 15 2 2 4-4" />
      </>
    ),
  },
  {
    href: "/calendar",
    label: "Calendar",
    icon: (
      <>
        <path d="M4 6.5h16v14H4zM8 3v4M16 3v4M4 10.5h16" />
        <path d="M8.5 14h2M13.5 14h2M8.5 17.5h2M13.5 17.5h2" />
      </>
    ),
  },
];

function NavIcon({ children, size = 22 }: { children: React.ReactNode; size?: number }) {
  return (
    <svg
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.6"
      strokeLinecap="round"
      strokeLinejoin="round"
      width={size}
      height={size}
      aria-hidden
    >
      {children}
    </svg>
  );
}

export function DarkNav() {
  const pathname = usePathname();
  const router = useRouter();
  const [authed, setAuthed] = useState(false);
  const [isAdmin, setIsAdmin] = useState(false);
  const [theme, setTheme] = useState<"dark" | "light">("dark");
  const [menuOpen, setMenuOpen] = useState(false);

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

  useEffect(() => {
    if (!menuOpen) return;
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && setMenuOpen(false);
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [menuOpen]);

  const themeLabel = theme === "dark" ? "light mode" : "dark mode";

  return (
    <>
      {/* ---------- mobile: compact top bar ---------- */}
      <div className="md:hidden">
        <div className="flex h-14 items-center justify-between gap-2 px-4">
          <Link
            href={authed ? "/" : "/onboarding"}
            className="-my-2 py-2 text-base font-bold tracking-tight text-ink"
          >
            GoalAssist
          </Link>
          <div className="flex items-center gap-1">
            <button
              onClick={toggleTheme}
              aria-label={`Switch to ${themeLabel}`}
              className="grid h-11 w-11 place-items-center rounded-xl text-ink-2 transition-colors hover:text-ink"
            >
              <NavIcon>
                {theme === "dark" ? (
                  <path d="M20 14.5A8.5 8.5 0 1 1 9.5 4a7 7 0 0 0 10.5 10.5Z" />
                ) : (
                  <>
                    <circle cx="12" cy="12" r="4.2" />
                    <path d="M12 2.5v2M12 19.5v2M2.5 12h2M19.5 12h2M5.2 5.2l1.4 1.4M17.4 17.4l1.4 1.4M18.8 5.2l-1.4 1.4M6.6 17.4l-1.4 1.4" />
                  </>
                )}
              </NavIcon>
            </button>
            <button
              onClick={() => setMenuOpen((v) => !v)}
              aria-label={menuOpen ? "Close menu" : "Open menu"}
              aria-expanded={menuOpen}
              aria-controls="ga-menu"
              className="grid h-11 w-11 place-items-center rounded-xl text-ink-2 transition-colors hover:text-ink"
            >
              <NavIcon>
                {menuOpen ? <path d="m6 6 12 12M18 6 6 18" /> : <path d="M4 7h16M4 12h16M4 17h16" />}
              </NavIcon>
            </button>
          </div>
        </div>

        <AnimatePresence>
          {menuOpen && (
            <motion.nav
              id="ga-menu"
              initial={{ opacity: 0, height: 0 }}
              animate={{ opacity: 1, height: "auto" }}
              exit={{ opacity: 0, height: 0 }}
              transition={{ duration: 0.22, ease: [0.22, 1, 0.36, 1] }}
              className="overflow-hidden border-y border-veil/10"
            >
              {/* Any choice inside the menu closes it — a menu left open across a
                  navigation would cover the page it just opened. Handled by
                  delegation rather than an effect on `pathname`, so it also works
                  when the tapped link is the route you are already on. */}
              <div
                onClick={() => setMenuOpen(false)}
                className="flex flex-col px-4 py-2 text-[15px] text-ink-2"
              >
                {MARKETING.map((m) => (
                  <Link key={m.href} href={m.href} className="py-3 transition-colors hover:text-ink">
                    {m.label}
                  </Link>
                ))}
                {isAdmin && (
                  <Link href="/admin" className="py-3 font-semibold text-accent">
                    admin
                  </Link>
                )}
                {authed && (
                  <button onClick={logout} className="py-3 text-left transition-colors hover:text-ink">
                    logout
                  </button>
                )}
              </div>
            </motion.nav>
          )}
        </AnimatePresence>
      </div>

      {/* ---------- desktop: the original row, unchanged ---------- */}
      <div className="hidden flex-wrap items-center justify-between gap-x-6 gap-y-3 px-8 py-6 text-sm font-medium text-ink-2 md:flex">
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
            {themeLabel}
          </button>
        </div>
      </div>
    </>
  );
}

/**
 * Bottom tab bar — mobile only, signed-in only.
 *
 * Fixed to the viewport. `.ob-root` is `position: fixed` but sets no transform,
 * so a fixed child still anchors to the viewport. The safe-area padding keeps
 * the labels clear of the iOS home indicator.
 */
function TabBar() {
  const pathname = usePathname();
  const [authed, setAuthed] = useState(false);

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setAuthed(getToken() !== null);
  }, [pathname]);

  if (!authed) return null;

  return (
    <nav
      aria-label="Primary"
      className="ga-tabbar fixed inset-x-0 bottom-0 z-20 border-t border-veil/10 bg-bg/85 backdrop-blur-lg md:hidden"
    >
      <ul className="flex">
        {PRIMARY.map((item) => {
          const active = pathname === item.href;
          return (
            <li key={item.href} className="flex-1">
              <Link
                href={item.href}
                aria-current={active ? "page" : undefined}
                className={`flex h-full flex-col items-center justify-center gap-1 py-2.5 text-[11px] font-medium transition-colors ${
                  active ? "text-accent" : "text-ink-muted"
                }`}
              >
                <NavIcon>{item.icon}</NavIcon>
                {item.label}
              </Link>
            </li>
          );
        })}
      </ul>
    </nav>
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
      {/* Bottom padding clears the tab bar on mobile; desktop keeps the old
          breathing room since there is no bar to clear. */}
      <main className={`ga-main mx-auto w-full px-4 sm:px-6 md:pb-28 ${width}`}>{children}</main>
      <TabBar />
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
