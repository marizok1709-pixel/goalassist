from datetime import datetime, timezone

from fastapi import APIRouter, Depends, HTTPException, status
from sqlalchemy import select
from sqlalchemy.orm import Session

from ..database import get_db
from ..deps import get_current_user
from ..models import GoalStatus, User
from ..schemas import Token, UserCreate, UserLogin, UserOut, UserUpdate
from ..security import create_access_token, hash_password, verify_password
from ..services import clock, engine

router = APIRouter(prefix="/auth", tags=["auth"])


@router.post("/register", response_model=Token, status_code=status.HTTP_201_CREATED)
def register(payload: UserCreate, db: Session = Depends(get_db)):
    existing = db.scalar(select(User).where(User.email == payload.email))
    if existing:
        raise HTTPException(status.HTTP_409_CONFLICT, "Email already registered")
    user = User(
        email=payload.email,
        password_hash=hash_password(payload.password),
        name=payload.name,
        university=payload.university,
        degree=payload.degree,
        year=payload.year,
        # An unresolvable zone is stored as NULL rather than rejected: a browser
        # that reports something we cannot parse should still get an account,
        # and NULL simply means "fall back to the server clock".
        timezone=payload.timezone if clock.is_valid_timezone(payload.timezone) else None,
    )
    db.add(user)
    db.commit()
    db.refresh(user)
    return Token(access_token=create_access_token(user.id), user=UserOut.model_validate(user))


@router.post("/login", response_model=Token)
def login(payload: UserLogin, db: Session = Depends(get_db)):
    user = db.scalar(select(User).where(User.email == payload.email))
    if user is None or not verify_password(payload.password, user.password_hash):
        raise HTTPException(status.HTTP_401_UNAUTHORIZED, "Invalid email or password")
    return Token(access_token=create_access_token(user.id), user=UserOut.model_validate(user))


@router.get("/me", response_model=UserOut)
def me(user: User = Depends(get_current_user)):
    return user


@router.patch("/me", response_model=UserOut)
def update_me(
    payload: UserUpdate,
    user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    data = payload.model_dump(exclude_unset=True)
    if "timezone" in data and not clock.is_valid_timezone(data["timezone"]):
        data["timezone"] = None
    for field, value in data.items():
        setattr(user, field, value)
    # A new weekly rhythm changes every active mission's future schedule, and
    # used to trigger a rebuild of each one. Nothing to rebuild now: the plan is
    # computed from the mission's live position — including this availability —
    # every time anybody reads it.
    db.commit()
    db.refresh(user)
    return user
