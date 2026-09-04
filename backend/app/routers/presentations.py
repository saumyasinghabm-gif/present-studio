from datetime import datetime, timezone
from fastapi import APIRouter, Depends, HTTPException, Request
from sqlalchemy.orm import Session
from ..config import get_settings
from ..database import get_db
from ..models import LiveSession, Presentation, PresentationMember, ShareLink, Slide, User
from ..schemas import LiveSessionOut, PresentationCreate, PresentationOut, PresentationPayload, PresentationSave, ShareLinkCreate, ShareLinkOut, SlideOut
from ..security import can_edit_presentation, can_view_presentation, current_user, new_id, optional_current_user, resolve_share_permission
from ..socket_manager import sio


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
) -> PresentationPayload:
    now = int(datetime.now(timezone.utc).timestamp() * 1000)
    title = payload.title.strip() or "Untitled presentation"
    presentation = Presentation(id=f"pres_{now}", title=title, owner_id=user.id)
    slide = Slide(
        id=f"slide_{now}",
        presentation_id=presentation.id,
        order=1,
        title=title,
        canvas={"background": "#f8f4ea", "elements": []},
    )
    db.add(presentation)
    db.add(slide)
    db.flush()
    db.add(LiveSession(id=new_id("live"), presentation_id=presentation.id, active_slide_id=slide.id, presenter_user_id=user.id))
    db.commit()
    db.refresh(presentation)
    return PresentationPayload(presentation=serialize_presentation(presentation), permission="presenter")


@router.get("/{presentation_id}")
def get_presentation(
    presentation_id: str,
    request: Request,
    db: Session = Depends(get_db),
) -> PresentationPayload:
    presentation = db.get(Presentation, presentation_id)
    if not presentation:
        raise HTTPException(status_code=404, detail="Presentation not found")

    token = request.query_params.get("token")
    if token:
        permission = resolve_share_permission(db, presentation.id, token)
        if not permission:
            raise HTTPException(status_code=403, detail="Share link is not valid")
        return PresentationPayload(presentation=serialize_presentation(presentation), permission=permission)

    user = optional_current_user(request, db)
    if not user:
        raise HTTPException(status_code=401, detail="Authentication required")
    if not can_view_presentation(db, presentation, user):
        raise HTTPException(status_code=403, detail="No access to this presentation")
    permission = "presenter" if can_edit_presentation(db, presentation, user) else "viewer"
    return PresentationPayload(presentation=serialize_presentation(presentation), permission=permission)


@router.put("/{presentation_id}")
async def save_presentation(
    presentation_id: str,
    payload: PresentationSave,
    user: User = Depends(current_user),
    db: Session = Depends(get_db),
) -> PresentationPayload:
    presentation = db.get(Presentation, presentation_id)
    if not presentation or not can_edit_presentation(db, presentation, user):
        raise HTTPException(status_code=404, detail="Presentation not found")

    presentation.title = payload.title.strip() or "Untitled presentation"
    db.query(Slide).filter(Slide.presentation_id == presentation.id).delete()
    for slide in payload.slides:
        db.add(Slide(id=slide.id, presentation_id=presentation.id, order=slide.order, title=slide.title, canvas=slide.canvas))
    live = db.query(LiveSession).filter(LiveSession.presentation_id == presentation.id).first()
    slide_ids = [slide.id for slide in payload.slides]
    if live and live.active_slide_id not in slide_ids:
        live.active_slide_id = slide_ids[0] if slide_ids else None
    db.commit()
    db.refresh(presentation)
    serialized = serialize_presentation(presentation)
    await sio.emit(
        "presentation_updated",
        {
            "presentationId": presentation.id,
            "presentation": serialized.model_dump(),
            "activeSlideId": live.active_slide_id if live else (slide_ids[0] if slide_ids else None),
        },
        room=presentation.id,
    )
    return PresentationPayload(presentation=serialized, permission="presenter")


@router.post("/{presentation_id}/share")
def create_share_link(
    presentation_id: str,
    payload: ShareLinkCreate = ShareLinkCreate(),
    user: User = Depends(current_user),
    db: Session = Depends(get_db),
) -> ShareLinkOut:
    presentation = db.get(Presentation, presentation_id)
    if not presentation or not can_edit_presentation(db, presentation, user):
        raise HTTPException(status_code=404, detail="Presentation not found")

    share = ShareLink(
        id=new_id("share"),
        presentation_id=presentation.id,
        token=new_id("token"),
        permission=payload.permission,
    )
    db.add(share)
    db.commit()
    base = get_settings().public_base_url.rstrip("/")
    page = "controller.html" if share.permission == "presenter" else "screen.html"
    return ShareLinkOut(url=f"{base}/{page}?id={presentation_id}&token={share.token}", token=share.token, permission=share.permission)


@router.post("/{presentation_id}/live/end")
def end_live_session(
    presentation_id: str,
    user: User = Depends(current_user),
    db: Session = Depends(get_db),
) -> LiveSessionOut:
    presentation = db.get(Presentation, presentation_id)
    if not presentation or not can_edit_presentation(db, presentation, user):
        raise HTTPException(status_code=404, detail="Presentation not found")
    live = db.query(LiveSession).filter(LiveSession.presentation_id == presentation_id).first()
    if not live:
        live = LiveSession(id=new_id("live"), presentation_id=presentation_id, presenter_user_id=user.id)
        db.add(live)
    live.is_live = False
    db.commit()
    return LiveSessionOut(presentationId=presentation_id, activeSlideId=live.active_slide_id, isLive=False)


@router.get("/{presentation_id}/live")
def get_live_session(
    presentation_id: str,
    request: Request,
    db: Session = Depends(get_db),
) -> LiveSessionOut:
    presentation = db.get(Presentation, presentation_id)
    if not presentation:
        raise HTTPException(status_code=404, detail="Presentation not found")
    live = db.query(LiveSession).filter(LiveSession.presentation_id == presentation_id).first()
    return LiveSessionOut(
        presentationId=presentation_id,
        activeSlideId=live.active_slide_id if live else None,
        isLive=bool(live and live.is_live),
    )


@router.delete("/{presentation_id}")
async def delete_presentation(
    presentation_id: str,
    user: User = Depends(current_user),
    db: Session = Depends(get_db),
) -> dict[str, str | bool]:
    presentation = db.get(Presentation, presentation_id)
    if not presentation or presentation.owner_id != user.id:
        raise HTTPException(status_code=404, detail="Presentation not found")

    db.query(PresentationMember).filter(PresentationMember.presentation_id == presentation_id).delete()
    db.query(ShareLink).filter(ShareLink.presentation_id == presentation_id).delete()
    db.query(LiveSession).filter(LiveSession.presentation_id == presentation_id).delete()
    db.delete(presentation)
    db.commit()
    await sio.emit("presentation_deleted", {"presentationId": presentation_id}, room=presentation_id)
    return {"ok": True, "presentationId": presentation_id}
