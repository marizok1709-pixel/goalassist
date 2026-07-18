# AcadAssist Backend (FastAPI)

## Run

```bash
cd backend
python3 -m venv .venv          # first time only
.venv/bin/pip install -r requirements.txt
.venv/bin/uvicorn app.main:app --reload --port 8000
```

API docs: http://localhost:8000/docs

## Test

```bash
.venv/bin/python smoke_test.py
```

## API overview

| Method | Path | Purpose |
|---|---|---|
| POST | `/auth/register` | Create account, returns JWT |
| POST | `/auth/login` | Login, returns JWT |
| GET/PATCH | `/auth/me` | Profile |
| POST/GET | `/goals` | Create / list missions |
| GET/PATCH/DELETE | `/goals/{id}` | Manage a mission |
| POST/GET | `/goals/{id}/materials` | Add materials (auto-sliced internally; `already_completed` sets the starting point) |
| PATCH | `/goals/{id}/materials/{mid}` | Set absolute progress ("I'm on page 120") |
| GET | `/goals/{id}/plan` | Planning Engine: required daily rate per material |
| GET | `/goals/{id}/schedule` | Upcoming schedule (Schedule Engine output) |
| POST | `/goals/{id}/schedule/rebuild` | Redistribute remaining work |
| GET | `/goals/{id}/history` | Past scheduled tasks (incl. missed) |
| GET | `/today` | Today's tasks across all active missions |
| POST | `/today/more` | Pull each mission's next scheduled day into today |
| PATCH | `/tasks/{id}` | Complete a task; `actual_quantity` logs more/less than planned |
| GET | `/dashboard` | All active missions + Reality Engine status |

Weekly availability (hours per weekday) lives on the user (`PATCH /auth/me` with
`availability`); saving it rebuilds every active mission's schedule. The Schedule
Engine weights days by those hours — a 0-hour day gets no tasks.

## Reality Engine

- Expected progress is linear from `start_date` to `deadline`. Missions declare
  their starting point at creation (start date + already-completed per material),
  so trajectory is honest from day one — no calibration period.
- Overall progress = mean of per-material completion % (a 400-page book and 10 exams weigh equally).
- `trajectory_ratio = actual% / expected%` → AHEAD ≥ 1.05 > ON_TRACK ≥ 0.9 > AT_RISK ≥ 0.7 > OFF_TRACK;
  FAILED once the deadline passes, COMPLETED at 100%.
- When behind, per-material adjustments show the new required daily rate vs the original plan.

## Config

- `ACADASSIST_SECRET` — JWT signing key (required in production).
- DB: SQLite file `acadassist.db` (swap `SQLALCHEMY_DATABASE_URL` for PostgreSQL later).
