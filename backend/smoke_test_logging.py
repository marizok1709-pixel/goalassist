"""Logging a day honestly: reported-zero, corrections, and un-ticking.

Written for the defect the owner hit in live use on 2026-08-12. He logged 0
problems and 0 pages for the previous day. The app marked the maths task **done**
— strike-through, "1/2 done" — while the engine recorded zero progress against
it, and the German plan carried on from pages nobody had read.

Three things were wrong and all three are locked here:

1. `completed` was set unconditionally in the completion branch, so
   `actual_quantity=0` produced a done task with no work behind it. A task row
   could only ever be *planned* or *done*; "I sat down and did none of it" was
   unrepresentable, and the 0 was used to build a message and then discarded.
2. Un-ticking subtracted the *planned* quantity rather than what was logged,
   because what was logged was never stored — so correcting a mistake destroyed
   real progress.
3. Completion rebuilt the schedule from tomorrow only, so correcting an earlier
   day never re-evaluated today. A missed day silently vanished: yesterday said
   pages 23-25, today still said 26-27, and the true remaining work only
   reappeared later in the week.
"""

import os
from datetime import date, timedelta

if os.path.exists("smoke_logging.db"):
    os.remove("smoke_logging.db")

import app.database as database
from sqlalchemy import create_engine
from sqlalchemy.orm import sessionmaker

database.engine = create_engine(
    "sqlite:///./smoke_logging.db", connect_args={"check_same_thread": False}
)
database.SessionLocal = sessionmaker(autocommit=False, autoflush=False, bind=database.engine)

from fastapi.testclient import TestClient  # noqa: E402
from app.main import app  # noqa: E402
from app.models import ScheduledTask  # noqa: E402

client = TestClient(app)
failures = []


def check(label, cond, detail=""):
    print(f"[{'PASS' if cond else 'FAIL'}] {label}{'' if cond else '  → ' + str(detail)}")
    if not cond:
        failures.append(label)


DAYS = ["mon", "tue", "wed", "thu", "fri", "sat", "sun"]
TODAY = date.today()
YESTERDAY = TODAY - timedelta(days=1)


def register(email: str) -> dict:
    r = client.post(
        "/auth/register", json={"name": "Logger", "email": email, "password": "loggingpass1"}
    )
    return {"Authorization": f"Bearer {r.json()['access_token']}"}


def make_mission(headers, total=30, days=9, unit="pages", already=0.0):
    """A mission whose every day is available, so the arithmetic stays readable."""
    client.patch("/auth/me", headers=headers, json={"availability": {d: 2.0 for d in DAYS}})
    gid = client.post(
        "/goals",
        headers=headers,
        json={"title": "TestDAF", "deadline": (TODAY + timedelta(days=days)).isoformat()},
    ).json()["id"]
    client.post(
        f"/goals/{gid}/materials",
        headers=headers,
        json={
            "name": "Mit Erfolg",
            "total_quantity": total,
            "unit": unit,
            "already_completed": already,
        },
    )
    return gid


def schedule(headers, gid, days=60):
    return client.get(f"/goals/{gid}/schedule", headers=headers, params={"days": days}).json()


def material_state(headers, gid):
    m = client.get(f"/goals/{gid}/plan", headers=headers).json()["materials"][0]
    return m["completed"], m["remaining"]


def backdate(task_id: int, to: date) -> None:
    """Move a row into the past. The engine only ever schedules forward, so a
    yesterday is otherwise unreachable through the API."""
    db = database.SessionLocal()
    db.get(ScheduledTask, task_id).date = to
    db.commit()
    db.close()


def get_task(task_id: int) -> dict:
    db = database.SessionLocal()
    t = db.get(ScheduledTask, task_id)
    out = {
        "date": t.date,
        "completed": t.completed,
        "actual_quantity": t.actual_quantity,
        "description": t.description,
        "quantity": t.quantity,
    }
    db.close()
    return out


# --------------------------------------------------------------------------
# 1. The reported zero — the exact shape of the live defect
# --------------------------------------------------------------------------
H = register("zero@example.com")
gid = make_mission(H)
first = schedule(H, gid)[0]
check("day one is scheduled", first["quantity"] > 0, first)
check("day one starts at the beginning", "1-" in first["description"], first["description"])

r = client.patch(f"/tasks/{first['id']}", headers=H, json={"completed": True, "actual_quantity": 0})
check("logging zero is accepted", r.status_code == 200, r.status_code)
body = r.json()
check("logging zero does NOT mark the task done", body["task"]["completed"] is False, body["task"])
check("the zero is stored, not discarded", body["task"]["actual_quantity"] == 0, body["task"])
done, remaining = material_state(H, gid)
check("logging zero records no progress", done == 0, done)
check("logging zero leaves the whole material outstanding", remaining == 30, remaining)
check("the message says nothing was done", "nothing" in (body["message"] or "").lower(), body["message"])

# --------------------------------------------------------------------------
# 2. A reported zero is not the same as an untouched day
#
# Both are "not done". Only one of them is a fact the user has told us, and a
# rebuild must not quietly delete it in order to re-plan the day.
# --------------------------------------------------------------------------
stored = get_task(first["id"])
check("zero-logged row survives as a reported day", stored["actual_quantity"] == 0.0, stored)
client.patch("/auth/me", headers=H, json={"availability": {d: 2.0 for d in DAYS}})
check("zero-logged row survives an availability rebuild", get_task(first["id"]) is not None)
check(
    "…and still carries its zero afterwards",
    get_task(first["id"])["actual_quantity"] == 0.0,
    get_task(first["id"]),
)

# --------------------------------------------------------------------------
# 3. Re-logging the same day is a correction, not a second helping
# --------------------------------------------------------------------------
client.patch(f"/tasks/{first['id']}", headers=H, json={"completed": True, "actual_quantity": 5})
done, _ = material_state(H, gid)
check("correcting 0 → 5 records 5", done == 5, done)
client.patch(f"/tasks/{first['id']}", headers=H, json={"completed": True, "actual_quantity": 2})
done, _ = material_state(H, gid)
check("correcting 5 → 2 records 2, not 7", done == 2, done)
client.patch(f"/tasks/{first['id']}", headers=H, json={"completed": True, "actual_quantity": 5})
done, _ = material_state(H, gid)
check("correcting 2 → 5 records 5, not 7", done == 5, done)

# --------------------------------------------------------------------------
# 4. Un-ticking gives back exactly what was logged — no more
#
# The old code subtracted the *planned* quantity. Logging 5 of a planned 3 and
# then un-ticking used to remove 3, stranding 2 points of phantom progress;
# logging 2 of a planned 3 and un-ticking removed 3, destroying real work.
# --------------------------------------------------------------------------
r = client.patch(f"/tasks/{first['id']}", headers=H, json={"completed": False})
done, _ = material_state(H, gid)
check("un-ticking a 5-logged task removes exactly 5", done == 0, done)
check("un-ticked row reports no amount", r.json()["task"]["actual_quantity"] is None, r.json())
check("un-ticked row is not done", r.json()["task"]["completed"] is False, r.json())

H2 = register("undertick@example.com")
gid2 = make_mission(H2)
t2 = schedule(H2, gid2)[0]
planned = t2["quantity"]
client.patch(f"/tasks/{t2['id']}", headers=H2, json={"completed": True, "actual_quantity": 1})
done, _ = material_state(H2, gid2)
check("logging 1 of a planned 3 records 1", done == 1, f"{done} (planned {planned})")
client.patch(f"/tasks/{t2['id']}", headers=H2, json={"completed": False})
done, _ = material_state(H2, gid2)
check("un-ticking it removes 1, not the planned 3", done == 0, done)

# --------------------------------------------------------------------------
# 5. Partial work is progress, but it is not a finished day
# --------------------------------------------------------------------------
H3 = register("partial@example.com")
gid3 = make_mission(H3)
t3 = schedule(H3, gid3)[0]
r = client.patch(f"/tasks/{t3['id']}", headers=H3, json={"completed": True, "actual_quantity": 1})
check("under-logging does not mark done", r.json()["task"]["completed"] is False, r.json()["task"])
check("under-logging stores the amount", r.json()["task"]["actual_quantity"] == 1, r.json()["task"])
r = client.patch(
    f"/tasks/{t3['id']}", headers=H3, json={"completed": True, "actual_quantity": t3["quantity"]}
)
check("logging the full amount does mark done", r.json()["task"]["completed"] is True, r.json())

# --------------------------------------------------------------------------
# 6. Overshoot still behaves (regression guard on adaptive completion)
# --------------------------------------------------------------------------
H4 = register("over@example.com")
gid4 = make_mission(H4)
t4 = schedule(H4, gid4)[0]
r = client.patch(
    f"/tasks/{t4['id']}", headers=H4, json={"completed": True, "actual_quantity": t4["quantity"] + 4}
)
check("overshoot marks the task done", r.json()["task"]["completed"] is True, r.json()["task"])
check("overshoot is reported", abs(r.json()["overshoot"] - 4) < 0.01, r.json()["overshoot"])
check("overshoot message still fires", "ahead of plan" in (r.json()["message"] or ""), r.json())
done, _ = material_state(H4, gid4)
check("overshoot cascades into later units", abs(done - (t4["quantity"] + 4)) < 0.01, done)

# --------------------------------------------------------------------------
# 7. THE HEADLINE: correcting an earlier day re-evaluates today
#
# Mark's German book. Yesterday's pages were never read; today must go back and
# ask for them instead of carrying on from a position nobody reached.
# --------------------------------------------------------------------------
H5 = register("yesterday@example.com")
gid5 = make_mission(H5)
sched = schedule(H5, gid5)
day1, day2 = sched[0], sched[1]
check("day two originally follows on from day one", "4-" in day2["description"], day2["description"])

backdate(day1["id"], YESTERDAY)
r = client.patch(f"/tasks/{day1['id']}", headers=H5, json={"completed": True, "actual_quantity": 0})
check("a past day can be logged at all", r.status_code == 200, r.status_code)

after = schedule(H5, gid5)
today_rows = [t for t in after if t["date"] == TODAY.isoformat()]
check("today still has work scheduled", len(today_rows) > 0, after[:3])
check(
    "today goes back for the missed pages instead of skipping them",
    "1-" in today_rows[0]["description"],
    today_rows[0]["description"],
)
check(
    "the missed pages are not scheduled twice",
    sum(t["quantity"] for t in after) == 30,
    sum(t["quantity"] for t in after),
)
check("the past row keeps its zero", get_task(day1["id"])["actual_quantity"] == 0.0, get_task(day1["id"]))
check("the past row is not marked done", get_task(day1["id"])["completed"] is False)

# --------------------------------------------------------------------------
# 8. Correcting an earlier day upward also re-evaluates today
# --------------------------------------------------------------------------
r = client.patch(f"/tasks/{day1['id']}", headers=H5, json={"completed": True, "actual_quantity": 6})
done, _ = material_state(H5, gid5)
check("the correction is recorded", done == 6, done)
after = schedule(H5, gid5)
today_rows = [t for t in after if t["date"] == TODAY.isoformat()]
check("today now starts after the corrected position", "7-" in today_rows[0]["description"], today_rows[0])
check(
    "still exactly the remaining work, no more",
    abs(sum(t["quantity"] for t in after) - 24) < 0.01,
    sum(t["quantity"] for t in after),
)

# --------------------------------------------------------------------------
# 9. Today's own row is still rebuilt from tomorrow
#
# Rebuilding from today while toggling today's row would delete or duplicate the
# row being toggled. That guard predates this fix and must survive it.
# --------------------------------------------------------------------------
H6 = register("todayrow@example.com")
gid6 = make_mission(H6)
t6 = schedule(H6, gid6)[0]
client.patch(f"/tasks/{t6['id']}", headers=H6, json={"completed": True, "actual_quantity": 1})
rows = [t for t in schedule(H6, gid6) if t["date"] == TODAY.isoformat()]
check("today's toggled row is not duplicated", len(rows) == 1, rows)
check("today's toggled row survives its own rebuild", rows[0]["id"] == t6["id"], rows)

# --------------------------------------------------------------------------
# 10. A row ticked before this column existed is still reversible
#
# Legacy rows carry actual_quantity = NULL. The only honest reading is the full
# planned amount, and un-ticking must not crash or drive a material negative.
# --------------------------------------------------------------------------
H7 = register("legacy@example.com")
gid7 = make_mission(H7, already=4.0)
t7 = schedule(H7, gid7)[0]
client.patch(f"/tasks/{t7['id']}", headers=H7, json={"completed": True})
db = database.SessionLocal()
db.get(ScheduledTask, t7["id"]).actual_quantity = None  # forge a pre-migration row
db.commit()
db.close()
before, _ = material_state(H7, gid7)
r = client.patch(f"/tasks/{t7['id']}", headers=H7, json={"completed": False})
check("un-ticking a legacy row succeeds", r.status_code == 200, r.status_code)
after_done, _ = material_state(H7, gid7)
check(
    "un-ticking a legacy row removes its planned amount",
    abs((before - after_done) - t7["quantity"]) < 0.01,
    f"{before} → {after_done}, planned {t7['quantity']}",
)
check("the declared starting point survives", after_done >= 0, after_done)

print()
if failures:
    print(f"{len(failures)} FAILURES: {failures}")
    raise SystemExit(1)
print("ALL CHECKS PASSED")
