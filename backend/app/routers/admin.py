"""Operator dashboard API.

Every route requires `is_admin`, which nothing in the API can grant.

Two honesty rules run through this file:

* **Numbers are computed, never invented.** Where there is no data the answer is
  zero, and the payload says so via `has_data` rather than dressing an empty
  database up as a chart.
* **Sources are labelled.** Engagement derived from analytics only sees users
  who opted in, so those figures carry `basis: "consented_analytics"`. Figures
  derived from product tables see everyone and are labelled separately. Mixing
  the two silently would produce a dashboard that lies quietly.
"""

from __future__ import annotations

import os
import platform
import resource
import time
from datetime import date, datetime, timedelta, timezone

from fastapi import APIRouter, Depends, Query
from sqlalchemy import func, select
from sqlalchemy.orm import Session

from ..database import get_db
from ..deps import require_admin
from ..metrics import metrics
from ..models import (
    AnalyticsEvent,
    Goal,
    Material,
    ProgressUnit,
    ScheduledTask,
    Transaction,
    TransactionKind,
    User,
)

router = APIRouter(prefix="/admin", tags=["admin"], dependencies=[Depends(require_admin)])

ONLINE_WINDOW_MINUTES = 5


def _utc_now() -> datetime:
    return datetime.now(timezone.utc)


def _since(days: int) -> datetime:
    return _utc_now() - timedelta(days=days)


# ---------------------------------------------------------------------------
# Users + engagement
# ---------------------------------------------------------------------------

@router.get("/overview")
def overview(db: Session = Depends(get_db)):
    now = _utc_now()

    total_users = db.scalar(select(func.count()).select_from(User)) or 0
    consented = (
        db.scalar(select(func.count()).select_from(User).where(User.analytics_consent.is_(True)))
        or 0
    )

    def new_users(days: int) -> int:
        return db.scalar(
            select(func.count()).select_from(User).where(User.created_at >= _since(days))
        ) or 0

    def active_users(days: int) -> int:
        """Distinct signed-in users with an analytics event in the window."""
        return (
            db.scalar(
                select(func.count(func.distinct(AnalyticsEvent.user_id))).where(
                    AnalyticsEvent.created_at >= _since(days),
                    AnalyticsEvent.user_id.is_not(None),
                )
            )
            or 0
        )

    # Product-side activity needs no consent: it is the user's own work.
    def active_by_work(days: int) -> int:
        return (
            db.scalar(
                select(func.count(func.distinct(Goal.user_id)))
                .select_from(ProgressUnit)
                .join(Goal, Goal.id == ProgressUnit.goal_id)
                .where(ProgressUnit.completed_at >= _since(days))
            )
            or 0
        )

    online = (
        db.scalar(
            select(func.count(func.distinct(AnalyticsEvent.session_id))).where(
                AnalyticsEvent.created_at >= now - timedelta(minutes=ONLINE_WINDOW_MINUTES)
            )
        )
        or 0
    )

    anon_sessions = (
        db.scalar(
            select(func.count(func.distinct(AnalyticsEvent.session_id))).where(
                AnalyticsEvent.created_at >= _since(30), AnalyticsEvent.user_id.is_(None)
            )
        )
        or 0
    )
    known_sessions = (
        db.scalar(
            select(func.count(func.distinct(AnalyticsEvent.session_id))).where(
                AnalyticsEvent.created_at >= _since(30), AnalyticsEvent.user_id.is_not(None)
            )
        )
        or 0
    )

    # "Returning" = signed up more than a day ago and still doing work.
    returning = (
        db.scalar(
            select(func.count(func.distinct(Goal.user_id)))
            .select_from(ProgressUnit)
            .join(Goal, Goal.id == ProgressUnit.goal_id)
            .join(User, User.id == Goal.user_id)
            .where(ProgressUnit.completed_at >= _since(7), User.created_at < _since(1))
        )
        or 0
    )

    total_events = db.scalar(select(func.count()).select_from(AnalyticsEvent)) or 0

    return {
        "generated_at": now.isoformat(),
        "users": {
            "total": total_users,
            "new_today": new_users(1),
            "new_7d": new_users(7),
            "new_30d": new_users(30),
            "returning_7d": returning,
            "online_now": online,
            "consented_to_analytics": consented,
            "consent_rate_pct": round(100 * consented / total_users, 1) if total_users else 0.0,
        },
        "engagement": {
            "basis": "consented_analytics",
            "dau": active_users(1),
            "wau": active_users(7),
            "mau": active_users(30),
            # Same question answered from product tables, which see every user.
            "dau_by_work": active_by_work(1),
            "wau_by_work": active_by_work(7),
            "mau_by_work": active_by_work(30),
        },
        "sessions_30d": {
            "anonymous": anon_sessions,
            "registered": known_sessions,
        },
        "content": {
            "goals": db.scalar(select(func.count()).select_from(Goal)) or 0,
            "materials": db.scalar(select(func.count()).select_from(Material)) or 0,
            "scheduled_tasks": db.scalar(select(func.count()).select_from(ScheduledTask)) or 0,
            "tasks_completed": db.scalar(
                select(func.count()).select_from(ScheduledTask).where(ScheduledTask.completed.is_(True))
            )
            or 0,
        },
        # Lets the UI say "no data yet" instead of drawing a flat line that
        # looks like a measurement.
        "has_data": total_events > 0,
    }


@router.get("/activity")
def activity(days: int = Query(default=30, ge=1, le=180), db: Session = Depends(get_db)):
    """Daily series for the activity charts. Always returns a dense range —
    days with nothing are zeros, not gaps, so charts do not mislead."""
    start = (_utc_now() - timedelta(days=days - 1)).date()

    rows = db.execute(
        select(
            func.date(AnalyticsEvent.created_at).label("d"),
            func.count().label("events"),
            func.count(func.distinct(AnalyticsEvent.session_id)).label("sessions"),
            func.count(func.distinct(AnalyticsEvent.user_id)).label("users"),
        )
        .where(AnalyticsEvent.created_at >= _since(days))
        .group_by("d")
    ).all()
    by_day = {str(r.d): r for r in rows}

    signups = db.execute(
        select(func.date(User.created_at).label("d"), func.count().label("n"))
        .where(User.created_at >= _since(days))
        .group_by("d")
    ).all()
    signups_by_day = {str(r.d): r.n for r in signups}

    completions = db.execute(
        select(func.date(ProgressUnit.completed_at).label("d"), func.count().label("n"))
        .where(ProgressUnit.completed_at >= _since(days))
        .group_by("d")
    ).all()
    completions_by_day = {str(r.d): r.n for r in completions}

    series = []
    for i in range(days):
        day = (start + timedelta(days=i)).isoformat()
        row = by_day.get(day)
        series.append(
            {
                "date": day,
                "events": row.events if row else 0,
                "sessions": row.sessions if row else 0,
                "active_users": row.users if row else 0,
                "new_users": signups_by_day.get(day, 0),
                "work_completed": completions_by_day.get(day, 0),
            }
        )
    return {"days": days, "series": series, "has_data": any(s["events"] or s["new_users"] for s in series)}


@router.get("/sessions")
def sessions(days: int = Query(default=30, ge=1, le=180), db: Session = Depends(get_db)):
    """Session count and duration. Duration is last-event minus first-event per
    session, so a single-event session is legitimately 0 seconds — the median is
    reported alongside the mean because one long tab distorts an average."""
    rows = db.execute(
        select(
            AnalyticsEvent.session_id,
            func.min(AnalyticsEvent.created_at).label("first"),
            func.max(AnalyticsEvent.created_at).label("last"),
            func.count().label("events"),
        )
        .where(AnalyticsEvent.created_at >= _since(days))
        .group_by(AnalyticsEvent.session_id)
    ).all()

    durations = [
        (r.last - r.first).total_seconds() for r in rows if r.last and r.first
    ]
    durations.sort()
    mean = sum(durations) / len(durations) if durations else 0.0
    median = durations[len(durations) // 2] if durations else 0.0
    bounced = sum(1 for r in rows if r.events <= 1)

    return {
        "days": days,
        "sessions": len(rows),
        "sessions_per_day": round(len(rows) / days, 2),
        "avg_duration_seconds": round(mean, 1),
        "median_duration_seconds": round(median, 1),
        "single_event_sessions": bounced,
        "has_data": len(rows) > 0,
    }


@router.get("/features")
def features(days: int = Query(default=30, ge=1, le=180), db: Session = Depends(get_db)):
    """What people actually use, plus the device/browser split behind it."""

    def group(column, limit=12):
        rows = db.execute(
            select(column, func.count().label("n"))
            .where(AnalyticsEvent.created_at >= _since(days), column.is_not(None))
            .group_by(column)
            .order_by(func.count().desc())
            .limit(limit)
        ).all()
        return [{"key": r[0], "count": r.n} for r in rows]

    return {
        "days": days,
        "events": group(AnalyticsEvent.name),
        "paths": group(AnalyticsEvent.path),
        "devices": group(AnalyticsEvent.device),
        "browsers": group(AnalyticsEvent.browser),
        "languages": group(AnalyticsEvent.language),
        "countries": group(AnalyticsEvent.country),
        "referrers": group(AnalyticsEvent.referrer_host),
    }


@router.get("/retention")
def retention(weeks: int = Query(default=6, ge=1, le=26), db: Session = Depends(get_db)):
    """Weekly signup cohorts against later activity.

    Computed from product work (progress-unit completions), not analytics, so it
    covers every user rather than only those who opted in — retention is the
    beta's success criterion and must not depend on a consent rate.
    """
    today = _utc_now().date()
    # Cohort weeks, oldest first, each starting on a Monday.
    this_monday = today - timedelta(days=today.weekday())
    cohorts = []

    for w in range(weeks - 1, -1, -1):
        cohort_start = this_monday - timedelta(weeks=w)
        cohort_end = cohort_start + timedelta(days=7)
        members = db.scalars(
            select(User.id).where(
                User.created_at >= datetime.combine(cohort_start, datetime.min.time()),
                User.created_at < datetime.combine(cohort_end, datetime.min.time()),
            )
        ).all()
        if not members:
            cohorts.append(
                {"cohort": cohort_start.isoformat(), "size": 0, "retained": [], "retained_pct": []}
            )
            continue

        retained, retained_pct = [], []
        for offset in range(0, w + 1):
            win_start = cohort_start + timedelta(weeks=offset)
            win_end = win_start + timedelta(days=7)
            n = (
                db.scalar(
                    select(func.count(func.distinct(Goal.user_id)))
                    .select_from(ProgressUnit)
                    .join(Goal, Goal.id == ProgressUnit.goal_id)
                    .where(
                        Goal.user_id.in_(members),
                        ProgressUnit.completed_at
                        >= datetime.combine(win_start, datetime.min.time()),
                        ProgressUnit.completed_at < datetime.combine(win_end, datetime.min.time()),
                    )
                )
                or 0
            )
            retained.append(n)
            retained_pct.append(round(100 * n / len(members), 1))

        cohorts.append(
            {
                "cohort": cohort_start.isoformat(),
                "size": len(members),
                "retained": retained,
                "retained_pct": retained_pct,
            }
        )

    return {
        "weeks": weeks,
        "basis": "product_activity",
        "cohorts": cohorts,
        "has_data": any(c["size"] for c in cohorts),
    }


# ---------------------------------------------------------------------------
# Infrastructure
# ---------------------------------------------------------------------------

@router.get("/infrastructure")
def infrastructure(db: Session = Depends(get_db)):
    # Measure a trivial round trip rather than guessing at DB health.
    db_started = time.perf_counter()
    db.execute(select(1))
    db_ms = round((time.perf_counter() - db_started) * 1000, 2)

    # maxrss is KB on Linux, bytes on macOS.
    rss = resource.getrusage(resource.RUSAGE_SELF).ru_maxrss
    rss_mb = round(rss / (1024 * 1024 if platform.system() == "Darwin" else 1024), 1)

    try:
        load1, load5, load15 = os.getloadavg()
    except (OSError, AttributeError):
        load1 = load5 = load15 = None

    return {
        "api": metrics.snapshot(),
        "database": {"ping_ms": db_ms, "dialect": db.bind.dialect.name if db.bind else "unknown"},
        "process": {
            "memory_rss_mb": rss_mb,
            "cpu_count": os.cpu_count(),
            "load_avg_1m": round(load1, 2) if load1 is not None else None,
            "load_avg_5m": round(load5, 2) if load5 is not None else None,
            "load_avg_15m": round(load15, 2) if load15 is not None else None,
            "python": platform.python_version(),
        },
        # Said plainly so nobody reads these as fleet-wide numbers.
        "caveat": (
            "Request and memory figures describe this single warm instance. On "
            "serverless a cold start resets them and other instances keep their "
            "own counters. Treat as a live health signal, not billing-grade "
            "telemetry. CPU percentage is unavailable without psutil; load "
            "average is reported instead and is null on platforms that lack it."
        ),
    }


# ---------------------------------------------------------------------------
# Finance
# ---------------------------------------------------------------------------

@router.get("/finance")
def finance(months: int = Query(default=12, ge=1, le=36), db: Session = Depends(get_db)):
    """Real aggregates over the transactions table.

    There is no billing yet, so this legitimately returns zeros — the queries
    are live, not stubbed, and will report actual figures the moment rows exist.
    `has_data` lets the UI say that honestly instead of drawing an empty chart.
    """

    def total(kind: TransactionKind, since: datetime | None = None) -> int:
        stmt = select(func.coalesce(func.sum(Transaction.amount_cents), 0)).where(
            Transaction.kind == kind
        )
        if since is not None:
            stmt = stmt.where(Transaction.occurred_at >= since)
        return int(db.scalar(stmt) or 0)

    revenue_all = total(TransactionKind.revenue)
    expense_all = total(TransactionKind.expense)
    credit_all = total(TransactionKind.credit)
    debit_all = total(TransactionKind.debit)

    mrr = int(
        db.scalar(
            select(func.coalesce(func.sum(Transaction.amount_cents), 0)).where(
                Transaction.kind == TransactionKind.revenue,
                Transaction.is_recurring.is_(True),
                Transaction.occurred_at >= _since(30),
            )
        )
        or 0
    )

    tx_count = db.scalar(select(func.count()).select_from(Transaction)) or 0

    # Monthly revenue/expense series, dense so the chart has a continuous axis.
    today = date.today().replace(day=1)
    series = []
    for i in range(months - 1, -1, -1):
        year = today.year
        month = today.month - i
        while month <= 0:
            month += 12
            year -= 1
        start = datetime(year, month, 1, tzinfo=timezone.utc)
        end = datetime(year + (month == 12), (month % 12) + 1, 1, tzinfo=timezone.utc)
        rev = int(
            db.scalar(
                select(func.coalesce(func.sum(Transaction.amount_cents), 0)).where(
                    Transaction.kind == TransactionKind.revenue,
                    Transaction.occurred_at >= start,
                    Transaction.occurred_at < end,
                )
            )
            or 0
        )
        exp = int(
            db.scalar(
                select(func.coalesce(func.sum(Transaction.amount_cents), 0)).where(
                    Transaction.kind == TransactionKind.expense,
                    Transaction.occurred_at >= start,
                    Transaction.occurred_at < end,
                )
            )
            or 0
        )
        series.append(
            {
                "month": start.date().isoformat()[:7],
                "revenue_cents": rev,
                "expense_cents": exp,
                "net_cents": rev - exp,
            }
        )

    paying = (
        db.scalar(
            select(func.count(func.distinct(Transaction.user_id))).where(
                Transaction.kind == TransactionKind.revenue, Transaction.user_id.is_not(None)
            )
        )
        or 0
    )

    return {
        "currency": "EUR",
        "totals": {
            "revenue_cents": revenue_all,
            "expense_cents": expense_all,
            "credit_cents": credit_all,
            "debit_cents": debit_all,
            "net_cents": revenue_all - expense_all,
            "mrr_cents": mrr,
        },
        "transactions": tx_count,
        "paying_users": paying,
        "series": series,
        "has_data": tx_count > 0,
        "note": (
            "No billing is wired up yet — premium is deferred until retention is "
            "proven. These are live queries over an empty transactions table, so "
            "the zeros are real rather than placeholder."
        ),
    }
