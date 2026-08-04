# Privacy — what GoalAssist collects, and why

This describes the technical reality of the system: what is stored, where, for
how long, and what a user can do about it. It is written for whoever maintains
this code next.

**This is not a legal document and not a compliance certificate.** GDPR
obligations depend on how the product is deployed, who is targeted, and what
agreements exist with the hosting and database providers. The measures below are
designed to *support* compliance; a lawyer still has to look at the deployment
before anyone claims the product is compliant. Two known gaps are listed at the
bottom.

---

## What is collected

### 1. Account data — needed to run the product

| Field | Why |
|---|---|
| Email | Sign-in, account recovery |
| Password (PBKDF2 hash) | Sign-in. The plaintext is never stored or logged |
| Display name | Greeting the user by name |
| University, degree, year | Optional profile fields, user-supplied |
| Weekly availability | The schedule engine weights work by study hours |

### 2. Product data — the thing the user came to use

Missions, materials, progress units, scheduled tasks and completion history.
This is the user's own content. It is never used for analytics and never leaves
their account.

### 3. Usage analytics — **only after explicit opt-in**

Nothing in this category is collected until the user actively accepts. Declining
means none, not less. See "Consent" below.

| Field | Shape | Why |
|---|---|---|
| Event name | From a fixed allow-list | Which features get used |
| Event props | Small scalars only, strings truncated to 64 chars | Counts and enums, e.g. `{materials: 3}` |
| Path | `/today`, `/calendar` … | Which screens get used |
| Session id | Random per browser tab, dies with the tab | Stitching one visit together |
| Device class | `mobile` / `tablet` / `desktop` | The first beta user was on a phone and the layout broke |
| Browser family | `chrome`, `safari`, … | Compatibility triage |
| Viewport width | Integer | Responsive breakpoint decisions |
| Language | e.g. `ru`, `de-DE` | Whether to translate the product |
| Country | Two-letter code from the edge proxy | Rough audience geography |
| Referrer **host** | e.g. `t.me` — never the full URL | Where signups come from |

### What is deliberately **not** collected

- **No IP addresses.** There is no column for one. Country comes from an edge
  header; the address itself is never read into the application.
- **No user-agent strings** — only a coarse browser family.
- **No full URLs or query strings** — path only, so search terms and ids in a
  referrer cannot leak in.
- **No mission content in analytics.** Book titles, goal names and notes never
  appear in an event.
- **No third-party analytics, no advertising SDKs, no tracking cookies.** Events
  go to our own backend and nowhere else.
- **No cross-site or cross-device identifiers.** The session id is random and
  scoped to a single tab.

---

## Consent

- Default is **off**. A new visitor is collected on zero times before deciding.
- The banner offers accept and decline with equal visual weight. Neither is
  preselected, and declining is not made harder than accepting.
- The decision is stored locally (`goalassist_consent`) and, for signed-in
  users, on the account (`users.analytics_consent`) so it survives a new device.
- **The server enforces it independently.** `POST /analytics/events` drops
  everything from a user whose `analytics_consent` is false, regardless of what
  the client claims. The browser-side gate is a courtesy, not the control.
- **Withdrawing consent deletes what was already collected** for that user, not
  just future events.

---

## Where it is stored

- **Database:** Neon serverless Postgres (EU region should be verified — see
  gaps). Reached only by the backend.
- **Backend:** FastAPI on Vercel Functions.
- **Frontend:** Next.js on Vercel. Stores only `acadassist_token` (session JWT),
  `goalassist_theme`, `goalassist_consent` and a per-tab session id in the
  browser. None of these are advertising or cross-site identifiers.
- Analytics never transit a third party.

---

## Retention

| Data | Retained |
|---|---|
| Analytics events | **180 days**, then deleted by `purge_expired_events()` |
| Account + product data | Until the user deletes their account |
| Deleted accounts | Removed immediately, no soft-delete or archive |

`RETENTION_DAYS` lives in `backend/app/routers/privacy.py`. The purge is
implemented and tested; **scheduling it is still a deployment task** (see gaps).

---

## User rights, and where they are implemented

| Right | How | Endpoint |
|---|---|---|
| Access + portability | Settings → *Download your data* → one JSON file | `GET /me/export` |
| Erasure | Settings → *Delete your account* (type `DELETE`) | `DELETE /me` |
| Withdraw consent | Settings → *Usage analytics* → Turn off | `PUT /me/consent` |
| Rectification | Settings, mission and material editors | existing CRUD |

Erasure cascades: goals → materials → progress units → scheduled tasks, and all
analytics events for that user. Verified in `backend/smoke_test_privacy.py`.

---

## Adding a new tracked event

1. **Ask whether you need it.** An event you cannot name a decision for is data
   you should not hold. Data minimisation is a requirement, not a preference.
2. Add the name to `EventName` in `frontend/src/lib/analytics.ts` **and** to
   `ALLOWED_EVENTS` in `backend/app/routers/privacy.py`. Both are required —
   unknown names are dropped server-side, silently and on purpose.
3. **Props: counts and enums only.** No free text, no names, no email, no
   titles, no IDs that point at a person. The server keeps only scalars and
   truncates strings to 64 characters, but that is a backstop, not permission.
4. Call `analytics.track("your_event", { count: 3 })`. Never call the ingest
   endpoint directly — that bypasses the consent gate.
5. Add a row to the table above in this file.
6. If the event could identify someone, it needs its own consent basis. Stop and
   ask rather than folding it into the existing opt-in.

**Rule of thumb:** if you would be uncomfortable showing a user the exact row
stored about them, do not store it.

---

## Known gaps

Honest list of what is *not* done:

1. **The retention purge is not scheduled.** `purge_expired_events()` exists and
   is tested, but nothing calls it on a timer yet. Until a cron job runs it,
   the 180-day limit is a policy on paper. This is the most important open item.
2. **Data residency is unverified.** The Neon region and the Vercel function
   region have not been confirmed as EU, and no processor agreements (DPAs) with
   Vercel or Neon have been reviewed. Both are required before EU users are
   recruited in earnest.
3. No formal record of processing activities, no named data controller contact
   published, and no defined breach-notification process.
4. The analytics opt-in is not versioned — if the scope of collection widens,
   existing consents should be re-asked, and there is currently no mechanism.
