"""End-to-end smoke test: auth -> goal -> auto-sliced materials -> availability-weighted
schedule -> today -> adaptive completion -> do-more -> reality."""

import os
import sys
from collections import defaultdict
from datetime import date, timedelta

if os.path.exists("smoke_test.db"):
    os.remove("smoke_test.db")

import app.database as database
from sqlalchemy import create_engine
from sqlalchemy.orm import sessionmaker

database.engine = create_engine("sqlite:///./smoke_test.db", connect_args={"check_same_thread": False})
database.SessionLocal = sessionmaker(autocommit=False, autoflush=False, bind=database.engine)

from fastapi.testclient import TestClient
from app.main import app

client = TestClient(app)
failures = []


def check(name, cond, detail=""):
    mark = "PASS" if cond else "FAIL"
    print(f"[{mark}] {name}" + (f" — {detail}" if detail else ""))
    if not cond:
        failures.append(name)


# 1. Auth
r = client.post("/auth/register", json={
    "email": "alex@tum.de", "password": "secret123", "name": "Alex", "university": "TUM"})
check("register", r.status_code == 201, str(r.status_code))
H = {"Authorization": f"Bearer {r.json()['access_token']}"}

# 2. Goal started 10 days ago, 90 days total
start = date.today() - timedelta(days=10)
deadline = start + timedelta(days=90)
gid = client.post("/goals", headers=H, json={
    "title": "Pass TestDaF TDN4", "deadline": deadline.isoformat(), "start_date": start.isoformat(),
}).json()["id"]

# 3. AUTO-SLICING — no chunk input anywhere
client.post(f"/goals/{gid}/materials", headers=H, json={
    "name": "Mit Erfolg zum digitalen TestDaF", "total_quantity": 400, "unit": "pages"})
client.post(f"/goals/{gid}/materials", headers=H, json={
    "name": "Mock exams", "total_quantity": 10, "unit": "exams"})
units = client.get(f"/goals/{gid}/units", headers=H).json()
book_units = [u for u in units if u["unit"] == "pages"]
exam_units = [u for u in units if u["unit"] == "exams"]
check("continuous material -> 1 running unit", len(book_units) == 1, str(len(book_units)))
check("countable material -> 1 unit per piece", len(exam_units) == 10, str(len(exam_units)))
check("piece titles", exam_units[0]["title"] == "Mock exams: exam #1", exam_units[0]["title"])

# The bug from the review: material without chunk info MUST still produce a schedule
sched = client.get(f"/goals/{gid}/schedule", headers=H, params={"days": 100}).json()
check("no-chunk material schedules fully",
      abs(sum(t["quantity"] for t in sched if t["material_id"] == 1) - 400) < 0.01,
      f"{sum(t['quantity'] for t in sched if t['material_id'] == 1)} pages scheduled")
day1 = [t for t in sched if t["date"] == date.today().isoformat()]
check("day-1 range description", "pages 1-" in day1[0]["description"], day1[0]["description"])

# 4. STARTING POINT — already_completed at creation, honest trajectory from day one
gid2 = client.post("/goals", headers=H, json={
    "title": "Linear Algebra Klausur", "deadline": (date.today() + timedelta(days=30)).isoformat(),
}).json()["id"]
client.post(f"/goals/{gid2}/materials", headers=H, json={
    "name": "Past exams", "total_quantity": 5, "unit": "exams", "already_completed": 2})
plan2 = client.get(f"/goals/{gid2}/plan", headers=H).json()
check("already_completed applied", plan2["materials"][0]["completed"] == 2,
      str(plan2["materials"][0]["completed"]))
check("no CALIBRATING: day-0 mission with progress is AHEAD",
      plan2["reality"]["status"] == "AHEAD", plan2["reality"]["status"])

gid3 = client.post("/goals", headers=H, json={
    "title": "Fresh from zero", "deadline": (date.today() + timedelta(days=20)).isoformat(),
}).json()["id"]
client.post(f"/goals/{gid3}/materials", headers=H, json={
    "name": "Essays", "total_quantity": 4, "unit": "essays"})
rr3 = client.get(f"/goals/{gid3}/plan", headers=H).json()["reality"]
check("no CALIBRATING: fresh mission is ON_TRACK (honest at day 0)",
      rr3["status"] == "ON_TRACK", rr3["status"])
print("   day-0 message:", rr3["message"])

# 5. AVAILABILITY — Tue = 0h, Wed double Mon
r = client.patch("/auth/me", headers=H, json={"availability": {
    "mon": 2, "tue": 0, "wed": 4, "thu": 2, "fri": 2, "sat": 3, "sun": 1}})
check("availability saved", r.status_code == 200 and r.json()["availability"]["wed"] == 4)
sched = client.get(f"/goals/{gid}/schedule", headers=H, params={"days": 100}).json()
by_weekday = defaultdict(float)
by_date = defaultdict(float)
for t in sched:
    if t["material_id"] == 1 and not t["completed"]:
        d = date.fromisoformat(t["date"])
        by_weekday[d.weekday()] += t["quantity"]
        by_date[t["date"]] += t["quantity"]
check("zero-hour day gets nothing", by_weekday.get(1, 0) == 0, f"Tue pages: {by_weekday.get(1, 0)}")
mon_avg = by_weekday[0] / max(sum(1 for d in by_date if date.fromisoformat(d).weekday() == 0), 1)
wed_avg = by_weekday[2] / max(sum(1 for d in by_date if date.fromisoformat(d).weekday() == 2), 1)
check("4h day carries ~2x the 2h day", 1.6 < wed_avg / mon_avg < 2.5, f"wed {wed_avg:.1f} vs mon {mon_avg:.1f}")

# 6. ADAPTIVE COMPLETION — planned N pages, did N+8
today_tasks = None
for m in client.get("/today", headers=H).json()["missions"]:
    if m["goal_id"] == gid and m["tasks"]:
        today_tasks = m["tasks"]
if not today_tasks:
    # Today may be a 0-hour day under the new availability; pull work in.
    for m in client.post("/today/more", headers=H).json()["missions"]:
        if m["goal_id"] == gid and m["tasks"]:
            today_tasks = m["tasks"]
task = today_tasks[0]
planned = task["quantity"]
r = client.patch(f"/tasks/{task['id']}", headers=H, json={
    "completed": True, "actual_quantity": planned + 8}).json()
check("overshoot detected", r["overshoot"] == 8, str(r["overshoot"]))
check("magic message", r["message"] is not None and "reduced" in r["message"], str(r["message"]))
u = client.get(f"/goals/{gid}/units", headers=H).json()
book = [x for x in u if x["unit"] == "pages"][0]
check("overshoot recorded on material", book["completed_quantity"] == planned + 8,
      str(book["completed_quantity"]))

# 7. WANNA DO MORE is gone — it moved rows between days without re-planning
# them, which is how work landed on a zero-hour day carrying another day's
# range. Doing more is logging more; check the endpoint no longer answers.
check("do-more endpoint removed", client.post("/today/more", headers=H).status_code == 404,
      str(client.post("/today/more", headers=H).status_code))

# 8. Material progress endpoint ("I'm on page 120")
r = client.patch(f"/goals/{gid}/materials/1", headers=H, json={"completed_quantity": 120})
check("set material progress", r.status_code == 200)
plan = client.get(f"/goals/{gid}/plan", headers=H).json()
book_plan = next(m for m in plan["materials"] if m["unit"] == "pages")
check("material progress applied", book_plan["completed"] == 120, str(book_plan["completed"]))
check("reality reflects it (30% book)", plan["reality"]["actual_progress_pct"] > 10,
      f"{plan['reality']['actual_progress_pct']}%")

# 9. WHY — every today task explains itself
why_tasks = [t for m in client.get("/today", headers=H).json()["missions"] for t in m["tasks"]]
check("today tasks carry a why", all(t["why"] for t in why_tasks), str(len(why_tasks)))
if why_tasks:
    print("   why:", why_tasks[0]["why"])

# 10. IN-APP CALENDAR — range query across all missions
cal = client.get("/calendar", headers=H, params={
    "start": date.today().isoformat(), "end": (date.today() + timedelta(days=13)).isoformat()}).json()
check("calendar returns range", len(cal) > 5 and all("goal_title" in t for t in cal), f"{len(cal)} tasks")
check("calendar bad dates rejected",
      client.get("/calendar", headers=H, params={"start": "nope", "end": "x"}).status_code == 422)

# 11. Isolation
r2 = client.post("/auth/register", json={"email": "eve@x.de", "password": "password1", "name": "Eve"})
H2 = {"Authorization": f"Bearer {r2.json()['access_token']}"}
check("cross-user blocked", client.get(f"/goals/{gid}", headers=H2).status_code == 404)

print()
if failures:
    print(f"{len(failures)} FAILURES: {failures}")
    sys.exit(1)
print("ALL CHECKS PASSED")
