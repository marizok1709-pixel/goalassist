"""Analytics ingest + GDPR rights.

The point of these checks is that the privacy guarantees are enforced by the
*server*, not by the client being polite.
"""

import os
from datetime import date, datetime, timedelta, timezone

if os.path.exists("smoke_privacy.db"):
    os.remove("smoke_privacy.db")

import app.database as database
from sqlalchemy import create_engine
from sqlalchemy.orm import sessionmaker

database.engine = create_engine(
    "sqlite:///./smoke_privacy.db", connect_args={"check_same_thread": False}
)
database.SessionLocal = sessionmaker(autocommit=False, autoflush=False, bind=database.engine)

from fastapi.testclient import TestClient  # noqa: E402
from app.main import app  # noqa: E402
from app.models import AnalyticsEvent, User  # noqa: E402
from app.routers.privacy import RETENTION_DAYS, purge_expired_events  # noqa: E402

client = TestClient(app)
failures = []


def check(label, cond, detail=""):
    print(f"[{'PASS' if cond else 'FAIL'}] {label}{'' if cond else '  → ' + str(detail)}")
    if not cond:
        failures.append(label)


def register(email):
    r = client.post(
        "/auth/register", json={"name": "Tester", "email": email, "password": "privacy123"}
    )
    return {"Authorization": f"Bearer {r.json()['access_token']}"}


def batch(events, session="sess-abcdef123456", **kw):
    return {"session_id": session, "events": events, **kw}


H = register("privacy@example.com")

# ---- consent defaults ----
r = client.get("/me/consent", headers=H)
check("consent defaults to False", r.json()["analytics_consent"] is False, r.json())

# ---- collection is blocked before opt-in ----
r = client.post("/analytics/events", json=batch([{"name": "page_view", "path": "/today"}]), headers=H)
check("ingest returns 202 even when dropped", r.status_code == 202, r.status_code)
check("no events stored without consent", r.json()["accepted"] == 0, r.json())

with database.SessionLocal() as db:
    check("database really is empty", db.query(AnalyticsEvent).count() == 0)

# ---- opt in ----
r = client.put("/me/consent", json={"analytics_consent": True}, headers=H)
check("opt-in persists", r.json()["analytics_consent"] is True, r.json())
check("consent timestamped", r.json()["updated_at"] is not None, r.json())

r = client.post(
    "/analytics/events",
    json=batch([{"name": "page_view", "path": "/today"}, {"name": "mission_created"}]),
    headers=H,
)
check("events accepted after opt-in", r.json()["accepted"] == 2, r.json())

# ---- allow-list ----
r = client.post(
    "/analytics/events",
    json=batch([{"name": "totally_made_up_event"}, {"name": "task_completed"}]),
    headers=H,
)
check("unknown event names dropped, known kept", r.json()["accepted"] == 1, r.json())

# ---- props are sanitised ----
r = client.post(
    "/analytics/events",
    json=batch(
        [
            {
                "name": "feature_used",
                "props": {
                    "count": 3,
                    "ok": True,
                    "secret_note": "x" * 400,          # over-long string
                    "nested": {"email": "a@b.c"},        # non-scalar
                    "list": [1, 2, 3],                   # non-scalar
                },
            }
        ]
    ),
    headers=H,
)
check("event with messy props accepted", r.json()["accepted"] == 1, r.json())
with database.SessionLocal() as db:
    ev = db.query(AnalyticsEvent).filter(AnalyticsEvent.name == "feature_used").one()
    check("scalar props kept", ev.props.get("count") == 3 and ev.props.get("ok") is True, ev.props)
    check("nested object dropped", "nested" not in ev.props, ev.props)
    check("list dropped", "list" not in ev.props, ev.props)
    check("long string truncated", len(ev.props.get("secret_note", "")) <= 64, ev.props)

# ---- referrer is reduced to a host ----
r = client.post(
    "/analytics/events",
    json=batch([{"name": "page_view"}], referrer="https://mail.google.com/mail/u/0?q=secret+term"),
    headers=H,
)
with database.SessionLocal() as db:
    ev = db.query(AnalyticsEvent).order_by(AnalyticsEvent.id.desc()).first()
    check("referrer stored as host only", ev.referrer_host == "mail.google.com", ev.referrer_host)

# ---- no IP is ever persisted ----
with database.SessionLocal() as db:
    cols = {c.name for c in AnalyticsEvent.__table__.columns}
    check("no ip column exists at all", not any("ip" in c for c in cols), cols)

# ---- anonymous visitors are counted, not identified ----
r = client.post("/analytics/events", json=batch([{"name": "page_view", "path": "/"}], session="anon-000111222"))
check("anonymous ingest accepted", r.json()["accepted"] == 1, r.json())
with database.SessionLocal() as db:
    anon = db.query(AnalyticsEvent).filter(AnalyticsEvent.session_id == "anon-000111222").one()
    check("anonymous event has no user_id", anon.user_id is None, anon.user_id)

# ---- batch cap ----
r = client.post("/analytics/events", json=batch([{"name": "page_view"}] * 80), headers=H)
check("oversized batch rejected by schema", r.status_code == 422, r.status_code)

# ---- export ----
deadline = (date.today() + timedelta(days=10)).isoformat()
g = client.post("/goals", json={"title": "Export me", "deadline": deadline}, headers=H).json()
client.post(
    f"/goals/{g['id']}/materials",
    json={"name": "A book", "total_quantity": 100, "unit": "pages", "already_completed": 0},
    headers=H,
)
exp = client.get("/me/export", headers=H)
check("export returns 200", exp.status_code == 200, exp.status_code)
data = exp.json()
check("export contains the account", data["account"]["email"] == "privacy@example.com", data["account"])
check("export contains goals", len(data["goals"]) == 1, data["goals"])
check("export contains materials", len(data["materials"]) == 1, data["materials"])
check("export contains scheduled tasks", len(data["scheduled_tasks"]) > 0)
check("export contains analytics events", len(data["analytics_events"]) > 0)
check("export never leaks the password hash", "password" not in str(data).lower(), "hash present!")

# ---- withdrawing consent erases past events ----
client.put("/me/consent", json={"analytics_consent": False}, headers=H)
with database.SessionLocal() as db:
    user = db.query(User).filter(User.email == "privacy@example.com").one()
    left = db.query(AnalyticsEvent).filter(AnalyticsEvent.user_id == user.id).count()
    check("opting out deletes previously collected events", left == 0, left)
    check(
        "anonymous events survive (not this user's)",
        db.query(AnalyticsEvent).filter(AnalyticsEvent.user_id.is_(None)).count() >= 1,
    )

# ---- retention ----
with database.SessionLocal() as db:
    old = AnalyticsEvent(
        session_id="old-session-1",
        name="page_view",
        created_at=datetime.now(timezone.utc) - timedelta(days=RETENTION_DAYS + 5),
    )
    db.add(old)
    db.commit()
    before = db.query(AnalyticsEvent).count()
    removed = purge_expired_events(db)
    after = db.query(AnalyticsEvent).count()
    check("retention purge removes expired rows", removed == 1 and after == before - 1, (removed, before, after))

# ---- erasure ----
H2 = register("erase@example.com")
client.put("/me/consent", json={"analytics_consent": True}, headers=H2)
g2 = client.post("/goals", json={"title": "Gone soon", "deadline": deadline}, headers=H2).json()
client.post(f"/goals/{g2['id']}/materials", json={"name": "B", "total_quantity": 10, "unit": "pages"}, headers=H2)
client.post("/analytics/events", json=batch([{"name": "page_view"}], session="erase-session-1"), headers=H2)

r = client.delete("/me", headers=H2)
check("account deletion returns 204", r.status_code == 204, r.status_code)
check("token no longer works", client.get("/auth/me", headers=H2).status_code == 401)

with database.SessionLocal() as db:
    check("user row gone", db.query(User).filter(User.email == "erase@example.com").count() == 0)
    check(
        "their analytics events gone",
        db.query(AnalyticsEvent).filter(AnalyticsEvent.session_id == "erase-session-1").count() == 0,
    )
    from app.models import Goal, Material, ScheduledTask

    check("their goals gone", db.query(Goal).filter(Goal.title == "Gone soon").count() == 0)
    check("their materials gone", db.query(Material).filter(Material.name == "B").count() == 0)
    check(
        "their scheduled tasks gone",
        db.query(ScheduledTask).filter(ScheduledTask.goal_id == g2["id"]).count() == 0,
    )

# ---- other users are unaffected ----
check("the first account still exists", client.get("/auth/me", headers=H).status_code == 200)

# ---- rights endpoints require auth ----
check("export requires auth", client.get("/me/export").status_code in (401, 403))
check("delete requires auth", client.delete("/me").status_code in (401, 403))
check("consent read requires auth", client.get("/me/consent").status_code in (401, 403))

print("\n" + ("ALL CHECKS PASSED" if not failures else f"{len(failures)} FAILED: {failures}"))
raise SystemExit(1 if failures else 0)
