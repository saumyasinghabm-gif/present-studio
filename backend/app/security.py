from datetime import datetime, timedelta, timezone
from uuid import uuid4
import jwt
from fastapi import Depends, HTTPException, Request, status
from passlib.context import CryptContext
from sqlalchemy.orm import Session
from .config import get_settings
from .database import get_db
from .models import Presentation, PresentationMember, ShareLink, User


pwd_context = CryptContext(schemes=["pbkdf2_sha256"], deprecated="auto")


def new_id(prefix: str) -> str:
    return f"{prefix}_{uuid4().hex}"


def hash_password(password: str) -> str:
    return pwd_context.hash(password)


def verify_password(password: str, password_hash: str) -> bool:
    return pwd_context.verify(password, password_hash)


def create_access_token(user: User) -> str:
    settings = get_settings()
    expires_at = datetime.now(timezone.utc) + timedelta(minutes=settings.access_token_minutes)
    payload = {"sub": user.id, "email": user.email, "role": user.role, "exp": expires_at}
    return jwt.encode(payload, settings.jwt_secret, algorithm=settings.jwt_algorithm)


def current_user(request: Request, db: Session = Depends(get_db)) -> User:
    auth_header = request.headers.get("authorization", "")
    token = auth_header.removeprefix("Bearer ").strip() if auth_header.lower().startswith("bearer ") else ""
    if not token:
        token = request.cookies.get("present_studio_token", "")
    if not token:
        raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="Authentication required")

    settings = get_settings()
    try:
        payload = jwt.decode(token, settings.jwt_secret, algorithms=[settings.jwt_algorithm])
    except jwt.PyJWTError as exc:
        raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="Invalid token") from exc

    user = db.get(User, payload.get("sub"))
    if not user or not user.is_active:
        raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="Invalid user")
    return user


def user_from_token(db: Session, token: str) -> User | None:
    if not token:
        return None
    settings = get_settings()
    try:
        payload = jwt.decode(token, settings.jwt_secret, algorithms=[settings.jwt_algorithm])
    except jwt.PyJWTError:
        return None
    user = db.get(User, payload.get("sub"))
    return user if user and user.is_active else None


def optional_current_user(request: Request, db: Session) -> User | None:
    auth_header = request.headers.get("authorization", "")
    token = auth_header.removeprefix("Bearer ").strip() if auth_header.lower().startswith("bearer ") else ""
    if not token:
        token = request.cookies.get("present_studio_token", "")
    return user_from_token(db, token)


def can_edit_presentation(db: Session, presentation: Presentation, user: User) -> bool:
    if presentation.owner_id == user.id:
        return True
    member = db.query(PresentationMember).filter(
        PresentationMember.presentation_id == presentation.id,
        PresentationMember.user_id == user.id,
    ).first()
    return bool(member and member.role in {"owner", "editor"})


def can_view_presentation(db: Session, presentation: Presentation, user: User) -> bool:
    if can_edit_presentation(db, presentation, user):
        return True
    member = db.query(PresentationMember).filter(
        PresentationMember.presentation_id == presentation.id,
        PresentationMember.user_id == user.id,
    ).first()
    return bool(member and member.role in {"viewer", "editor", "owner"})


def resolve_share_permission(db: Session, presentation_id: str, token: str) -> str | None:
    share = db.query(ShareLink).filter(
        ShareLink.token == token,
        ShareLink.presentation_id == presentation_id,
        ShareLink.is_active == True,  # noqa: E712
    ).first()
    if not share:
        return None
    if share.permission not in {"viewer", "presenter"}:
        return "viewer"
    return share.permission


def can_present_with_credentials(db: Session, presentation: Presentation, auth_token: str = "", share_token: str = "") -> bool:
    user = user_from_token(db, auth_token)
    if user and can_edit_presentation(db, presentation, user):
        return True
    return resolve_share_permission(db, presentation.id, share_token) == "presenter"
