# GoalAssist — Project State (handoff)

_Last updated: 2026-07-28. Read this first when resuming work._

## ⏭️ Next session (resume here)

**The dark re-skin is complete — every page** (onboarding, `/`, `/today`,
`/timing`, `/calendar`, `/missions/[id]`, `/missions/new`, `/settings`,
`/login`, nav pages) uses the dark aurora + glassmorphism system. The old light
chrome (`components/nav.tsx`, `components/ui.tsx`, light layout header) is
deleted. Shared dark chrome: `frontend/src/components/darkchrome.tsx`
(`DarkShell`, `DarkNav`, `DarkStatusBadge`, `DarkTrajectoryBar`, `DayColumn`);
tokens under `.ob-*` in `globals.css`. No native browser dialogs remain —
"did more/less" (`/today`), material "update" and mission delete
(`/missions/[id]`) are inline glass panels. The dev "Load a demo" testing
button was removed by owner request. All on branch `onboarding-flow` → **PR #1**
(not merged to main).

Since then (2026-07-28, second pass): `/calendar` defaults to a **week view**
(7 full day columns, all tasks visible, week nav) with a month-view toggle;
**light mode is live** (DarkNav toggle, `goalassist_theme` in localStorage,
`html[data-theme="light"]` + an invert/hue-rotate rule in `globals.css`);
"Connect your calendar" copy is now **"Design your schedule"** (nothing ever
connected a calendar); **all dev accounts were wiped** from `acadassist.db`.

Open items:
- **Empty day-one daily.** A fresh mission with sparse cadence (e.g. 32 units /
  91 days) schedules the first task a few days out via cumulative rounding, so a
  brand-new user can land on "Nothing scheduled today" right after onboarding —
  undercuts the "heart of the product" moment. Decide: front-load day 1 / ensure
  ≥1 task on creation vs. leave the honest spacing.
- **Mobile responsiveness pass** — students live on phones; the glass pages are
  desktop-first (calendar grids + materials rows are the tight spots).

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
1. Empty/loading/error states, mobile responsiveness pass (students live on
   phones; current UI is desktop-first).
2. Milestone 2 "Trusted": explain schedule *changes*, not just today's tasks.
3. Deploy for 10 users: env secrets (`ACADASSIST_SECRET`), SQLite→Postgres,
   HTTPS, error logging, backups; per-user timezone handling.
4. Watch 10 users create a mission; every >5s hesitation is a UX bug.

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
