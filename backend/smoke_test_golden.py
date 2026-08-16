"""The two real missions, pinned. A regression net for the pivot.

Phase 1 replaces the scheduler with a pure, portfolio-aware, minutes-first engine.
The only honest way to know that rewrite preserves what already works is to
record what the current engine says about real data — the owner's own two live
missions, at the state production held on 2026-08-15 — and diff every future
version against it.

This is the golden file from the pivot plan's test section: *feed your two real
missions and actual capacity in, assert the full plan output.*

Two properties make it useful rather than decorative:

- **It is date-stable.** Every function here is called with an explicit `today`,
  never `date.today()`, so the snapshot does not rot overnight and a diff always
  means a behaviour change. Anything that reads the wall clock belongs in the
  other smoke tests, not here.
- **It covers the whole output, not a sampled assertion.** Schedule, material
  plans, reality report and the derived ranges are all serialised. A rewrite that
  quietly shifts one day's quantity shows up as a diff rather than as a passing
  test.

    .venv/bin/python smoke_test_golden.py            # compare against the fixture
    .venv/bin/python smoke_test_golden.py --update   # re-record it, deliberately

Re-recording is a decision, not a side effect: a broken run must never be able to
install itself as the new baseline. Read the diff before you accept it.
"""

import json
import os
import sys
from datetime import date, timedelta

if os.path.exists("smoke_golden.db"):
    os.remove("smoke_golden.db")

import app.database as database
from sqlalchemy import create_engine, select
from sqlalchemy.orm import sessionmaker

database.engine = create_engine(
    "sqlite:///./smoke_golden.db", connect_args={"check_same_thread": False}
)
database.SessionLocal = sessionmaker(autocommit=False, autoflush=False, bind=database.engine)

from app.main import app  # noqa: E402,F401  (imported for its create_all/migrate side effects)
from app.models import Goal, Material, ProgressUnit, ScheduledTask, User  # noqa: E402
from app.security import hash_password  # noqa: E402
from app.services import engine  # noqa: E402

FIXTURE = os.path.join(os.path.dirname(os.path.abspath(__file__)), "golden_plan.json")

# Production state of user 8 on 2026-08-15, read from Neon. Fixed, not derived
# from the clock — this is the whole point of the file.
TODAY = date(2026, 8, 15)
AVAILABILITY = {"mon": 0.0, "tue": 2.0, "wed": 2.0, "thu": 0.0, "fri": 2.0, "sat": 0.0, "sun": 2.0}

MISSIONS = [
    {
        "title": "TestDAF TDN16",
        "start_date": date(2026, 8, 10),
        "deadline": date(2026, 11, 10),
        "materials": [
            {"name": "Mit Erfolg zum digitalen TestDAF", "total": 161.0, "unit": "pages",
             "completed": 21.0},
            {"name": "Modelprufung", "total": 1.0, "unit": "mock exam", "completed": 0.0},
        ],
        "rows": [
            (date(2026, 8, 11), 0, 3.0, None, "Mit Erfolg zum digitalen TestDAF: pages 23-25"),
            (date(2026, 8, 12), 0, 3.0, 0.0, "Mit Erfolg zum digitalen TestDAF: pages 21-23"),
            (date(2026, 8, 14), 0, 3.0, None, "Mit Erfolg zum digitalen TestDAF: pages 21-23"),
            (date(2026, 8, 15), 0, 3.0, 1.0, "Mit Erfolg zum digitalen TestDAF: pages 24-26"),
            (date(2026, 8, 16), 0, 3.0, None, "Mit Erfolg zum digitalen TestDAF: pages 22-24"),
            (date(2026, 8, 18), 0, 3.0, None, "Mit Erfolg zum digitalen TestDAF: pages 25-27"),
            (date(2026, 8, 19), 0, 2.0, None, "Mit Erfolg zum digitalen TestDAF: pages 28-29"),
        ],
    },
    {
        "title": "EGE math",
        "start_date": date(2026, 8, 10),
        "deadline": date(2026, 8, 31),
        "materials": [
            {"name": "Stepik problems", "total": 1497.0, "unit": "points", "completed": 106.0},
        ],
        "rows": [
            (date(2026, 8, 11), 0, 118.0, 0.0, "Stepik problems: points 88-205"),
            (date(2026, 8, 12), 0, 128.0, 19.0, "Stepik problems: points 88-215"),
            (date(2026, 8, 14), 0, 139.0, None, "Stepik problems: points 107-245"),
            (date(2026, 8, 15), 0, 139.0, None, "Stepik problems: points 246-384"),
            (date(2026, 8, 18), 0, 139.0, None, "Stepik problems: points 385-523"),
            (date(2026, 8, 19), 0, 139.0, None, "Stepik problems: points 524-662"),
            (date(2026, 8, 21), 0, 140.0, None, "Stepik problems: points 663-802"),
            (date(2026, 8, 23), 0, 139.0, None, "Stepik problems: points 803-941"),
        ],
    },
]


def build() -> tuple:
    """Reconstruct the two missions directly, bypassing the API's own `today`."""
    db = database.SessionLocal()
    user = User(
        email="golden@example.com",
        password_hash=hash_password("goldenpass1"),
        name="Golden",
        availability=AVAILABILITY,
    )
    db.add(user)
    db.flush()

    goals = []
    for spec in MISSIONS:
        goal = Goal(
            user_id=user.id,
            title=spec["title"],
            start_date=spec["start_date"],
            deadline=spec["deadline"],
        )
        db.add(goal)
        db.flush()
        units = []
        for m in spec["materials"]:
            material = Material(
                goal_id=goal.id, name=m["name"], total_quantity=m["total"], unit=m["unit"]
            )
            db.add(material)
            db.flush()
            unit = ProgressUnit(
                goal_id=goal.id,
                material_id=material.id,
                title=material.name,
                quantity=m["total"],
                unit=m["unit"],
                completed_quantity=m["completed"],
                position=0,
            )
            db.add(unit)
            db.flush()
            units.append(unit)
        for d, unit_i, qty, actual, desc in spec["rows"]:
            unit = units[unit_i]
            db.add(
                ScheduledTask(
                    goal_id=goal.id,
                    progress_unit_id=unit.id,
                    material_id=unit.material_id,
                    date=d,
                    quantity=qty,
                    actual_quantity=actual,
                    completed=False,
                    description=desc,
                )
            )
        goals.append(goal)
    db.commit()
    return db, goals


def snapshot(db, goals) -> dict:
    """Everything the engine claims about these missions, at a fixed `today`."""
    out: dict = {"today": TODAY.isoformat(), "availability": AVAILABILITY, "missions": []}
    for goal in goals:
        report = engine.build_reality_report(goal, TODAY)
        plans = engine.build_material_plans(goal, TODAY)
        # The schedule as it would be laid down from scratch right now. This is
        # the arithmetic the rewrite has to preserve.
        fresh = engine.build_schedule(goal, TODAY, availability=AVAILABILITY)
        rows = list(
            db.scalars(
                select(ScheduledTask)
                .where(ScheduledTask.goal_id == goal.id)
                .order_by(ScheduledTask.date, ScheduledTask.id)
            )
        )
        derived = engine.derive_descriptions(goal, rows, TODAY)

        out["missions"].append(
            {
                "title": goal.title,
                "deadline": goal.deadline.isoformat(),
                "days_remaining": engine.days_remaining(goal, TODAY),
                "overall_progress_pct": round(engine.overall_progress_pct(goal), 4),
                "reality": {
                    "days_total": report.days_total,
                    "days_elapsed": report.days_elapsed,
                    "days_remaining": report.days_remaining,
                    "days_behind": report.days_behind,
                    "expected_progress_pct": report.expected_progress_pct,
                    "actual_progress_pct": report.actual_progress_pct,
                    "trajectory_ratio": report.trajectory_ratio,
                    "status": report.status,
                    "message": report.message,
                    "adjustments": report.adjustments,
                },
                "materials": [
                    {
                        "name": p.name,
                        "unit": p.unit,
                        "total": p.total,
                        "completed": p.completed,
                        "remaining": p.remaining,
                        "required_per_day": p.required_per_day,
                        "human_rate": p.human_rate,
                    }
                    for p in plans
                ],
                "schedule_from_today": [
                    {
                        "date": t["date"].isoformat(),
                        "weekday": t["date"].strftime("%a"),
                        "quantity": t["quantity"],
                        "description": t["description"],
                    }
                    for t in fresh
                ],
                "derived_ranges": [
                    {"date": t.date.isoformat(), "text": derived[t.id]}
                    for t in rows
                    if t.id in derived
                ],
            }
        )
    return out


def diff(expected, actual, path="") -> list[str]:
    """Every leaf that changed, named by its path. Beats a bare 'not equal'."""
    if type(expected) is not type(actual):
        return [f"{path or '<root>'}: type {type(expected).__name__} -> {type(actual).__name__}"]
    if isinstance(expected, dict):
        out = []
        for k in sorted(set(expected) | set(actual)):
            if k not in expected:
                out.append(f"{path}.{k}: added ({actual[k]!r})")
            elif k not in actual:
                out.append(f"{path}.{k}: removed (was {expected[k]!r})")
            else:
                out += diff(expected[k], actual[k], f"{path}.{k}")
        return out
    if isinstance(expected, list):
        out = []
        if len(expected) != len(actual):
            out.append(f"{path}: length {len(expected)} -> {len(actual)}")
        for i in range(min(len(expected), len(actual))):
            out += diff(expected[i], actual[i], f"{path}[{i}]")
        return out
    return [] if expected == actual else [f"{path}: {expected!r} -> {actual!r}"]


db, goals = build()
current = snapshot(db, goals)
db.close()

if "--update" in sys.argv:
    with open(FIXTURE, "w") as f:
        json.dump(current, f, indent=2, ensure_ascii=False)
        f.write("\n")
    print(f"Recorded {FIXTURE}")
    print(f"  {len(current['missions'])} missions, "
          f"{sum(len(m['schedule_from_today']) for m in current['missions'])} scheduled days")
    raise SystemExit(0)

if not os.path.exists(FIXTURE):
    print(f"No fixture at {FIXTURE}. Record one with --update, and read it before committing.")
    raise SystemExit(1)

with open(FIXTURE) as f:
    expected = json.load(f)

changes = diff(expected, current)
if changes:
    print(f"{len(changes)} DIFFERENCES from the recorded plan:\n")
    for c in changes[:60]:
        print(f"  {c}")
    if len(changes) > 60:
        print(f"  … and {len(changes) - 60} more")
    print(
        "\nIf the change is intended, re-record with --update and put the diff in the commit "
        "message. If it is not, the rewrite has changed behaviour on real data."
    )
    raise SystemExit(1)

print(f"[PASS] the plan for both real missions is unchanged ({FIXTURE})")
print("ALL CHECKS PASSED")
