# GoalAssist — Project State (handoff)

_Last updated: 2026-08-05. Read this first when resuming work._

## 📋 Session 2026-08-05 — redesign, analytics, GDPR, admin, hardening, deploy

Large session. All shipped to production and verified live. Full detail in
`CHANGELOG.md`; the short version:

- **UI redesign (colours only).** One semantic-token system in `globals.css`
  drives both themes: light = "Burnt sienna", dark = "Stormy morning". Light
  mode's old `filter: invert()` hack is gone. Halftone-burst background rebuilt
  in CSS (follows the cursor on desktop only). Glass buttons kept.
- **Analytics** (`frontend/src/lib/analytics.ts`) — provider-swappable sink,
  typed events, server-side allow-list + PII sanitisation
  (`backend/app/routers/privacy.py`).
- **GDPR** — strict opt-in consent (server-enforced), export, delete, 180-day
  retention purge (**not yet scheduled** — see below). `PRIVACY.md` at repo root.
- **Admin dashboard** at `/admin` — user/activity/session/feature/retention/
  infra/finance. Behind `is_admin`, which only `backend/make_admin.py` can set.
  Charts are hand-rolled SVG (validated palette, no chart dep).
- **Adversarial break-test** — ~60 probes; only findings were numeric-input
  crashes, all fixed and regression-locked (`smoke_test_hardening.py`).
- **Security headers** — CSP + 4 others in `frontend/next.config.ts` (D → ~A-).
- **Deployed** both projects to prod; migration applied to Neon cleanly,
  Vasiliy's row intact.

**Open follow-ups from this session:**
1. **Retention purge is not scheduled.** `purge_expired_events()` exists +
   tested; nothing calls it on a timer. Until a cron runs it, 180 days is policy
   on paper. Most important open item.
2. **Consent-sync gap.** Accepting the banner while logged out saves the local
   decision but never syncs to the account after login, so events get dropped
   until the user toggles it in settings. Minor UX, not a privacy hole.
3. **Mobile layout** (priority below) still not done.
4. Neon/Vercel EU residency + DPAs still unverified (see `PRIVACY.md` gaps).
5. Single admin account: `admin@goalassist.app` (created on the **local** demo
   DB only — production has no admin yet; run `make_admin.py` against prod to
   create one).

## 👤 The beta so far (as of 2026-08-04)

**One real user.** `Burnalda Vasiliy` / `boberkurkurkur@gmail.com`, registered
2026-08-04 10:15, mission "Read books every day" (Aug 4 → Aug 16) with two book
materials. 26 tasks scheduled, **0 completed**. `availability` is NULL — they
never reached `/timing`, so the engine is spreading work evenly with no rest
days. They returned the same day ~13:22.

Until priority 3 (data collection) exists, the only way to know any of this is
to query Neon directly — that is worth remembering, and worth fixing.

**They reported three things, on an Android phone:** book names saved
word-reversed (fixed 08-04), no way to change materials after the mission was
created (fixed 08-04), and the vertical mobile layout being a mess (**still
open** — see priority 2b below).

## ⏭️ Next session (resume here) — owner-set priorities

1. **Timezones.** All dates are currently server-local; per-user timezone
   handling is required before friends in different cities use it (a task that
   flips at the server's midnight, not the user's, breaks the "today" promise).
   Includes the known frontend inconsistency: `missions/[id]` marks TODAY via
   UTC (`toISOString`) while `/calendar` uses local time.
2. **Bug fix.** The first item is new and now outranks the rest — it is the one
   reported defect still open, and the only user we have is on a phone.
   - **(NEW) Mobile vertical layout.** `components/darkchrome.tsx:53` — the nav is
     a 10-item `flex-wrap` row with `px-8 py-6`; at 360px it collapses into four
     stacked lines that dominate the screen. `app/calendar/page.tsx:208,290` —
     `grid grid-cols-7 gap-1.5` is hardcoded with no breakpoint and no
     horizontal scroll, so each of the 7 columns is ~46px and task titles break
     one word per line. Needs a real responsive pass (nav → compact/menu on
     small screens; week view → scrollable columns or a stacked day list).
   - Then the 2026-07-28 code-review list (details in the session
   log below). Priority order inside that item: (a) calendar detail panel
   claims "rest day" for selected days outside the fetched range; (b)
   week↔month toggle snaps back to the last-clicked day's period; (c) no auth
   guard on `/missions/new` → build one shared authed shell instead of per-page
   copies; (d) light-mode dark flash on hard load + default 404 ignores theme
   (pre-paint inline script + `not-found.tsx`); (e) redundant calendar
   refetches / loading flash; (f) silent delete/save failures on mission
   detail — **done 2026-08-04** for the material/mission writes on
   `missions/[id]` (all of them now route through one `run()` helper that shows
   an error line); other pages still swallow failures; (g) `next-env.d.ts`
   dev/build churn.
3. **Proper data collection.** Minimal funnel instrumentation for the beta:
   who finished onboarding, day-2/day-7 return, last-seen page — DB queries or
   a tiny events table; no analytics SaaS at 10 users.
4. **Deploy.** ✅ First production deploy done 2026-08-03 (see session log
   below): frontend + separate FastAPI backend on Vercel, Neon Postgres, env
   secrets, HTTPS. **Still open before the beta:** error logging / monitoring,
   an explicit backup policy (currently only Neon's default history), a health
   alert, and deciding whether the DB stays on Neon or moves (Railway was the
   originally-noted option). The deploy config fix is **not yet committed** (see
   log).

Backlog (agreed 2026-07-28 vision discussion, after the four above): day-one
task guarantee (fresh sparse mission can show "Nothing scheduled today" —
front-load ≥1 task on creation day), daily email reminder (the retention
lever), mobile-web responsiveness pass + PWA manifest (no native apps —
web-first, retention target 50% weekly over 30 days with 10 users decides
everything), Milestone 2 (explain schedule changes). Premium is deferred until
retention is proven; sketch: free = 1 active mission, premium = unlimited,
never paywall the trajectory math, student pricing ~€3–4/mo, no ads ever.

## 📋 Session log 2026-08-04 — first user-reported bugs

Two of the three things the first beta user hit are fixed; the mobile layout is
not (promoted to priority 2, above). Full detail in `CHANGELOG.md`.

- **Word-reversed book names.** Confirmed *persisted in Neon* (`sun and Klara`,
  `могу не я но мог бы Я`) — an input bug, not a rendering one. Root cause: the
  onboarding step animation left `filter: blur(0px)` on the container forever,
  keeping the step in a composited layer where Chromium/Android gives Gboard a
  wrong cursor anchor. Cleared via `transitionEnd: { filter: "none" }`.
  Corroborating detail: the goal title (`autoFocus`, focused programmatically)
  survived intact, while the *tapped* material fields did not.
  **Caveat: not reproducible without a physical Android device.** Synthetic CDP
  IME events do not model Gboard's cached cursor state. What *is* verified is
  that the defective filter is gone (automated check) and that a second,
  independent cause was removed too (`components/textfield.tsx` — free-text
  fields are no longer re-controlled while typing). If a user reports it again,
  the next suspect is the light-mode `filter: invert(1)` on `.ob-root`, which is
  the same class of problem and is unavoidable while light mode works that way.
- **Materials were write-once** → `PUT /goals/{id}/materials/{mid}` plus edit /
  add / remove UI on `missions/[id]`. This is also the mitigation for the bug
  above: a user who gets a mangled name can now fix it themselves.
- Verified: `smoke_test.py` 24/24, new `smoke_test_material_edit.py` 25/25,
  two puppeteer runs (6/6 onboarding, 12/12 mission-detail editing), clean
  `tsc --noEmit`, clean `next build`. No new lint errors (the one
  `react-hooks/set-state-in-effect` error on `missions/[id]` pre-dates this work).
- **Not done:** mobile responsiveness; the live user's two mangled names were
  left untouched in Neon by decision — he can now correct them in-app.

## 📋 Session log 2026-08-03 — first production deploy (Vercel + Neon)

Goal: the deployed frontend was failing immediately after registration (the
first beta user reported "where are the servers?"). Diagnosed and fixed by
deploying the backend and wiring the two together. **The substantive work is in
the Vercel account + Neon; the repo working tree (branch `onboarding-flow`) has
uncommitted changes, listed at the bottom of this log.** Nothing was committed
or pushed this session.

**Root cause (two compounding problems):**
1. **No backend was deployed at all.** `frontend/src/lib/api.ts` line 1 is
   `const API_URL = process.env.NEXT_PUBLIC_API_URL ?? "http://localhost:8000"`.
   `NEXT_PUBLIC_API_URL` was unset, so every visitor's browser POSTed
   registration to `localhost:8000` on *their own machine* → instant failure.
2. Even once deployed, the backend 404'd on every route. `backend/vercel.json`
   had `{"rewrites":[{"source":"/(.*)","destination":"/api/index"}]}`. Vercel's
   now-native FastAPI framework preset routes internal rewrites **by the
   rewritten destination path**, so FastAPI saw the literal path `/api/index`
   for every request and matched nothing (confirmed in the build log warning).

**What was actually done (in order):**
- Installed the Vercel CLI globally (`vercel` 58.4.4). It was not present before.
- Verified `backend/app/main:app` imports cleanly (8 routes) in the local venv.
- Confirmed already logged in as `marizok1709-pixel`, team scope `kram3`.
  Existing projects: `goalassist` (frontend, live) and `mars-habitat-lab`
  (unrelated, untouched).
- **Created a new Vercel project `goalassist-api`** by linking `backend/`
  (`vercel link`; Vercel auto-detected FastAPI).
- Added **`backend/.vercelignore`** (`.venv/`, `__pycache__/`, `*.pyc`, `*.db`,
  `smoke_test.py`) so the venv and local SQLite files aren't uploaded.
- **Provisioned Neon Postgres** via `vercel integration add neon` (Marketplace).
  Required a one-time browser acceptance of Neon's terms by the owner first.
  Store name `neon-purple-coin`, connected to `goalassist-api`. This injected
  `DATABASE_URL` **plus ~18 other `POSTGRES_*` / `PG*` / `NEON_*` vars** into all
  environments — our code only reads `DATABASE_URL`; the rest are unused.
- Set backend env (production + preview + development):
  `ACADASSIST_SECRET` = a fresh 64-hex random (replaces the insecure dev
  default in `security.py`), `CORS_ORIGINS` = `https://goalassist.vercel.app`.
- First backend deploy → **all routes 404** (problem #2). Read the build log,
  saw the rewrite-destination warning, **changed `backend/vercel.json` to `{}`**
  (dropped the rewrite; the FastAPI preset serves the app directly), redeployed.
- Backend now at **`https://goalassist-api.vercel.app`**. Verified: `/health`,
  `/docs`, `/openapi.json` all 200; `POST /auth/register` → **201 + JWT**, row
  written to Neon (tables auto-created on cold start); duplicate email → 409;
  `Access-Control-Allow-Origin: https://goalassist.vercel.app` present.
- Frontend: set `NEXT_PUBLIC_API_URL=https://goalassist-api.vercel.app` (prod +
  preview + dev) on the `goalassist` project. First `vercel deploy` from inside
  `frontend/` **failed** (project Root Directory is `frontend`, so it looked for
  `frontend/frontend`). Re-linked at the **repo root** and deployed from there.
- Frontend redeployed to **`https://goalassist.vercel.app`**. Verified the built
  JS chunks reference `goalassist-api.vercel.app` and contain **zero**
  `localhost:8000` references (the env is baked in at build time — a rebuild was
  mandatory, not optional).
- Cleanup: the smoke-test registration created one real user
  (`deploytest+11129@example.com`, id 1) in Neon; **deleted it** — `users` table
  is back to **0 rows** for the beta.

**Uncommitted working-tree changes at end of session** (nothing committed/pushed):
- `backend/vercel.json` — modified by me: rewrite → `{}` (the actual fix; the
  live deploy used this local file, so if anyone redeploys from the *committed*
  `vercel.json`, the 404 returns).
- `backend/.vercelignore` — new, written by me.
- `.gitignore` (root), `backend/.gitignore`, `frontend/.gitignore` — created /
  modified by the Vercel CLI's `link` step (added `.vercel` and `.env*`), not by
  me directly. Harmless and sensible; kept.
- `backend/api/acadassist.db` — a stray local SQLite file that was **already
  untracked before this session**; not mine, left as-is (and now `.vercelignore`d
  so it can't be deployed).
- Also removed this session: `backend/.agents/` and `backend/skills-lock.json`,
  junk that the Neon integration auto-created (its own agent-skill docs).

**Explicitly NOT done this session (still open):**
- CORS is pinned to the production domain only — frontend **preview** deploys
  (`goalassist-*.vercel.app`) will be blocked by the API until whitelisted.
- No error logging / monitoring / uptime alerting. No explicit DB backup policy
  beyond Neon defaults. `smoke_test.py` was not run against production.
- Local gitignored secret files now exist: `backend/.env.local` (Neon creds),
  repo-root `.env.local`, `frontend/.env.local` (Vercel OIDC tokens).

**Deploy topology (for next session):** two Vercel projects under team `kram3` —
`goalassist` (Next.js frontend, Root Directory `frontend`, deploy from repo
root) and `goalassist-api` (FastAPI backend, deploy from `backend/`). Neon
Postgres `neon-purple-coin` backs the API. Frontend↔backend link is the pair of
env vars above; changing the backend URL means updating `NEXT_PUBLIC_API_URL`
**and rebuilding the frontend**.

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

**Production (deployed 2026-08-03, team `kram3`):** frontend
`https://goalassist.vercel.app`, backend `https://goalassist-api.vercel.app`
(FastAPI, `/docs` live), Neon Postgres. Redeploy: `vercel deploy --prod --yes`
from the repo root for the frontend, from `backend/` for the API.

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
absolute progress ("I'm on page 120"); `PUT .../materials/{id}` corrects the
material itself (name / total / unit — rename keeps units and history, an
amount or unit change re-slices and carries progress over). `/goals/{id}/plan` (pace + reality),
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

`backend/smoke_test_material_edit.py` covers editing a material after creation
(25 checks: rename keeps progress + retitles today's tasks, amount/unit change
re-slices and carries progress, clamping, validation, cross-user isolation).

`backend/smoke_test.py` is the source of truth for engine behavior (24 checks:
auto-slicing, schedule totals/spacing, availability weighting incl. 0-hour days,
starting point, adaptive overshoot, borrow, why, calendar, auth isolation).
UI is verified with headless Chrome via puppeteer-core against the running app —
but never click-test against a demo DB you care about (it pollutes state; it
burned us once).
