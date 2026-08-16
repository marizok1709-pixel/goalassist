"""The pivot through the API: a verdict before creation, and a record after.

`smoke_test_planner.py` proves the arithmetic. This proves the product actually
exposes it — that a student can be told a mission does not fit *before* anything
is written, that starting anyway is recorded rather than refused, and that a
reported day leaves an ExecutionRecord with the one measurement the product has
never taken.

Acceptance scenario B, restated as a rule rather than a number: if this silently
accepts, the pivot failed; if it refuses to let the student proceed, the pivot
also failed.
"""

import os
from datetime import date, timedelta

if os.path.exists("smoke_feas.db"):
    os.remove("smoke_feas.db")

import app.database as database
from sqlalchemy import create_engine, select
from sqlalchemy.orm import sessionmaker

database.engine = create_engine(
    "sqlite:///./smoke_feas.db", connect_args={"check_same_thread": False}
)
database.SessionLocal = sessionmaker(autocommit=False, autoflush=False, bind=database.engine)

from fastapi.testclient import TestClient  # noqa: E402
from app.main import app  # noqa: E402
from app.models import DayStatus, ExecutionRecord, Goal  # noqa: E402

client = TestClient(app)
failures = []


def check(label, cond, detail=""):
    print(f"[{'PASS' if cond else 'FAIL'}] {label}{'' if cond else '  → ' + str(detail)}")
    if not cond:
        failures.append(label)


DAYS = ["mon", "tue", "wed", "thu", "fri", "sat", "sun"]
TODAY = date.today()


def register(email, tz="Europe/Berlin"):
    r = client.post(
        "/auth/register",
        json={"name": "F", "email": email, "password": "feasible1", "timezone": tz},
    )
    return {"Authorization": f"Bearer {r.json()['access_token']}"}, r.json()["user"]


# ---------------------------------------------------------------- timezone
H, u = register("tz@example.com")
check("the browser's zone is stored at register", u["timezone"] == "Europe/Berlin", u)
_, u2 = register("badtz@example.com", tz="Mars/Olympus_Mons")
check("an unresolvable zone is stored as NULL, not rejected", u2["timezone"] is None, u2)
_, u3 = register("notz@example.com", tz=None)
check("registering without one still works", u3["timezone"] is None, u3)

# ---------------------------------------------------------------- ACCEPTANCE B
# 1,400 problems, 8h a week, a deadline that cannot hold them.
# 8h a week. Anchored so today is always a study day — otherwise the section
# below has nothing to report on, and which weekday the suite runs on would
# decide whether it passes.
eight_h = {d: 0.0 for d in DAYS}
for d in (DAYS[TODAY.weekday()], DAYS[(TODAY.weekday() + 2) % 7],
          DAYS[(TODAY.weekday() + 4) % 7], DAYS[(TODAY.weekday() + 5) % 7]):
    eight_h[d] = 2.0
client.patch("/auth/me", headers=H, json={"availability": eight_h})

deadline = TODAY + timedelta(days=16)
body = {
    "title": "EGE math",
    "deadline": deadline.isoformat(),
    "materials": [{
        "name": "Stepik problems", "total_quantity": 1400, "unit": "problems",
        "already_completed": 0, "minutes_per_unit": 3.0,
    }],
}
r = client.post("/plan/preview", headers=H, json=body)
check("a verdict exists before the mission does", r.status_code == 200, r.text[:200])
f = r.json()
check("B: it says this does not fit", f["verdict"] == "OVER_CAPACITY", f["verdict"])
check("B: it names the real finish date",
      f["projected_finish"] is not None and f["projected_finish"] > f["deadline"],
      f"{f['projected_finish']} vs {f['deadline']}")
check("B: and how many days late that is", f["days_late"] > 0, f["days_late"])
print(f"       B → {f['verdict']}, deadline {f['deadline']}, finish {f['projected_finish']} "
      f"({f['days_late']}d late)")

# The three concrete alternatives, with the honest one first.
check("B: offers a deadline that would work",
      f["suggested_deadline"] == f["projected_finish"], f["suggested_deadline"])
check("B: offers a scope that would fit",
      f["suggested_scope"] is not None and 0 < f["suggested_scope"]["units"] < 1400,
      f["suggested_scope"])
check("B: offers the hours it would take, or admits there are none",
      "suggested_weekly_hours" in f, f.get("suggested_weekly_hours"))
print(f"       alternatives → move to {f['suggested_deadline']}, "
      f"cut to {f['suggested_scope']['units']} of 1400 {f['suggested_scope']['unit']}, "
      f"or {f['suggested_weekly_hours']}h/week")

check("B: nothing was written — the student can still change their mind",
      client.get("/goals", headers=H).json() == [], client.get("/goals", headers=H).json())

check("B: the daily cap that shaped the verdict is disclosed",
      f["daily_cap_minutes"] == 240.0, f["daily_cap_minutes"])

# Proceeding anyway is allowed, and recorded.
gid = client.post("/goals", headers=H,
                  json={"title": "EGE math", "deadline": deadline.isoformat(),
                        "launched_over_capacity": True}).json()["id"]
client.post(f"/goals/{gid}/materials", headers=H,
            json={"name": "Stepik problems", "total_quantity": 1400, "unit": "problems",
                  "minutes_per_unit": 3.0})
db = database.SessionLocal()
goal = db.get(Goal, gid)
check("B: launching over capacity is recorded on the mission",
      goal.launched_over_capacity is True, goal.launched_over_capacity)
db.close()

plan_r = client.get(f"/goals/{gid}/plan", headers=H).json()
check("B: the mission still reports the honest verdict after creation",
      plan_r["reality"]["verdict"] == "OVER_CAPACITY", plan_r["reality"]["verdict"])
check("B: and states the date rather than shouting",
      "WARNING" not in plan_r["reality"]["message"]
      and "WILL" not in plan_r["reality"]["message"]
      and plan_r["reality"]["projected_finish"] is not None,
      plan_r["reality"]["message"])
print(f"       after creation → \"{plan_r['reality']['message']}\"")

# ---------------------------------------------------------------- ACCEPTANCE A
H2, _ = register("a@example.com")
# Anchored to today for the same reason acceptance B is: this section asserts
# that today holds work, so pinning the rest day to Sunday let the weekday the
# suite happened to run on decide whether it passed. It ran on a Sunday.
twelve_h = {d: 2.0 for d in DAYS}
twelve_h[DAYS[(TODAY.weekday() + 1) % 7]] = 0.0
client.patch("/auth/me", headers=H2, json={"availability": twelve_h})
r = client.post("/plan/preview", headers=H2, json={
    "title": "TestDaF",
    "deadline": (TODAY + timedelta(days=89)).isoformat(),
    "materials": [{"name": "Mit Erfolg", "total_quantity": 161, "unit": "pages",
                   "already_completed": 80, "minutes_per_unit": 6.0}],
})
fa = r.json()
check("A: a verdict", fa["verdict"] in ("COMFORTABLE", "FEASIBLE", "TIGHT"), fa["verdict"])
check("A: a projected finish date", fa["projected_finish"] is not None, fa)
check("A: it fits, so no alternatives are pushed",
      fa["suggested_deadline"] is None and fa["days_late"] == 0, fa)
print(f"       A → {fa['verdict']}, finish {fa['projected_finish']}")

gid2 = client.post("/goals", headers=H2, json={
    "title": "TestDaF", "deadline": (TODAY + timedelta(days=89)).isoformat()}).json()["id"]
client.post(f"/goals/{gid2}/materials", headers=H2, json={
    "name": "Mit Erfolg", "total_quantity": 161, "unit": "pages",
    "already_completed": 80, "minutes_per_unit": 6.0})
today_r = client.get("/today", headers=H2).json()
tasks = [t for m in today_r["missions"] for t in m["tasks"]]
check("A: today's work is stated in units", tasks and tasks[0]["quantity"] > 0, tasks)
mins = today_r["missions"][0].get("minutes_today")
plan2 = client.get(f"/goals/{gid2}/plan", headers=H2).json()
check("A: …and in minutes", plan2["reality"]["minutes_today"] > 0,
      plan2["reality"]["minutes_today"])
print(f"       A today → {tasks[0]['quantity']:g} pages / "
      f"{plan2['reality']['minutes_today']:g} min")

# ---------------------------------------------------------------- no estimate
H3, _ = register("noest@example.com")
client.patch("/auth/me", headers=H3, json={"availability": eight_h})
r = client.post("/plan/preview", headers=H3, json={
    "deadline": (TODAY + timedelta(days=16)).isoformat(),
    "materials": [{"name": "Stepik", "total_quantity": 1400, "unit": "points"}],
})
fn = r.json()
check("with no estimate there is no invented date",
      fn["verdict"] == "NO_ESTIMATE" and fn["projected_finish"] is None, fn)
check("…but there is still a rate the student can check",
      fn["required_units_per_hour"] and fn["required_units_per_hour"] > 50,
      fn["required_units_per_hour"])
print(f"       no estimate → {fn['required_units_per_hour']:g} points/hour needed")

# ---------------------------------------------------------------- portfolio
# The pivot's own done-when: 8h a week does not cover both live missions.
#
# Registered with **no** timezone on purpose. Everything below anchors its
# availability to `date.today()` and then asserts that today holds work, and the
# server now answers "what day is it" from the *student's* zone. On a machine
# running ahead of Berlin those are different dates — which is the feature
# working, and a reason for the test not to assume they agree. No zone means the
# server falls back to its own clock, which is the one this file is reading.
H4, _ = register("both@example.com", tz=None)
client.patch("/auth/me", headers=H4, json={"availability": eight_h})
g_td = client.post("/goals", headers=H4, json={
    "title": "TestDAF TDN16", "deadline": (TODAY + timedelta(days=87)).isoformat()}).json()["id"]
client.post(f"/goals/{g_td}/materials", headers=H4, json={
    "name": "Mit Erfolg", "total_quantity": 161, "unit": "pages",
    "already_completed": 21, "minutes_per_unit": 6.0})
g_ege = client.post("/goals", headers=H4, json={
    "title": "EGE math", "deadline": (TODAY + timedelta(days=16)).isoformat()}).json()["id"]
client.post(f"/goals/{g_ege}/materials", headers=H4, json={
    "name": "Stepik problems", "total_quantity": 1497, "unit": "points",
    "already_completed": 106, "minutes_per_unit": 3.0})

dash = client.get("/dashboard", headers=H4).json()
verdicts = {g["goal"]["title"]: g["reality"]["verdict"] for g in dash["goals"]}
check("the two real missions are planned as one portfolio",
      verdicts.get("EGE math") == "OVER_CAPACITY", verdicts)
check("…and TestDaF is not falsely condemned with it",
      verdicts.get("TestDAF TDN16") != "OVER_CAPACITY", verdicts)
for g in dash["goals"]:
    print(f"       {g['goal']['title']:16} {g['reality']['verdict']:14} "
          f"finish {g['reality']['projected_finish']}")

# ---------------------------------------------------------------- ExecutionRecord
tasks4 = [t for m in client.get("/today", headers=H4).json()["missions"] for t in m["tasks"]]
check("there is something to report today", len(tasks4) > 0, tasks4)
tid = tasks4[0]["id"]
r = client.patch(f"/tasks/{tid}", headers=H4,
                 json={"completed": True, "actual_quantity": 5, "actual_minutes": 42})
check("a day can be reported with the time it took", r.status_code == 200, r.text[:200])

db = database.SessionLocal()
recs = list(db.scalars(select(ExecutionRecord)))
check("reporting writes exactly one execution record", len(recs) == 1, len(recs))
rec = recs[0]
check("…with the amount actually done", rec.actual_units == 5, rec.actual_units)
check("…with the minutes it actually took — the calibration input",
      rec.actual_minutes == 42, rec.actual_minutes)
check("…and a status that is not PENDING",
      rec.status in (DayStatus.completed, DayStatus.partial, DayStatus.skipped), rec.status)
check("no record is ever written ahead of its day",
      all(x.date <= TODAY for x in recs), [x.date for x in recs])
db.close()

# Correcting the same day rewrites the record rather than filing a second.
client.patch(f"/tasks/{tid}", headers=H4,
             json={"completed": True, "actual_quantity": 9, "actual_minutes": 70})
db = database.SessionLocal()
recs = list(db.scalars(select(ExecutionRecord)))
check("re-reporting corrects the record instead of duplicating it",
      len(recs) == 1 and recs[0].actual_units == 9, [(x.actual_units) for x in recs])
db.close()

# Un-ticking removes it: "never reported" and "reported nothing" are different.
client.patch(f"/tasks/{tid}", headers=H4, json={"completed": False})
db = database.SessionLocal()
check("un-ticking removes the record entirely",
      len(list(db.scalars(select(ExecutionRecord)))) == 0)
db.close()

# A reported zero is a record, not an absence.
client.patch(f"/tasks/{tid}", headers=H4, json={"completed": True, "actual_quantity": 0})
db = database.SessionLocal()
recs = list(db.scalars(select(ExecutionRecord)))
check("a reported zero is recorded as SKIPPED, not as silence",
      len(recs) == 1 and recs[0].status == DayStatus.skipped,
      [(x.status, x.actual_units) for x in recs])
check("…and its minutes stay NULL rather than being invented",
      recs[0].actual_minutes is None, recs[0].actual_minutes)
db.close()

print()
if failures:
    print(f"{len(failures)} FAILURES: {failures}")
    raise SystemExit(1)
print("ALL CHECKS PASSED")
