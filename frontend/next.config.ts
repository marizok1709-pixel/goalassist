import type { NextConfig } from "next";

/**
 * Security response headers.
 *
 * A third-party scan graded the deployed site D — every header below except
 * Strict-Transport-Security (which Vercel adds) was missing. These close that.
 *
 * The CSP is deliberately the "keep static rendering" variant: nonce-based CSP
 * in this Next version forces every page to dynamic rendering (no static
 * generation, no CDN cache), which is not worth it for the beta. `script-src`
 * therefore allows 'unsafe-inline' — React's output escaping remains the real
 * XSS defense (verified inert in the break-test), and this keeps Next's own
 * inline hydration scripts and the pre-paint theme script working.
 *
 * `connect-src` MUST list the API origin or every fetch and the analytics
 * beacon break. It is derived from the same env var the client is built with,
 * so it can never drift from where the app actually calls.
 */

// e.g. "https://goalassist-api.vercel.app" or "http://localhost:8000"
const API_URL = process.env.NEXT_PUBLIC_API_URL ?? "http://localhost:8000";
let apiOrigin = "http://localhost:8000";
try {
  apiOrigin = new URL(API_URL).origin;
} catch {
  // keep the localhost fallback
}

const isDev = process.env.NODE_ENV === "development";

const csp = [
  "default-src 'self'",
  // 'unsafe-eval' only in dev — React uses eval for its error overlay there.
  `script-src 'self' 'unsafe-inline'${isDev ? " 'unsafe-eval'" : ""}`,
  "style-src 'self' 'unsafe-inline'", // Tailwind + motion write inline styles
  "img-src 'self' data: blob:",
  "font-src 'self'",
  `connect-src 'self' ${apiOrigin}`, // API calls + analytics beacon
  "object-src 'none'",
  "base-uri 'self'",
  "form-action 'self'",
  "frame-ancestors 'none'", // clickjacking (modern equivalent of X-Frame-Options)
  "upgrade-insecure-requests",
].join("; ");

const securityHeaders = [
  { key: "Content-Security-Policy", value: csp },
  // Explicit X-Frame-Options too: some scanners check it by name, and older
  // browsers don't honour frame-ancestors.
  { key: "X-Frame-Options", value: "DENY" },
  { key: "X-Content-Type-Options", value: "nosniff" },
  // Send only the origin cross-site; aligns with the product's privacy stance.
  { key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },
  // Deny powerful features the app never uses.
  { key: "Permissions-Policy", value: "camera=(), microphone=(), geolocation=(), interest-cohort=()" },
];

const nextConfig: NextConfig = {
  // Don't advertise the framework/version.
  poweredByHeader: false,
  async headers() {
    return [{ source: "/:path*", headers: securityHeaders }];
  },
};

export default nextConfig;
