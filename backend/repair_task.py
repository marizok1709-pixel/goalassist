"""Reset one scheduled task to the amount that was actually done. Dry-run by default.

Exists because of the 2026-08-12 defect: `PATCH /tasks/{id}` set `completed`
unconditionally, so logging 0 produced a task flagged done with no progress
behind it. The code no longer does that, but rows written *while* it did are
still wrong in the database, and nothing in the product can express "this tick
was never real" — un-ticking such a row through the API would subtract its full
planned quantity from a material that never received it.

    .venv/bin/python repair_task.py 2149 --actual 0
    .venv/bin/python repair_task.py 2149 --actual 0 --apply

Without --apply it prints the before/after and changes nothing. It only ever
writes the two fields on the named row; the material is left alone, because the
whole point of a phantom completion is that the material was never touched.
Pass --rebuild to also redistribute the goal's unreported future afterwards.
"""

import argparse
from datetime import date

from app.database import SessionLocal, engine as db_engine
from app.migrate import ensure_columns
from app.models import ProgressUnit, ScheduledTask
from app.services import engine

# This script talks to the database without going through app.main, which is
# where the additive migration normally runs. Against a database the API has not
# cold-started on yet, actual_quantity would not exist. ensure_columns is
# idempotent and additive, so calling it here costs nothing and removes a
# deploy-ordering trap.
applied = ensure_columns(db_engine)
if applied:
    print(f"migration applied: {', '.join(applied)}")

parser = argparse.ArgumentParser(description=__doc__)
parser.add_argument("task_id", type=int)
parser.add_argument(
    "--actual",
    type=float,
    required=True,
    help="the amount actually done; 0 for a day that was reported and produced nothing",
)
parser.add_argument("--apply", action="store_true", help="write it (default: dry run)")
parser.add_argument("--rebuild", action="store_true", help="redistribute the goal afterwards")
args = parser.parse_args()

db = SessionLocal()
task = db.get(ScheduledTask, args.task_id)
if task is None:
    raise SystemExit(f"no task {args.task_id}")

unit = db.get(ProgressUnit, task.progress_unit_id) if task.progress_unit_id else None
material = unit.material if unit is not None else None

print(f"task    #{task.id}  {task.date}  {task.description!r}")
print(f"goal    #{task.goal_id}  {task.goal.title!r}  (user {task.goal.user_id})")
print(f"before  completed={task.completed}  actual_quantity={task.actual_quantity}  planned={task.quantity}")
if material is not None:
    done, total = engine._material_progress(material)
    print(f"material {material.name!r}: {done}/{total} {material.unit} recorded — left untouched")

task.completed = args.actual >= task.quantity - engine.EPS
task.actual_quantity = args.actual
print(f"after   completed={task.completed}  actual_quantity={task.actual_quantity}")

if args.rebuild:
    print(f"rebuild goal #{task.goal_id} from {date.today()} (unreported rows only)")
    engine.rebuild_schedule(db, task.goal, date.today())

if args.apply:
    db.commit()
    print("\nAPPLIED.")
else:
    db.rollback()
    print("\nDry run — nothing written. Re-run with --apply.")
db.close()
