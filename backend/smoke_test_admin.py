"""Admin surface: authorization first, then whether the numbers are real."""

import os
from datetime import date, datetime, timedelta, timezone

if os.path.exists("smoke_admin.db"):
    os.remove("smoke_admin.db")

import app.database as database
from sqlalchemy import create_engine
from sqlalchemy.orm import sessionmaker

database.engine = create_engine(
    "sqlite:///./smoke_admin.db", connect_args={"check_same_thread": False}
)
database.SessionLocal = sessionmaker(autocommit=False, autoflush=False, bind=database.engine)

from fastapi.testclient import TestClient  # noqa: E402
from app.main import app  # noqa: E402
from app.models import Transaction, TransactionKind, User  # noqa: E402

client = TestClient(app)
failures = []

ADMIN_ROUTES = [
    "/admin/overview",
    "/admin/activity",
    "/admin/sessions",
    "/admin/features",
    "/admin/retention",
    "/admin/infrastructure",
    "/admin/finance",
]


def check(label, cond, detail=""):
    print(f"[{'PASS' if cond else 'FAIL'}] {label}{'' if cond else '  → ' + str(detail)}")
    if not cond:
        failures.append(label)


def register(email):
    r = client.post("/auth/register", json={"name": "U", "email": email, "password": "adminpass1"})
    return {"Authorization": f"Bearer {r.json()['access_token']}"}


# ---- authorization ----
for route in ADMIN_ROUTES:
    check(f"{route} rejects anonymous", client.get(route).status_code in (401, 403), route)

NORMAL = register("normal@example.com")
for route in ADMIN_ROUTES:
    r = client.get(route, headers=NORMAL)
    check(f"{route} hidden from a normal user", r.status_code == 404, r.status_code)

# The flag must not be grantable through the API.
r = client.patch("/auth/me", json={"is_admin": True}, headers=NORMAL)
with database.SessionLocal() as db:
    u = db.query(User).filter(User.email == "normal@example.com").one()
    check("is_admin cannot be set via PATCH /auth/me", u.is_admin is False, u.is_admin)

r = client.post(
    "/auth/register",
    json={"name": "X", "email": "sneaky@example.com", "password": "adminpass1", "is_admin": True},
)
with database.SessionLocal() as db:
    u = db.query(User).filter(User.email == "sneaky@example.com").one()
    check("is_admin cannot be set at registration", u.is_admin is False, u.is_admin)

# Promote out-of-band, the only supported path.
ADMIN = register("admin@example.com")
with database.SessionLocal() as db:
    u = db.query(User).filter(User.email == "admin@example.com").one()
    u.is_admin = True
    db.commit()

for route in ADMIN_ROUTES:
    r = client.get(route, headers=ADMIN)
    check(f"{route} reachable by an admin", r.status_code == 200, r.status_code)

# ---- the numbers ----
o = client.get("/admin/overview", headers=ADMIN).json()
check("counts every registered user", o["users"]["total"] == 3, o["users"])
check("no analytics yet, so has_data is false", o["has_data"] is False, o["has_data"])
check("engagement labels its basis", o["engagement"]["basis"] == "consented_analytics", o["engagement"])
check("consent rate is 0 with nobody opted in", o["users"]["consent_rate_pct"] == 0.0, o["users"])

# Opt in and send an event; the dashboard must move.
client.put("/me/consent", json={"analytics_consent": True}, headers=ADMIN)
client.post(
    "/analytics/events",
    json={"session_id": "admin-session-1", "events": [{"name": "page_view", "path": "/today"}],
          "device": "desktop", "browser": "chrome", "viewport_w": 1440, "language": "en"},
    headers=ADMIN,
)
o = client.get("/admin/overview", headers=ADMIN).json()
check("has_data flips once events exist", o["has_data"] is True, o["has_data"])
check("DAU picks up the event", o["engagement"]["dau"] == 1, o["engagement"])
check("online-now counts the session", o["users"]["online_now"] >= 1, o["users"])
check("consent rate reflects the opt-in", o["users"]["consent_rate_pct"] > 0, o["users"])

f = client.get("/admin/features", headers=ADMIN).json()
check("feature usage lists the event", any(e["key"] == "page_view" for e in f["events"]), f["events"])
check("device split recorded", any(d["key"] == "desktop" for d in f["devices"]), f["devices"])

a = client.get("/admin/activity?days=7", headers=ADMIN).json()
check("activity returns a dense 7-day series", len(a["series"]) == 7, len(a["series"]))
check("series is chronological", [s["date"] for s in a["series"]] == sorted(s["date"] for s in a["series"]))
check("today's events are counted", a["series"][-1]["events"] >= 1, a["series"][-1])
check("signups appear in the series", sum(s["new_users"] for s in a["series"]) == 3, a["series"])

s = client.get("/admin/sessions", headers=ADMIN).json()
check("sessions counted", s["sessions"] >= 1, s)
check("single-event session reported as such", s["single_event_sessions"] >= 1, s)

r = client.get("/admin/retention?weeks=3", headers=ADMIN).json()
check("retention uses product activity, not analytics", r["basis"] == "product_activity", r)
check("retention returns the requested cohorts", len(r["cohorts"]) == 3, r["cohorts"])
check("current cohort has our three users", any(c["size"] == 3 for c in r["cohorts"]), r["cohorts"])

i = client.get("/admin/infrastructure", headers=ADMIN).json()
check("db ping measured", i["database"]["ping_ms"] >= 0, i["database"])
check("api latency recorded", i["api"]["requests_in_window"] > 0, i["api"])
check("memory reported", i["process"]["memory_rss_mb"] > 0, i["process"])
check("single-instance caveat is stated", "single warm instance" in i["caveat"], i["caveat"])

# ---- users roster (individual PII, admin-only) ----
ADMIN_ROUTES.append("/admin/users")  # keep the auth matrix honest for this one too
check("/admin/users rejects anonymous", client.get("/admin/users").status_code in (401, 403))
check("/admin/users hidden from normal user (404)", client.get("/admin/users", headers=NORMAL).status_code == 404)

# Give the admin account a real mission so the roster has something to show.
roster_deadline = (date.today() + timedelta(days=12)).isoformat()
gid_for_admin = client.post(
    "/goals", json={"title": "Roster goal", "deadline": roster_deadline}, headers=ADMIN
).json()["id"]
client.post(
    f"/goals/{gid_for_admin}/materials",
    json={"name": "Roster book", "total_quantity": 40, "unit": "pages", "already_completed": 0},
    headers=ADMIN,
)

# Open the app first. Only days that have arrived are written down, so a
# student who has never looked has nothing stored yet — which is correct, and
# means the roster's totals describe real days rather than an imagined plan.
client.get("/today", headers=ADMIN)
roster = client.get("/admin/users", headers=ADMIN).json()
check("roster returns every user", len(roster) == 3, len(roster))
me_row = next((r for r in roster if r["email"] == "admin@example.com"), None)
check("roster row carries name + email", me_row and me_row["name"] == "U", me_row)
check("roster exposes no password field", not any("password" in str(k).lower() for r in roster for k in r), list(roster[0].keys()))
check("roster row has goal titles", any(g["title"] == "Roster goal" for g in me_row["goals"]), me_row["goals"])
check("roster row has task totals", me_row["tasks_total"] >= 1, me_row)
check("note starts empty", me_row["note"] is None, me_row["note"])
check("activity is 0 before any work", me_row["tasks_completed"] == 0 and me_row["last_active"] is None, me_row)

# activity signal: complete a task and confirm it registers
sched = client.get(f"/goals/{gid_for_admin}/schedule", headers=ADMIN).json()
if sched:
    client.patch(f"/goals/{sched[0]['goal_id']}/days/{sched[0]['date']}", json={"completed": True}, headers=ADMIN)
roster = client.get("/admin/users", headers=ADMIN).json()
me_row = next(r for r in roster if r["email"] == "admin@example.com")
check("completing a task registers activity", me_row["tasks_completed"] >= 1, me_row)
check("last_active is set after real work", me_row["last_active"] is not None, me_row)

# editable note
uid = me_row["id"]
r = client.patch(f"/admin/users/{uid}", json={"note": "  the founder account  "}, headers=ADMIN)
check("note update returns 200", r.status_code == 200, r.status_code)
check("note is trimmed and stored", r.json()["note"] == "the founder account", r.json()["note"])
check("note persists on re-read", next(x for x in client.get("/admin/users", headers=ADMIN).json() if x["id"] == uid)["note"] == "the founder account")
check("note can be cleared", client.patch(f"/admin/users/{uid}", json={"note": ""}, headers=ADMIN).json()["note"] is None)
check("over-long note rejected", client.patch(f"/admin/users/{uid}", json={"note": "x" * 600}, headers=ADMIN).status_code == 422)
check("note edit hidden from normal user (404)", client.patch(f"/admin/users/{uid}", json={"note": "x"}, headers=NORMAL).status_code == 404)
check("note on missing user 404s", client.patch("/admin/users/999999", json={"note": "x"}, headers=ADMIN).status_code == 404)

# ---- finance: real queries over a real (empty) table ----
fin = client.get("/admin/finance", headers=ADMIN).json()
check("finance reports genuine zeros", fin["totals"]["revenue_cents"] == 0, fin["totals"])
check("finance flags that there is no data", fin["has_data"] is False, fin)
check("finance series is dense", len(fin["series"]) == 12, len(fin["series"]))

# Insert real rows and confirm the aggregates are live, not stubbed.
with database.SessionLocal() as db:
    admin_user = db.query(User).filter(User.email == "admin@example.com").one()
    db.add_all([
        Transaction(kind=TransactionKind.revenue, amount_cents=400, user_id=admin_user.id, is_recurring=True),
        Transaction(kind=TransactionKind.revenue, amount_cents=350, user_id=admin_user.id, is_recurring=True),
        Transaction(kind=TransactionKind.expense, amount_cents=1200, description="Neon"),
        Transaction(kind=TransactionKind.credit, amount_cents=500),
        Transaction(kind=TransactionKind.debit, amount_cents=100),
    ])
    db.commit()

fin = client.get("/admin/finance", headers=ADMIN).json()
check("revenue summed", fin["totals"]["revenue_cents"] == 750, fin["totals"])
check("expenses summed", fin["totals"]["expense_cents"] == 1200, fin["totals"])
check("credit summed", fin["totals"]["credit_cents"] == 500, fin["totals"])
check("debit summed", fin["totals"]["debit_cents"] == 100, fin["totals"])
check("net is revenue minus expense", fin["totals"]["net_cents"] == -450, fin["totals"])
check("MRR counts only recurring revenue", fin["totals"]["mrr_cents"] == 750, fin["totals"])
check("transaction count", fin["transactions"] == 5, fin)
check("paying users counted once", fin["paying_users"] == 1, fin)
check("has_data now true", fin["has_data"] is True, fin)
check("current month carries the revenue", fin["series"][-1]["revenue_cents"] == 750, fin["series"][-1])

# ---- bounds ----
check("activity rejects a silly range", client.get("/admin/activity?days=9999", headers=ADMIN).status_code == 422)
check("retention rejects a silly range", client.get("/admin/retention?weeks=0", headers=ADMIN).status_code == 422)

print("\n" + ("ALL CHECKS PASSED" if not failures else f"{len(failures)} FAILED: {failures}"))
raise SystemExit(1 if failures else 0)
