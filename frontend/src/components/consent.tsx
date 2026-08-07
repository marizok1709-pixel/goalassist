"use client";

import { useEffect, useRef, useState } from "react";
import { usePathname } from "next/navigation";
import Link from "next/link";
import { analytics, getConsent, setConsent, type ConsentState } from "@/lib/analytics";
import { api, getToken } from "@/lib/api";

/**
 * Consent gate + page-view tracking.
 *
 * The banner is genuinely a choice: accept and decline are the same size, the
 * same weight, and neither is preselected. Nothing is collected while the
 * banner is open — declining is not "less tracking", it is none.
 *
 * Mounted once in the root layout so a decision is asked for exactly once and
 * page views are recorded from a single place rather than per page.
 */
export function ConsentGate() {
  const pathname = usePathname();
  const [state, setState] = useState<ConsentState>("unset");
  const [ready, setReady] = useState(false);
  const bannerRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    // localStorage is client-only, so the banner can only be decided post-mount.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setState(getConsent());
     
    setReady(true);
    analytics.start();
  }, []);

  /**
   * Publish the banner's height so layouts can reserve it.
   *
   * It is fixed to the bottom of the viewport, and on a phone that is exactly
   * where a page puts its primary button. At 360x800 it sat on top of the
   * onboarding "Create account" CTA — the tap was landing on the banner, so
   * the funnel's first step was unreachable until a decision was made. The
   * height is measured rather than hardcoded because the copy wraps
   * differently at every width.
   */
  useEffect(() => {
    const root = document.documentElement;
    const el = bannerRef.current;
    if (!el) {
      root.style.setProperty("--ga-consent-h", "0px");
      return;
    }
    const publish = () => root.style.setProperty("--ga-consent-h", `${el.offsetHeight}px`);
    publish();
    const ro = new ResizeObserver(publish);
    ro.observe(el);
    return () => {
      ro.disconnect();
      root.style.setProperty("--ga-consent-h", "0px");
    };
  }, [ready, state]);

  // One page_view per navigation, and only ever after consent.
  useEffect(() => {
    if (state !== "granted" || !pathname) return;
    analytics.track("page_view", undefined, pathname);
  }, [pathname, state]);

  async function decide(next: "granted" | "denied") {
    setConsent(next);
    setState(next);
    // Mirror the decision onto the account when signed in, so it survives a
    // new device and so the server can enforce it independently.
    if (getToken()) {
      await api.setConsent(next === "granted").catch(() => {
        /* the local decision still stands */
      });
    }
    if (next === "granted") analytics.track("session_start");
  }

  if (!ready || state !== "unset") return null;

  return (
    <div
      ref={bannerRef}
      role="dialog"
      aria-label="Analytics consent"
      className="ga-consent fixed inset-x-0 bottom-0 z-[60] px-4 pb-4 sm:px-6 sm:pb-6"
    >
      <div className="ob-glass mx-auto flex max-w-3xl flex-col gap-4 rounded-2xl p-5 sm:flex-row sm:items-center sm:gap-6">
        <div className="flex-1">
          <p className="text-sm font-semibold text-ink">Help us make GoalAssist work?</p>
          <p className="mt-1 text-sm text-ink-2">
            We&apos;d like to record which features get used — never what you write in your
            missions, and never sold or shared. You can change this any time in settings.
          </p>
          <Link
            href="/policies"
            className="mt-0.5 inline-block py-2 text-xs text-ink-muted underline hover:text-ink"
          >
            What we collect
          </Link>
        </div>
        <div className="flex shrink-0 gap-2.5">
          {/* Equal weight on purpose: declining must not be the harder path. */}
          <button
            onClick={() => decide("denied")}
            className="ob-btn-quiet flex-1 rounded-xl px-5 py-2.5 text-sm font-semibold sm:flex-none"
          >
            No thanks
          </button>
          <button
            onClick={() => decide("granted")}
            className="ob-btn-quiet flex-1 rounded-xl px-5 py-2.5 text-sm font-semibold sm:flex-none"
          >
            Sure
          </button>
        </div>
      </div>
    </div>
  );
}
