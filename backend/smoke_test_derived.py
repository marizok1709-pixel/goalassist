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
from app.services import engine  # noqa: E402

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

# ------------------------------------------------- the forward plan is derived
# The invariant the whole cutover exists to establish. An upcoming day is a
# computation, not a record: it has no row, therefore no id, therefore nothing
# can name it except the mission and the date.
Ha = register("eqa@example.com")
ga = make_mission(Ha, "A")

today_rows = [t for m in client.get("/today", headers=Ha).json()["missions"] for t in m["tasks"]]
check("today still has work to do", len(today_rows) > 0, today_rows)

# Today is written down — it has arrived, and a day that goes by unreported has
# to leave a trace or missed days would vanish from the calendar. Everything
# *after* today is a computation and has no row to be named by.
sched = client.get(f"/goals/{ga}/schedule", headers=Ha).json()
ahead = [t for t in sched if t["date"] > TODAY.isoformat()]
check("the schedule reaches past today", len(ahead) > 0, len(ahead))
check("no day beyond today carries a row id",
      all(t["id"] is None for t in ahead), [t["id"] for t in ahead][:5])

with database.SessionLocal() as db:
    check("and nothing was written for a day that has not arrived",
          db.query(ScheduledTask).filter(ScheduledTask.date > TODAY).count() == 0,
          db.query(ScheduledTask).filter(ScheduledTask.date > TODAY).count())

# The row-keyed door is gone, not merely unused.
r = client.patch("/tasks/1", headers=Ha, json={"completed": True})
check("the row-keyed endpoint no longer exists", r.status_code == 404, r.status_code)

# Reporting still works, and a reported day *does* become a record.
client.patch(f"/goals/{ga}/days/{TODAY.isoformat()}", headers=Ha,
             json={"completed": True, "actual_quantity": 4, "actual_minutes": 25})
check("reporting a derived day still records it", len(records(ga)) == 1, len(records(ga)))
pa = client.get(f"/goals/{ga}/plan", headers=Ha).json()["materials"][0]["completed"]
check("…and moves the material", abs(pa - 4) < 1e-6, pa)

Hb = register("eqb@example.com")
gb = make_mission(Hb, "B")

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

# ------------------------------------------- three materials, one Monday
# Sima's IELTS mission, 2026-08-17: Listening, Speaking and Writing all due the
# same day. Ticking "Writing" crossed out "Listening", because the report was
# keyed by (mission, date) and the first row won. Then the other two stopped
# working entirely, because a reported day was struck out for *every* material
# on it. Both are identity bugs: a day of a mission is not one piece of work.
Hm = register("multi@example.com")
gm = client.post("/goals", headers=Hm, json={
    "title": "Pass IELTS", "deadline": (TODAY + timedelta(days=40)).isoformat()}).json()["id"]
for name in ("Listening", "Speaking", "Writing"):
    client.post(f"/goals/{gm}/materials", headers=Hm, json={
        "name": name, "total_quantity": 20, "unit": "H/w", "already_completed": 0,
        "minutes_per_unit": 30.0})

day = [t for m in client.get("/today", headers=Hm).json()["missions"] for t in m["tasks"]]
check("all three materials land on the same day", len(day) == 3, [t["description"] for t in day])
by_name = {t["description"].split(":")[0]: t for t in day}
check("…and they are three different materials",
      len({t["material_id"] for t in day}) == 3, [t["material_id"] for t in day])

# Tick the LAST one. Only that one may change.
writing = by_name.get("Writing") or day[2]
r = client.patch(f"/goals/{gm}/days/{TODAY.isoformat()}", headers=Hm,
                 json={"completed": True, "material_id": writing["material_id"],
                       "actual_quantity": 1})
check("the third material can be reported", r.status_code == 200, r.text[:160])

recs = records(gm)
check("exactly one record was written", len(recs) == 1, len(recs))
check("…against the material that was actually ticked",
      recs and recs[0].material_id == writing["material_id"],
      f"{recs[0].material_id if recs else None} vs {writing['material_id']}")

after = [t for m in client.get("/today", headers=Hm).json()["missions"] for t in m["tasks"]]
check("the other two are still there afterwards", len(after) == 3,
      [t["description"] for t in after])
done_now = [t for t in after if t["completed"]]
check("…and exactly one of them is crossed out", len(done_now) == 1,
      [t["description"] for t in done_now])
check("…the one that was ticked",
      done_now and done_now[0]["material_id"] == writing["material_id"],
      done_now[0]["description"] if done_now else None)

# And the remaining two must still be reportable — this is the half Sima hit
# second: once the first was crossed out, the others stopped responding.
speaking = by_name.get("Speaking") or day[1]
r = client.patch(f"/goals/{gm}/days/{TODAY.isoformat()}", headers=Hm,
                 json={"completed": True, "material_id": speaking["material_id"],
                       "actual_quantity": 1})
check("a second material on the same day is still reportable", r.status_code == 200, r.text[:160])
check("and now two records exist, not one overwritten", len(records(gm)) == 2, len(records(gm)))

# The skip is keyed by material, not by date — tested against the generator
# directly, because through the API it cannot be made to fail: only stored days
# feed the skip set, and nothing ahead of today is stored. Exercised here so the
# property is actually proven rather than assumed.
from app.models import Goal as _Goal  # noqa: E402

with database.SessionLocal() as _db:
    _g = _db.get(_Goal, gm)
    _first = _g.materials[0]
    _day = TODAY + timedelta(days=2)
    by_date = engine.build_schedule(_g, TODAY, availability=AVAIL, skip_dates={_day})
    by_mat = engine.build_schedule(
        _g, TODAY, availability=AVAIL, skip_by_material={_first.id: {_day}}
    )
    on_day_date = {t["material_id"] for t in by_date if t["date"] == _day}
    on_day_mat = {t["material_id"] for t in by_mat if t["date"] == _day}
    check("a date-keyed skip empties the day for every material",
          len(on_day_date) == 0, on_day_date)
    check("a material-keyed skip leaves the other materials on that day",
          len(on_day_mat) >= 1 and _first.id not in on_day_mat,
          f"materials still on {_day}: {on_day_mat}")

# Naming no material on an ambiguous day is refused rather than guessed.
r = client.patch(f"/goals/{gm}/days/{TODAY.isoformat()}", headers=Hm, json={"completed": True})
check("an ambiguous day is refused, not guessed", r.status_code == 422, r.status_code)

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

r = client.patch(f"/goals/{fut['goal_id']}/days/{fut['date']}", headers=Hf, json={"completed": False})
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
