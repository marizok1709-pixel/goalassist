# GoalAssist — Project State

_The plan, and only the plan. What happened → `CHANGELOG.md`. How work gets
proven → `VERIFICATION.md`. Last updated 2026-08-16._

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

The pivot's **Phase 1 is committed and pushed** (branch `onboarding-flow`, three
commits, 2026-08-16) and **not deployed**. Production still runs the pre-pivot
engine, so three sessions of fixes — honest day logging, scheduler correctness,
and the whole pivot — have never been in front of a real user.

**The metric:** _one person who is not Mark completes one mission end to end._
`backend/funnel.py` is the only thing that reports it. **Not met.**

## ▶️ Resume here

1. **Deploy — backend first.** The additive migration runs on the API's cold
   start: `users.timezone`, `goals.{replanned_on, priority,
   launched_over_capacity, acknowledged_load}`, `materials.minutes_per_unit`,
   and the `execution_records` table. Frontend second, rebuilt (the API URL is
   baked in at build time). Post-deploy check in `VERIFICATION.md`.

   The gate was last run green in full on 2026-08-16 (numbers in
   `VERIFICATION.md`), so this is ready to run as-is:

   ```bash
   cd /Users/markmitrofanov/acadassist

   # 1. backend first — nothing may read the new columns before they exist
   cd backend && vercel deploy --prod --yes && cd ..

   # 2. frontend second, from the repo root (Root Directory is `frontend`;
   #    deploying from inside it looks for frontend/frontend and fails)
   vercel deploy --prod --yes

   # 3. the one corrupted row, only now — never through the UI
   cd backend && set -a; . ./.env.local; set +a
   .venv/bin/python repair_task.py 2149 --actual 0            # dry run first
   .venv/bin/python repair_task.py 2149 --actual 0 --apply

   # 4. prove it landed (all read-only)
   curl -s -o /dev/null -w '%{http_code}\n' https://goalassist-api.vercel.app/health   # 200
   curl -s -o /dev/null -w '%{http_code}\n' https://goalassist-api.vercel.app/dashboard # 401
   .venv/bin/python funnel.py        # must still report the accounts you expect

   # 5. main should equal production truth
   cd .. && git checkout main && git merge onboarding-flow && git push
   ```
2. **Repair production row #2149** — only after deploying. Task #2149 (user 8,
   goal 7 EGE math, 2026-08-11) is flagged `completed` while its unit records 87
   points. **Do not un-tick it through the UI**: the row claims 118 points the
   material never received, so the reversal would strip 118 from a material that
   only has 87 and wipe the declared starting point.
   ```bash
   cd backend && set -a; . ./.env.local; set +a
   .venv/bin/python repair_task.py 2149 --actual 0            # dry run
   .venv/bin/python repair_task.py 2149 --actual 0 --apply
   ```
3. **Merge to `main`.** The branch is **15 commits ahead**; `main` has been stale
   since PR #2 merged on 2026-08-07. Main should equal production truth.
4. **Ask the two users why.** Eleven days, zero movement.

### The one part of Phase 1 that is not finished

**The cutover is partial, and two engines now coexist.**

- `services/planner.py` (new, pure, no DB) answers *will you make it* — the
  verdict and the projected finish date. It is live, through
  `adapter.plan_for()` in `routers/plan.py` and `routers/feasibility.py`.
- `services/engine.py`'s `build_schedule` / `rebuild_schedule` (old) still
  produce the day's rows as `ScheduledTask` — 40 references in `plan.py`, 18 in
  `admin.py`, 8 in `goals.py`.

Part 3, step 3 of the approved plan — _"`ScheduledTask` forward rows stop being
written; `rebuild_schedule` and the twelve call sites it has retire with it"_ —
**did not happen.** So the forward plan is still persisted, which is the exact
defect this phase existed to end. It is *mitigated* (the day-turn replan gated by
`Goal.replanned_on`, plus `engine.derive_descriptions` deriving ranges at read
time), not removed. Finish it before Phase 2, or the mitigation becomes the
architecture.

## The queue

| # | Item | Size | Why it is here |
|---|---|---|---|
| 1 | **Deploy Phase 1** | ½ day | Three sessions of fixes no user has seen |
| 2 | **Finish the cutover** | ~1 day | Ends the two-engine split above, and actually stops persisting the forward plan |
| 3 | **Ask the two users why** | free | One message each. Vasiliy: "you opened it, saw the list — what stopped you?" Sima never made a mission, so hers is "what did you see when you signed up?" Worth more than any analytics at n=2 |
| 4 | **"I fell behind — fix my plan"** | 2–4h | **Much cheaper than first costed**: `components/reality-check.tsx` and the `suggested_deadline` / `suggested_scope` / `suggested_weekly_hours` fields already exist and are wired into both creation paths. This is mounting them on `missions/[id]` over the `PATCH /goals/{id}` that already rebuilds. Today the product's honesty terminates in a dead end whose only exit is quitting |
| 5 | **Daily email** | ½ day | Cheap, and it buys password reset for free. Expect amplification, not salvation |
| 6 | **Pivot Phase 2** | — | Material library + `unit_type` enum. Settle the `DAILY_EFFECTIVE_CAP` question below first |
| 7 | **Pivot Phase 3** | — | Calibration ("we assumed 4.5 min/page; you run 6.2") and mission debrief. **Data-gated, not effort-gated** — it needs `actual_minutes` to accumulate from real use, so it cannot start until item 1 ships and somebody logs time |

**Retired as done:** mobile layout pass (08-06, locked by `verify/mobile.mjs`) ·
availability back in the flow (08-07) · timezone as a stored IANA string (pivot
Part 0b) · honest day logging (08-12) · scheduler correctness (08-15).

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

## The beta (funnel, 2026-08-16)

| Account | Registered | Mission | Rhythm | Tasks | Stopped at |
|---|---|---|---|---|---|
| `serafimastsevaya@gmail.com` (Sima) | 2026-08-05 | — none — | none | 0 | **registered** |
| `boberkurkurkur@gmail.com` (Vasiliy) | 2026-08-05 | "Watch two lessons from my nutritionist every day" | none | 0 / 22 | **mission** |

Unchanged in eleven days: no new accounts, no mission for Sima, and Vasiliy has
never ticked anything. `availability` is NULL for both — the onboarding rhythm
step that fixes this is built but has never been deployed, so neither has been
asked. Refresh with:

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
