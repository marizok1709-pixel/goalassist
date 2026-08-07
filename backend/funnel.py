"""Where every real account stopped. Read-only.

The plan's success metric is one sentence: *one person who is not Mark
completes one mission end to end.* Nothing in the product reports that. The
only way to know it today is to open Neon and write SQL by hand, which is why
the answer arrives late and in fragments.

This prints the funnel instead:

    registered → mission → availability → first tick → mission complete

with the day each account stalled at and how long it has been stalled. At n=1
that is worth more than an events table — and unlike analytics it needs no
consent, because it reads only what the account already is.

    .venv/bin/python funnel.py                  # local SQLite
    DATABASE_URL=postgresql://… python funnel.py  # production, read-only

Writes nothing, ever. Safe against production by construction.
"""

import os
from datetime import datetime, timezone

from sqlalchemy import func, select

from app.database import SessionLocal
from app.models import Goal, GoalStatus, ProgressUnit, ScheduledTask, User

# In order. An account's stage is the last one it reached.
STAGES = ["registered", "mission", "availability", "first tick", "mission complete"]


def _age(then: datetime | None) -> str:
    if then is None:
        return "—"
    if then.tzinfo is None:
        then = then.replace(tzinfo=timezone.utc)
    days = (datetime.now(timezone.utc) - then).days
    if days == 0:
        return "today"
    return f"{days}d ago"


def _masked(url: str) -> str:
    """Show which database this is without printing the password into a log."""
    if "@" not in url:
        return url
    scheme, _, rest = url.partition("://")
    return f"{scheme}://***@{rest.rpartition('@')[2]}"


def _refined_flags(db) -> dict[int, bool]:
    """`availability_refined` per user, or empty if the column is not deployed yet."""
    try:
        return {
            uid: bool(flag)
            for uid, flag in db.execute(select(User.id, User.availability_refined)).all()
        }
    except Exception:
        db.rollback()
        return {}


def main() -> int:
    target = os.environ.get("DATABASE_URL", "sqlite:///./acadassist.db")
    print(f"database: {_masked(target)}\n")

    with SessionLocal() as db:
        # Explicit columns, not `select(User)`. This runs against production
        # from a laptop, where the deployed schema can lag the model by a
        # cold start — a mapper-wide SELECT would then fail on a column that
        # simply is not there yet, exactly when the report is most wanted.
        rows = db.execute(
            select(
                User.id, User.name, User.email, User.created_at, User.availability, User.note
            )
            .where(User.is_admin.is_(False))
            .order_by(User.id)
        ).all()
        if not rows:
            print("no non-admin accounts")
            return 0

        refined_by_id = _refined_flags(db)
        reached = dict.fromkeys(STAGES, 0)

        for u in rows:
            goals = db.scalars(select(Goal).where(Goal.user_id == u.id)).all()
            goal_ids = [g.id for g in goals]

            scheduled = completed = 0
            last_tick = None
            if goal_ids:
                scheduled = db.scalar(
                    select(func.count(ScheduledTask.id)).where(ScheduledTask.goal_id.in_(goal_ids))
                )
                completed = db.scalar(
                    select(func.count(ScheduledTask.id)).where(
                        ScheduledTask.goal_id.in_(goal_ids), ScheduledTask.completed.is_(True)
                    )
                )
                last_tick = db.scalar(
                    select(func.max(ProgressUnit.completed_at)).where(
                        ProgressUnit.goal_id.in_(goal_ids)
                    )
                )

            done_missions = [g for g in goals if g.status == GoalStatus.completed]

            stage = "registered"
            if goals:
                stage = "mission"
            # An availability of all zeros is not an answer — the engine falls
            # back to even weighting, which is the state item 3 exists to end.
            if u.availability and any(v > 0 for v in u.availability.values()):
                stage = "availability"
            if completed:
                stage = "first tick"
            if done_missions:
                stage = "mission complete"
            for s in STAGES[: STAGES.index(stage) + 1]:
                reached[s] += 1

            title = goals[0].title if goals else "—"
            if not u.availability:
                rhythm = "none"
            elif u.id not in refined_by_id:
                rhythm = "set"  # schema predates the refined flag
            else:
                rhythm = "refined" if refined_by_id[u.id] else "rest days only"

            print(f"#{u.id} {u.name} <{u.email}>")
            print(f"    registered   {u.created_at:%Y-%m-%d} ({_age(u.created_at)})")
            print(f"    mission      {title}")
            print(f"    rhythm       {rhythm}")
            print(f"    tasks        {completed}/{scheduled} done, last tick {_age(last_tick)}")
            print(f"    STOPPED AT   {stage}")
            if u.note:
                print(f"    note         {u.note}")
            print()

        print("funnel")
        for s in STAGES:
            n = reached[s]
            bar = "#" * n
            print(f"  {s:<17} {n:>3} {bar}")

        winners = reached["mission complete"]
        print()
        if winners:
            print(f"METRIC MET: {winners} account(s) finished a mission end to end.")
        else:
            print("METRIC NOT MET: nobody has finished a mission end to end yet.")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
