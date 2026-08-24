from datetime import datetime, timezone
from fastapi import APIRouter, Depends, File, UploadFile
from sqlalchemy.orm import Session
from ..database import get_db
from ..models import MediaAsset, User
from ..routers.auth import current_user
from ..schemas import MediaAssetOut


router = APIRouter(prefix="/api/media", tags=["media"])


@router.post("/upload")
async def upload_media(
    file: UploadFile = File(...),
    user: User = Depends(current_user),
    db: Session = Depends(get_db),
) -> dict[str, MediaAssetOut]:
    # MVP placeholder: production should upload to Cloudinary/S3/R2 and store the returned CDN URL.
    content = await file.read()
    now = int(datetime.now(timezone.utc).timestamp() * 1000)
    asset = MediaAsset(
        id=f"asset_{now}",
        owner_id=user.id,
        name=file.filename or "upload",
        mime_type=file.content_type or "application/octet-stream",
        url=f"/uploads/{now}-{file.filename}",
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
