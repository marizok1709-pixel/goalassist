#!/usr/bin/env python
"""Assert that what the documents claim is true of the code.

The standing gate in `VERIFICATION.md` proves the *code* works. Nothing proved
the *claims about it* were true, and on 2026-08-16 three false ones surfaced at
once, each of which had been written up and believed:

  - `VERIFICATION.md` said `funnel.py` survives a schema lag. It did not: a
    mapper-wide `select(Goal)` had survived at line 89, so the report that
    measures the only success criterion was blind against production for the
    eleven days the pivot sat undeployed.
  - `PROJECT_STATE.md` said "PR #1 still open" in three places. PR #1 closed on
    2026-07-26; PR #2 merged on 2026-08-07.
  - Both pivot notes recorded Phase 1's cutover as finished. It is not — the
    forward plan is still written to `ScheduledTask`, which is the exact defect
    Phase 1 existed to end.

Every check here is *structural*: it compares a number or a name in a document
against the thing the document is describing. Nothing here greps prose for
sentiment, because a check that depends on how a sentence is phrased rots the
first time somebody rewrites the sentence.

    backend/.venv/bin/python scripts/verify_claims.py

Exits non-zero if any claim is false. Set SKIP_LINT=1 to skip the one check
that shells out to npm.
"""

from __future__ import annotations

import json
import os
import re
import subprocess
import sys
import tempfile
from pathlib import Path

REPO = Path(__file__).resolve().parent.parent
BACKEND = REPO / "backend"
FRONTEND = REPO / "frontend"
VAULT = Path.home() / "Documents" / "Obsidian Vault" / "GoalAssist"
MEMORY = (
    Path.home()
    / ".claude"
    / "projects"
    / "-Users-markmitrofanov-acadassist"
    / "memory"
)

# Importing `app.main` runs `Base.metadata.create_all()`, so point it at a
# throwaway database before anything else touches the environment. Never let a
# verification run create tables in the demo database.
_TMP = tempfile.mkdtemp(prefix="verify_claims_")
os.environ["DATABASE_URL"] = f"sqlite:///{_TMP}/claims.db"

results: list[tuple[str, str, bool, str]] = []


def check(ref: str, name: str, ok: bool, detail: str = "") -> None:
    results.append((ref, name, bool(ok), detail))


def read(path: Path) -> str:
    return path.read_text(encoding="utf-8")


WORDS = {
    "one": 1, "two": 2, "three": 3, "four": 4, "five": 5, "six": 6, "seven": 7,
    "eight": 8, "nine": 9, "ten": 10, "eleven": 11, "twelve": 12,
    "thirteen": 13, "fourteen": 14, "fifteen": 15,
}


def as_int(token: str) -> int | None:
    token = token.strip().lower()
    if token.isdigit():
        return int(token)
    return WORDS.get(token)


# --------------------------------------------------------------- A, B: suites
def check_suites() -> None:
    verification = read(REPO / "VERIFICATION.md")
    # `smoke_test*.py`, not `smoke_test_*.py` — the underscore form silently
    # excludes `smoke_test.py` itself, and the same blind spot in both patterns
    # made the comparison agree with itself.
    on_disk = {p.name for p in BACKEND.glob("smoke_test*.py")}
    named = set(re.findall(r"smoke_test\w*\.py", verification))

    unlisted = sorted(on_disk - named)
    phantom = sorted(named - on_disk)
    check(
        "A", "every suite on disk is named in VERIFICATION.md, and vice versa",
        not unlisted and not phantom,
        f"unlisted={unlisted} phantom={phantom}" if (unlisted or phantom) else
        f"{len(on_disk)} suites, all accounted for",
    )

    m = re.search(r"(\w+) backend suites", verification)
    claimed = as_int(m.group(1)) if m else None
    check(
        "B", "the suite count in the prose matches the count on disk",
        claimed == len(on_disk),
        f"prose says {claimed!r}, disk has {len(on_disk)}",
    )


# ------------------------------------------------------------ C: the API map
def check_routes() -> None:
    sys.path.insert(0, str(BACKEND))
    try:
        from app.main import app  # noqa: PLC0415
    except Exception as exc:  # pragma: no cover - import failure is the finding
        check("C", "the documented API map matches the real route table", False,
              f"could not import app.main: {exc}")
        return

    def norm(p: str) -> str:
        return re.sub(r"\{[^}]*\}", "{}", p.rstrip("/")) or "/"

    def walk(routes) -> set[str]:
        # Included routers appear as `_IncludedRouter` containers with no `path`
        # of their own; their routes hang off `original_router`, already carrying
        # the prefix. Missing that made this check pass vacuously against an
        # empty set, which is the failure mode it exists to prevent.
        found: set[str] = set()
        for r in routes:
            path = getattr(r, "path", None)
            if isinstance(path, str):
                found.add(norm(path))
            found |= walk(getattr(r, "routes", []) or [])
            original = getattr(r, "original_router", None)
            if original is not None:
                found |= walk(getattr(original, "routes", []) or [])
        return found

    real = walk(app.routes)

    # backend/README.md is the API map: a markdown table whose Path column is a
    # backticked path. It is the only doc that claims to enumerate endpoints.
    documented: set[str] = set()
    for line in read(BACKEND / "README.md").splitlines():
        if line.startswith("|"):
            cells = [c.strip() for c in line.split("|")]
            for cell in cells[2:3]:
                found = re.findall(r"`(/[^`]*)`", cell)
                documented.update(norm(f) for f in found)

    missing = sorted(documented - real)
    check(
        "C", "every endpoint in the API map exists in the route table",
        not missing and bool(documented),
        f"documented but absent: {missing}" if missing
        else f"{len(documented)} documented endpoints, all present",
    )

    # `POST /today/more` moved rows between days without re-planning, which is
    # how work landed on a zero-hour Saturday. It must stay gone.
    check(
        "C2", "POST /today/more is still deleted",
        "/today/more" not in real,
        "present again" if "/today/more" in real else "absent",
    )


# ------------------------------------------------------------- D: the cutover
def check_cutover() -> None:
    refs = 0
    for path in (BACKEND / "app" / "routers").glob("*.py"):
        refs += len(re.findall(r"\bScheduledTask\b", read(path)))

    doc = read(REPO / "PROJECT_STATE.md").lower()
    says_partial = "cutover is partial" in doc

    # The biconditional is the point. Finishing the cutover without updating the
    # document fails; claiming it is finished while the writes remain fails too.
    check(
        "D", "the documented cutover status matches the code",
        (refs > 0) == says_partial,
        f"{refs} ScheduledTask refs in routers, doc says partial={says_partial}",
    )


# ------------------------------------------------------------- E: the vault
def check_vault() -> None:
    if not VAULT.is_dir():
        check("E", "vault docs are symlinks into the repo", False, "vault missing")
        return

    expected = {
        "PROJECT_STATE.md": REPO / "PROJECT_STATE.md",
        "VERIFICATION.md": REPO / "VERIFICATION.md",
        "CHANGELOG.md": REPO / "CHANGELOG.md",
        "PRIVACY.md": REPO / "PRIVACY.md",
        "README (root).md": REPO / "README.md",
        "README (backend).md": BACKEND / "README.md",
    }
    broken = []
    for name, target in expected.items():
        p = VAULT / name
        if not p.is_symlink():
            broken.append(f"{name}: not a symlink")
        elif p.resolve() != target.resolve():
            broken.append(f"{name}: points at {p.resolve()}")
        elif not p.resolve().exists():
            broken.append(f"{name}: dangling")
    check(
        "E", "vault docs are symlinks into the repo, so they cannot drift",
        not broken, "; ".join(broken) if broken else f"{len(expected)} symlinks intact",
    )

    dangling = []
    for md in VAULT.glob("*.md"):
        for link in re.findall(r"\[\[([^\]|#]+)", read(md)):
            if not (VAULT / f"{link.strip()}.md").exists():
                dangling.append(f"{md.name} -> [[{link.strip()}]]")
    check(
        "E2", "every vault wikilink resolves",
        not dangling, "; ".join(dangling) if dangling else "all links resolve",
    )


# ------------------------------------------------------------- F: the memory
def check_memory() -> None:
    if not MEMORY.is_dir():
        check("F", "the memory index matches the memory files", False, "memory dir missing")
        return

    index_path = MEMORY / "MEMORY.md"
    index = read(index_path) if index_path.exists() else ""
    files = {p.name for p in MEMORY.glob("*.md")} - {"MEMORY.md"}
    linked = set(re.findall(r"\(([^)]+\.md)\)", index))

    unindexed = sorted(files - linked)
    dangling = sorted(n for n in linked if not (MEMORY / n).exists())
    check(
        "F", "every memory file is indexed, and every index entry exists",
        not unindexed and not dangling,
        f"unindexed={unindexed} dangling={dangling}" if (unindexed or dangling)
        else f"{len(files)} memories, all indexed",
    )

    # Narrow guard on the two claims the pivot retired. A line is exempt when it
    # is explicitly marking the claim as dead, which is how the correction reads.
    retired = ["engine stays feature-frozen", "10 students, 30 days"]
    exempt = ("retired", "superseded", "no longer", "replaced", "reversed")
    offences = []
    for path in list(MEMORY.glob("*.md")) + [
        REPO / "PROJECT_STATE.md", REPO / "VERIFICATION.md"
    ]:
        for i, line in enumerate(read(path).splitlines(), 1):
            low = line.lower()
            if any(p in low for p in retired) and not any(e in low for e in exempt):
                offences.append(f"{path.name}:{i}")
    check(
        "F2", "no live document still asserts a retired decision",
        not offences, "; ".join(offences) if offences else "none asserted as current",
    )


# ------------------------------------------------------------- G: the funnel
def check_funnel() -> None:
    # Strip comments first: funnel.py *documents* the rule in prose ("Explicit
    # columns, not `select(User)`"), and matching that text reported the fix
    # itself as the defect.
    source = "\n".join(
        line.split("#", 1)[0] for line in read(BACKEND / "funnel.py").splitlines()
    )
    # The regression was a mapper-wide SELECT: `select(Goal)` rather than
    # `select(Goal.id, ...)`. A bare model name inside select() is the shape.
    bare = re.findall(r"select\(\s*(User|Goal|ScheduledTask|ProgressUnit)\s*\)", source)
    check(
        "G", "funnel.py selects explicit columns, never a whole mapper",
        not bare, f"mapper-wide selects: {bare}" if bare else "no mapper-wide selects",
    )

    # Seed one non-admin account *with a goal*. Against an empty database
    # funnel.py returns at its "no non-admin accounts" guard and never reaches
    # the goal query — so this check passed while the very line it exists to
    # guard was broken. An unexercised check is not a check.
    from datetime import date, timedelta  # noqa: PLC0415

    from app.database import SessionLocal  # noqa: PLC0415
    from app.models import Goal, User  # noqa: PLC0415

    with SessionLocal() as db:
        if not db.query(User).first():
            u = User(email="probe@example.com", password_hash="x", name="Probe")
            db.add(u)
            db.flush()
            db.add(Goal(user_id=u.id, title="Probe", deadline=date.today() + timedelta(days=7)))
            db.commit()

    proc = subprocess.run(
        [sys.executable, "funnel.py"], cwd=BACKEND,
        capture_output=True, text=True, env=os.environ, timeout=120,
    )
    reached_goals = "STOPPED AT" in proc.stdout
    blew_up = proc.returncode != 0 or "UndefinedColumn" in proc.stderr
    check(
        "G2", "funnel.py runs end to end, reaching the goal query",
        not blew_up and reached_goals,
        (proc.stderr.strip().splitlines() or ["?"])[-1] if blew_up
        else ("never reached the goal query" if not reached_goals else "exit 0, goals read"),
    )


# ------------------------------------------------- H, I: frontend claims
def check_frontend() -> None:
    verification = read(REPO / "VERIFICATION.md")

    m = re.search(r"(\d+) routes", verification)
    claimed = int(m.group(1)) if m else None
    pages = len(list((FRONTEND / "src" / "app").rglob("page.tsx")))
    icons = len([
        p for p in (FRONTEND / "src" / "app").glob("*")
        if p.stem in ("icon", "apple-icon")
    ])
    actual = pages + icons + 1  # +1: Next always emits /_not-found
    check(
        "I", "the route count in VERIFICATION.md matches the app directory",
        claimed == actual,
        f"doc says {claimed}, app has {pages} pages + {icons} icons + _not-found = {actual}",
    )

    m = re.search(r"[Ll]int baseline:\s*\*?\*?(\d+) errors", verification)
    claimed_lint = int(m.group(1)) if m else None
    if os.environ.get("SKIP_LINT"):
        check("H", "the lint baseline matches reality", True,
              f"skipped (doc claims {claimed_lint})")
        return
    proc = subprocess.run(
        ["npm", "run", "lint"], cwd=FRONTEND,
        capture_output=True, text=True, timeout=300,
    )
    out = proc.stdout + proc.stderr
    m = re.search(r"(\d+) errors?", out)
    actual_lint = int(m.group(1)) if m else (0 if "✖" not in out else None)
    check(
        "H", "the lint baseline in VERIFICATION.md matches reality",
        claimed_lint == actual_lint,
        f"doc says {claimed_lint}, lint reports {actual_lint}",
    )


# ------------------------------------------------- J: migration vs the ORM
def check_migration_defaults() -> None:
    """Every enum-ish default in migrate.py must be a form the ORM can read back.

    `Enum(GoalPriority)` persists the member *name* (`normal`), not its value
    (`NORMAL`). `migrate.py` wrote the value, so on 2026-08-16 every production
    mission became unloadable — `LookupError: 'NORMAL' is not among the defined
    enum values` — while all 354 local checks stayed green, because the suites
    build their schema with `create_all()` and never execute the ALTER TABLE
    path that only production takes.
    """
    sys.path.insert(0, str(BACKEND))
    try:
        from app import migrate as migrate_mod  # noqa: PLC0415
        from app import models as models_mod  # noqa: PLC0415
    except Exception as exc:  # pragma: no cover
        check("J", "migration defaults are values the ORM can read back", False, str(exc))
        return

    import enum as _enum  # noqa: PLC0415

    # Every name any of the app's enums would persist.
    valid = {
        m.name
        for obj in vars(models_mod).values()
        if isinstance(obj, type) and issubclass(obj, _enum.Enum)
        for m in obj
    }
    spec = getattr(migrate_mod, "ADDITIONS", None)
    if not spec:
        # Guessing the attribute name made this check pass against an empty
        # dict — green while the bug it exists for was sitting in the file.
        check("J", "migration defaults are in the form the ORM persists", False,
              "migrate.ADDITIONS not found — check is not reading the spec")
        return

    offences = []
    for table, cols in (spec or {}).items():
        for col, ddl in cols.items():
            m = re.search(r"DEFAULT\s+'([^']+)'", str(ddl))
            if not m:
                continue
            literal = m.group(1)
            # Only judge literals that look like an enum member of some casing.
            if literal.lower() in {v.lower() for v in valid} and literal not in valid:
                offences.append(f"{table}.{col} defaults to {literal!r}, ORM persists {literal.lower()!r}")
    check(
        "J", "migration defaults are in the form the ORM persists",
        not offences, "; ".join(offences) if offences else "all enum defaults use member names",
    )


def main() -> int:
    check_suites()
    check_routes()
    check_cutover()
    check_vault()
    check_memory()
    check_funnel()
    check_migration_defaults()
    check_frontend()

    width = max(len(n) for _, n, _, _ in results)
    print("\nclaims verified against the code\n")
    for ref, name, ok, detail in results:
        mark = "PASS" if ok else "FAIL"
        print(f"  [{mark}] {ref:<3} {name:<{width}}  {detail}")

    failed = [f"{r} {n}" for r, n, ok, _ in results if not ok]
    print()
    if failed:
        print(f"{len(failed)} FALSE CLAIM(S): " + "; ".join(failed))
        return 1
    print(f"all {len(results)} claims hold")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
