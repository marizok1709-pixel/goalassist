"""Weekly availability: rest days, weighting, and the flag that retires the nudge.

Written for the beta failure it exists to prevent. The first real user never
reached /timing, so `availability` stayed NULL, `day_weight()` fell back to 1.0
for every date, and their 26 tasks landed on 13 consecutive days with no rest
day — a plan nobody keeps. Onboarding now asks which days are rest days before
the mission is created; these checks lock down that the answer actually reaches
the schedule engine, in the order the flow sends it.

`availability_refined` is checked here too: it is the stored fact that replaced
a guess (is every day 0 or exactly the onboarding default?) which could not tell
a student who deliberately picked the default value apart from one who never
answered at all.
"""

import os
from collections import defaultdict
from datetime import date, timedelta

if os.path.exists("smoke_availability.db"):
    os.remove("smoke_availability.db")

import app.database as database
from sqlalchemy import create_engine
from sqlalchemy.orm import sessionmaker

database.engine = create_engine(
    "sqlite:///./smoke_availability.db", connect_args={"check_same_thread": False}
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


DAYS = ["mon", "tue", "wed", "thu", "fri", "sat", "sun"]


def weekly(**hours) -> dict:
    """Availability dict, every unnamed day 0. weekly(mon=2, tue=2) → the rest rest."""
    return {d: float(hours.get(d, 0)) for d in DAYS}


def register(email: str) -> dict:
    r = client.post(
        "/auth/register", json={"name": "Rhythm", "email": email, "password": "rhythmpass1"}
    )
    return {"Authorization": f"Bearer {r.json()['access_token']}"}


def schedule(headers, gid, days=60) -> list[dict]:
    return client.get(f"/goals/{gid}/schedule", headers=headers, params={"days": days}).json()


def by_weekday(tasks) -> dict[int, float]:
    """Total scheduled quantity per weekday index (0 = Monday)."""
    out: dict[int, float] = defaultdict(float)
    for t in tasks:
        out[date.fromisoformat(t["date"]).weekday()] += t["quantity"]
    return out


def by_date(tasks) -> dict[str, float]:
    out: dict[str, float] = defaultdict(float)
    for t in tasks:
        out[t["date"]] += t["quantity"]
    return out


# --------------------------------------------------------------------------
# 1. A fresh account has no rhythm and has not refined one
# --------------------------------------------------------------------------
H = register("rhythm@example.com")
me = client.get("/auth/me", headers=H).json()
check("fresh account has no availability", me["availability"] is None, me["availability"])
check("fresh account is not refined", me["availability_refined"] is False, me)

# --------------------------------------------------------------------------
# 2. Onboarding's ordering: availability is saved BEFORE the first goal exists
#
# The flow does PATCH /auth/me → POST /goals → POST /materials on purpose, so
# the first schedule the engine ever builds for the mission is already weighted
# instead of being built flat and immediately thrown away. The PATCH's rebuild
# loop has nothing to iterate here — that is the point.
# --------------------------------------------------------------------------
r = client.patch("/auth/me", headers=H, json={"availability": weekly(mon=2, tue=2, wed=2, thu=2, fri=2)})
check("availability saves with no goals yet", r.status_code == 200, r.status_code)
check("weekend stored as 0", r.json()["availability"]["sat"] == 0, r.json()["availability"])
check("saving hours alone does not mark refined", r.json()["availability_refined"] is False)

# The first beta user's shape: 26 pieces of work across 13 days.
start = date.today()
deadline = start + timedelta(days=12)
gid = client.post(
    "/goals", headers=H, json={"title": "Read books every day", "deadline": deadline.isoformat()}
).json()["id"]
client.post(
    "/goals/%d/materials" % gid,
    headers=H,
    json={"name": "Klara and the Sun", "total_quantity": 26, "unit": "chapters"},
)

first = schedule(H, gid)
weekend = sum(q for wd, q in by_weekday(first).items() if wd >= 5)
check("first schedule ever built is already weighted", weekend == 0, f"{weekend} on sat/sun")
check(
    "the whole material is still scheduled",
    abs(sum(t["quantity"] for t in first) - 26) < 0.01,
    sum(t["quantity"] for t in first),
)
check("no task lands past the deadline", all(t["date"] <= deadline.isoformat() for t in first))

# --------------------------------------------------------------------------
# 3. Rest days concentrate work rather than thinning it
#
# The regression this whole item exists for: with no availability the same 26
# chapters smear one-per-day-ish across every date. With two rest days a week
# the study days have to carry more.
# --------------------------------------------------------------------------
Hflat = register("flat@example.com")
gid_flat = client.post(
    "/goals", headers=Hflat, json={"title": "Read books every day", "deadline": deadline.isoformat()}
).json()["id"]
client.post(
    "/goals/%d/materials" % gid_flat,
    headers=Hflat,
    json={"name": "Klara and the Sun", "total_quantity": 26, "unit": "chapters"},
)
flat = schedule(Hflat, gid_flat)

check(
    "without availability, every day carries work",
    len(by_date(flat)) > len(by_date(first)),
    f"flat {len(by_date(flat))} days vs weighted {len(by_date(first))} days",
)
check(
    "with rest days, a study day carries more",
    max(by_date(first).values()) > max(by_date(flat).values()),
    f"weighted peak {max(by_date(first).values())} vs flat peak {max(by_date(flat).values())}",
)

# --------------------------------------------------------------------------
# 4. Hours are a weight, not a label — a 4h day gets more than a 2h day
# --------------------------------------------------------------------------
Hw = register("weights@example.com")
client.patch("/auth/me", headers=Hw, json={"availability": weekly(mon=4, tue=2, wed=4, thu=2, fri=4, sat=2, sun=4)})
gid_w = client.post(
    "/goals", headers=Hw, json={"title": "Weighted", "deadline": (start + timedelta(days=27)).isoformat()}
).json()["id"]
client.post(
    "/goals/%d/materials" % gid_w,
    headers=Hw,
    json={"name": "Grammar drills", "total_quantity": 280, "unit": "pages"},
)
wd = by_weekday(schedule(Hw, gid_w, days=40))
heavy = wd[0] + wd[2] + wd[4] + wd[6]  # the 4h days
light = wd[1] + wd[3] + wd[5]  # the 2h days
check(
    "4h days carry roughly double a 2h day",
    1.7 < (heavy / 4) / (light / 3) < 2.3,
    f"heavy/day {heavy / 4:.1f} vs light/day {light / 3:.1f}",
)

# --------------------------------------------------------------------------
# 5. Changing the rhythm later reshuffles every active mission
# --------------------------------------------------------------------------
client.patch("/auth/me", headers=H, json={"availability": weekly(sat=3, sun=3)})
flipped = by_weekday(schedule(H, gid))
check("old study days are now empty", sum(q for d, q in flipped.items() if d < 5) == 0, dict(flipped))
check("new study days carry everything", sum(q for d, q in flipped.items() if d >= 5) > 0, dict(flipped))
check(
    "reshuffling loses no work",
    abs(sum(flipped.values()) - 26) < 0.01,
    sum(flipped.values()),
)

# --------------------------------------------------------------------------
# 6. Today's rest day means today is genuinely empty
#
# The user-visible half of the promise: /today, not just the schedule table.
# --------------------------------------------------------------------------
Hr = register("resting@example.com")
today_key = DAYS[date.today().weekday()]
client.patch(
    "/auth/me",
    headers=Hr,
    json={"availability": {d: (0.0 if d == today_key else 3.0) for d in DAYS}},
)
gid_r = client.post(
    "/goals", headers=Hr, json={"title": "Resting today", "deadline": (start + timedelta(days=20)).isoformat()}
).json()["id"]
client.post(
    "/goals/%d/materials" % gid_r,
    headers=Hr,
    json={"name": "Problem sets", "total_quantity": 40, "unit": "problems"},
)
today_payload = client.get("/today", headers=Hr).json()
todays_tasks = [t for m in today_payload["missions"] for t in m["tasks"]]
check("a rest day today shows no tasks", todays_tasks == [], f"{len(todays_tasks)} tasks")
check(
    "but the mission is still fully scheduled",
    abs(sum(t["quantity"] for t in schedule(Hr, gid_r, days=30)) - 40) < 0.01,
)

# --------------------------------------------------------------------------
# 7. An all-zero week cannot silently produce a plan with no tasks
#
# The UI blocks "0 study days", but the server must not depend on that. The
# documented engine behaviour is to fall back to even distribution — a plan the
# student can then fix beats a mission that appears to require no work at all.
# --------------------------------------------------------------------------
Hz = register("zeroes@example.com")
r = client.patch("/auth/me", headers=Hz, json={"availability": weekly()})
check("all-zero availability is accepted", r.status_code == 200, r.status_code)
gid_z = client.post(
    "/goals", headers=Hz, json={"title": "Blocked week", "deadline": (start + timedelta(days=10)).isoformat()}
).json()["id"]
client.post(
    "/goals/%d/materials" % gid_z,
    headers=Hz,
    json={"name": "Lecture notes", "total_quantity": 22, "unit": "pages"},
)
zero_sched = schedule(Hz, gid_z, days=20)
check("all-zero still schedules the work", len(zero_sched) > 0, f"{len(zero_sched)} tasks")
check(
    "all-zero schedules the full amount",
    abs(sum(t["quantity"] for t in zero_sched) - 22) < 0.01,
    sum(t["quantity"] for t in zero_sched),
)

# --------------------------------------------------------------------------
# 8. availability_refined — the dashboard nudge's source of truth
#
# It is client-declared (only /timing sends it), so what matters is that it
# round-trips, that the coarse onboarding save leaves it alone, and that
# setting it does not disturb a schedule.
# --------------------------------------------------------------------------
before = sorted((t["date"], t["quantity"], t["material_id"]) for t in schedule(H, gid))
r = client.patch("/auth/me", headers=H, json={"availability_refined": True})
check("refined flag round-trips", r.json()["availability_refined"] is True, r.json())
check(
    "the flag alone does not touch the schedule",
    sorted((t["date"], t["quantity"], t["material_id"]) for t in schedule(H, gid)) == before,
)
check(
    "and it persists across reads",
    client.get("/auth/me", headers=H).json()["availability_refined"] is True,
)
check(
    "another account is unaffected",
    client.get("/auth/me", headers=Hz).json()["availability_refined"] is False,
)

# The coarse default is the exact case the old heuristic got wrong: every study
# day sitting on the same value. Refined must win over what the numbers look like.
Hc = register("coarse@example.com")
client.patch(
    "/auth/me",
    headers=Hc,
    json={"availability": weekly(mon=2, tue=2, wed=2, thu=2, fri=2), "availability_refined": True},
)
mec = client.get("/auth/me", headers=Hc).json()
check(
    "a student who chooses the default value is still refined",
    mec["availability_refined"] is True and set(mec["availability"].values()) == {0.0, 2.0},
    mec,
)

# --------------------------------------------------------------------------
# 9. Rubbish in the availability dict cannot wedge the engine
# --------------------------------------------------------------------------
r = client.patch("/auth/me", headers=Hz, json={"availability": {"mon": "lots"}})
check("non-numeric hours rejected", r.status_code == 422, r.status_code)
r = client.patch("/auth/me", headers=Hz, json={"availability": {"mon": -5, "tue": 2}})
check("negative hours do not crash the schedule", r.status_code in (200, 422), r.status_code)
if r.status_code == 200:
    neg = schedule(Hz, gid_z, days=20)
    check(
        "negative hours still schedule the full amount",
        abs(sum(t["quantity"] for t in neg) - 22) < 0.01,
        sum(t["quantity"] for t in neg),
    )

print()
if failures:
    print(f"{len(failures)} FAILURES: {failures}")
    raise SystemExit(1)
print("ALL CHECKS PASSED")
