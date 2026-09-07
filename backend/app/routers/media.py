from fastapi import APIRouter, Depends, File, HTTPException, UploadFile
from sqlalchemy import func
from sqlalchemy.orm import Session
import cloudinary
import cloudinary.uploader
from ..config import get_settings
from ..database import get_db
from ..models import MediaAsset, User
from ..schemas import MediaAssetOut
from ..security import current_user, new_id


router = APIRouter(prefix="/api/media", tags=["media"])


def configure_cloudinary() -> None:
    settings = get_settings()
    if not settings.cloudinary_cloud_name or not settings.cloudinary_api_key or not settings.cloudinary_api_secret:
        raise HTTPException(status_code=500, detail="Cloudinary is not configured")
    cloudinary.config(
        cloud_name=settings.cloudinary_cloud_name,
        api_key=settings.cloudinary_api_key,
        api_secret=settings.cloudinary_api_secret,
        secure=True,
    )


@router.get("")
def list_media(
    user: User = Depends(current_user),
    db: Session = Depends(get_db),
) -> dict[str, list[MediaAssetOut]]:
    assets = db.query(MediaAsset).filter(MediaAsset.owner_id == user.id).order_by(MediaAsset.created_at.desc()).all()
    return {
        "assets": [
            MediaAssetOut(id=asset.id, name=asset.name, mimeType=asset.mime_type, url=asset.url, size=asset.size)
            for asset in assets
        ]
    }


@router.post("/upload")
async def upload_media(
    file: UploadFile = File(...),
    user: User = Depends(current_user),
    db: Session = Depends(get_db),
) -> dict[str, MediaAssetOut]:
    content = await file.read()
    if len(content) > 100 * 1024 * 1024:
        raise HTTPException(status_code=413, detail="Maximum upload size is 100 MB")

    quota_user = db.query(User).filter(User.id == user.id).with_for_update().one()
    storage_used = db.query(func.coalesce(func.sum(MediaAsset.size), 0)).filter(MediaAsset.owner_id == user.id).scalar() or 0
    if quota_user.storage_limit_bytes is not None and int(storage_used) + len(content) > quota_user.storage_limit_bytes:
        remaining = max(quota_user.storage_limit_bytes - int(storage_used), 0)
        raise HTTPException(
            status_code=413,
            detail=f"Media storage limit reached. {remaining} bytes remaining; this upload requires {len(content)} bytes.",
        )

    configure_cloudinary()
    settings = get_settings()
    content_type = file.content_type or ""
    if not content_type.startswith(("image/", "video/", "audio/")):
        raise HTTPException(status_code=415, detail="Only image, video, and audio files are supported")
    resource_type = "image" if content_type.startswith("image/") else "video"
    result = cloudinary.uploader.upload(
        content,
        folder=settings.cloudinary_folder,
        resource_type=resource_type,
        filename=file.filename,
    )
    asset = MediaAsset(
        id=new_id("asset"),
        owner_id=user.id,
        name=file.filename or "upload",
        mime_type=file.content_type or "application/octet-stream",
        url=result["secure_url"],
        size=len(content),
    )
    db.add(asset)
    db.commit()
    return {
        "asset": MediaAssetOut(
            id=asset.id,
            name=asset.name,
            mimeType=asset.mime_type,
            url=asset.url,
            size=asset.size,
        )
    }
