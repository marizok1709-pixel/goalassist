# Changelog

All notable changes to Goal Assist, newest first. Dates are yyyy-mm-dd.
This is a pre-beta product; entries focus on user-visible behaviour and notable
engineering decisions. Deeper resume context lives in `PROJECT_STATE.md`.

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
