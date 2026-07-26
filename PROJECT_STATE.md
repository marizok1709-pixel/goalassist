# GoalAssist — Project State (handoff)

_Last updated: 2026-07-27. Read this first when resuming work._

## ⏭️ Next session (resume here)

**Redesign the dashboard (`/`) and daily page (`/today`) to match the new dark
onboarding look**, so the whole app is visually consistent. As of 2026-07-27
onboarding is dark/aurora/glassmorphism (see `/onboarding` + `designs/`) but the
rest of the app is still the light/serif editorial theme — a jarring jump after
"Start today →". Owner (Mark) decided to re-skin the core loop to the dark
system. The reusable dark/glass tokens live under `.ob-*` in `globals.css` and
the `motion/react` transition patterns are in `frontend/src/app/onboarding/page.tsx`.

Onboarding flow itself is **built, verified, pushed** on branch `onboarding-flow`
→ **PR #1** (not yet merged to main).

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

- `/onboarding` — **conversational first-run flow** (dark aurora + glassmorphism,
  `motion/react` transitions). welcome → register → goal → deadline → materials →
  how-far → availability → building → launch → `/today`. The only account path
  that also sets weekly availability. Entry points funnel here: logged-out `/`
  redirects here; old `/register` redirects here. Built to `designs/*.png`.
  (Design language deliberately differs from the light pages below — the core
  loop is slated to be re-skinned to match; see "Next session" up top.)
- `/` Command Center — one dominant trajectory %, status badge, message,
  bar with expected-tick, TODAY'S MOVE + START; other missions as small cards.
- `/today` — execution only: tasks w/ checkbox, **Why?** toggle, "did more/less"
  logging, overshoot flash banner, Day Complete card with consequence-based
  praise ladder (4 tiers by tasks done) + "Borrow tomorrow's work".
- `/calendar` — in-app month grid (Google Calendar was explicitly rejected):
  today circled, chips per day, missed = red, done = struck, day-detail panel.
- `/missions/new` — single-page wizard (title/category/started/deadline +
  materials with "Done" starting point) → **Mission Launch** moment (serif
  title, big day-count, "you'll need", Start today →).
- `/missions/[id]` — stat tiles, materials/pace table with "update" progress,
  Next-14-days schedule, History (incl. missed).
- `/settings` — profile + weekly availability (save = reschedule everything).

## Design system (current implementation; Figma redesign in progress by owner)

Light "Anthropic-inspired" theme, tokens in `frontend/src/app/globals.css`:
page `#fafaf8`, surface `#fff`, line `#e4e3dd`, ink `#191917`/`#52514e`/`#8a887f`,
**primary blue `#2a78d6`** (deep `#1c5cab`, wash `#eaf2fc`), good `#0b8a0b`,
warning `#a16207`, critical `#c93838`. Serif display (Iowan/Georgia stack) for
mission titles + hero numbers; system sans body; `tnum` class for aligned
numerals. Status is never color-alone (icon + label always).

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
1. **Re-skin dashboard (`/`) + daily (`/today`) to the dark onboarding look**
   ← NEXT SESSION. Then extend to `/calendar` and mission detail.
2. Empty/loading/error states, mobile responsiveness pass (students live on
   phones; current UI is desktop-first). Fold into the re-skin.
3. Milestone 2 "Trusted": explain schedule *changes*, not just today's tasks.
4. Deploy for 10 users: env secrets (`ACADASSIST_SECRET`), SQLite→Postgres,
   HTTPS, error logging, backups; per-user timezone handling.
5. Watch 10 users create a mission; every >5s hesitation is a UX bug.

## Design direction (as of 2026-07-27)

Two visual systems currently coexist: the original **light editorial** theme
(warm paper, serif, blue `#2a78d6`) on `/`, `/today`, `/calendar`, mission
detail + settings; and the new **dark/aurora/glassmorphism** system on
`/onboarding` (bold sans, glass fields, `motion/react` transitions, tokens
under `.ob-*` in `globals.css`, Figma exports in `designs/`). The owner has
decided the dark system wins — the core loop is being migrated to it, starting
with the dashboard and daily page. New deps: `motion`.

## Verification habits

`backend/smoke_test.py` is the source of truth for engine behavior (24 checks:
auto-slicing, schedule totals/spacing, availability weighting incl. 0-hour days,
starting point, adaptive overshoot, borrow, why, calendar, auth isolation).
UI is verified with headless Chrome via puppeteer-core against the running app —
but never click-test against a demo DB you care about (it pollutes state; it
burned us once).
