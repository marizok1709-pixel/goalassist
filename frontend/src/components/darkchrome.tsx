"use client";

import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { useEffect, useState } from "react";
import { motion } from "motion/react";
import { clearToken, getToken } from "@/lib/api";

// Marketing nav from the Figma — now functional (each links to a real page).
// "light mode" stays an inert placeholder for now (theme toggle comes later).
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

  useEffect(() => {
    // Token lives in localStorage (client-only), so it can only be read after
    // mount — deliberate, mirrors the app's other auth-aware nav.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setAuthed(getToken() !== null);
  }, [pathname]);

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
        <span className="cursor-default text-white/80">light mode</span>
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
