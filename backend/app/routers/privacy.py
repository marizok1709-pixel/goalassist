"""Analytics ingest and the user's data rights.

Two things live together here on purpose: the endpoint that collects data and
the endpoints that let someone see, control and destroy it. Keeping them in one
file makes it hard to add collection without thinking about the other half.

Collection rules enforced server-side (never trusted to the client):
  * a logged-in user with analytics_consent = False has their events dropped,
  * event names must be on a known allow-list,
  * props are size- and type-limited, so nothing large or free-text sneaks in,
  * IP addresses are never stored; only a coarse country code from the edge.
"""

from datetime import datetime, timedelta, timezone
from urllib.parse import urlparse

from fastapi import APIRouter, Depends, Request, Response, status
from sqlalchemy import delete, select
from sqlalchemy.orm import Session

from ..database import get_db
from ..deps import get_current_user, get_current_user_optional
from ..models import AnalyticsEvent, Goal, Material, ProgressUnit, ScheduledTask, User
from ..schemas import (
    ConsentOut,
    ConsentUpdate,
    EventBatch,
)

router = APIRouter(tags=["privacy"])

# Events the product is allowed to record. An unknown name is dropped rather
# than stored, so a stray or malicious client cannot invent new collection.
ALLOWED_EVENTS = {
    "page_view",
    "session_start",
    "session_end",
    "onboarding_step",
    "onboarding_complete",
    "mission_created",
    "mission_completed",
    "mission_deleted",
    "material_added",
    "material_edited",
    "material_removed",
    "task_completed",
    "task_logged",
    "borrow_tomorrow",
    "availability_saved",
    "theme_changed",
    "feature_used",
    "api_failure",
    "client_error",
    "web_vitals",
}

# Product-analytics retention. Long enough to answer the beta's only real
# question (30-day retention), short enough to be defensible.
RETENTION_DAYS = 180

MAX_EVENTS_PER_BATCH = 50
MAX_PROP_KEYS = 10
MAX_PROP_STR = 64


def _clean_props(props: dict | None) -> dict | None:
    """Keep small scalars only. Strings are truncated and never free-text-sized,
    which is what stops a caller smuggling personal data through the JSON bag."""
    if not props:
        return None
    out: dict[str, object] = {}
    for key, value in list(props.items())[:MAX_PROP_KEYS]:
        if not isinstance(key, str) or len(key) > 32:
            continue
        if isinstance(value, bool) or isinstance(value, int) or isinstance(value, float):
            out[key] = value
        elif isinstance(value, str):
            out[key] = value[:MAX_PROP_STR]
    return out or None


def _referrer_host(referrer: str | None) -> str | None:
    """Host only. A full referrer URL can carry search terms and ids."""
    if not referrer:
        return None
    try:
        host = urlparse(referrer).hostname
    except ValueError:
        return None
    return host[:120] if host else None


@router.post("/analytics/events", status_code=status.HTTP_202_ACCEPTED)
def ingest(
    batch: EventBatch,
    request: Request,
    db: Session = Depends(get_db),
    user: User | None = Depends(get_current_user_optional),
):
    """Accept a batch of events. Always 202 — analytics must never surface an
    error into the product, and a caller learns nothing from the response."""
    if user is not None and not user.analytics_consent:
        return {"accepted": 0}  # consent withdrawn or never given

    # Country comes from the edge (Vercel/Cloudflare set these). The IP itself
    # is never read or stored.
    country = (
        request.headers.get("x-vercel-ip-country")
        or request.headers.get("cf-ipcountry")
        or None
    )
    country = country[:2].upper() if country else None
    referrer_host = _referrer_host(batch.referrer)

    accepted = 0
    for event in batch.events[:MAX_EVENTS_PER_BATCH]:
        if event.name not in ALLOWED_EVENTS:
            continue
        db.add(
            AnalyticsEvent(
                user_id=user.id if user else None,
                session_id=batch.session_id[:64],
                name=event.name,
                props=_clean_props(event.props),
                path=(event.path or None) and event.path[:120],
                device=(batch.device or None) and batch.device[:16],
                browser=(batch.browser or None) and batch.browser[:24],
                viewport_w=batch.viewport_w,
                language=(batch.language or None) and batch.language[:12],
                country=country,
                referrer_host=referrer_host,
            )
        )
        accepted += 1
    db.commit()
    return {"accepted": accepted}


# ---------------------------------------------------------------------------
# Consent
# ---------------------------------------------------------------------------

@router.get("/me/consent", response_model=ConsentOut)
def get_consent(user: User = Depends(get_current_user)):
    return ConsentOut(
        analytics_consent=user.analytics_consent,
        updated_at=user.consent_updated_at,
    )


@router.put("/me/consent", response_model=ConsentOut)
def set_consent(
    payload: ConsentUpdate,
    user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    """Opting out is not just a flag flip — previously collected product events
    are deleted, because continuing to hold them needs a basis the user just
    withdrew."""
    user.analytics_consent = payload.analytics_consent
    user.consent_updated_at = datetime.now(timezone.utc)
    if not payload.analytics_consent:
        db.execute(delete(AnalyticsEvent).where(AnalyticsEvent.user_id == user.id))
    db.commit()
    db.refresh(user)
    return ConsentOut(
        analytics_consent=user.analytics_consent,
        updated_at=user.consent_updated_at,
    )


# ---------------------------------------------------------------------------
# Access / portability / erasure
# ---------------------------------------------------------------------------

@router.get("/me/export")
def export_my_data(user: User = Depends(get_current_user), db: Session = Depends(get_db)):
    """Everything held about this account, in a portable, machine-readable form."""
    goals = db.scalars(select(Goal).where(Goal.user_id == user.id)).all()
    goal_ids = [g.id for g in goals]

    materials = (
        db.scalars(select(Material).where(Material.goal_id.in_(goal_ids))).all() if goal_ids else []
    )
    units = (
        db.scalars(select(ProgressUnit).where(ProgressUnit.goal_id.in_(goal_ids))).all()
        if goal_ids
        else []
    )
    tasks = (
        db.scalars(select(ScheduledTask).where(ScheduledTask.goal_id.in_(goal_ids))).all()
        if goal_ids
        else []
    )
    events = db.scalars(select(AnalyticsEvent).where(AnalyticsEvent.user_id == user.id)).all()

    return {
        "exported_at": datetime.now(timezone.utc).isoformat(),
        "format_version": 1,
        "account": {
            "id": user.id,
            "email": user.email,
            "name": user.name,
            "university": user.university,
            "degree": user.degree,
            "year": user.year,
            "availability": user.availability,
            "analytics_consent": user.analytics_consent,
            "consent_updated_at": user.consent_updated_at.isoformat()
            if user.consent_updated_at
            else None,
            "created_at": user.created_at.isoformat() if user.created_at else None,
        },
        "goals": [
            {
                "id": g.id,
                "title": g.title,
                "description": g.description,
                "category": g.category,
                "deadline": g.deadline.isoformat(),
                "start_date": g.start_date.isoformat(),
                "status": g.status.value,
                "created_at": g.created_at.isoformat() if g.created_at else None,
            }
            for g in goals
        ],
        "materials": [
            {
                "id": m.id,
                "goal_id": m.goal_id,
                "name": m.name,
                "total_quantity": m.total_quantity,
                "unit": m.unit,
            }
            for m in materials
        ],
        "progress_units": [
            {
                "id": u.id,
                "goal_id": u.goal_id,
                "material_id": u.material_id,
                "title": u.title,
                "quantity": u.quantity,
                "unit": u.unit,
                "completed_quantity": u.completed_quantity,
                "completed_at": u.completed_at.isoformat() if u.completed_at else None,
            }
            for u in units
        ],
        "scheduled_tasks": [
            {
                "id": t.id,
                "goal_id": t.goal_id,
                "date": t.date.isoformat(),
                "quantity": t.quantity,
                "description": t.description,
                "completed": t.completed,
            }
            for t in tasks
        ],
        "analytics_events": [
            {
                "name": e.name,
                "props": e.props,
                "path": e.path,
                "device": e.device,
                "browser": e.browser,
                "language": e.language,
                "country": e.country,
                "referrer_host": e.referrer_host,
                "created_at": e.created_at.isoformat() if e.created_at else None,
            }
            for e in events
        ],
    }


@router.delete("/me", status_code=status.HTTP_204_NO_CONTENT)
def delete_my_account(user: User = Depends(get_current_user), db: Session = Depends(get_db)):
    """Erasure. Goals cascade to materials, units and tasks; analytics events
    cascade from the user. Nothing is soft-deleted or archived — after this the
    account genuinely is not in the database."""
    db.delete(user)
    db.commit()
    return Response(status_code=status.HTTP_204_NO_CONTENT)


# ---------------------------------------------------------------------------
# Retention
# ---------------------------------------------------------------------------

def purge_expired_events(db: Session, now: datetime | None = None) -> int:
    """Delete analytics events past the retention window. Called from the
    scheduled purge endpoint; safe to run repeatedly."""
    cutoff = (now or datetime.now(timezone.utc)) - timedelta(days=RETENTION_DAYS)
    result = db.execute(delete(AnalyticsEvent).where(AnalyticsEvent.created_at < cutoff))
    db.commit()
    return result.rowcount or 0
