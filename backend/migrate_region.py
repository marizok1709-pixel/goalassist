"""One-shot data migration between two Postgres databases (US → EU region move).

Copies every row from SOURCE to DEST, in FK-safe order, preserving primary keys,
then resets each table's id sequence so future inserts don't collide.

  SOURCE_DATABASE_URL  — current prod (us-east-1), read-only here
  DEST_DATABASE_URL    — new EU database

  # dry run: just enumerate what SOURCE holds (no DEST needed, nothing written)
  SOURCE_DATABASE_URL=... python migrate_region.py --dry-run

  # real run: create schema on DEST, copy, verify
  SOURCE_DATABASE_URL=... DEST_DATABASE_URL=... python migrate_region.py

Safe to re-run: DEST tables are cleared before copy so a partial run can be
retried. Never writes to SOURCE.
"""

import argparse
import os
import sys

from sqlalchemy import create_engine, delete, insert, select, text

from app.database import Base
from app import models  # noqa: F401 — registers all tables on Base.metadata

# Parent-before-child, so foreign keys always resolve.
ORDER = [
    "users",
    "goals",
    "materials",
    "progress_units",
    "scheduled_tasks",
    "analytics_events",
    "transactions",
]


def _normalize(url: str) -> str:
    if url.startswith("postgres://"):
        return url.replace("postgres://", "postgresql+psycopg://", 1)
    if url.startswith("postgresql://"):
        return url.replace("postgresql://", "postgresql+psycopg://", 1)
    return url


def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("--dry-run", action="store_true")
    args = ap.parse_args()

    src_url = os.environ.get("SOURCE_DATABASE_URL")
    if not src_url:
        print("SOURCE_DATABASE_URL is required", file=sys.stderr)
        return 2
    src = create_engine(_normalize(src_url), pool_pre_ping=True)

    tables = {t.name: t for t in Base.metadata.sorted_tables}

    print("SOURCE contents:")
    with src.connect() as s:
        counts = {}
        for name in ORDER:
            n = s.execute(select(text("count(*)")).select_from(tables[name])).scalar_one()
            counts[name] = n
            print(f"  {name:20} {n} rows")

    if args.dry_run:
        print("\n[dry run] nothing written. Provide DEST_DATABASE_URL to migrate.")
        return 0

    dest_url = os.environ.get("DEST_DATABASE_URL")
    if not dest_url:
        print("DEST_DATABASE_URL is required for a real run", file=sys.stderr)
        return 2
    dest = create_engine(_normalize(dest_url), pool_pre_ping=True)

    print("\nCreating schema on DEST…")
    Base.metadata.create_all(dest)

    print("Copying…")
    with src.connect() as s, dest.begin() as dconn:
        # clear child→parent so re-runs are clean
        for name in reversed(ORDER):
            dconn.execute(delete(tables[name]))
        for name in ORDER:
            rows = [dict(r) for r in s.execute(select(tables[name])).mappings().all()]
            if rows:
                dconn.execute(insert(tables[name]), rows)
            print(f"  {name:20} {len(rows)} copied")
        # reset id sequences to max(id) so the next insert gets a fresh id
        for name in ORDER:
            dconn.execute(
                text(
                    f"SELECT setval(pg_get_serial_sequence('{name}', 'id'), "
                    f"COALESCE((SELECT MAX(id) FROM {name}), 1), "
                    f"(SELECT COUNT(*) FROM {name}) > 0)"
                )
            )

    print("\nVerifying row counts match…")
    ok = True
    with dest.connect() as d:
        for name in ORDER:
            n = d.execute(select(text("count(*)")).select_from(tables[name])).scalar_one()
            match = n == counts[name]
            ok = ok and match
            print(f"  {name:20} src={counts[name]} dest={n} {'OK' if match else 'MISMATCH'}")

    print("\n" + ("MIGRATION OK — every table matches." if ok else "MISMATCH — do NOT switch over."))
    return 0 if ok else 1


if __name__ == "__main__":
    raise SystemExit(main())
