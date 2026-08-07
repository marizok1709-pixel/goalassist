"""Regression tests for the numeric-input hardening (break-test findings).

Each case is a bug found by adversarial testing: a value that used to 500, be
silently accepted, or wedge the schedule engine. All must now be clean 4xx.
"""

import json
import os
from datetime import date, timedelta

if os.path.exists("smoke_harden.db"):
    os.remove("smoke_harden.db")

import app.database as database
from sqlalchemy import create_engine
from sqlalchemy.orm import sessionmaker

database.engine = create_engine(
    "sqlite:///./smoke_harden.db", connect_args={"check_same_thread": False}
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
    "/auth/register", json={"name": "H", "email": "harden@example.com", "password": "harden123"}
).json()["access_token"]
H = {"Authorization": f"Bearer {tok}"}
DL = (date.today() + timedelta(days=10)).isoformat()
gid = client.post("/goals", json={"title": "Hardening", "deadline": DL}, headers=H).json()["id"]


def add_material_raw(raw: str):
    """Post a raw body so NaN/Infinity literals survive to the server."""
    return client.post(
        f"/goals/{gid}/materials",
        headers={**H, "Content-Type": "application/json"},
        content=raw,
    )


def add_material(payload: dict):
    return client.post(f"/goals/{gid}/materials", json=payload, headers=H)


# ---- finding 1: 1e308 used to 500 in the engine ----
r = add_material({"name": "big", "total_quantity": 1e308, "unit": "pages"})
check("1e308 total is a clean 422, not a 500", r.status_code == 422, r.status_code)

# ---- finding 2: NaN used to 500 in error serialization ----
r = add_material_raw('{"name":"nan","total_quantity":NaN,"unit":"pages"}')
check("NaN total is a clean 422, not a 500", r.status_code == 422, r.status_code)
# and the 422 body is actually serialisable / returned
check("NaN 422 body is valid JSON", isinstance(r.json(), dict), r.text[:120])

# ---- finding 3: Infinity used to be accepted (201) ----
r = add_material_raw('{"name":"inf","total_quantity":Infinity,"unit":"pages"}')
check("Infinity total is rejected (was 201)", r.status_code == 422, r.status_code)
r = add_material_raw('{"name":"ninf","total_quantity":-Infinity,"unit":"pages"}')
check("-Infinity total is rejected", r.status_code == 422, r.status_code)

# ---- finding 4: unbounded deadline ----
r = client.post("/goals", json={"title": "far", "deadline": "9999-12-31"}, headers=H)
check("year-9999 deadline rejected (was 201)", r.status_code == 422, r.status_code)
r = client.patch(f"/goals/{gid}", json={"deadline": "9999-12-31"}, headers=H)
check("year-9999 deadline rejected on update too", r.status_code == 422, r.status_code)

# ---- the upper bound on quantity ----
r = add_material({"name": "huge", "total_quantity": 5_000_000, "unit": "pages"})
check("quantity over the cap rejected", r.status_code == 422, r.status_code)
r = add_material({"name": "progress-huge", "total_quantity": 100, "unit": "pages", "already_completed": 9e9})
check("already_completed over the cap rejected", r.status_code == 422, r.status_code)

# ---- the same guards on the edit path (PUT) ----
mid = add_material({"name": "editable", "total_quantity": 100, "unit": "pages"}).json()["id"]
for label, raw in {
    "NaN": '{"total_quantity":NaN}',
    "Infinity": '{"total_quantity":Infinity}',
}.items():
    r = client.put(
        f"/goals/{gid}/materials/{mid}",
        headers={**H, "Content-Type": "application/json"},
        content=raw,
    )
    check(f"material edit rejects {label}", r.status_code == 422, r.status_code)
r = client.put(f"/goals/{gid}/materials/{mid}", json={"total_quantity": 1e308}, headers=H)
check("material edit rejects 1e308", r.status_code == 422, r.status_code)

# ---- progress update path ----
r = client.patch(
    f"/goals/{gid}/materials/{mid}",
    headers={**H, "Content-Type": "application/json"},
    content='{"completed_quantity":NaN}',
)
check("progress update rejects NaN", r.status_code == 422, r.status_code)

# ---- sane values still work, and a normal deadline is fine ----
r = add_material({"name": "normal", "total_quantity": 300, "unit": "pages", "already_completed": 20})
check("a normal material still works", r.status_code == 201, r.status_code)
r = client.post(
    "/goals",
    json={"title": "5y", "deadline": (date.today() + timedelta(days=365 * 5)).isoformat()},
    headers=H,
)
check("a 5-year deadline is still allowed", r.status_code == 201, r.status_code)

# ---- server still healthy ----
check("server healthy", client.get("/health").status_code == 200)

print("\n" + ("ALL CHECKS PASSED" if not failures else f"{len(failures)} FAILED: {failures}"))
raise SystemExit(1 if failures else 0)
