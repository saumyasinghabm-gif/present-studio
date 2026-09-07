from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy import func, or_
from sqlalchemy.orm import Session

from ..database import get_db
from ..models import LiveSession, MediaAsset, Presentation, PresentationMember, ShareLink, Slide, User
from ..schemas import PresentationLimitUpdate, StorageLimitUpdate
from ..security import admin_user


router = APIRouter(prefix="/api/admin", tags=["admin"])


def serialize_admin_user(user: User, presentation_used: int, storage_used: int) -> dict:
    presentation_remaining = max(user.presentation_limit - presentation_used, 0)
    storage_limit = user.storage_limit_bytes
    storage_remaining = None if storage_limit is None else max(storage_limit - storage_used, 0)
    storage_overage = 0 if storage_limit is None else max(storage_used - storage_limit, 0)
    return {
        "id": user.id,
        "name": user.name,
        "email": user.email,
        "role": user.role,
        "isActive": user.is_active,
        "createdAt": user.created_at.isoformat() if user.created_at else None,
        "presentationUsed": presentation_used,
        "presentationLimit": user.presentation_limit,
        "presentationRemaining": presentation_remaining,
        "storageUsedBytes": storage_used,
        "storageLimitBytes": storage_limit,
        "storageRemainingBytes": storage_remaining,
        "storageOverageBytes": storage_overage,
        "storageStatus": "unlimited" if storage_limit is None else ("exceeded" if storage_overage else "within_limit"),
    }


def usage_maps(db: Session) -> tuple[dict[str, int], dict[str, int]]:
    presentation_counts = {
        owner_id: count
        for owner_id, count in db.query(Presentation.owner_id, func.count(Presentation.id))
        .group_by(Presentation.owner_id)
        .all()
    }
    storage_totals = {
        owner_id: int(total or 0)
        for owner_id, total in db.query(MediaAsset.owner_id, func.sum(MediaAsset.size))
        .group_by(MediaAsset.owner_id)
        .all()
    }
    return presentation_counts, storage_totals


@router.get("/users")
def list_users(
    _: User = Depends(admin_user),
    db: Session = Depends(get_db),
) -> dict:
    users = db.query(User).order_by(User.created_at.desc(), User.name.asc()).all()
    presentation_counts, storage_totals = usage_maps(db)
    serialized = [
        serialize_admin_user(
            user,
            presentation_counts.get(user.id, 0),
            storage_totals.get(user.id, 0),
        )
        for user in users
    ]
    return {
        "users": serialized,
        "summary": {
            "totalUsers": len(users),
            "activeUsers": sum(1 for user in users if user.is_active),
            "totalPresentations": sum(presentation_counts.values()),
            "totalStorageBytes": sum(storage_totals.values()),
            "overageUsers": sum(1 for item in serialized if item["storageOverageBytes"] > 0),
        },
    }


@router.patch("/users/{user_id}/presentation-limit")
def update_presentation_limit(
    user_id: str,
    payload: PresentationLimitUpdate,
    _: User = Depends(admin_user),
    db: Session = Depends(get_db),
) -> dict:
    user = db.get(User, user_id)
    if not user:
        raise HTTPException(status_code=404, detail="User not found")
    user.presentation_limit = payload.presentationLimit
    db.commit()
    db.refresh(user)
    presentation_used = db.query(func.count(Presentation.id)).filter(Presentation.owner_id == user.id).scalar() or 0
    storage_used = db.query(func.coalesce(func.sum(MediaAsset.size), 0)).filter(MediaAsset.owner_id == user.id).scalar() or 0
    return {"user": serialize_admin_user(user, presentation_used, int(storage_used))}


@router.patch("/users/{user_id}/storage-limit")
def update_storage_limit(
    user_id: str,
    payload: StorageLimitUpdate,
    _: User = Depends(admin_user),
    db: Session = Depends(get_db),
) -> dict:
    user = db.get(User, user_id)
    if not user:
        raise HTTPException(status_code=404, detail="User not found")
    user.storage_limit_bytes = payload.storageLimitBytes
    db.commit()
    db.refresh(user)
    presentation_used = db.query(func.count(Presentation.id)).filter(Presentation.owner_id == user.id).scalar() or 0
    storage_used = db.query(func.coalesce(func.sum(MediaAsset.size), 0)).filter(MediaAsset.owner_id == user.id).scalar() or 0
    return {"user": serialize_admin_user(user, presentation_used, int(storage_used))}


@router.delete("/users/{user_id}")
def revoke_user(
    user_id: str,
    administrator: User = Depends(admin_user),
    db: Session = Depends(get_db),
) -> dict:
    if user_id == administrator.id:
        raise HTTPException(status_code=409, detail="You cannot revoke your own administrator account")

    user = db.get(User, user_id)
    if not user:
        raise HTTPException(status_code=404, detail="User not found")

    presentation_ids = [
        presentation_id
        for (presentation_id,) in db.query(Presentation.id).filter(Presentation.owner_id == user.id).all()
    ]
    if presentation_ids:
        db.query(PresentationMember).filter(
            or_(
                PresentationMember.user_id == user.id,
                PresentationMember.presentation_id.in_(presentation_ids),
            )
        ).delete(synchronize_session=False)
        db.query(ShareLink).filter(ShareLink.presentation_id.in_(presentation_ids)).delete(synchronize_session=False)
        db.query(LiveSession).filter(LiveSession.presentation_id.in_(presentation_ids)).delete(synchronize_session=False)
        db.query(Slide).filter(Slide.presentation_id.in_(presentation_ids)).delete(synchronize_session=False)
        db.query(Presentation).filter(Presentation.id.in_(presentation_ids)).delete(synchronize_session=False)
    else:
        db.query(PresentationMember).filter(PresentationMember.user_id == user.id).delete(synchronize_session=False)

    db.query(LiveSession).filter(LiveSession.presenter_user_id == user.id).update(
        {LiveSession.presenter_user_id: None}, synchronize_session=False
    )
    db.query(MediaAsset).filter(MediaAsset.owner_id == user.id).delete(synchronize_session=False)
    db.delete(user)
    db.commit()
    return {"ok": True, "userId": user_id}
