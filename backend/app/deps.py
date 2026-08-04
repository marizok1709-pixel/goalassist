from fastapi import Depends, HTTPException, status
from fastapi.security import HTTPAuthorizationCredentials, HTTPBearer
from sqlalchemy.orm import Session

from .database import get_db
from .models import Goal, User
from .security import decode_access_token

bearer = HTTPBearer(auto_error=False)


def get_current_user(
    credentials: HTTPAuthorizationCredentials | None = Depends(bearer),
    db: Session = Depends(get_db),
) -> User:
    if credentials is None:
        raise HTTPException(status.HTTP_401_UNAUTHORIZED, "Not authenticated")
    user_id = decode_access_token(credentials.credentials)
    if user_id is None:
        raise HTTPException(status.HTTP_401_UNAUTHORIZED, "Invalid or expired token")
    user = db.get(User, user_id)
    if user is None:
        raise HTTPException(status.HTTP_401_UNAUTHORIZED, "User no longer exists")
    return user


def get_current_user_optional(
    credentials: HTTPAuthorizationCredentials | None = Depends(bearer),
    db: Session = Depends(get_db),
) -> User | None:
    """Same as get_current_user but returns None instead of raising.

    Analytics has to work for logged-out visitors, so the ingest endpoint needs
    to know *whether* someone is signed in without demanding that they are.
    """
    if credentials is None:
        return None
    user_id = decode_access_token(credentials.credentials)
    if user_id is None:
        return None
    return db.get(User, user_id)


def require_admin(user: User = Depends(get_current_user)) -> User:
    """Gate for every operator endpoint.

    `is_admin` has no self-service path anywhere in the API — it is set by a
    direct database update and nothing else, so privilege cannot be escalated
    through a request. 404 rather than 403 on purpose: an unauthorised caller
    should not learn that an admin surface exists.
    """
    if not user.is_admin:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Not found")
    return user


def get_own_goal(
    goal_id: int,
    user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
) -> Goal:
    goal = db.get(Goal, goal_id)
    if goal is None or goal.user_id != user.id:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Goal not found")
    return goal
