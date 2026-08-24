from fastapi import APIRouter, Depends
from sqlalchemy.orm import Session
from ..database import get_db
from ..models import User
from ..schemas import LoginRequest, UserOut
from ..seed import DEMO_USER_ID


router = APIRouter(prefix="/api/auth", tags=["auth"])


def current_user(db: Session = Depends(get_db)) -> User:
    return db.get(User, DEMO_USER_ID)


@router.post("/login")
def login(payload: LoginRequest, db: Session = Depends(get_db)) -> dict[str, UserOut]:
    user = db.query(User).filter(User.email == payload.email).first() or db.get(User, DEMO_USER_ID)
    return {"user": UserOut(id=user.id, name=user.name, email=user.email, role=user.role)}


@router.get("/me")
def me(user: User = Depends(current_user)) -> dict[str, UserOut]:
    return {"user": UserOut(id=user.id, name=user.name, email=user.email, role=user.role)}


@router.post("/logout")
def logout() -> dict[str, bool]:
    return {"ok": True}
