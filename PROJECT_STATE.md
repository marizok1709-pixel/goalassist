# GoalAssist — Project State

_The plan, and only the plan. What happened → `CHANGELOG.md`. How work gets
proven → `VERIFICATION.md`. Last updated 2026-08-17._

**GoalAssist turns academic deadlines into daily certainty.** A student creates a
mission with a hard deadline and real materials; the system scopes the work in
time, tests whether it fits the rest of their life, and says plainly — with
arithmetic, not vibes — when they will actually finish and what to do today. No
AI anywhere; the credibility comes from explainable maths. (Former names:
AcadAssist, Life.exe — the repo directory is still `acadassist`.)

## Status

**Live beta, n=2, nobody past the starting line.** Production has run since
2026-08-03: frontend `goalassist.vercel.app`, API `goalassist-api.vercel.app`,
Neon Postgres in `eu-central-1` with the API pinned to `fra1`.

The pivot's **Phase 1 is live** (2026-08-16) and **its cutover with it**
(2026-08-17): the forward plan is computed on every read and never stored.
Three sessions of work (honest day logging, scheduler correctness, and the whole
pivot) are now in front of real users for the first time. `main` and
`onboarding-flow` are in sync and pushed.

**The metric:** _one person who is not Mark completes one mission end to end._
`backend/funnel.py` is the only thing that reports it. **Not met.**

## ▶️ Resume here

**Deployed 2026-08-17**, backend and frontend together — the cutover removed
`PATCH /tasks/{id}`, so an old frontend could not have logged a day. Verified
live: the route is gone from the API, the shipped bundle carries only the
day-keyed path, and the derived engine answers for every real account.

1. **Watch Sima.** She returned on 2026-08-16 and reached `availability` — the
   furthest anyone has ever come. She is one tick from the metric. If she stalls
   at the first tick, that is worth more than anything else on the queue.
2. **Then the queue.**

### The cutover is done — the forward plan is no longer stored

Finished 2026-08-17, completing Part 3 step 3 of the pivot plan.

`engine.rebuild_schedule` had **eleven call sites** writing days that had not
arrived. All eleven are gone, and so is the row id they existed to create:
`PATCH /tasks/{id}` is replaced by **`PATCH /goals/{id}/days/{day}`**, because a
student reports what happened on a date, not what happened to a database row.

What `ScheduledTask` holds now is one thing: **days that have happened.** A row
is materialised when its day arrives, or when it is reported on — never ahead.
Everything past today is computed from the mission's live position on every
read, so a day that goes by unreported is absorbed by definition rather than by
a scheduled repair.

Two rules keep it honest:

- **Today stays live until it is reported on.** It is written down so a missed
  day leaves a trace, but while nobody has spoken about it the row is
  re-derived on every read — a row written this morning is stale by the
  afternoon, which is the original defect in miniature.
- **Nothing beyond today is ever written.** `smoke_test_derived.py` prints the
  count on every run; it is **0**, down from 120.

Evidence: the golden file reports the two real missions' plans **unchanged**,
which is exactly what it was built for.

## The queue

| # | Item | Size | Why it is here |
|---|---|---|---|
| 1 | **"I fell behind — fix my plan"** | 2–4h | **Much cheaper than first costed**: `components/reality-check.tsx` and the `suggested_deadline` / `suggested_scope` / `suggested_weekly_hours` fields already exist and are wired into both creation paths. This is mounting them on `missions/[id]` over the `PATCH /goals/{id}` that already rebuilds. Today the product's honesty terminates in a dead end whose only exit is quitting |
| 2 | **Daily email** | ½ day | Cheap, and it buys password reset for free. Expect amplification, not salvation |
| 3 | **Pivot Phase 2** | — | Material library + `unit_type` enum. Settle the `DAILY_EFFECTIVE_CAP` question below first |
| 4 | **Pivot Phase 3** | — | Calibration ("we assumed 4.5 min/page; you run 6.2") and mission debrief. **Data-gated, not effort-gated** — `actual_minutes` has to accumulate from real use first, and as of now nobody has logged a single day |

**Retired as done:** mobile layout pass (08-06, locked by `verify/mobile.mjs`) ·
availability back in the flow (08-07) · timezone as a stored IANA string (pivot
Part 0b) · honest day logging (08-12) · scheduler correctness (08-15) ·
**deploying Phase 1 (08-16)** · **asking the two users (08-16)** ·
**finishing the cutover (08-17)**.

## Decisions in force

- **Time is the scheduling currency**, and feasibility is a property of the
  student, not of a single mission.
- **The forward plan is derived, never persisted.** `ExecutionRecord` records
  only what happened — there is no `PENDING`, and it must never acquire one.
- **A weekly floor of one study slot per active mission**, applied before
  demand-rate splits the remainder. Without it, demand rate hands a near exam
  every hour and starves a language exam for weeks.
- **`minutes_per_unit` is nullable**, with a units-per-hour fallback. No invented
  seed values — nothing in this product has ever measured how long work takes.
- **Mobile is the baseline**; desktop is the enhancement. A native app stays
  deliberately deferred.
- No AI. No ads. No Google Calendar. No user-facing "chunks". Praise shows
  consequences, never cheerleading. Every recommendation stays explainable.
- **No visual redesign mid-pivot.** And never a literal colour in a component —
  that property is why the last re-theme was one CSS file plus four touches.
- **Superseded 2026-08-15:** _"the engine stays feature-frozen"_ and _per-task
  time estimates_ on the cut list. The pivot reversed both; the older lines stay
  here only so the reversal is legible.

**Open decision, before Phase 2:** should `DAILY_EFFECTIVE_CAP` (240 min) be
overridable by the student? It *decides the verdict* and is disclosed on the
reality-check screen but not editable — which is only a partial answer to
"every recommendation is explainable".

## Cut until retention exists

Admin dashboard work · analytics beyond the funnel · landing page · PWA · CI +
frontend unit tests · rate limiting · email verification · time-weighted
progress · non-linear effort curves · second-mission wizard polish · monitoring
beyond ticking Neon's PITR box · **native app**.

None are wrong. All are infrastructure for a scale that does not exist. Revisit
each when a real user's behaviour demands it.

## The beta (funnel, 2026-08-17)

**It moved.** First change in twelve days, the day after both users were asked
directly.

| Account | Registered | Mission | Rhythm | Tasks | Stopped at |
|---|---|---|---|---|---|
| `serafima.mastsevaya@gmail.com` (Sima, **new address**) | 2026-08-16 | "Pass exam" | rest days set | 0 / 2 | **availability** |
| `boberkurkurkur@gmail.com` (Vasiliy) | 2026-08-05 | "Watch two lessons from my nutritionist every day" | none | 0 / 22 | **mission** |
| `serafimastsevaya@gmail.com` (Sima's first account) | 2026-08-05 | — none — | none | 0 | **registered** |

```
registered  3  ·  mission  2  ·  availability  1  ·  first tick  0  ·  complete  0
```

Sima came back on a **second address** (note the added dot) rather than
returning to the first — worth knowing before reading the funnel as three
people. She is at `availability`, the furthest anyone has reached, and one tick
from the metric. Nobody has ever logged a day, which is also why Phase 3 cannot
start.

Refresh with:

```bash
cd backend && set -a; . ./.env.local; set +a; .venv/bin/python funnel.py
```

Read-only, masks the password. Run it before deciding what to build next: a
funnel stalling at `availability` and one stalling at `first tick` call for
opposite work.

**They reported three things, on an Android phone:** book names saved
word-reversed (fixed 08-04), no way to change materials after creation (fixed
08-04), and the vertical mobile layout being a mess (fixed 08-06).

---

# Reference

## Deploy topology

Two Vercel projects under team `kram3`:

| Project | What | Deploy from | Notes |
|---|---|---|---|
| `goalassist` | Next.js frontend | **repo root** | Root Directory is set to `frontend`; deploying from inside `frontend/` fails looking for `frontend/frontend` |
| `goalassist-api` | FastAPI backend | `backend/` | `vercel.json` pins `regions: ["fra1"]` + the 03:00 purge cron |

`vercel deploy --prod --yes` from the right directory. Neon Postgres
(`neon-purple-coin`, `eu-central-1`) backs the API. The frontend↔backend link is
`NEXT_PUBLIC_API_URL`; **changing the backend URL means rebuilding the frontend**,
because the value is baked in at build time.

Still open: error logging, a health alert, and Neon PITR (tick the box). Preview
deploys remain CORS-blocked — `CORS_ORIGINS` pins the production domain only.

## How to run

```bash
# backend  (FastAPI, port 8000; docs at /docs)
cd backend && .venv/bin/uvicorn app.main:app --reload --port 8000
# frontend (Next.js 16 + Tailwind v4, port 3000)
cd frontend && npm run dev
# the gate (11 backend suites + browser suites) — see VERIFICATION.md
```

## Architecture

```
Goal (mission, deadline, start_date, priority)
 └─ Material (name, total_quantity, unit, minutes_per_unit?)
     └─ ProgressUnit   — WHAT exists (auto-sliced)
         └─ ScheduledTask — WHEN it happens (dated)
ExecutionRecord — what actually happened (units, minutes, COMPLETED/PARTIAL/SKIPPED)
```

- **Planner** (`services/planner.py`) — pure, no DB or HTTP. `plan(missions,
  capacity, history, today) -> Plan` over the *whole portfolio*. Five stages:
  demand → effective capacity → allocation → feasibility → schedule. Every
  tunable in `services/params.py`; `services/adapter.py` is the only place the
  ORM meets it. **The invariant**: allocate in minutes, convert to units, but
  advance *one unit cursor* per material — the range belongs to the cursor, not
  to the conversion.
- **Schedule engine** (`services/engine.py`) — still produces the dated rows
  (see "the cutover" above). Distributes remaining work across the days to the
  deadline, weighted by weekly availability (0h = rest day). Descriptions for
  past rows go through `plan._settled_description`; an unfinished past day states
  the amount owed, never a stale page range.
- **Reality** — the headline is a **date**: `projected_finish_date`, `days_late`,
  `pace_planned` vs `pace_actual` (trailing 7 study days), and a verdict band
  whose floor is `OVER_CAPACITY`. The old `expected_progress_pct`,
  `trajectory_ratio` and the 1.05/0.9/0.7 thresholds are **retired**, as is
  `CALIBRATING`. Dates resolve in the *student's* IANA zone (`services/clock.py`),
  not the server's.
- **`POST /plan/preview`** answers "does this fit?" before anything is written,
  so the reality-check screen sits between the last onboarding question and
  creation. Launching over capacity is **recorded, never refused**
  (`Goal.launched_over_capacity`).
- **`POST /today/more` is deleted.** It moved rows between days without
  re-planning, which is how work landed on a zero-hour Saturday.

Two load-bearing invariants, both learned from bugs: **`completed` is derived
from the amount, never assigned directly**, and **a stored `description` is only
true for the position it was built at**.

## Frontend

All client components, JWT in localStorage, one dark aurora + glassmorphism
language ("Bloom" light / "Nocturne" dark, semantic tokens in `globals.css`).
18 routes. `/onboarding` is the conversational first-run flow and the landing
page; `/` is the Command Center; `/today` is execution only; `/calendar` defaults
to a week view; `/missions/[id]` carries the material editors.

Colour is constrained by contrast on translucent panels over a saturated field.
Run both validators after touching any token, gradient stop or glass alpha:

```bash
cd frontend && node scripts/validate_contrast.mjs && node scripts/validate_palette.mjs
```

## Open engineering detail

From the 2026-07-28 review, still open: (a) the calendar detail panel claims
"rest day" for selected days outside the fetched range; (b) the week↔month toggle
snaps back to the last-clicked day's period; (c) no auth guard on
`/missions/new` — build one shared authed shell rather than per-page copies;
(d) the default 404 ignores the theme; (e) redundant calendar refetches and a
loading flash; (f) silent save failures outside `missions/[id]`;
(g) `next-env.d.ts` churn.

**Day-one task guarantee.** A fresh sparse mission can still show "Nothing
scheduled today" — front-load at least one task on creation day. It is the first
screen after the launch reveal.

**Premium**, deferred until retention is proven: free = 1 active mission,
premium = unlimited, never paywall the trajectory maths, student pricing ~€3–4/mo,
no ads ever.
