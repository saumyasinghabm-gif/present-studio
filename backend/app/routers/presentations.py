from datetime import datetime, timezone
from fastapi import APIRouter, Depends, HTTPException, Request
from sqlalchemy.orm import Session
from ..database import get_db
from ..models import Presentation, Slide, User
from ..routers.auth import current_user
from ..schemas import PresentationCreate, PresentationOut, PresentationSave, ShareLinkOut, SlideOut


router = APIRouter(prefix="/api/presentations", tags=["presentations"])


def serialize_presentation(presentation: Presentation) -> PresentationOut:
    slides = sorted(presentation.slides, key=lambda item: item.order)
    return PresentationOut(
        id=presentation.id,
        title=presentation.title,
        ownerId=presentation.owner_id,
        status=presentation.status,
        updatedAt=presentation.updated_at.isoformat() if presentation.updated_at else None,
        slides=[SlideOut(id=slide.id, order=slide.order, title=slide.title, canvas=slide.canvas or {}) for slide in slides],
    )


@router.get("")
def list_presentations(
    user: User = Depends(current_user),
    db: Session = Depends(get_db),
) -> dict[str, list[PresentationOut]]:
    presentations = db.query(Presentation).filter(Presentation.owner_id == user.id).order_by(Presentation.updated_at.desc()).all()
    return {"presentations": [serialize_presentation(item) for item in presentations]}


@router.post("")
def create_presentation(
    payload: PresentationCreate,
    user: User = Depends(current_user),
    db: Session = Depends(get_db),
) -> dict[str, PresentationOut]:
    now = int(datetime.now(timezone.utc).timestamp() * 1000)
    presentation = Presentation(id=f"pres_{now}", title=payload.title.strip() or "Untitled presentation", owner_id=user.id)
    slide = Slide(
        id=f"slide_{now}",
        presentation_id=presentation.id,
        order=1,
        title=payload.title.strip() or "Untitled Slide",
        canvas={"background": "#f8f4ea", "elements": []},
    )
    db.add(presentation)
    db.add(slide)
    db.commit()
    db.refresh(presentation)
    return {"presentation": serialize_presentation(presentation)}


@router.get("/{presentation_id}")
def get_presentation(
    presentation_id: str,
    user: User = Depends(current_user),
    db: Session = Depends(get_db),
) -> dict[str, PresentationOut]:
    presentation = db.get(Presentation, presentation_id)
    if not presentation or presentation.owner_id != user.id:
        raise HTTPException(status_code=404, detail="Presentation not found")
    return {"presentation": serialize_presentation(presentation)}


@router.put("/{presentation_id}")
def save_presentation(
    presentation_id: str,
    payload: PresentationSave,
    user: User = Depends(current_user),
    db: Session = Depends(get_db),
) -> dict[str, PresentationOut]:
    presentation = db.get(Presentation, presentation_id)
    if not presentation or presentation.owner_id != user.id:
        raise HTTPException(status_code=404, detail="Presentation not found")

    presentation.title = payload.title.strip() or "Untitled presentation"
    db.query(Slide).filter(Slide.presentation_id == presentation.id).delete()
    for slide in payload.slides:
        db.add(Slide(
            id=slide.id,
            presentation_id=presentation.id,
            order=slide.order,
            title=slide.title,
            canvas=slide.canvas,
        ))
    db.commit()
    db.refresh(presentation)
    return {"presentation": serialize_presentation(presentation)}


@router.post("/{presentation_id}/share")
def create_share_link(presentation_id: str, request: Request, db: Session = Depends(get_db)) -> ShareLinkOut:
    presentation = db.get(Presentation, presentation_id)
    if not presentation:
        raise HTTPException(status_code=404, detail="Presentation not found")
    base = str(request.base_url).rstrip("/")
    return ShareLinkOut(url=f"{base}/present.html?id={presentation_id}")
