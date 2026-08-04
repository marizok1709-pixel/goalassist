"""Editing a material after the mission exists: rename, re-count, re-unit.

Covers the beta bug where materials were write-once — a user who typo'd a book
name during onboarding could never correct it.
"""

import os
from datetime import date, timedelta

if os.path.exists("smoke_edit.db"):
    os.remove("smoke_edit.db")

import app.database as database
from sqlalchemy import create_engine
from sqlalchemy.orm import sessionmaker

database.engine = create_engine(
    "sqlite:///./smoke_edit.db", connect_args={"check_same_thread": False}
)
database.SessionLocal = sessionmaker(autocommit=False, autoflush=False, bind=database.engine)

from fastapi.testclient import TestClient  # noqa: E402
from app.main import app  # noqa: E402

client = TestClient(app)
failures = []


def check(label, cond, detail=""):
    print(f"[{'PASS' if cond else 'FAIL'}] {label}{'' if cond else '  → ' + str(detail)}")
    if not cond:
        failures.append(label)


tok = client.post(
    "/auth/register",
    json={"name": "Editor", "email": "editor@example.com", "password": "editpass1"},
).json()["access_token"]
H = {"Authorization": f"Bearer {tok}"}

deadline = (date.today() + timedelta(days=12)).isoformat()
goal = client.post("/goals", json={"title": "Read books every day", "deadline": deadline}, headers=H).json()
gid = goal["id"]

# The exact material the first beta user ended up with.
mat = client.post(
    f"/goals/{gid}/materials",
    json={"name": "sun and Klara", "total_quantity": 327, "unit": "pages", "already_completed": 27},
    headers=H,
).json()
mid = mat["id"]

# ---- 1. rename ----
r = client.put(f"/goals/{gid}/materials/{mid}", json={"name": "Klara and the Sun"}, headers=H)
check("rename returns 200", r.status_code == 200, r.text)
check("name is corrected", r.json()["name"] == "Klara and the Sun", r.json())

plan = client.get(f"/goals/{gid}/plan", headers=H).json()
m = plan["materials"][0]
check("rename preserves progress (27 done)", abs(m["completed"] - 27) < 0.01, m)
check("plan shows the new name", m["name"] == "Klara and the Sun", m)

today = client.get("/today", headers=H).json()
descs = [t["description"] for mission in today["missions"] for t in mission["tasks"]]
check("today's tasks show the new name", all("Klara and the Sun" in d for d in descs), descs)
check("no task still says the old name", not any("sun and Klara" in d for d in descs), descs)

# ---- 2. change the total ----
r = client.put(f"/goals/{gid}/materials/{mid}", json={"total_quantity": 300}, headers=H)
check("total change returns 200", r.status_code == 200, r.text)
check("total is updated", r.json()["total_quantity"] == 300, r.json())
m = client.get(f"/goals/{gid}/plan", headers=H).json()["materials"][0]
check("progress carried across the re-slice", abs(m["completed"] - 27) < 0.01, m)
check("remaining recomputed against the new total", abs(m["remaining"] - 273) < 0.01, m)

# ---- 3. progress above a shrunken total is clamped ----
client.patch(f"/goals/{gid}/materials/{mid}", json={"completed_quantity": 250}, headers=H)
r = client.put(f"/goals/{gid}/materials/{mid}", json={"total_quantity": 100}, headers=H)
m = client.get(f"/goals/{gid}/plan", headers=H).json()["materials"][0]
check("progress clamped to the smaller total", abs(m["completed"] - 100) < 0.01, m)
check("material reads as complete, not negative", m["remaining"] >= -0.01, m)

# ---- 4. unit change re-slices ----
mat2 = client.post(
    f"/goals/{gid}/materials",
    json={"name": "Mock exams", "total_quantity": 8, "unit": "exams", "already_completed": 0},
    headers=H,
).json()
r = client.put(f"/goals/{gid}/materials/{mat2['id']}", json={"unit": "papers"}, headers=H)
check("unit change returns 200", r.status_code == 200, r.text)
check("unit is updated", r.json()["unit"] == "papers", r.json())
units = client.get(f"/goals/{gid}/units", headers=H).json()
mine = [u for u in units if u["material_id"] == mat2["id"]]
check("re-sliced into 8 countable units", len(mine) == 8, len(mine))
check("unit titles use the new unit word", all("paper #" in u["title"] for u in mine), [u["title"] for u in mine])

# ---- 5. schedule still sane, nothing past the deadline ----
sched = client.get(f"/goals/{gid}/schedule", headers=H).json()
check("schedule regenerated", len(sched) > 0, len(sched))
check("nothing scheduled past the deadline", all(t["date"] <= deadline for t in sched), deadline)

# ---- 6. validation + isolation ----
check("empty name rejected", client.put(f"/goals/{gid}/materials/{mid}", json={"name": ""}, headers=H).status_code == 422)
check("zero total rejected", client.put(f"/goals/{gid}/materials/{mid}", json={"total_quantity": 0}, headers=H).status_code == 422)
check("unknown material 404s", client.put(f"/goals/{gid}/materials/999999", json={"name": "x"}, headers=H).status_code == 404)
check("empty payload is a no-op 200", client.put(f"/goals/{gid}/materials/{mid}", json={}, headers=H).status_code == 200)

tok2 = client.post(
    "/auth/register",
    json={"name": "Other", "email": "other@example.com", "password": "otherpass1"},
).json()["access_token"]
check(
    "another user cannot edit my material",
    client.put(
        f"/goals/{gid}/materials/{mid}", json={"name": "hacked"}, headers={"Authorization": f"Bearer {tok2}"}
    ).status_code in (403, 404),
)

# ---- 7. delete still works from the API the frontend will now call ----
check("delete material 204", client.delete(f"/goals/{gid}/materials/{mat2['id']}", headers=H).status_code == 204)
check("material is gone", len(client.get(f"/goals/{gid}/materials", headers=H).json()) == 1)

print("\n" + ("ALL CHECKS PASSED" if not failures else f"{len(failures)} FAILED: {failures}"))
raise SystemExit(1 if failures else 0)
