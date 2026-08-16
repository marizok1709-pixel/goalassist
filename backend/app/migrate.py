"""Tiny additive schema migration.

`Base.metadata.create_all()` creates missing *tables* but never adds a column to
a table that already exists. Production (Neon) already has a `users` table, so
new columns on it would silently never appear and every query touching them
would 500 at runtime.

Alembic is the real answer for a schema that changes often; this project adds a
column every few weeks and deliberately carries no migration tooling, so this
covers the one case that actually bites: additive, nullable/defaulted columns.
It is idempotent, runs at import time, and never drops or rewrites anything —
if a column is missing it is added, otherwise nothing happens.

Anything destructive (renames, type changes, drops) is out of scope on purpose
and should be done deliberately by hand.
"""

from sqlalchemy import inspect, text
from sqlalchemy.engine import Engine

# table -> column -> DDL type + default, portable across SQLite and Postgres.
ADDITIONS: dict[str, dict[str, str]] = {
    "users": {
        "is_admin": "BOOLEAN NOT NULL DEFAULT FALSE",
        "analytics_consent": "BOOLEAN NOT NULL DEFAULT FALSE",
        "consent_updated_at": "TIMESTAMP NULL",
        "note": "VARCHAR(500) NULL",
        "availability_refined": "BOOLEAN NOT NULL DEFAULT FALSE",
        # Left NULL on existing rows on purpose: we do not know where those
        # accounts are, and guessing a zone would silently move their "today".
        "timezone": "VARCHAR(64) NULL",
    },
    "goals": {
        # NULL means "never replanned", which reads as due — the first read of
        # the day catches the mission up whether or not it has one of these.
        "replanned_on": "DATE NULL",
        # Existing missions are normal: nobody has told us otherwise, and the
        # value only affects how the pool is shared.
        #
        # The literal is the enum *member name* (`normal`), not its value
        # (`NORMAL`). SQLAlchemy's `Enum(GoalPriority)` persists the name, so a
        # default written as the value is a row the ORM cannot load back: this
        # shipped to production on 2026-08-16 and every mission became
        # unreadable until the column was rewritten by hand. Locked by check J
        # in `scripts/verify_claims.py`.
        "priority": "VARCHAR(10) NOT NULL DEFAULT 'normal'",
        "launched_over_capacity": "BOOLEAN NOT NULL DEFAULT FALSE",
        "acknowledged_load": "FLOAT NULL",
    },
    "materials": {
        # NULL is the honest default: no estimate has ever been measured.
        "minutes_per_unit": "FLOAT NULL",
    },
    "scheduled_tasks": {
        # Deliberately left NULL on existing rows rather than backfilled: NULL
        # means "logged before this column existed, amount unknown", which the
        # completion code reads as the full planned quantity. Backfilling would
        # write that guess into the data as if it were a fact.
        "actual_quantity": "FLOAT NULL",
    },
}


def ensure_columns(engine: Engine) -> list[str]:
    """Add any missing additive columns. Returns what it changed, for logging."""
    applied: list[str] = []
    inspector = inspect(engine)
    existing_tables = set(inspector.get_table_names())

    with engine.begin() as conn:
        for table, columns in ADDITIONS.items():
            if table not in existing_tables:
                continue  # create_all() will build it complete
            present = {c["name"] for c in inspector.get_columns(table)}
            for column, ddl in columns.items():
                if column in present:
                    continue
                conn.execute(text(f"ALTER TABLE {table} ADD COLUMN {column} {ddl}"))
                applied.append(f"{table}.{column}")
    return applied
