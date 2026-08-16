# Verification

_How work on GoalAssist gets proven. Last updated 2026-08-15._

The ranked plan lives at the top of `PROJECT_STATE.md`. This file says what
"done" means for each remaining item, and what has to pass before anything is
committed. It is written **before** the items are built on purpose — a gate
agreed after the fact is not a gate.

## The gate as of 2026-08-15

Eleven backend suites, 354 checks, one command each. Two browser suites, 79
checks, `npm run verify`. All of it has to be green before anything is committed.

| Suite | What it holds |
|---|---|
| `smoke_test_replan.py` | A day that passes unreported re-plans; upcoming ranges are contiguous and monotone; a day already reported on gets no second row; nothing lands on a zero-hour day; the catch-up runs once a day, not once a read |
| `smoke_test_planner.py` | The engine alone, no database. Cases 11-18 from the pivot plan, the cursor invariant, and acceptance scenarios A and B |
| `smoke_test_feasibility.py` | The same through HTTP: a verdict before anything is written, launching over capacity recorded rather than refused, and one `ExecutionRecord` per reported day carrying `actual_minutes` |
| `smoke_test_golden.py` | The owner's two real missions, pinned. Any change to the plan they produce shows up as a named diff |

**On the golden file.** It exists because the pivot rewrites the scheduler and
the only honest way to know a rewrite preserves what worked is to record what the
current engine says about real data and diff every version against it. It is
date-stable — every call takes an explicit `today`, never `date.today()` — so a
diff always means a behaviour change rather than the calendar moving. Re-record
with `--update` **only** after reading the diff; a broken run must never be able
to install itself as the new baseline.

**On weekday independence.** Both browser suites used to pin their rest days to
Sat/Sun while asserting that today holds work. That made the core-loop suite fail
every weekend for reasons that said nothing about the product. Rest days are now
chosen relative to today.

## Why this exists

The backend has always been covered and repeatable: six suites, ~200 checks,
one command each. The frontend was covered and *not* repeatable. Everything the
2026-08-06 changelog claims about the phone layout was proven with throwaway
puppeteer scripts that no longer exist, so the guarantees could not be
re-checked and would have rotted on the next CSS change without anyone knowing.

The first run of the committed replacement found three real defects that the
one-off scripts had missed, including the consent banner sitting on top of the
onboarding CTA — the first tap of the funnel, unreachable on a phone. That is
the argument for this file in one sentence.

## The standing gate

Everything here passes before a commit. Nothing is skipped because a change
"only touched CSS" — the consent-banner defect only touched CSS.

```bash
# backend — seven suites, throwaway SQLite each, no shared state
cd backend
for t in smoke_test.py smoke_test_material_edit.py smoke_test_hardening.py \
         smoke_test_privacy.py smoke_test_admin.py smoke_test_availability.py \
         smoke_test_logging.py; do
  .venv/bin/python $t | tail -1
done

# frontend — types, lint, build
cd ../frontend
npx tsc --noEmit          # must be silent
npm run lint              # must be exactly the baseline below
npm run build             # must succeed, 17 routes, static rendering preserved

# colour — required after ANY change to a token, gradient stop or glass alpha
node scripts/validate_contrast.mjs   # text on glass AND on the bare field
node scripts/validate_palette.mjs    # chart ramps, incl. deuteranopia

# browser — both servers must already be up (see below)
npm run verify
```

**Lint baseline: 4 errors, all `react-hooks/set-state-in-effect`**, in
`admin/page.tsx`, `calendar/page.tsx`, `missions/[id]/page.tsx` and
`components/darkchrome.tsx`. They pre-date this work. More than 4, or a
different rule, is a regression.

### Running the browser suites

`npm run verify` starts nothing and asserts both servers are answering first.
It registers throwaway accounts through the real API, so **never point it at
production**.

```bash
# backend on a throwaway database — never the demo DB you care about
cd backend && DATABASE_URL="sqlite:///./verify.db" \
  .venv/bin/uvicorn app.main:app --port 8000
cd frontend && npm run dev
cd frontend && npm run verify
```

`verify/mobile.mjs` (44 checks) locks the phone layout: every route in both
themes, no horizontal overflow, no control below the tap-target floor, nothing
permanently covered, plus the consent banner's own state. `verify/loop.mjs`
(31 checks) walks the product: onboard → plan → tick a task → the counter moves
→ the calendar agrees → **a logged day can be corrected from the calendar** →
the schedule can still be corrected.

Both servers must be on the ports the suites expect (`3000`/`8000`). If a stale
dev server holds 3000, Next silently moves to 3001 and the API rejects the CORS
preflight — which surfaces as an 8-second timeout inside `onboard()` and looks
exactly like a broken onboarding flow. Check the ports before believing it.

If a suite is ever run against a database you meant to keep, it leaves
`verify+…@example.com` accounts behind. Delete them — `funnel.py` counts them,
and a funnel with fake rows in it is worse than no funnel.

Chrome is found at the usual macOS/Linux paths; override with `CHROME_PATH`.

### Two habits worth keeping

**A suite that has never gone red proves nothing.** Every check here was
confirmed by breaking the thing it guards and watching it fail. The overflow
check silently passed for its whole first life because `.ob-root` sets
`overflow-y: auto`, which computes `overflow-x` to `auto` too — a 520px child
scrolled *inside* the container and `documentElement.scrollWidth` never moved.
It only surfaced because the break test was run.

**Never click-test against a database you care about.** It burned this project
once. `verify.db` is disposable and gitignored.

## Gates for the remaining plan items

### Honest day logging · **shipped 2026-08-12, gated**

`backend/smoke_test_logging.py` (49 checks) plus the correction block in
`verify/loop.mjs`. Found in live use by the owner, so the suite is written
against what actually happened rather than against the API surface.

What is locked: a reported **0 does not mark a task done** and is stored as a 0
rather than discarded; a reported zero is distinguishable from an untouched day
and survives a rebuild instead of being redistributed away; re-logging a day is
a **correction, not an addition**; un-ticking returns exactly what was logged
(the old code returned the *planned* amount, which destroyed real progress);
correcting an **earlier** day re-evaluates today, so missed work reappears
instead of being skipped; today's own row is still rebuilt from tomorrow so
toggling it cannot delete or duplicate it; a row ticked before
`actual_quantity` existed is still reversible; overshoot still cascades.

Also locked: **an unfinished past day does not display a page range.** A
description is a snapshot of the material's position when the row was built; if
the position later moves, a missed Tuesday keeps claiming pages that today has
correctly re-planned, and the app reads as though it went backwards. Completed
past days keep their range (real history), as do whole discrete items (a mock
exam's title names a thing, not a position).

Two load-bearing invariants:

1. **`completed` is derived from the amount, never set on its own.** Any future
   code that assigns `task.completed = True` directly re-introduces this bug.
2. **A stored `description` is only true for the position it was built at.**
   Anything rendering one for a past row goes through
   `plan._settled_description`.

### Item 2 — ask the one user why

Not a code gate, listed so it cannot quietly disappear. **Done** = their answer
is written into `PROJECT_STATE.md` with that account's `funnel.py` row next to
it, so the reply and the behaviour sit side by side.

### Item 3 — availability back in the flow · **shipped, gated**

`backend/smoke_test_availability.py` (27 checks) and the availability section
of `verify/loop.mjs`. What is locked: onboarding produces availability before
the goal exists, so the first schedule is already weighted; rest days get zero
tasks; the full material is still scheduled; hours are a weight, not a label;
a rest day today means `/today` is genuinely empty; an all-zero week falls back
to even distribution rather than a plan with no work in it.

### Item 4 — "I fell behind — fix my plan"

`PATCH /goals/{id}` already rebuilds on a deadline change
(`backend/app/routers/goals.py:55`); only the UI is missing. The gate is on
engine behaviour under it, not just on the button existing:

- moving a deadline out keeps completed history and does **not** move a day
  already worked on (`engine.rebuild_start_date`)
- trajectory and `days_behind` recompute against the new deadline
- dropping a material re-slices the remainder and loses no completed progress
- a tap-through in `verify/loop.mjs` reaching the new control from `/today`,
  because the point of the item is that the dead end currently has one exit

### Item 5 — daily email

There is no mail path in `backend/` today (no smtp / resend / sendgrid
anywhere). The gate is delivery-level, because a unit test that asserts "we
called send()" proves nothing about whether mail arrives:

- a real send to a real inbox from a **preview** deploy
- the link lands on `/today` already authenticated
- unsubscribe works and is honoured on the next run
- a user with no scheduled tasks receives **no** mail
- the provider comes through the Vercel Marketplace, not a hardcoded SDK

### Item 6 — timezone as a stored IANA string

Better scoped than it looks: there is one chokepoint. `_today()` at
`backend/app/routers/plan.py:28` is `datetime.now().date()`, and every `today`
computation flows through it; the direct `datetime.now().date()` calls in
`goals.py` and `auth.py` feed rebuilds. On Vercel that is UTC, so a Moscow user
opening the app at 01:00 local is served yesterday's tasks.

- IANA string captured at register (`Intl.DateTimeFormat().resolvedOptions().timeZone`)
- threaded through those call sites
- with a frozen clock at 23:30 UTC, an `Asia/Nicosia` account gets tomorrow's
  date while a `Pacific/Honolulu` account still gets yesterday's
- the frontend inconsistency resolves to one helper: `missions/[id]` marks
  TODAY via `toISOString` (UTC) while `/calendar` uses local time

This class of bug is not hypothetical here — `verify/lib.mjs`'s own
`isoInDays()` was written with `toISOString()` and produced an off-by-one
deadline the first time the suite ran past a date boundary.

## Verifying the product, not the code

```bash
cd backend && .venv/bin/python funnel.py                  # local
cd backend && set -a; . ./.env.local; set +a; .venv/bin/python funnel.py   # production
```

Read-only, writes nothing, masks the connection password. It prints where every
real account stopped:

```
registered → mission → availability → first tick → mission complete
```

This is the plan's success metric — *one person who is not Mark completes one
mission end to end* — made observable in one command instead of hand-written
SQL. It selects explicit columns rather than the whole mapper, so it keeps
working when the deployed schema lags the model by a cold start.

Run it before deciding what to build next. A funnel that stalls at
`availability` and one that stalls at `first tick` call for opposite work.

## Post-deploy check

Safe against production, because none of it writes:

- `GET /health` and `/docs` return 200
- an unauthenticated `GET /dashboard` returns 401
- the built frontend JS contains **zero** `localhost:8000` references
  (`NEXT_PUBLIC_API_URL` is baked in at build time — a rebuild is mandatory,
  not optional, whenever the backend URL changes)
- the security response headers are present
- `GET /internal/purge-expired-events` refuses without `CRON_SECRET`
- `funnel.py` still reports the accounts you expect

**Do not run `smoke_test.py` against production.** It registers real users; one
had to be deleted by hand on 2026-08-03.

## Known gaps, deliberately not gated

- **The Gboard word-reversal cannot be reproduced without a physical Android
  device.** Synthetic CDP IME events do not model Gboard's cached cursor state.
  What is automated is that the defective composited `filter` is gone and that
  a typed material name round-trips.
- **Accounts that set their rhythm before `availability_refined` existed** have
  the column defaulted to false, so they see "Sharpen your schedule" once more.
  Production had no such account when the column shipped; `funnel.py` prints
  `set` rather than guessing for schemas that predate it.
- **Preview deploys are still CORS-blocked** — the API pins
  `CORS_ORIGINS` to the production domain.
- **No error logging, uptime alerting, or CI.** The gate above is run by hand.
  CI is on the cut list until retention exists; when it arrives, it is this
  file's command block and nothing more.
- The everything else on the `PROJECT_STATE.md` cut list.
