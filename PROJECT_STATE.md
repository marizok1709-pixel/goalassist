# GoalAssist — Project State (handoff)

_Last updated: 2026-07-28. Read this first when resuming work._

## ⏭️ Next session (resume here) — owner-set priorities

1. **Timezones.** All dates are currently server-local; per-user timezone
   handling is required before friends in different cities use it (a task that
   flips at the server's midnight, not the user's, breaks the "today" promise).
   Includes the known frontend inconsistency: `missions/[id]` marks TODAY via
   UTC (`toISOString`) while `/calendar` uses local time.
2. **Bug fix** — work the 2026-07-28 code-review list (details in the session
   log below). Priority order inside this item: (a) calendar detail panel
   claims "rest day" for selected days outside the fetched range; (b)
   week↔month toggle snaps back to the last-clicked day's period; (c) no auth
   guard on `/missions/new` → build one shared authed shell instead of per-page
   copies; (d) light-mode dark flash on hard load + default 404 ignores theme
   (pre-paint inline script + `not-found.tsx`); (e) redundant calendar
   refetches / loading flash; (f) silent delete/save failures on mission
   detail; (g) `next-env.d.ts` dev/build churn.
3. **Proper data collection.** Minimal funnel instrumentation for the beta:
   who finished onboarding, day-2/day-7 return, last-seen page — DB queries or
   a tiny events table; no analytics SaaS at 10 users.
4. **Deploy.** Env secrets (`ACADASSIST_SECRET`), SQLite→Postgres, HTTPS,
   error logging, backups (Railway or similar). Then the 10-friend beta.

Backlog (agreed 2026-07-28 vision discussion, after the four above): day-one
task guarantee (fresh sparse mission can show "Nothing scheduled today" —
front-load ≥1 task on creation day), daily email reminder (the retention
lever), mobile-web responsiveness pass + PWA manifest (no native apps —
web-first, retention target 50% weekly over 30 days with 10 users decides
everything), Milestone 2 (explain schedule changes). Premium is deferred until
retention is proven; sketch: free = 1 active mission, premium = unlimited,
never paywall the trajectory math, student pricing ~€3–4/mo, no ads ever.

## 📋 Session log 2026-07-28

Shipped (commits `6cdd7c0`, `8956874` on `onboarding-flow` → PR #1):
- **Dark re-skin completed** across the whole app (mission detail, new
  mission, calendar, settings, login); light chrome (`nav.tsx`, `ui.tsx`,
  light layout header) deleted; `DarkStatusBadge`/`DarkTrajectoryBar` moved
  into `darkchrome.tsx`.
- **Every native browser dialog replaced** with inline glass editors
  ("did more/less" on `/today`; material update + delete confirm on
  `/missions/[id]`).
- Dev "Load a demo (testing)" button removed (owner request).
- **Calendar week view** (new default; 7 full day columns, week nav) with
  month-view toggle.
- **Light mode live**: DarkNav toggle, `goalassist_theme` in localStorage,
  `html[data-theme=light] .ob-root { filter: invert(1) hue-rotate(180deg) }`.
- Copy: "Connect your calendar" → **"Design your schedule"** (nudge + /timing).
- **All accounts wiped** from `acadassist.db` (fresh start pre-beta).
- Verified end-to-end with headless Chrome both rounds (15 + 12 checks).
- **/code-review (high, 8 angles + verification) run on the branch**: 10
  findings (9 CONFIRMED, 1 PLAUSIBLE) — now item 2 above. Also refuted:
  `/today` log editor cannot double-submit (closes synchronously);
  settings/calendar logged-out redirect to `/onboarding` is the documented
  funnel decision, not a regression. Below-cap cleanup noted for later:
  duplicated inline editors / loading placeholders / launch screens /
  `glassInput` + `DAYS` constants; dead light `@theme` tokens with a stale
  comment; three-state calendar anchor.

## One-liner

**GoalAssist turns academic deadlines into daily certainty.** A student creates a
Mission with a hard deadline and real materials; the system slices the work,
schedules it around their weekly availability, and tells them bluntly — with
math, not vibes — whether their current pace will make the deadline, and what
exactly to do today. No AI anywhere; the credibility comes from explainable
arithmetic. (Former names: AcadAssist, Life.exe — repo dir is still `acadassist`.)

## Status: pre-beta

The engine is feature-frozen by decision of the product owner. Remaining work is
clarity, speed, trust, beauty, then deployment to exactly 10 test users
(success = 50%+ weekly retention over 30 days).

## How to run

```bash
# backend  (FastAPI + SQLite, port 8000; docs at /docs)
cd backend && .venv/bin/uvicorn app.main:app --reload --port 8000
# frontend (Next.js 16 + Tailwind v4, port 3000)
cd frontend && npm run dev
# tests (24 end-to-end checks, throwaway DB)
cd backend && .venv/bin/python smoke_test.py
```

Demo login: `demo@acadassist.app` / `demo1234` (seed script pattern lives in
past session notes; reseed by re-registering and creating a mission).

## Architecture

```
Goal (mission, deadline, start_date)
 └─ Material (name, total_quantity, unit, no user-facing chunking)
     └─ ProgressUnit  — WHAT exists  (auto-sliced: continuous units → 1 running
        amount; countable ≤100 integer pieces → 1 unit per piece)
         └─ ScheduledTask — WHEN it happens (Schedule Engine output, dated)
```

- **Schedule Engine** (`backend/app/services/engine.py`): distributes remaining
  work from a start date through the deadline (inclusive), weighted by the
  user's weekly availability (hours per weekday; 0h = rest day = no tasks).
  Cumulative rounding spaces slow-cadence materials (exams) evenly. Rebuilds
  delete the incomplete future and redistribute; today's plan stays fixed once
  worked on; missed past tasks are kept as honest history.
- **Reality Engine** (same file): expected progress is linear start→deadline;
  overall progress = mean of per-material completion %. trajectory = actual/expected:
  ≥1.05 AHEAD, ≥0.9 ON_TRACK, ≥0.7 AT_RISK, else OFF_TRACK; FAILED past
  deadline; COMPLETED at 100%. `days_behind` feeds the "you are N days behind"
  copy. **No CALIBRATING state** — starting point (start date + per-material
  already-completed) is collected at mission creation, so day-one trajectory is
  honest. All dates are **server-local** (UTC bug fixed 2026-07-19).
- **Adaptive completion**: completing a task can log `actual_quantity`;
  overshoot cascades into later units and the response carries the message
  ("Nice — 8 pages ahead of plan. I've reduced the rest of your week.").
- **Borrow tomorrow's work** (`POST /today/more`): moves each mission's next
  scheduled day into today. One call = one day.

## API map (backend/README.md has the full table)

Auth: register/login/me (JWT, PBKDF2). `PATCH /auth/me` with `availability`
rebuilds all schedules. Goals + materials CRUD; `PATCH .../materials/{id}` sets
absolute progress ("I'm on page 120"). `/goals/{id}/plan` (pace + reality),
`/goals/{id}/schedule`, `/goals/{id}/history`, `/today` (tasks carry a computed
`why` string), `/today/more`, `PATCH /tasks/{id}`, `/calendar?start&end`,
`/dashboard`.

## Frontend pages (all client components, JWT in localStorage)

All pages share the dark aurora + glassmorphism design language.

- `/onboarding` — **conversational first-run flow** (`motion/react` transitions).
  welcome → register → goal → deadline → materials → how-far → building →
  launch → `/today`. Entry points funnel here: logged-out `/` redirects here;
  old `/register` redirects here. Built to `designs/*.png`.
- `/` Command Center — one dominant trajectory %, status badge, message,
  bar with expected-tick, TODAY'S MOVE + START; other missions as small cards.
- `/today` — execution only: tasks w/ checkbox, **Why?** toggle, "did more/less"
  logging (inline glass panel, not a browser prompt), overshoot flash banner,
  Day Complete card with consequence-based praise ladder (4 tiers by tasks
  done) + "Borrow tomorrow's work".
- `/calendar` — in-app calendar (Google Calendar was explicitly rejected).
  Defaults to a **week view** (7 day columns, every task visible, done counter)
  for planning the week you're in; toggle to the month grid. Today circled,
  missed = red, done = struck, day-detail panel under both views.
- `/missions/new` — single-page wizard (title/category/started/deadline +
  materials with "Done" starting point) → **Mission Launch** moment (serif
  title, big day-count, "you'll need", Start today →).
- `/missions/[id]` — glass stat tiles, materials/pace rows with inline "update"
  editor, Next-14-days schedule, History (incl. missed), inline delete confirm.
- `/settings` — profile + weekly availability (save = reschedule everything).

## Design system (current implementation)

**Dark aurora + glassmorphism everywhere**: aurora radial-gradient background,
glass fields (`.ob-glass`), glass buttons (`.ob-btn`), bold sans type, white
text at opacity steps (white → /85 → /70 → /50 → /45), status colors
emerald-300 / amber-300 / red-300, `tnum` class for aligned numerals. Status is
never color-alone (icon + label always). **Light mode** = whole-app inversion
(`html[data-theme="light"] .ob-root { filter: invert(1) hue-rotate(180deg) }`),
toggled from DarkNav, stored as `goalassist_theme`. The old light-editorial
`@theme` tokens in `globals.css` are unused legacy kept for a possible real
light redesign.

## Product rules (owner decisions — do not regress)

1. No user-facing "chunks" — slicing is internal, always automatic.
2. Praise shows consequences, not cheerleading (top tiers keep the
   beast/Kobe lines).
3. Every recommendation must be explainable → task `why` strings; extend to
   schedule-change explanations (Milestone 2).
4. No ads. No Google Calendar. No AI until the loop retains users.
5. Feature freeze on the engine; polish > features.

## Known gaps / next steps (agreed roadmap)

- [x] **Conversational onboarding** — DONE (branch `onboarding-flow`, PR #1).
  Dark/glass, `motion/react` transitions. Also serves as the landing page
  (welcome screen). Availability now collected in-flow.
- [x] `git init` + version control — DONE (commit `8c3d490`); GitHub remote
  `marizok1709-pixel/goalassist`.
- [x] **Re-skin the whole app to the dark onboarding look** — DONE 2026-07-28
  (core loop 07-27; calendar/mission detail/new-mission/settings/login 07-28).
Current priorities live in "Next session" at the top (owner-set 2026-07-28:
timezones → bug fix → data collection → deploy, then the beta). Standing
principle for the beta: watch users create a mission; every >5s hesitation is
a UX bug. Milestone 2 "Trusted" (explain schedule *changes*) stays on the
backlog after the beta launches.

## Design direction (as of 2026-07-28)

The **dark/aurora/glassmorphism** system (bold sans, glass fields, `motion/react`
transitions, tokens under `.ob-*` in `globals.css`, shared chrome in
`components/darkchrome.tsx`, Figma exports in `designs/`) now covers **every
page**. The light editorial theme is retired from the UI; its tokens stay in
`globals.css` only for the future light-mode toggle. New deps: `motion`.

## Verification habits

`backend/smoke_test.py` is the source of truth for engine behavior (24 checks:
auto-slicing, schedule totals/spacing, availability weighting incl. 0-hour days,
starting point, adaptive overshoot, borrow, why, calendar, auth isolation).
UI is verified with headless Chrome via puppeteer-core against the running app —
but never click-test against a demo DB you care about (it pollutes state; it
burned us once).
