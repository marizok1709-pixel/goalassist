# Changelog

All notable changes to Goal Assist, newest first. Dates are yyyy-mm-dd.
This is a pre-beta product; entries focus on user-visible behaviour and notable
engineering decisions. Deeper resume context lives in `PROJECT_STATE.md`.

## 2026-08-16 — Phase 1 goes live, and two defects only production could find

The pivot reached real users: feasibility before commitment, a projected finish
date instead of a percentage, and honest day logging. Backend first, then the
frontend. Two defects shipped with it, both now gated.

### Fixed

- **Every mission became unreadable for logged-in users.** `Enum(GoalPriority)`
  persists the member *name* (`normal`), but the migration defaulted the new
  column to the *value* (`NORMAL`), so the cold start stamped all four
  production goals with a string the ORM refuses to load and every authenticated
  read threw `LookupError`. `/health` and `/dashboard` stayed green throughout,
  because neither loads a goal. Rows rewritten, column default reset, and
  `migrate.py` corrected.
- **`/missions/new` did not fit an iPhone.** iOS Safari sizes a native
  `input[type="date"]` to its formatted value and will not shrink below it, so a
  Russian-locale date ("16 августа 2026 г.") pushed the page ~120px past the
  viewport; everything but the fixed tab bar sat off-screen and every label was
  cut in half. Dropping the native appearance lets the declared width win.

### Added

- **`scripts/verify_claims.py`** — 14 checks asserting the *documents* still
  describe the real code, run as part of the standing gate. It exists because
  three claims turned out to be false at once: `funnel.py`'s schema-lag
  resilience, "PR #1 still open", and Phase 1's cutover being finished. Check J
  covers the migration defect above; the mobile suite gained 18 checks covering
  the date one.
- **One plan instead of seven.** `PROJECT_STATE.md` went from 681 lines to the
  plan alone; the session logs it duplicated now live here. The Obsidian vault
  symlinks these files rather than copying them, so the two can no longer drift.

### Notes

- Production is confirmed on Neon `eu-central-1`, API pinned to `fra1` — the EU
  residency question `PRIVACY.md` listed as open.
- Task #2149 needed no repair: the dry run showed the phantom tick already gone.
- **Neither defect was reachable by the local suites.** They build their schema
  with `create_all()` and never run the ALTER TABLE path, and headless Chrome
  shrinks a date control that Safari does not. 354 backend checks, 79 browser
  checks and a full gate were green while both were live.

## 2026-08-15 — the plan is computed, not remembered

Two pieces of work, one root cause between them.

### The bug the owner reported

The calendar showed a Friday owing 139 Stepik points beside a Saturday starting
at point 246 — 106 points belonging to nobody — and a TestDaF Saturday reading
"pages 24-26" beside a Sunday reading "pages 22-24", apparently walking
backwards.

The chunk generator was never at fault; it walks a cursor and always has. The
fault was that a **forward plan was persisted and then read on a later day than
it was written**. Friday passed without anyone opening the app, no write
happened, so nothing re-planned, and Saturday was still serving the row a build
from two days earlier had laid down.

- **A day that merely passes now re-plans.** `rebuild_schedule` was reachable
  only from write paths. `engine.needs_replan` + `Goal.replanned_on` gate a
  catch-up to once per day per mission, on read.
- **An upcoming row's range is derived at read time**, from the mission's live
  position, in one pass over one cursor (`engine.derive_descriptions`). Every
  read path goes through one `_display()` helper, so `/today` and `/calendar`
  can no longer disagree about the same task.
- **`POST /today/more` is gone.** It moved rows between days by reassigning
  `date`, which is how work landed on a Saturday the owner had declared a
  zero-hour day, carrying a range computed for a different date. Doing more than
  planned is already said properly by logging more than planned.
- **A day already reported on cannot receive a second generated row.**
- **`rebuild_schedule` flushes first.** The session runs with `autoflush=False`,
  so logging a *future* day from the calendar panel deleted the row being
  edited. Pre-existing since future-day editing shipped; found by the new tests.
- **Labels split three ways**: `— missed` (never opened), `— logged none`
  (reported zero), `logged 1 of 3 pages` (reported partial). "not done" was read
  as a quantity.

### Phase 1 of the pivot

Time is the scheduling currency; units are presentation. Feasibility is a
property of the student, not of a mission — one capacity pool, all missions
competing in it.

- **`app/services/planner.py`** — a pure module, no DB or HTTP:
  `plan(missions, capacity, history, today) -> Plan`. Five stages: demand,
  effective capacity, allocation, feasibility, schedule. Every tunable lives in
  `app/services/params.py`; `app/services/adapter.py` is the only place the ORM
  meets it.
- **A verdict before anything is written.** `POST /plan/preview` plans a mission
  that does not exist yet *alongside* the ones that do. The reality-check screen
  sits between the last onboarding question and creation, states the projected
  finish date, pre-selects the honest option, and never blocks — "start anyway"
  sets `launched_over_capacity`.
- **`ExecutionRecord` records what happened. There is no `PENDING`.** A row is
  written when its day arrives or is reported on, never ahead: a persisted
  forward plan is exactly what caused the bug above. `actual_minutes` is the
  first measurement this product has ever taken of how long work really takes.
- **Projected finish replaces 7% / 19% / 37%.** A date can be checked against a
  calendar; a percentage cannot be checked against anything.
- **Missed days are absorbed in silence** below a 15% rise in daily load, and
  surfaced once, for acknowledgment, above it.
- **Tone.** No WARNING, no WILL, no capitals. The number is enough.
- **Timezone is stored per student** (`User.timezone`, IANA). "Today" was the
  server's date — UTC on Vercel — so a Berlin student between midnight and 02:00
  was served yesterday. Phase 1 stacks four more date-triggered behaviours on
  that boundary, so it had to move first.
- **Availability is validated.** Those hours were relative weights the engine
  normalised away; they are now real capacity the verdict divides by.

### Gates

`smoke_test_replan.py` (18), `smoke_test_planner.py` (39), `smoke_test_golden.py`
(the owner's two real missions, pinned), `smoke_test_feasibility.py` (33).
Backend 11/11 suites. Both browser suites carry the reality-check screen and no
longer pin their rest days to the weekend — that made the core-loop suite fail
every Saturday for reasons unrelated to the product.

## 2026-08-12 — a logged zero is a real answer

Found by the owner using the product on his own TestDAF and EGE maths missions.
He reported 0 problems and 0 pages for the previous day. The app marked the
maths task **done** — strike-through, "1/2 done" — while the engine recorded no
progress at all, and the German plan carried on from pages nobody had read.
There was also no way to go back and correct it: refreshing changed nothing
because every screen was faithfully rendering rows that disagreed.

One defect underneath all three symptoms: **`completed` was a boolean with no
arithmetic behind it.**

### Fixed

- **Logging 0 no longer marks a task done.** `PATCH /tasks/{id}` set
  `task.completed = True` unconditionally, so `actual_quantity: 0` applied zero
  progress and then flipped the row to done anyway. Completion is now *derived*
  from the amount: report the planned amount and the day is done, report less
  and it is a reported day that is not finished.
- **The amount is now stored.** New `scheduled_tasks.actual_quantity` (nullable,
  additive migration). NULL means "never reported on", which is a different
  fact from a reported 0 — previously unrepresentable, so the 0 was used to
  build a message and then thrown away.
- **Un-ticking returns what was logged, not what was planned.** It used to
  subtract `task.quantity`: doing 40 of a planned 118, ticking, then un-ticking
  removed 118 and destroyed real progress. Only the delta between the stored
  amount and the new one is ever applied, which also makes re-logging a day a
  correction rather than a second helping.
- **Correcting an earlier day now re-evaluates today.** Completion rebuilt from
  tomorrow only, so a missed day silently vanished: yesterday said pages 23-25,
  today still said 26-27, and the true remaining work only reappeared later in
  the week. Editing a past day now rebuilds from today; editing today's own row
  still rebuilds from tomorrow, so it cannot delete or duplicate itself.
- **Rebuilds no longer eat reported days.** `rebuild_schedule` deleted every
  incomplete future row; it now keeps any row that was reported on, so a logged
  zero or a part-done day survives re-planning as history.
- **Progress corrections unwind from the tail.** The negative branch of
  `apply_progress` only touched the starting unit, leaving any overshoot that
  had spilled forward stranded. It now takes work back in the exact inverse
  order it was applied, keeping a material's progress contiguous — which
  `build_schedule` relies on when it computes "pages 21-23".

### Added

- **Any day can be corrected from the calendar.** The day-detail panel was
  display-only: `PATCH /tasks/{id}` never had a date restriction, but `/today`
  was the only screen in the app that called it, and it only ever renders
  today. The panel now carries a checkbox and a log/edit control for any date,
  past included.
- Days reported below plan say so in words — "logged 0 of 3 — the rest went
  back into your plan" — on both `/today` and the calendar, so a cleared tick
  is never the only signal.
- **A missed day states what it owed, not which pages it named.** Reported by
  the owner an hour after the first fix shipped, and the better bug of the two:
  Tuesday's card said "pages 23-25" while Wednesday correctly said "pages
  21-23", so the app looked like it was walking *backwards*. The arithmetic was
  right the whole time — a task's description is a snapshot taken when the row
  is built, and the material's position had since moved underneath it. An
  unfinished past day now reads "3 pages — not done". A **completed** past day
  keeps its range, because there the pages are real history; so does a whole
  discrete item like a mock exam, whose title names a thing rather than a
  position and cannot go stale.
- `backend/smoke_test_logging.py` (49 checks) and 5 new browser checks in
  `verify/loop.mjs`. See `VERIFICATION.md`.
- `backend/repair_task.py` — dry-run-by-default repair for rows written while
  the bug was live, where un-ticking through the API would subtract a quantity
  the material never received.

## 2026-08-07 — "Bloom": rose glass replaces both themes

Owner decision this session, and it **reverses** the 2026-07-28 decision that
the dark slate system won: colour *is* the background now. A vivid rose→violet
gradient field carries the page and frosted panels float over it holding all
the text. "Burnt sienna" (light) and "Stormy morning" (dark) are retired.

Because every component already reads semantic tokens and never a raw hex, this
was a change to `globals.css` plus four small component touches — no page was
rewritten.

### Changed

- **Light = "Bloom"**, rose→violet field on `#fff6f9`. **Dark = "Nocturne"**,
  plum→indigo on `#120c17` — the same hue family rather than an unrelated
  second design.
- **Real glass in both themes.** Light mode previously faked it with an opaque
  card, because a pale background gives a blur nothing to work with; the
  saturated field is what makes glass possible, which is the whole argument for
  the direction. Panels now carry `blur(28px) saturate(180%)`, a specular top
  edge, and a shadow that separates them from the field.
- **The primary button is the only opaque object on screen.** When every panel
  is see-through, a see-through button is just another panel — so it is a solid
  rose gradient, and that is the entire hierarchy.
- **The halftone burst is gone.** Dot texture and a saturated gradient compete
  for the same job. The cursor-tracking variables survive and now drift the
  field's first bloom instead.
- Top bar and bottom tab bar became glass; `themeColor` follows the new grounds.

### Added

- `scripts/validate_contrast.mjs` — every text token against **two** surfaces:
  the glass composite and the bare field. 32 pairs, both themes.
- `scripts/validate_palette.mjs` — the categorical chart ramps, including a
  deuteranopia simulation. `globals.css` had told you to run
  `scripts/validate_palette.js` for months; that file was never in the repo.

### Notable

- **The contrast maths drove the design, not the other way round.** Three
  findings, all caught by the validators before anything shipped: `--ink-muted`
  sat at **2.93:1** on the full-strength violet, so the violet's peak is capped
  at 0.82 and the lower two text steps were darkened; the first chart ramp put
  rose next to amber, which collapses to **6.9 ΔE** for a deuteranope — one
  colour, not two; and the dark ramp had the same problem between violet and
  green. Tightest margin now: 4.90:1 light, 4.75:1 dark.
- Verified: `npm run verify` 70/70 in both themes (no tap-target, overflow or
  reachability regressions), `tsc` clean, `next build` clean (17 routes), lint
  at its 4-error baseline, both validators green.

## 2026-08-07 — verification you can re-run

The mobile pass shipped real guarantees proven by scripts that were then thrown
away. This session turned them into something committed, plus a written gate
for the work still on the plan. `VERIFICATION.md` at the repo root is the
entry point.

### Fixed

- **The consent banner covered the onboarding button.** At 360×800 the point a
  thumb aims at for "Create account →" belonged to the banner, not the button —
  the first tap of the funnel was unreachable on a phone until the banner was
  dismissed, and the onboarding screen centres itself in a fixed viewport so it
  could not be scrolled clear. The banner now publishes its measured height as
  `--ga-consent-h`, which the onboarding step and page content reserve.
- **It also covered the entire bottom tab bar** on every signed-in route.
  Page content can be scrolled out from under an overlay; fixed navigation
  cannot. The tab bar marks itself with `data-tabbar` and the banner now stacks
  above it.
- **Two controls below the tap-target floor** the mobile pass claimed
  everything cleared: "What we collect" in the banner (16px tall) and `edit` on
  mission detail (22px wide, four characters with no horizontal padding).
- **The dashboard nudged forever.** "Sharpen your schedule" was shown when
  every day's hours were 0 or exactly the onboarding default — but `/timing`
  steps in whole hours, so a student who deliberately sets 2h on each study day
  was indistinguishable from one who never opened the page. It now reads a
  stored `availability_refined` flag that `/timing` sets when it saves.

### Added

- **`frontend/verify/`** — two committed browser suites, `npm run verify`
  (70 checks — 44 + 26 — and no new dependency; `puppeteer-core` was already
  installed).
  `mobile.mjs` sweeps every route in both themes at 360×800 for horizontal
  overflow, tap-target size and reachability, plus the consent banner's own
  state. `loop.mjs` walks the product the way a student does: onboard through
  the rhythm step → the plan respects rest days → tick a task → the counter
  moves → the calendar agrees → the schedule can still be corrected.
- **`backend/smoke_test_availability.py`** — 27 checks locking the onboarding
  rhythm step: rest days get no tasks, hours act as weights, availability is
  saved before the goal exists, an all-zero week still produces a plan.
- **`backend/funnel.py`** — read-only report of where every real account
  stopped (`registered → mission → availability → first tick → mission
  complete`). The plan's success metric in one command instead of hand-written
  SQL against Neon. Masks the connection password; selects explicit columns so
  it survives the deployed schema lagging the model.
- **`VERIFICATION.md`** — the standing pre-commit gate, a gate written in
  advance for plan items 4, 5 and 6, the post-deploy check, and the list of
  gaps deliberately left ungated.

### Notable

- **The overflow check had been passing vacuously.** `.ob-root` sets
  `overflow-y: auto`, and per spec that computes `overflow-x` to `auto` too, so
  a 520px child scrolls *inside* the container and `documentElement.scrollWidth`
  never grows. Any horizontal overflow introduced since the mobile pass would
  have gone unreported. Found only because every new check was confirmed by
  breaking the thing it guards and watching it fail — a habit now written into
  `VERIFICATION.md`.
- `availability_refined` is an additive column, applied by `app/migrate.py` on
  the next cold start. Accounts that set a rhythm before it existed default to
  false and will see the nudge once more; production had no such account.

## 2026-08-06 — mobile is the product

The last open defect the first beta user reported. Owner decision this session:
**phones are the baseline, desktop is the enhancement** — every screen is now
designed and verified at 360×800 first. A native app stays deferred; the web
layout has to be right before anything gets wrapped. The re-ranked plan behind
this (and what got cut) is at the top of `PROJECT_STATE.md`.

### Fixed

- **The navigation ate the top of every page.** Ten links in one `flex-wrap`
  row collapsed into four stacked lines at 360px. Phones now get a 56px top bar
  (wordmark · theme · menu) plus a **bottom tab bar** carrying the core loop —
  dashboard, today, calendar — because thumbs reach the bottom of a phone, not
  the top. Everything secondary moved behind the menu. Desktop keeps the
  original row; it was never the problem.
- **The calendar was unreadable.** `grid-cols-7` was hardcoded with no
  breakpoint, so each column was ~46px and every task title broke one word per
  line. The grid keeps its shape on a phone and drops to **load dots** —
  one dot per task, green done / red missed / accent pending — while the
  day-detail panel below carries the titles, which is what it was always for.
  Desktop still shows full columns.
- **The completion checkbox was nearly invisible.** `accent-color` only paints
  a checkbox when it is *checked*; unchecked, on the dark theme, it rendered as
  a near-black square with no visible edge — it read as a disabled placeholder
  rather than the control the whole product depends on. It is now drawn
  explicitly: a bordered empty box, a filled accent box with a checkmark when
  done, in a 48px label so a thumb can hit it. Worth noting the first beta user
  ticked 0 of 26 tasks on a phone.
- **Undersized tap targets** across `/today`, the dashboard, mission detail,
  new-mission, login and onboarding — inline text links 16–20px tall are now
  ≥32px. Every control on every route passes.
- **`/missions/new` material rows** needed 282px of fixed columns before the
  name field got a single pixel (~14px wide at 360). Name takes its own row on
  a phone; the three small fields share the next one.
- **Type scale** on onboarding, the dashboard hero and mission detail — 60px
  headings on a 360px screen, now stepped per breakpoint.
- Number inputs declare `inputMode`, so Android offers the right keypad.

### Added

- `viewport` export in the root layout: `viewportFit: "cover"` (so
  `env(safe-area-inset-*)` reports real numbers and the tab bar clears the home
  indicator) and per-theme `themeColor` (so the browser's own chrome matches the
  app). Pinch-zoom is deliberately **not** disabled.

Verified with headless Chrome at 360×800, touch emulation on: 9 routes with
**zero horizontal overflow and zero undersized tap targets**, and an 11-check
loop test that taps the tab bar, taps the checkbox, and confirms the task
completes and the counter moves — in both themes. `tsc` clean, `next build`
clean (17 routes, static rendering preserved), lint unchanged from baseline,
backend suites 24/25/16 all passing.

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
