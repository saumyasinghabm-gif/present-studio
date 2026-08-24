from fastapi import APIRouter, Depends, HTTPException, Response, status
from sqlalchemy.orm import Session
from ..database import get_db
from ..models import User
from ..schemas import AuthOut, LoginRequest, SignupRequest, UserOut
from ..security import create_access_token, current_user, hash_password, new_id, verify_password


router = APIRouter(prefix="/api/auth", tags=["auth"])


def serialize_user(user: User) -> UserOut:
    return UserOut(id=user.id, name=user.name, email=user.email, role=user.role)


@router.post("/signup")
def signup(payload: SignupRequest, response: Response, db: Session = Depends(get_db)) -> AuthOut:
    email = payload.email.strip().lower()
    if len(payload.password) < 8:
        raise HTTPException(status_code=400, detail="Password must be at least 8 characters")
    if db.query(User).filter(User.email == email).first():
        raise HTTPException(status_code=409, detail="Email already registered")

    user = User(
        id=new_id("usr"),
        name=payload.name.strip() or "Studio User",
        email=email,
        password_hash=hash_password(payload.password),
        role="owner",
    )
    db.add(user)
    db.commit()
    token = create_access_token(user)
    response.set_cookie("present_studio_token", token, httponly=True, samesite="lax")
    return AuthOut(user=serialize_user(user), accessToken=token)


@router.post("/login")
def login(payload: LoginRequest, response: Response, db: Session = Depends(get_db)) -> AuthOut:
    user = db.query(User).filter(User.email == payload.email.strip().lower()).first()
    if not user or not verify_password(payload.password, user.password_hash):
        raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="Invalid email or password")

    token = create_access_token(user)
    response.set_cookie("present_studio_token", token, httponly=True, samesite="lax")
    return AuthOut(user=serialize_user(user), accessToken=token)


@router.get("/me")
def me(user: User = Depends(current_user)) -> dict[str, UserOut]:
    return {"user": serialize_user(user)}


@router.post("/logout")
def logout(response: Response) -> dict[str, bool]:
    response.delete_cookie("present_studio_token")
    return {"ok": True}
