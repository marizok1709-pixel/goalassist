# AcadAssist — MVP v0.1

Deadline-driven academic execution system. A student creates a **Mission** with a
hard deadline, enters real **Materials** (book pages, mock exams, vocab sets),
the system slices them into **Progress Units**, computes the required daily pace,
and the **Reality Engine** bluntly reports whether the current pace will hit the
deadline. No AI — pure math. The goal of the MVP is to validate the execution loop.

## Run locally

Backend (FastAPI + SQLite, port 8000):

```bash
cd backend
python3 -m venv .venv && .venv/bin/pip install -r requirements.txt   # first time
.venv/bin/uvicorn app.main:app --reload --port 8000
```

Frontend (Next.js, port 3000):

```bash
cd frontend
npm install        # first time
npm run dev
```

Open http://localhost:3000 — register, or use the seeded demo account:
`demo@acadassist.app` / `demo1234`.

## Structure

- `backend/` — FastAPI app: auth (JWT), goals, materials, progress units,
  Planning Engine + Reality Engine (`app/services/engine.py`), daily plan.
  API docs at http://localhost:8000/docs. Tests: `.venv/bin/python smoke_test.py`.
- `frontend/` — Next.js 16 + Tailwind v4 "Mission Control" UI (dark).
  Pages: dashboard, new-mission wizard, mission detail, login/register.

## MVP success criteria

10 students, 30 days, ≥50% weekly retention. Ship, recruit, measure.
