"""Grant or revoke operator access.

This is the *only* way to become an admin. There is deliberately no API path —
not registration, not PATCH /auth/me — so the flag cannot be escalated by
anything reachable from a browser. It has to be done here, with database
credentials in hand.

    python make_admin.py you@example.com            # grant
    python make_admin.py you@example.com --revoke   # revoke
    python make_admin.py --list                     # who has it

Runs against whatever DATABASE_URL points at, so double-check before running it
against production.
"""

import argparse
import os
import sys

from app.database import SessionLocal
from app.models import User


def main() -> int:
    parser = argparse.ArgumentParser(description="Grant or revoke GoalAssist admin access")
    parser.add_argument("email", nargs="?", help="account to change")
    parser.add_argument("--revoke", action="store_true", help="remove admin instead of granting")
    parser.add_argument("--list", action="store_true", help="list current admins")
    args = parser.parse_args()

    target_db = os.environ.get("DATABASE_URL", "sqlite:///./acadassist.db")
    print(f"database: {target_db}")

    with SessionLocal() as db:
        if args.list:
            admins = db.query(User).filter(User.is_admin.is_(True)).all()
            if not admins:
                print("no admins")
            for u in admins:
                print(f"  {u.email}")
            return 0

        if not args.email:
            parser.error("an email is required unless --list is given")

        user = db.query(User).filter(User.email == args.email).one_or_none()
        if user is None:
            print(f"no account with email {args.email!r}", file=sys.stderr)
            return 1

        user.is_admin = not args.revoke
        db.commit()
        print(f"{'revoked' if args.revoke else 'granted'} admin for {user.email}")
        return 0


if __name__ == "__main__":
    raise SystemExit(main())
