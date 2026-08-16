"""A day that passes without being reported on is a change to the plan.

Written for the defect the owner hit in live use on 2026-08-15. The calendar
showed a Friday owing 139 Stepik points, and a Saturday starting at point 246 —
a gap of 106 points that belonged to nobody. Beside it, TestDAF read "pages
24-26" on Saturday and "pages 22-24" on Sunday, apparently walking backwards.

Both came from the same place, and it was not the chunk generator: that walks a
cursor and has always produced contiguous ranges. It was that a *plan* was
persisted and then read on a later day than it was written.

1. Nothing re-planned when a day merely went by. `rebuild_schedule` was reachable
   only from write paths, so a Friday nobody opened left every later row quoting
   a position the mission never reached. The 106 points were not lost — they
   were still sitting on Friday's row, and Saturday had been laid down back when
   Friday was expected to happen.
2. A row's description was stamped in at build time and never revisited, so two
   rows written by two different builds disagreed. Saturday and Sunday were both
   correct about the moment they were written and contradicted each other on
   screen.
3. `POST /today/more` moved rows between days by reassigning `date`, which put
   work on a zero-hour Saturday still carrying Sunday's page range. It is gone;
   `smoke_test.py` holds that.

The invariant these lock: an upcoming row's range is derived from the mission's
live position at read time, never read back from the row. Contiguity stops being
something the stored data has to preserve.
"""

import os
from datetime import date, timedelta

if os.path.exists("smoke_replan.db"):
    os.remove("smoke_replan.db")

import app.database as database
from sqlalchemy import create_engine
from sqlalchemy.orm import sessionmaker

database.engine = create_engine(
    "sqlite:///./smoke_replan.db", connect_args={"check_same_thread": False}
)
database.SessionLocal = sessionmaker(autocommit=False, autoflush=False, bind=database.engine)

from fastapi.testclient import TestClient  # noqa: E402
from app.main import app  # noqa: E402
from app.models import Goal, ScheduledTask  # noqa: E402

client = TestClient(app)
failures = []


def db_rows_after(goal_id):
    db = database.SessionLocal()
    rows = list(db.query(ScheduledTask).filter(ScheduledTask.goal_id == goal_id))
    db.close()
    return rows


def check(label, cond, detail=""):
    print(f"[{'PASS' if cond else 'FAIL'}] {label}{'' if cond else '  → ' + str(detail)}")
    if not cond:
        failures.append(label)


DAYS = ["mon", "tue", "wed", "thu", "fri", "sat", "sun"]
TODAY = date.today()


def register(email: str) -> dict:
    r = client.post(
        "/auth/register", json={"name": "Replan", "email": email, "password": "replanpass1"}
    )
    return {"Authorization": f"Bearer {r.json()['access_token']}"}


def make_mission(headers, total, days, unit="pages", availability=None):
    client.patch(
        "/auth/me",
        headers=headers,
        json={"availability": availability or {d: 2.0 for d in DAYS}},
    )
    gid = client.post(
        "/goals",
        headers=headers,
        json={"title": "Mission", "deadline": (TODAY + timedelta(days=days)).isoformat()},
    ).json()["id"]
    client.post(
        f"/goals/{gid}/materials",
        headers=headers,
        json={"name": "Book", "total_quantity": total, "unit": unit, "already_completed": 0.0},
    )
    return gid


def calendar(headers, lo, hi):
    return client.get(
        "/calendar", headers=headers, params={"start": lo.isoformat(), "end": hi.isoformat()}
    ).json()


def ranges_of(rows):
    """(start, end) for every row whose description names one."""
    out = []
    for r in rows:
        tail = r["description"].rsplit(" ", 1)[-1]
        if "-" in tail:
            lo, hi = tail.split("-")
            if lo.isdigit() and hi.isdigit():
                out.append((r["date"], int(lo), int(hi)))
    return out


def backdate(gid, days):
    """Drag a mission's whole schedule into the past — the day going by, simulated."""
    db = database.SessionLocal()
    for t in db.query(ScheduledTask).filter(ScheduledTask.goal_id == gid):
        t.date = t.date - timedelta(days=days)
    goal = db.get(Goal, gid)
    goal.start_date = goal.start_date - timedelta(days=days)
    goal.replanned_on = None
    db.commit()
    db.close()


# ---------------------------------------------------------------- case 19
# A plan computed on Friday, read on Saturday, with Friday never reported.
# The first upcoming row must start where the missed one did — no gap.

H = register("replan-gap@replan.example.com")
gid = make_mission(H, total=100, days=10)

before = client.get(f"/goals/{gid}/schedule", headers=H, params={"days": 60}).json()
check("a fresh mission schedules something", len(before) > 0, str(len(before)))
first_start = ranges_of(before)[0][1]
check("and starts at the beginning", first_start == 1, str(first_start))

# Two days go by. Nobody opens the app; nothing is reported.
backdate(gid, 2)

rows = calendar(H, TODAY - timedelta(days=5), TODAY + timedelta(days=30))
upcoming = [r for r in rows if r["date"] >= TODAY.isoformat()]
missed = [r for r in rows if r["date"] < TODAY.isoformat()]

check("the missed days are still on the calendar as history", len(missed) > 0, str(len(missed)))
check(
    "and they say they were missed, not what they owed in pages",
    all("missed" in r["description"] for r in missed),
    [r["description"] for r in missed],
)

up_ranges = ranges_of(upcoming)
check("the plan still has upcoming work", len(up_ranges) > 0, str(len(up_ranges)))
check(
    "the next day picks up at page 1 — the missed work was absorbed, not skipped",
    up_ranges[0][1] == 1,
    str(up_ranges[0]),
)
check(
    "and the plan still runs to the end of the book",
    up_ranges[-1][2] == 100,
    str(up_ranges[-1]),
)

# ---------------------------------------------------------------- case 20
# Contiguity across the whole tail. Every range picks up exactly where the
# previous one stopped — this is the "24-26 then 22-24" reversal, generalised.

gaps = [
    (up_ranges[i][0], up_ranges[i][2], up_ranges[i + 1][0], up_ranges[i + 1][1])
    for i in range(len(up_ranges) - 1)
    if up_ranges[i + 1][1] != up_ranges[i][2] + 1
]
check("every upcoming range starts one past the previous one", not gaps, gaps)
check(
    "no upcoming range ever goes backwards",
    all(up_ranges[i + 1][1] > up_ranges[i][2] for i in range(len(up_ranges) - 1)),
    up_ranges,
)

# ---------------------------------------------------------------- case 21
# Logging today must not leave today's own row quoting an older position.
# The rebuild deliberately starts at tomorrow, so today's row is never rewritten
# — its range has to be derived rather than stored.

H2 = register("replan-today@replan.example.com")
gid2 = make_mission(H2, total=60, days=12)
today_rows = client.get("/today", headers=H2).json()["missions"][0]["tasks"]
check("today has a task", len(today_rows) == 1, str(len(today_rows)))
planned = today_rows[0]["quantity"]

client.patch(
    f"/goals/{today_rows[0]['goal_id']}/days/{today_rows[0]['date']}", headers=H2, json={"completed": True, "actual_quantity": 1}
)

rows2 = calendar(H2, TODAY, TODAY + timedelta(days=30))
after_today = ranges_of([r for r in rows2 if r["date"] > TODAY.isoformat()])
check("tomorrow onwards still has ranges", len(after_today) > 0, str(len(after_today)))
check(
    "tomorrow resumes at page 2 — the one page logged today is behind the cursor",
    after_today[0][1] == 2,
    str(after_today[0]),
)
check(
    "the tail stays contiguous after a partial log",
    all(after_today[i + 1][1] == after_today[i][2] + 1 for i in range(len(after_today) - 1)),
    after_today,
)
check("the partially logged day is not marked done", planned > 1, str(planned))

# ---------------------------------------------------------------- case 22
# A day already reported on must not receive a second, freshly generated row.
# Reachable today: the calendar panel lets any day be logged, including a future
# one, and that row survives every rebuild.

H3 = register("replan-dup@replan.example.com")
gid3 = make_mission(H3, total=80, days=14)
sched = client.get(f"/goals/{gid3}/schedule", headers=H3, params={"days": 60}).json()
future = next(r for r in sched if r["date"] > TODAY.isoformat())
future_date = future["date"]

client.patch(
    f"/goals/{future['goal_id']}/days/{future['date']}", headers=H3, json={"completed": True, "actual_quantity": 1}
)
# Force a rebuild that spans the reported future day.
client.post(f"/goals/{gid3}/schedule/rebuild", headers=H3)

rows3 = calendar(H3, TODAY, TODAY + timedelta(days=40))
on_that_day = [r for r in rows3 if r["date"] == future_date]
check(
    "a day reported ahead of time keeps exactly one row after a rebuild",
    len(on_that_day) == 1,
    [r["description"] for r in on_that_day],
)

# ---------------------------------------------------------------- case 23
# The catch-up runs once a day, not on every read. A write on a GET is
# acceptable; a write on every GET is not.

H4 = register("replan-once@replan.example.com")
gid4 = make_mission(H4, total=50, days=10)
backdate(gid4, 3)

client.get("/today", headers=H4)
db = database.SessionLocal()
ids_first = sorted(t.id for t in db.query(ScheduledTask).filter(ScheduledTask.goal_id == gid4))
db.close()
# `Goal.replanned_on` used to be stamped here: the day-turn catch-up gated a
# rebuild to once per day, because a stored plan had to be repaired after a day
# went by. There is nothing to repair now — the plan is computed from the
# mission's live position on every read, so a day that passes unreported is
# absorbed by definition rather than by a scheduled visit. The property that
# check was protecting is the one directly above: the missed work reappears.
check("nothing beyond today was written down",
      all(t.date <= TODAY for t in db_rows_after(gid4)), "a future row was persisted")

client.get("/today", headers=H4)
client.get("/calendar", headers=H4, params={"start": TODAY.isoformat(), "end": TODAY.isoformat()})
db = database.SessionLocal()
ids_second = sorted(t.id for t in db.query(ScheduledTask).filter(ScheduledTask.goal_id == gid4))
db.close()
check("further reads on the same day rebuild nothing", ids_first == ids_second,
      f"{len(ids_first)} rows -> {len(ids_second)} rows")

# ---------------------------------------------------------------- case 24
# Zero-hour days stay empty. This is what `/today/more` used to violate by
# dragging rows onto a Saturday the owner had declared unavailable.

H5 = register("replan-zero@replan.example.com")
avail = {d: 2.0 for d in DAYS} | {"sat": 0.0, "sun": 0.0}
gid5 = make_mission(H5, total=60, days=21, availability=avail)
rows5 = calendar(H5, TODAY, TODAY + timedelta(days=21))
weekend = [
    r for r in rows5
    if date.fromisoformat(r["date"]).weekday() >= 5 and r["date"] >= TODAY.isoformat()
]
check("no work lands on a zero-hour day", not weekend, [r["date"] for r in weekend])

print()
if failures:
    print(f"{len(failures)} FAILURES: {failures}")
    raise SystemExit(1)
print("ALL CHECKS PASSED")
