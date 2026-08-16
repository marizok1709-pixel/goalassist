# GoalAssist — Project State (handoff)

_Last updated: 2026-08-15. Read this first when resuming work._

> **How work gets proven now lives in `VERIFICATION.md`** — the standing
> pre-commit gate, a written gate for each remaining plan item, the post-deploy
> check, and `funnel.py` for the metric itself. Read it before starting item 4,
> 5 or 6.

## ▶️ RESUME HERE (next session)

### 2026-08-15 — the pivot's Phase 1 is in the tree, NOT deployed

Two pieces of work, in this order.

**1. The scheduler correctness bug (Aug-15 report).** The calendar showed a
Friday owing 139 Stepik points beside a Saturday starting at 246, and a TestDaF
Saturday reading "pages 24-26" beside a Sunday reading "pages 22-24". Neither was
a chunk-generator defect — that walks a cursor and always has. Both came from
*persisting a forward plan and reading it on a later day than it was written*.
Fixed: a day-turn replan gated by `Goal.replanned_on`; ranges derived at read
time (`engine.derive_descriptions`); `POST /today/more` deleted (it moved rows
between days without re-planning, which is how work landed on a zero-hour
Saturday); a guard so a day already reported on cannot receive a second
generated row; and `rebuild_schedule` now flushes first — with `autoflush=False`,
logging a *future* day from the calendar used to delete the row being edited.

**2. Phase 1 of the pivot.** Time is the scheduling currency; feasibility is a
property of the student, not of a mission. New pure module
`app/services/planner.py` (`plan(missions, capacity, history, today) -> Plan`),
tunables in `app/services/params.py`, ORM bridge in `app/services/adapter.py`.
`POST /plan/preview` answers "does this fit?" *before* anything is written, and
the reality-check screen sits between the last onboarding question and creation.
`ExecutionRecord` records what happened — **there is no PENDING**; a row is
written when its day arrives or is reported on, never ahead, because a persisted
forward plan is exactly what caused (1).

**Owner decisions taken 2026-08-15:** forward plan derived, never persisted ·
weekly floor of one study slot per active mission · `minutes_per_unit` nullable
with a units-per-hour fallback, no invented seed values.

**This supersedes two earlier decisions recorded below** (2026-08-06): *"engine
stays feature-frozen"* and *per-task time estimates* in the cut-until-retention
list. The pivot is the newer call; the older lines stay for the record.

**Still to do by hand:** deploy the backend before the frontend (the additive
migration adds `users.timezone`, `goals.priority` / `launched_over_capacity` /
`acknowledged_load` / `replanned_on`, `materials.minutes_per_unit` and the
`execution_records` table on cold start). Nothing is committed yet.

### 2026-08-12 — the logging bug is fixed in the tree, NOT deployed

The owner hit it in live use (detail in `CHANGELOG.md`, gate in
`VERIFICATION.md`). Root cause: `completed` was a boolean with no arithmetic
behind it, so logging 0 marked a task done with no progress recorded; un-ticking
subtracted the *planned* amount and destroyed real progress; and correcting an
earlier day never re-evaluated today. Any day is now editable from the calendar.

**Second round, same evening:** the first fix deployed cleanly and the owner
immediately hit the *display* half of the same defect — a missed Tuesday still
reading "pages 23-25" beside a correctly re-planned Wednesday reading "pages
21-23". The arithmetic was right; a description is a snapshot of the position it
was built at. Unfinished past days now state the amount owed instead
(`plan._settled_description`). **Not deployed either.**

**Also outstanding: the German position is wrong in production.** Unit 28 records
**20** pages; the owner says he is on **23**. The "update" editor on mission
detail asks for *completed* pages ("Where are you in X? Completed pages of 161"),
so this is his to set — 23 if 23 pages are finished, 22 if page 23 is the next
one he will read. Nothing in the codebase can settle that, and nothing should
guess it. Until it is set, today's plan is off by three pages.

**Two things are outstanding and both need the owner:**

1. **Deploy.** The fix adds `scheduled_tasks.actual_quantity`; the additive
   migration runs on the API's cold start, so the backend must go out **before**
   anything reads the column. Frontend after.
2. **One corrupted production row.** Task **#2149** (user 8
   `marizok1709@gmail.com`, goal 7 EGE math, 2026-08-11, "Stepik problems:
   points 88-205") is flagged `completed` while unit 30 still records 87 points
   — the phantom tick that started all this. Do **not** un-tick it through the
   UI: the row claims 118 points the material never received, so the reversal
   would take 118 off a material that only has 87, wiping the declared starting
   point. Repair it instead, after deploying:

   ```bash
   cd backend && set -a; . ./.env.local; set +a
   .venv/bin/python repair_task.py 2149 --actual 0            # dry run
   .venv/bin/python repair_task.py 2149 --actual 0 --apply
   ```

   Verified against a local copy of the same data: it writes only `completed`
   and `actual_quantity` on that row and leaves the material alone.

Everything else in this file below still stands.

**Nothing from the last two sessions is committed.** Branch `onboarding-flow`,
PR #1 still open against `main`. The working tree holds *both* the onboarding
rhythm step (item 3) and the whole verification layer. First decision of the
next session is whether to commit it as one change or split it in two —
suggested split: (a) *availability back in the flow* + the nudge fix, (b) *the
verification layer*. They are independent and the second is much larger.

**Working tree, 2026-08-07**

| New | Modified |
|---|---|
| `VERIFICATION.md` | `PROJECT_STATE.md`, `CHANGELOG.md` |
| `frontend/verify/{lib,mobile,loop,run}.mjs` | `backend/app/{models,migrate,schemas}.py`, `backend/app/routers/privacy.py` |
| `backend/smoke_test_availability.py` | `frontend/src/app/{page,timing/page,onboarding/page,layout.tsx,globals.css}` |
| `backend/funnel.py` | `frontend/src/app/missions/[id]/page.tsx`, `frontend/src/components/{consent,darkchrome,ui}.tsx`, `frontend/src/lib/api.ts`, `frontend/package.json` |
| `frontend/scripts/validate_contrast.mjs` | |
| `frontend/scripts/validate_palette.mjs` | |

The third change in the tree is the **"Bloom" re-theme** (rose glass), which is
a `globals.css` rewrite plus four small component touches. It is separable from
the other two if you want three commits rather than two.

**Before committing, run the gate in `VERIFICATION.md`.** Last full run was
green: 6 backend suites, `tsc` clean, `next build` clean (17 routes), eslint at
its 4-error baseline, `npm run verify` 70/70.

**Then start with item 2 — and note it grew.** `funnel.py` against production
shows **two** accounts now, not one, and the newer one stalled a step *earlier*
than anyone knew (registered, never created a mission). Ask both. Item 4 is the
next code item; its gate is already written.

**Two loose threads** (detail in the session log below): confirm whether
production is actually on the EU Neon region, and note that `availability` is
still NULL for both real users — the rhythm step is built but has never been in
front of a real person, because it is not deployed.

**Machine state as left:** backend and frontend dev servers running on the
**demo** DB (`acadassist.db`, one account: `marizok1709@gmail.com`); the
throwaway `verify.db` is deleted. Reminder from `VERIFICATION.md`: the browser
suites register real accounts, so point the backend at a throwaway
`DATABASE_URL` before running them — running them against the demo DB creates
`verify+…@example.com` rows that then have to be deleted by hand.

A written-up version of the last session, with before/after screenshots of the
defects, is published at
<https://claude.ai/code/artifact/d522925d-28c1-4293-bc16-851d6575a88f>.

## 🎯 The plan (owner-set 2026-08-06, after the council review)

The previous priority list (timezones → mobile → data collection → deploy
hardening) was **all correctness and no product**. Shipping it perfectly still
produces ~0% retention, because nothing in the product asks anyone to come back,
and — more importantly — **there is nothing to retain anyone into yet**: the one
real user completed 0 of 26 tasks. Retention machinery amplifies a working loop.
We do not have evidence of a working loop.

**Owner decision 2026-08-06: mobile is the product.** Users are overwhelmingly on
phones (the only real user is, and the only reported open defect is the phone
layout). Every screen is designed and verified at 360×800 first; desktop is the
enhancement, not the baseline. A **native app is deliberately deferred** — the
web layout must be right before anything is wrapped. Revisit after retention.

### Ranked, with sizes

| # | Item | Size | Why it is here |
|---|---|---|---|
| 1 | **Mobile layout pass** — nav, `/today`, `/calendar`, then the rest | ~1–2 days | The only reported open defect, on the only user's device. **It is also the confound**: until it is fixed, 0/26 cannot be read as unmotivated rather than untappable |
| 2 | **Ask the users why** — **now two of them** | free | One message each. Vasiliy: "when you opened it and saw the list, what stopped you?" Sima never made a mission at all, so hers is a different question: "what did you see when you signed up?" Worth more than the whole analytics stack at n=2 |
| 3 | ~~**Availability back in the flow**~~ **DONE 2026-08-07** | ½ day | Onboarding gained a `rhythm` step (which days are rest days), saved *before* the goal exists so the first schedule is already weighted. Gated by `smoke_test_availability.py` + `verify/loop.mjs` |
| 4 | **"I fell behind — fix my plan"** (move deadline / drop material) | 2h–1 day | `PATCH /goals/{id}` already ships; the UI exposes only *delete*. Today the product's honesty terminates in a dead end whose only action is quitting |
| 5 | **Daily email** | ½ day | Cheap, and it buys password reset for free. Expect amplification, **not** salvation — the one user returned the same day and still ticked nothing |
| 6 | **Timezone as a stored IANA string** | ½ day | `Intl.DateTimeFormat().resolvedOptions().timeZone` at register, threaded into every `today` computation. This is not a temporal refactor |

### Cut until retention exists

Admin dashboard work · analytics / "proper data collection" (n=1 with consent
off) · landing page · PWA · CI + frontend tests · rate limiting · email
verification · time-weighted progress · non-linear effort curves · cross-mission
load view · per-task time estimates · second-mission wizard polish · monitoring
beyond ticking Neon's PITR box · **native app**.

None of these are wrong. All of them are infrastructure for a scale that does
not exist. Revisit each when a real user's behaviour demands it.

### The metric changed

Retired: _"10 students, 30 days, ≥50% weekly retention."_ It measures app-opens
across ten friends — friendship, not product.

Replaced with: **one person who is not Mark completes one mission end to end.**
Then, and only then, recruit — and **screen for a real, externally dated exam
inside 4–8 weeks**. A habit-shaped user ("read books every day") in a
deadline-shaped product churns regardless of what gets built.

### Standing rules this does not change

Engine stays feature-frozen. No AI, no ads, no Google Calendar. Praise shows
consequences. Every recommendation stays explainable.

## 📋 Session 2026-08-07 — verification, and what it found

Built the thing that was missing: the guarantees this project makes about the
phone layout were proven once, by hand, with scripts that were thrown away.
Full detail in `VERIFICATION.md` and `CHANGELOG.md`. The short version:

- **`frontend/verify/`** — two committed browser suites (`npm run verify`,
  70 checks: `mobile.mjs` 44, `loop.mjs` 26). `mobile.mjs` sweeps every route in
  both themes for overflow, tap targets and reachability; `loop.mjs` walks
  onboarding → tick → calendar.
- **`backend/smoke_test_availability.py`** (27 checks) locks item 3.
- **`backend/funnel.py`** — read-only, prints where every real account stopped.
  This is the plan's metric in one command instead of hand-written SQL.
- **`VERIFICATION.md`** — the standing gate plus a written gate for items 4, 5
  and 6, agreed before those items are built.

**Three real defects the new suites found**, all fixed:

1. **The consent banner sat on top of the onboarding CTA.** At 360×800 the
   point a thumb aims at for "Create account →" belonged to the banner, not the
   button — the first tap of the funnel, on a phone, was unreachable. It also
   covered the whole bottom tab bar on every authed route. Fixed with a
   measured `--ga-consent-h` and a `data-tabbar` marker so the banner stacks
   above the bar instead of over it.
2. **"What we collect" (16px) and mission detail's `edit` (22px wide)** were
   below the tap-target floor the mobile pass claimed everything cleared.
3. **The overflow check was passing vacuously** — `.ob-root` sets
   `overflow-y: auto`, which computes `overflow-x` to `auto` as well, so wide
   children scroll *inside it* and `documentElement.scrollWidth` never grows.
   Any horizontal overflow introduced since the mobile pass would have gone
   unnoticed. The suite now measures the real scroll container.

**Also this session:** the `availability_refined` column (the dashboard nudge
now reads a stored fact instead of guessing from the hours — a student who
picks 2h on every study day at `/timing` was previously indistinguishable from
one who never opened the page, and got nudged forever).

**Two things to check, found while running `funnel.py` against production:**

- **The beta has moved on from what this file recorded.** Production now has
  two accounts: `serafimastsevaya@gmail.com` (registered 08-05, **never created
  a mission**) and `boberkurkurkur@gmail.com`, whose mission is now *"Watch two
  lessons from my nutritionist every day"* (22 tasks, 0 done) — not the "Read
  books every day" / 26 tasks recorded below. Neither has availability set.
  Item 2 (ask them why) now has **two** people to ask, and the first one
  stalled a step earlier than anyone knew.
- **`backend/.env.local`'s `DATABASE_URL` points at `us-east-1`**, despite the
  EU region migration script (`ac510b1`). Either the migration has not been run
  or the local env file is stale — worth confirming against what production
  actually uses, since `PRIVACY.md` still lists EU residency as an open gap.

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
1. ~~Retention purge is not scheduled.~~ **Done** (commit `80dbab4`): a Vercel
   Cron hits `GET /internal/purge-expired-events` daily at 03:00, guarded by
   `CRON_SECRET` (the endpoint refuses outright if the var is unset).
2. **Consent-sync gap.** Accepting the banner while logged out saves the local
   decision but never syncs to the account after login, so events get dropped
   until the user toggles it in settings. Minor UX, not a privacy hole.
3. **Mobile layout** (priority below) still not done.
4. Neon/Vercel EU residency + DPAs still unverified (see `PRIVACY.md` gaps).
5. Single admin account: `admin@goalassist.app` (created on the **local** demo
   DB only — production has no admin yet; run `make_admin.py` against prod to
   create one).

## 👤 The beta so far (verified against production 2026-08-07 via `funnel.py`)

**Two real users, neither past the starting line.**

| Account | Registered | Mission | Rhythm | Tasks | Stalled at |
|---|---|---|---|---|---|
| `serafimastsevaya@gmail.com` (Sima) | 2026-08-05 | — none — | none | 0 | **registered** |
| `boberkurkurkur@gmail.com` (Burnalda Vasiliy) | 2026-08-05 | "Watch two lessons from my nutritionist every day" | none | 0 / 22 | **mission** |

Two things changed from what this file recorded on 08-04, and both matter:
**Vasiliy's mission is not the one on file** — it is no longer "Read books every
day" / 26 tasks, so he started over at least once — and **there is a second
account that never created a mission at all**, which is a failure one step
earlier in the funnel than anything previously seen.

`availability` is NULL for both. The onboarding rhythm step that fixes this is
**built but not deployed**, so neither of them has ever been asked.

Run `cd backend && set -a; . ./.env.local; set +a; .venv/bin/python funnel.py`
to refresh this table. It is read-only and masks the password. Before 08-07 the
only way to know any of it was hand-written SQL against Neon — that is what
`funnel.py` replaced.

**They reported three things, on an Android phone:** book names saved
word-reversed (fixed 08-04), no way to change materials after the mission was
created (fixed 08-04), and the vertical mobile layout being a mess (**item 1 of
the current plan**).

## 🗂️ Carried-over engineering detail

_The ranked plan is at the top of this file. What follows is the detail behind
individual items, kept because it is specific and still true._

**Mobile (item 1) — the two confirmed offenders.** `components/darkchrome.tsx`
— the nav is a 10-item `flex-wrap` row with `px-8 py-6`; at 360px it collapses
into four stacked lines that dominate the screen. `app/calendar/page.tsx` —
`grid grid-cols-7 gap-1.5` is hardcoded with no breakpoint and no horizontal
scroll, so each of the 7 columns is ~46px and task titles break one word per
line.

**Timezones (item 6) — scope.** `Intl.DateTimeFormat().resolvedOptions().timeZone`
stored at register, threaded into every `today` computation. Includes the known
frontend inconsistency: `missions/[id]` marks TODAY via UTC (`toISOString`)
while `/calendar` uses local time. Not a refactor.

**2026-07-28 code-review list, still open:** (a) calendar detail panel claims
"rest day" for selected days outside the fetched range; (b) week↔month toggle
snaps back to the last-clicked day's period; (c) no auth guard on
`/missions/new` → build one shared authed shell instead of per-page copies;
(d) default 404 ignores theme (`not-found.tsx`); (e) redundant calendar
refetches / loading flash; (f) silent save failures — **done 2026-08-04** on
`missions/[id]` (all writes route through one `run()` helper that shows an
error line), other pages still swallow failures; (g) `next-env.d.ts` churn.

**Day-one task guarantee.** A fresh sparse mission can show "Nothing scheduled
today" — front-load ≥1 task on creation day. Cheap, and it is the first screen
after the launch reveal.

**Deploy.** ✅ Production since 2026-08-03. Still open: error logging, a health
alert, and Neon PITR (tick the box — it is not a "policy"). Deferred, not
forgotten.

**Premium.** Deferred until retention is proven. Sketch unchanged: free = 1
active mission, premium = unlimited, never paywall the trajectory math, student
pricing ~€3–4/mo, no ads ever. Milestone 2 ("explain schedule changes") sits
behind the same gate — note that the schedule *already* silently recomputes
after every completion (`rebuild_schedule` from tomorrow); what is missing is
telling the user it happened.

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

## Status: live beta, n=2

Deployed to production since 2026-08-03; two real accounts, neither past the
starting line (see "The beta so far"). The engine is feature-frozen by decision
of the product owner. The old success criterion — 10 test users, 50%+ weekly
retention over 30 days — was **retired on 2026-08-06**; see "The metric changed"
near the top of this file for what replaced it and why.

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

## Design direction (as of 2026-08-07) — "Bloom"

**Owner decision 2026-08-07, reversing the 2026-07-28 "the dark slate system
wins" call:** colour *is* the background. A vivid rose→violet gradient field
carries the page and Liquid-Glass panels float over it holding all the text.
Light = **"Bloom"**, dark = **"Nocturne"** (plum→indigo, same hue family).
"Burnt sienna" and "Stormy morning" are both retired, as is the halftone burst.

Structure is unchanged: bold sans, `motion/react` transitions, `.ob-*` tokens in
`globals.css`, shared chrome in `components/darkchrome.tsx`. Because components
read semantic tokens and never a raw hex, the re-theme was one CSS file plus
four small component touches — no page was rewritten. That property is worth
protecting: **never put a literal colour in a component.**

**The constraint that shapes this theme is contrast.** Translucent panels over
a saturated field means every text token has to survive two backgrounds — the
glass composite *and* the bare field, where headings and nav sit with nothing
behind them. That second case is what set the palette: at full strength the
violet stop left `--ink-muted` at 2.93:1, so the violet peaks at 0.82 and the
lower two text steps are darker than they look like they need to be.

Two validators encode it. Run both before touching any colour:

```bash
cd frontend
node scripts/validate_contrast.mjs   # 32 pairs, text on glass AND on the field
node scripts/validate_palette.mjs    # chart ramps, incl. deuteranopia
```

Tightest margins today: 4.90:1 light, 4.75:1 dark. Deps unchanged (`motion`);
the Figma exports in `designs/` now predate the current look.

## Verification habits

**`VERIFICATION.md` is the authoritative version of this section** — the
standing gate, the per-item gates, the post-deploy check. What stays here is
the orientation:

`backend/smoke_test.py` is the source of truth for engine behaviour (24 checks:
auto-slicing, schedule totals/spacing, availability weighting incl. 0-hour days,
starting point, adaptive overshoot, borrow, why, calendar, auth isolation).
`smoke_test_material_edit.py` covers editing a material after creation (25),
`smoke_test_availability.py` the onboarding rhythm step (27), plus hardening
(16), privacy (40) and admin (62).

UI is verified by `frontend/verify/` (`npm run verify`, 70 checks) rather than
by ad-hoc scripts — that change is the whole point of the 08-07 session. Two
rules that predate it and still hold: **never click-test against a database you
care about** (the suites register real accounts; it has burned us twice now),
and **never trust a check that has never been seen to fail**.
