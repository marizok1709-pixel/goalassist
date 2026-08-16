"""Reporting a day by naming the day, not by naming a row.

A row id only exists because the forward plan is still persisted. It is the last
thing forcing that, so the report has to move onto the identity it actually has:
*this mission, that date*. This suite locks the new endpoint's behaviour now,
while it still resolves to a stored row, so that when the rows go the only thing
that may change is the resolution — never the meaning.

The equivalence check is the load-bearing one. Two endpoints that write days are
two chances to disagree, which is the whole family of bug this project keeps
meeting; they share `_report_day`, and this proves it.
"""

import os
from datetime import date, timedelta

if os.path.exists("smoke_derived.db"):
    os.remove("smoke_derived.db")

import app.database as database
from sqlalchemy import create_engine
from sqlalchemy.orm import sessionmaker

database.engine = create_engine(
    "sqlite:///./smoke_derived.db", connect_args={"check_same_thread": False}
)
database.SessionLocal = sessionmaker(autocommit=False, autoflush=False, bind=database.engine)

from fastapi.testclient import TestClient  # noqa: E402
from app.main import app  # noqa: E402
from app.models import ExecutionRecord, ScheduledTask  # noqa: E402

client = TestClient(app)
failures = []


def check(label, cond, detail=""):
    print(f"[{'PASS' if cond else 'FAIL'}] {label}{'' if cond else '  → ' + str(detail)}")
    if not cond:
        failures.append(label)


DAYS = ["mon", "tue", "wed", "thu", "fri", "sat", "sun"]
TODAY = date.today()
# Every day is a study day, so which weekday this runs on cannot decide the
# result. That has now broken two suites.
AVAIL = {d: 2.0 for d in DAYS}


def register(email):
    # Registered with **no** timezone on purpose. Everything below anchors to
    # `date.today()` — the machine's date — while the API answers from the
    # student's zone. This laptop runs UTC+3; a Europe/Berlin account is a day
    # behind it for an hour either side of midnight, and the suite then reports
    # "today" to an API that thinks today is tomorrow. It cost a debugging
    # session to learn twice.
    r = client.post(
        "/auth/register",
        json={"name": "D", "email": email, "password": "derived1"},
    )
    h = {"Authorization": f"Bearer {r.json()['access_token']}"}
    client.patch("/auth/me", headers=h, json={"availability": AVAIL})
    return h


def make_mission(h, title="Book", total=120, done=0):
    gid = client.post(
        "/goals", headers=h,
        json={"title": title, "deadline": (TODAY + timedelta(days=30)).isoformat()},
    ).json()["id"]
    client.post(
        f"/goals/{gid}/materials", headers=h,
        json={"name": "Pages", "total_quantity": total, "unit": "pages",
              "already_completed": done, "minutes_per_unit": 5.0},
    )
    return gid


def records(goal_id, day=None):
    with database.SessionLocal() as db:
        q = db.query(ExecutionRecord).filter(ExecutionRecord.goal_id == goal_id)
        if day is not None:
            q = q.filter(ExecutionRecord.date == day)
        return q.all()


# --------------------------------------------------------- the day-keyed report
H = register("day@example.com")
gid = make_mission(H)

r = client.patch(
    f"/goals/{gid}/days/{TODAY.isoformat()}",
    headers=H,
    json={"completed": True, "actual_quantity": 3, "actual_minutes": 20},
)
check("a day can be reported by naming it", r.status_code == 200, r.text[:200])

recs = records(gid)
check("reporting writes exactly one execution record", len(recs) == 1, len(recs))
check("…for the day that was named", recs and recs[0].date == TODAY, recs and recs[0].date)
check("…carrying the minutes the student gave", recs and recs[0].actual_minutes == 20,
      recs and recs[0].actual_minutes)
check("…and the units", recs and abs(recs[0].actual_units - 3) < 1e-6,
      recs and recs[0].actual_units)

# A correction is a correction, not a second helping.
client.patch(
    f"/goals/{gid}/days/{TODAY.isoformat()}",
    headers=H,
    json={"completed": True, "actual_quantity": 5, "actual_minutes": 30},
)
recs = records(gid)
check("re-reporting corrects rather than duplicating", len(recs) == 1, len(recs))
check("…and holds the corrected amount", recs and abs(recs[0].actual_units - 5) < 1e-6,
      recs and recs[0].actual_units)

before = client.get(f"/goals/{gid}/plan", headers=H).json()
progressed = before["materials"][0]["completed"]
check("the correction reached the material, once", abs(progressed - 5) < 1e-6, progressed)

# Un-reporting: the day goes back to never-reported. "Nothing happened" and
# "nobody said" are different claims.
client.patch(f"/goals/{gid}/days/{TODAY.isoformat()}", headers=H, json={"completed": False})
check("un-reporting removes the record entirely", len(records(gid)) == 0, len(records(gid)))
after = client.get(f"/goals/{gid}/plan", headers=H).json()
check("…and gives the work back to the plan",
      abs(after["materials"][0]["completed"]) < 1e-6, after["materials"][0]["completed"])

# ------------------------------------------------------------------ equivalence
# The same report through both doors must land in the same place, or the two
# write paths have already begun to disagree.
Ha, Hb = register("eqa@example.com"), register("eqb@example.com")
ga, gb = make_mission(Ha, "A"), make_mission(Hb, "B")

today_a = client.get("/today", headers=Ha).json()
task_id = [t for m in today_a["missions"] for t in m["tasks"]][0]["id"]
row = client.patch(f"/tasks/{task_id}", headers=Ha,
                   json={"completed": True, "actual_quantity": 4, "actual_minutes": 25}).json()
day = client.patch(f"/goals/{gb}/days/{TODAY.isoformat()}", headers=Hb,
                   json={"completed": True, "actual_quantity": 4, "actual_minutes": 25}).json()

check("both doors report the same overshoot", row["overshoot"] == day["overshoot"],
      f'{row["overshoot"]} vs {day["overshoot"]}')
check("both doors report the same message", row["message"] == day["message"],
      f'{row["message"]!r} vs {day["message"]!r}')
ra, rb = records(ga)[0], records(gb)[0]
check("both write one record with the same units and status",
      (ra.actual_units, ra.status) == (rb.actual_units, rb.status),
      f"{(ra.actual_units, ra.status)} vs {(rb.actual_units, rb.status)}")
check("both record the same minutes", ra.actual_minutes == rb.actual_minutes,
      f"{ra.actual_minutes} vs {rb.actual_minutes}")

pa = client.get(f"/goals/{ga}/plan", headers=Ha).json()["materials"][0]["completed"]
pb = client.get(f"/goals/{gb}/plan", headers=Hb).json()["materials"][0]["completed"]
check("both leave the material in the same position", abs(pa - pb) < 1e-6, f"{pa} vs {pb}")

# ------------------------------------------------------------------- the guards
r = client.patch(
    f"/goals/{gb}/days/{(TODAY + timedelta(days=9000)).isoformat()}",
    headers=Hb, json={"completed": True},
)
check("a day with nothing planned is refused, not invented", r.status_code == 404, r.status_code)

r = client.patch(f"/goals/{ga}/days/{TODAY.isoformat()}", headers=Hb, json={"completed": True})
check("another student's mission is not reportable", r.status_code == 404, r.status_code)

r = client.patch(f"/goals/{gb}/days/not-a-date", headers=Hb, json={"completed": True})
check("a malformed day is rejected", r.status_code == 422, r.status_code)

# ------------------------------------------------- correcting a day not yet due
# A live 500, found while writing this suite and pre-dating it: reporting a
# future day from the calendar worked, un-reporting it did not. Un-ticking puts
# the day back to never-reported, which is precisely the state the rebuild is
# entitled to delete — so the row the response described stopped existing
# mid-request and `db.refresh` raised. The product offers this control on the
# calendar, so it was reachable in production.
Hf = register("future@example.com")
gf = make_mission(Hf, "Future")
upcoming = [s for s in client.get(f"/goals/{gf}/schedule", headers=Hf).json()
            if s["date"] > TODAY.isoformat()]
check("a mission has days ahead of it to correct", len(upcoming) > 0, len(upcoming))
fut = upcoming[0]

r = client.patch(f"/goals/{gf}/days/{fut['date']}", headers=Hf,
                 json={"completed": True, "actual_quantity": 2})
check("a day that has not arrived can be reported", r.status_code == 200, r.text[:160])

r = client.patch(f"/goals/{gf}/days/{fut['date']}", headers=Hf, json={"completed": False})
check("…and un-reported without a 500", r.status_code == 200, r.text[:160])

pf = client.get(f"/goals/{gf}/plan", headers=Hf).json()["materials"][0]["completed"]
check("…giving the work back to the plan", abs(pf) < 1e-6, pf)

r = client.patch(f"/tasks/{fut['id']}", headers=Hf, json={"completed": False})
check("the row-keyed door survives the same correction",
      r.status_code in (200, 404), r.status_code)

# ------------------------------------------------------- what is actually stored
# The number the cutover exists to move. Recorded here so the change is visible
# in a suite rather than only in a migration note.
with database.SessionLocal() as db:
    future = db.query(ScheduledTask).filter(ScheduledTask.date > TODAY).count()
print(f"\n       forward rows currently persisted: {future}")

print()
if failures:
    print(f"{len(failures)} FAILED: {failures}")
    raise SystemExit(1)
print("ALL CHECKS PASSED")
