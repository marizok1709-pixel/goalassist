# Changelog

All notable changes to Goal Assist, newest first. Dates are yyyy-mm-dd.
This is a pre-beta product; entries focus on user-visible behaviour and notable
engineering decisions. Deeper resume context lives in `PROJECT_STATE.md`.

## 2026-08-05 — security response headers

A third-party header scan graded the deployed frontend **D** (only
Strict-Transport-Security present). Added the five missing headers in
`frontend/next.config.ts`:

- **Content-Security-Policy** — the "keep static rendering" variant. Nonce-based
  CSP in this Next version forces every page to dynamic rendering (no static
  generation / CDN cache), not worth it at beta scale, so `script-src` allows
  `'unsafe-inline'`; React's escaping stays the real XSS defense (break-test
  confirmed inert). `connect-src` is derived from `NEXT_PUBLIC_API_URL` so it
  can't drift from where the app actually calls.
- **X-Frame-Options: DENY**, **X-Content-Type-Options: nosniff**,
  **Referrer-Policy: strict-origin-when-cross-origin**,
  **Permissions-Policy** (camera/mic/geolocation/interest-cohort off).
- `poweredByHeader: false` drops the `X-Powered-By` giveaway.

Verified against a local production build: all five headers emitted, static
rendering preserved, and the whole app works under the CSP with zero console
violations (login, all seven `/admin/*` calls, inline theme script, inline SVG
charts, halftone burst). A+ isn't reached because of `script-src 'unsafe-inline'`
— a deliberate, documented trade for keeping static rendering.

## 2026-08-04 (later still) — adversarial testing + numeric hardening

Ran ~60 adversarial probes across auth, authorization, IDOR, JWT, consent, PII,
GDPR, input boundaries and XSS. Everything security-critical held; the only real
bugs were a cluster of numeric-input crashes, all now fixed.

### Fixed
- **`total_quantity: 1e308` → 500.** The value passed the `>0` check, reached the
  schedule engine, and `round(1e308 × weight)` overflowed to infinity
  (`OverflowError`). Quantity fields are now bounded (`le=1_000_000`).
- **`NaN`/`Infinity` handling.** NaN turned a clean 422 into a 500 because
  FastAPI's error body echoes the offending value and JSON can't encode NaN;
  Infinity slipped past `>0` and created a material with infinite quantity. All
  quantity fields now set `allow_inf_nan=False`, and a global
  `RequestValidationError` handler stringifies any non-serialisable leaf (a
  non-finite float *or* a raised validator exception) so a bad value can never
  produce a 500.
- **Unbounded deadline.** A year-9999 deadline made each schedule rebuild loop
  over millions of days (~tens of seconds of CPU). Deadlines are now capped at
  30 years out on both create and update. (Row count was already bounded by
  quantity, so this was CPU-only, not a row explosion.)
- New suite `backend/smoke_test_hardening.py` (16 checks). Re-running the full
  adversarial battery against the fix: 0 findings, 43 defenses held.

### Added
- `backend/make_admin.py` — the only way to grant/revoke `is_admin` (no API path
  can set it). The nav shows an `/admin` link for operators only (cosmetic; the
  server 404s the routes for everyone else regardless).

## 2026-08-04 (later) — redesign, analytics, GDPR, admin dashboard

### Added
- **Design system.** One semantic token layer drives both themes: light =
  "Burnt sienna", dark = "Stormy morning". Light mode's old
  `filter: invert(1) hue-rotate(180deg)` is gone — that inversion was why it
  looked wrong. 300 hardcoded colour utilities swapped across 15 files; a
  pre-paint theme script kills the flash on hard load.
- **Halftone burst background** rebuilt in CSS (not the source PNG) so it
  re-colours from tokens; follows the cursor on desktop only, via CSS variables
  in a rAF loop that parks when idle.
- **Analytics** (`lib/analytics.ts`): provider-swappable sink, typed event
  names, batching, lifecycle flush. Backend `analytics_events` table with a
  server-side event allow-list and prop sanitisation.
- **GDPR controls**: strict opt-in consent banner, settings panel for consent /
  export / deletion, `GET /me/export`, `DELETE /me`, `PUT /me/consent`,
  180-day retention purge. See `PRIVACY.md`.
- **Admin dashboard** at `/admin`: user metrics, activity charts, sessions,
  feature usage, cohort retention, infrastructure, finance. Backed by seven
  `/admin/*` endpoints behind an `is_admin` flag that no API path can set.
  Charts are hand-rolled SVG reading the design tokens — no chart dependency.
- **Finance data model** (`transactions`). No billing exists yet, so the
  dashboard reports genuine zeros from live queries rather than placeholders.
- New suites: `smoke_test_privacy.py` (39 checks), `smoke_test_admin.py` (62).

### Fixed
- `create_all()` never alters an existing table, so new columns would have
  silently never appeared on production Neon. `app/migrate.py` applies additive
  columns idempotently at startup.
- Chart palette failed accessibility validation (two hues 8.7 ΔE apart —
  indistinguishable even with normal colour vision). Re-derived; both themes now
  pass lightness band, chroma floor, CVD separation, and contrast.
- Duplicated UI primitives consolidated into `components/ui.tsx` (six copies of
  the loading block, two `DAYS`, two `glassInput`).

## 2026-08-04

First two bugs reported by the first real beta user, both fixed.

### Fixed
- **Book names were saved with their words in reverse order.** The user typed
  "Klara and Sun" and got "sun and Klara" — stored that way in the database, so
  it was wrong everywhere (today, calendar, mission detail). Cause: onboarding's
  step animation left `filter: blur(0px)` on the container permanently. That is
  not `filter: none`, so the whole step stayed in a composited layer, and
  Chromium on Android then hands the on-screen keyboard a wrong cursor anchor —
  each word Gboard commits lands at offset 0, prepending word by word. The
  filter is now cleared once the step settles (`transitionEnd`). Only mobile
  users could hit this, which is why it survived desktop testing.
- **Hardened every free-text field against the same class of bug.** New
  `components/textfield.tsx`: seeds the DOM node with `defaultValue` and only
  mirrors changes *out* to React state, so React never writes a value back into
  a field mid-composition (the other known way to corrupt Android IME state).
  Material rows now carry stable ids instead of array-index keys.
- **Silent save/delete failures on mission detail** now surface an error line
  instead of doing nothing (part of the 2026-07-28 review list).

### Added
- **Materials can be changed after the mission is created.** They were
  write-once: a name typed during onboarding was permanent, which is exactly
  what the first user got stuck with. Mission detail now has, per material,
  an `edit` panel (name / total / unit) and `remove material` with an inline
  confirm, plus `+ add material` for the mission as a whole.
  - New endpoint `PUT /goals/{goal_id}/materials/{material_id}` (schema
    `MaterialEdit`; all fields optional). Renaming keeps the existing progress
    units, so completion history survives and unit titles are re-derived.
    Changing the amount or the unit re-slices the material, carries the
    completed amount over (clamped to the new total), and keeps completed past
    tasks as history by unlinking rather than deleting them.
  - `api.editMaterial` and the previously missing `api.deleteMaterial`.
  - New suite `backend/smoke_test_material_edit.py` (25 checks).

## 2026-08-03

### Added
- **First production deployment.** Frontend live at
  `https://goalassist.vercel.app`; a new, separate FastAPI backend project
  (`goalassist-api`) live at `https://goalassist-api.vercel.app`, backed by a
  Neon serverless Postgres database. Backend env: `DATABASE_URL` (Neon),
  `ACADASSIST_SECRET` (fresh random, no longer the dev default), `CORS_ORIGINS`.
  Frontend now points at the API via `NEXT_PUBLIC_API_URL`.

### Fixed
- **Registration failed immediately in production.** The deployed frontend was
  calling `http://localhost:8000` (no `NEXT_PUBLIC_API_URL` set + no backend
  deployed), so every user's browser hit their own machine. Fixed by deploying
  the backend and setting the env var.
- **Backend 404'd on every route.** `backend/vercel.json`'s catch-all rewrite
  (`/(.*) → /api/index`) broke under Vercel's native FastAPI preset, which now
  routes rewrites by the destination path. Replaced the rewrite with `{}` so the
  preset serves the app directly. *(Working-tree change, not yet committed.)*

### Added (repo)
- `backend/.vercelignore` — keeps the venv and local `*.db` files out of deploys.

## 2026-07-28

### Added
- **Calendar week view (new default).** `/calendar` opens on the current week:
  seven full-height day columns showing *every* task (done struck, missed red),
  a per-day done counter, week ← → navigation, and the same day-detail panel.
  A toggle switches to the classic month grid and back; the selected day
  carries over between views.
- **Light mode.** The nav "light mode" toggle now works: white background,
  black text (implemented as a faithful inversion of the dark system so every
  page flips at once). Persisted in `localStorage`, applied on every page,
  label flips to "dark mode".

### Changed
- **"Connect your calendar" → "Design your schedule."** The dashboard nudge and
  `/timing` never connected any external calendar — the copy now says what the
  feature does.
- **All test accounts wiped** from the dev database (fresh start before beta).
- **Dark re-skin complete.** The last light pages — mission detail
  (`/missions/[id]`), `/missions/new`, `/calendar`, `/settings`, `/login` — now
  use the dark aurora + glassmorphism system. The whole product is one design
  language; the old light-editorial chrome (`components/nav.tsx`,
  `components/ui.tsx`) is deleted and the root layout no longer renders a
  light header.
- **Glass inline editors replace every native browser dialog.** "did more/less"
  on `/today` and "update" on mission detail open an inline glass panel
  (number input + Log it/Save, Enter/Escape work); "Delete mission" shows an
  inline glass confirmation instead of `window.confirm`. No more default
  browser popups anywhere.

### Removed
- **Dev testing button.** The "🧪 Load a demo (testing)" button added earlier
  today is gone again — not needed now that onboarding is fast to click through.

### Fixed
- **Silent failure on mission build.** If creating the goal/materials failed at
  the end of onboarding, the error was cleared by the step navigation and the
  user bounced back to "how far" with no explanation. The error now shows.
- **Unreadable validation errors.** FastAPI 422 responses (e.g. an invalid email)
  rendered as a raw JSON blob. The API client now formats validation messages
  into readable text across every form.

## 2026-07-27

### Added
- **Dark re-skin of the core loop.** Dashboard (`/`) and daily (`/today`) rebuilt
  in the dark aurora + glassmorphism system, matching onboarding. Shared chrome
  in `components/darkchrome.tsx` (`DarkShell`, `DarkNav`, `DayColumn`).
- **`/timing` page.** The weekly-availability ("connect your calendar") setup,
  moved out of onboarding into a standalone dark page. A dashboard nudge points
  here until timing is set.
- **Functional nav.** `policies and data`, `social media`, `support`, `about us`
  now open real pages; `settings` links to the existing page. (`light mode`
  remains an inert placeholder by request.)
- **Apple-style onboarding transitions** via `motion/react`: directional
  cross-fade with blur/scale between steps over a persistent background.

### Changed
- **Onboarding no longer asks about timing.** Students reach the dashboard/daily
  loop first; availability defaults to even weighting until set via `/timing`.
  Flow is now welcome → register → goal → deadline → materials → how-far → launch.

### Fixed
- **"Expected is broken" (day-zero trajectory).** The dashboard hero showed
  `trajectory_ratio × 100`, which pins to 100% on a mission's first day and read
  as "complete". The hero now shows actual progress %, and the engine gives a
  clean day-zero message ("Strong start — N% already done on day one") instead
  of "0% expected".

## 2026-07-26

### Added
- **Conversational onboarding flow** (`/onboarding`), dark/glassmorphism, built to
  the Figma frames in `designs/`. First account path that also (originally)
  collected availability. Entry points funnel here: logged-out `/`, the login
  "Register" link, and the old `/register` route all lead to onboarding.
- First **version control** for the repo; pushed to GitHub
  (`marizok1709-pixel/goalassist`), branch `onboarding-flow` → PR #1.
