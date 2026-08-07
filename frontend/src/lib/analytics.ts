/**
 * Product analytics.
 *
 * Two rules shape this file:
 *
 * 1. **Nothing leaves the browser without consent.** The queue is dropped, not
 *    buffered, while consent is absent — so a later opt-in cannot retroactively
 *    ship what someone did before they agreed. The server enforces the same
 *    rule independently; this is the polite half of the pair, not the only one.
 *
 * 2. **The sink is swappable.** Everything the app calls goes through
 *    `analytics.track()`. Moving to PostHog/Plausible/whatever later means
 *    writing one `AnalyticsSink` and changing one line in `configureAnalytics`,
 *    not touching call sites.
 *
 * Context is deliberately coarse — device class rather than a user-agent
 * string, viewport width rather than a fingerprintable screen profile, no IP
 * (the server reads a country code from the edge), referrer host only.
 */

const API_URL = process.env.NEXT_PUBLIC_API_URL ?? "http://localhost:8000";

/** Names must also exist in the backend allow-list or they are dropped there. */
export type EventName =
  | "page_view"
  | "session_start"
  | "session_end"
  | "onboarding_step"
  | "onboarding_complete"
  | "mission_created"
  | "mission_completed"
  | "mission_deleted"
  | "material_added"
  | "material_edited"
  | "material_removed"
  | "task_completed"
  | "task_logged"
  | "borrow_tomorrow"
  | "availability_saved"
  | "theme_changed"
  | "feature_used"
  | "api_failure"
  | "client_error"
  | "web_vitals";

/** Only small scalars. Anything identifying is a bug — see PRIVACY.md. */
export type EventProps = Record<string, string | number | boolean>;

export interface AnalyticsEvent {
  name: EventName;
  props?: EventProps;
  path?: string;
}

export interface EventContext {
  session_id: string;
  device: "mobile" | "tablet" | "desktop";
  browser: string;
  viewport_w: number;
  language: string;
  referrer?: string;
}

/** Implement this to send events somewhere else. */
export interface AnalyticsSink {
  send(events: AnalyticsEvent[], context: EventContext): Promise<void> | void;
}

/** Default sink: our own backend. No third party, no cookies. */
export class HttpSink implements AnalyticsSink {
  constructor(private readonly url = `${API_URL}/analytics/events`) {}

  async send(events: AnalyticsEvent[], context: EventContext) {
    const body = JSON.stringify({ ...context, events });
    // sendBeacon survives the page being closed, which is the only way
    // session_end ever arrives. It cannot set an Authorization header, so
    // logged-in sends fall back to fetch with keepalive.
    const token = getToken();
    if (!token && typeof navigator !== "undefined" && navigator.sendBeacon) {
      navigator.sendBeacon(this.url, new Blob([body], { type: "application/json" }));
      return;
    }
    await fetch(this.url, {
      method: "POST",
      keepalive: true,
      headers: {
        "Content-Type": "application/json",
        ...(token ? { Authorization: `Bearer ${token}` } : {}),
      },
      body,
    }).catch(() => {
      // Analytics must never surface an error into the product.
    });
  }
}

/** For tests and local development. */
export class ConsoleSink implements AnalyticsSink {
  send(events: AnalyticsEvent[]) {
     
    console.debug("[analytics]", events.map((e) => e.name).join(", "));
  }
}

export class NoopSink implements AnalyticsSink {
  send() {}
}

/* -------------------------------------------------------------------------- */

const CONSENT_KEY = "goalassist_consent";
const SESSION_KEY = "goalassist_session";
const FLUSH_MS = 10_000;
const MAX_QUEUE = 40;

function getToken(): string | null {
  if (typeof window === "undefined") return null;
  try {
    return localStorage.getItem("acadassist_token");
  } catch {
    return null;
  }
}

export type ConsentState = "granted" | "denied" | "unset";

export function getConsent(): ConsentState {
  if (typeof window === "undefined") return "unset";
  try {
    const v = localStorage.getItem(CONSENT_KEY);
    return v === "granted" || v === "denied" ? v : "unset";
  } catch {
    return "unset";
  }
}

/**
 * A session id that identifies a *visit*, not a person: random, stored in
 * sessionStorage, gone when the tab closes. Never derived from anything about
 * the user, so it cannot be correlated across days or devices.
 */
function getSessionId(): string {
  try {
    const existing = sessionStorage.getItem(SESSION_KEY);
    if (existing) return existing;
    const id =
      typeof crypto !== "undefined" && crypto.randomUUID
        ? crypto.randomUUID()
        : `s-${Math.random().toString(36).slice(2)}${Date.now().toString(36)}`;
    sessionStorage.setItem(SESSION_KEY, id);
    return id;
  } catch {
    return "no-storage-session";
  }
}

function deviceClass(width: number): EventContext["device"] {
  if (width < 640) return "mobile";
  if (width < 1024) return "tablet";
  return "desktop";
}

/** Coarse browser family. Deliberately not the full user-agent string. */
function browserFamily(ua: string): string {
  if (/Edg\//.test(ua)) return "edge";
  if (/OPR\//.test(ua)) return "opera";
  if (/Chrome\//.test(ua)) return "chrome";
  if (/Safari\//.test(ua) && !/Chrome/.test(ua)) return "safari";
  if (/Firefox\//.test(ua)) return "firefox";
  return "other";
}

class Analytics {
  private sink: AnalyticsSink = new HttpSink();
  private queue: AnalyticsEvent[] = [];
  private timer: ReturnType<typeof setInterval> | null = null;
  private started = false;

  configure(sink: AnalyticsSink) {
    this.sink = sink;
  }

  private context(): EventContext {
    const width = window.innerWidth || 0;
    return {
      session_id: getSessionId(),
      device: deviceClass(width),
      browser: browserFamily(navigator.userAgent || ""),
      viewport_w: width,
      language: (navigator.language || "").slice(0, 12),
      // Own-origin referrers say nothing useful and only add noise.
      referrer:
        document.referrer && !document.referrer.startsWith(location.origin)
          ? document.referrer
          : undefined,
    };
  }

  /** Records an event if — and only if — consent has been granted. */
  track(name: EventName, props?: EventProps, path?: string) {
    if (typeof window === "undefined") return;
    if (getConsent() !== "granted") return; // dropped, never buffered

    this.queue.push({
      name,
      props,
      path: path ?? location.pathname,
    });
    if (this.queue.length >= MAX_QUEUE) this.flush();
    this.ensureTimer();
  }

  private ensureTimer() {
    if (this.timer || typeof window === "undefined") return;
    this.timer = setInterval(() => this.flush(), FLUSH_MS);
  }

  flush() {
    if (!this.queue.length) return;
    const events = this.queue.splice(0, MAX_QUEUE);
    try {
      this.sink.send(events, this.context());
    } catch {
      // never throw into the product
    }
  }

  /** Wire up lifecycle flushing. Safe to call more than once. */
  start() {
    if (this.started || typeof window === "undefined") return;
    this.started = true;
    // visibilitychange is the reliable "page is going away" signal on mobile;
    // pagehide covers bfcache navigations.
    document.addEventListener("visibilitychange", () => {
      if (document.visibilityState === "hidden") this.flush();
    });
    window.addEventListener("pagehide", () => this.flush());
  }

  /** Drop anything queued — used the moment consent is withdrawn. */
  clear() {
    this.queue = [];
  }
}

export const analytics = new Analytics();

/** Swap the destination in one place. */
export function configureAnalytics(sink: AnalyticsSink) {
  analytics.configure(sink);
}

export function setConsent(state: Exclude<ConsentState, "unset">) {
  try {
    localStorage.setItem(CONSENT_KEY, state);
  } catch {
    /* storage unavailable — treated as no consent */
  }
  if (state === "denied") analytics.clear();
}
