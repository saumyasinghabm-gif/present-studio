from datetime import datetime, timezone
from urllib.parse import urlsplit, urlunsplit
from fastapi import APIRouter, Depends, HTTPException, Request
from sqlalchemy import func
from sqlalchemy.orm import Session
from ..config import get_settings
from ..database import get_db
from ..models import LiveSession, Presentation, PresentationMember, ShareLink, Slide, User
from ..schemas import LiveSessionOut, LiveSlideUpdate, PresentationCreate, PresentationOut, PresentationPayload, PresentationSave, ScreenAccessRequest, ShareLinkCreate, ShareLinkOut, SlideOut
from ..security import can_edit_presentation, can_view_presentation, current_user, hash_password, new_id, optional_current_user, resolve_share_permission, verify_password
from ..socket_manager import sio


router = APIRouter(prefix="/api/presentations", tags=["presentations"])
LOCAL_HOSTS = {"localhost", "127.0.0.1", "::1"}


def public_share_base_url(request: Request) -> str:
    """Return the public origin of the backend that stored the share token."""
    forwarded_host = request.headers.get("x-forwarded-host", "").split(",", 1)[0].strip()
    external_url = urlsplit(f"https://{forwarded_host}") if forwarded_host else request.url
    request_hostname = (external_url.hostname or "").lower()
    if request_hostname and request_hostname not in LOCAL_HOSTS:
        hostname = external_url.hostname or request_hostname
        port = external_url.port
        netloc = f"[{hostname}]" if ":" in hostname else hostname
        if port and port not in {80, 443}:
            netloc = f"{netloc}:{port}"
        return f"https://{netloc}"

    # A locally-created presentation and token exist only in the local database.
    # Pointing that token at PUBLIC_BASE_URL would cross database instances and
    # make an otherwise valid link fail with "Presentation not found".
    if request_hostname in LOCAL_HOSTS:
        return str(request.base_url).rstrip("/")

    configured = get_settings().public_base_url.strip().rstrip("/")
    configured_url = urlsplit(configured if "://" in configured else f"https://{configured}")
    if configured_url.hostname:
        hostname = configured_url.hostname
        port = configured_url.port
        netloc = f"[{hostname}]" if ":" in hostname else hostname
        if port and port not in {80, 443}:
            netloc = f"{netloc}:{port}"
        scheme = configured_url.scheme if hostname.lower() in LOCAL_HOSTS else "https"
        return urlunsplit((scheme, netloc, configured_url.path.rstrip("/"), "", ""))
    return str(request.base_url).rstrip("/")


def active_share_link(db: Session, presentation_id: str, token: str) -> ShareLink | None:
    if not token:
        return None
    return db.query(ShareLink).filter(
        ShareLink.token == token,
        ShareLink.presentation_id == presentation_id,
        ShareLink.is_active == True,  # noqa: E712
    ).first()


def verify_screen_access_code(share: ShareLink, code: str | None) -> bool:
    if not share.screen_access_code_hash:
        return True
    return bool(code and verify_password(code, share.screen_access_code_hash))


def screen_code_share(db: Session, presentation_id: str, share: ShareLink | None = None) -> ShareLink | None:
    # Every screen token must carry its own code. Depending on the most recent
    # presenter token made access depend on link creation order and left the
    # first viewer link unprotected.
    return share if share and share.screen_access_code_hash else None


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
    quota_user = db.query(User).filter(User.id == user.id).with_for_update().one()
    presentation_count = db.query(func.count(Presentation.id)).filter(Presentation.owner_id == user.id).scalar() or 0
    if presentation_count >= quota_user.presentation_limit:
        raise HTTPException(
            status_code=409,
            detail=f"Presentation limit reached ({presentation_count}/{quota_user.presentation_limit}). Contact an administrator to increase your limit.",
        )

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
        share = active_share_link(db, presentation.id, token)
        if not share:
            raise HTTPException(status_code=403, detail="Share link is not valid")
        if request.query_params.get("screen") == "1":
            required_code_share = screen_code_share(db, presentation.id, share)
            if not required_code_share:
                raise HTTPException(status_code=403, detail="This unprotected screen link is no longer valid. Generate a new protected link")
            if not verify_screen_access_code(required_code_share, request.query_params.get("screenCode")):
                raise HTTPException(status_code=403, detail="Enter the 4-digit screen access code")
        permission = share.permission if share.permission in {"viewer", "presenter"} else "viewer"
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
    request: Request,
    payload: ShareLinkCreate = ShareLinkCreate(),
    user: User = Depends(current_user),
    db: Session = Depends(get_db),
) -> ShareLinkOut:
    presentation = db.get(Presentation, presentation_id)
    if not presentation or not can_edit_presentation(db, presentation, user):
        raise HTTPException(status_code=404, detail="Presentation not found")
    if not payload.screenAccessCode:
        raise HTTPException(status_code=422, detail="Shared presentation links require a 4-digit screen access code")

    share = ShareLink(
        id=new_id("share"),
        presentation_id=presentation.id,
        token=new_id("token"),
        permission=payload.permission,
        screen_access_code_hash=hash_password(payload.screenAccessCode),
    )
    db.add(share)
    db.commit()
    base = public_share_base_url(request)
    page = "controller.html" if share.permission == "presenter" else "screen.html"
    return ShareLinkOut(
        url=f"{base}/{page}?id={presentation_id}&token={share.token}",
        token=share.token,
        permission=share.permission,
        requiresScreenCode=True,
    )


@router.get("/{presentation_id}/screen-access")
def screen_access_requirements(
    presentation_id: str,
    request: Request,
    db: Session = Depends(get_db),
) -> dict[str, bool]:
    presentation = db.get(Presentation, presentation_id)
    if not presentation:
        raise HTTPException(status_code=404, detail="Presentation not found")
    token = request.query_params.get("token") or ""
    if not token:
        return {"requiresCode": False}
    share = active_share_link(db, presentation_id, token)
    if not share:
        raise HTTPException(status_code=403, detail="Share link is not valid")
    if not share.screen_access_code_hash:
        raise HTTPException(status_code=403, detail="This unprotected screen link is no longer valid. Generate a new protected link")
    return {"requiresCode": True}


@router.post("/{presentation_id}/screen-access")
def verify_screen_access(
    presentation_id: str,
    payload: ScreenAccessRequest,
    db: Session = Depends(get_db),
) -> dict[str, bool]:
    presentation = db.get(Presentation, presentation_id)
    if not presentation:
        raise HTTPException(status_code=404, detail="Presentation not found")
    share = active_share_link(db, presentation_id, payload.token)
    if not share:
        raise HTTPException(status_code=403, detail="Share link is not valid")
    required_code_share = screen_code_share(db, presentation_id, share)
    if not required_code_share:
        raise HTTPException(status_code=403, detail="This unprotected screen link is no longer valid. Generate a new protected link")
    if not verify_screen_access_code(required_code_share, payload.screenAccessCode):
        raise HTTPException(status_code=403, detail="Screen access code is incorrect")
    return {"ok": True}


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


@router.post("/{presentation_id}/live/slide")
async def update_live_slide(
    presentation_id: str,
    payload: LiveSlideUpdate,
    request: Request,
    db: Session = Depends(get_db),
) -> LiveSessionOut:
    presentation = db.get(Presentation, presentation_id)
    if not presentation:
        raise HTTPException(status_code=404, detail="Presentation not found")

    user = optional_current_user(request, db)
    token = request.query_params.get("token") or ""
    has_presenter_access = bool(user and can_edit_presentation(db, presentation, user)) or resolve_share_permission(db, presentation.id, token) == "presenter"
    if not has_presenter_access:
        raise HTTPException(status_code=403, detail="Presenter permission required")

    slide = db.query(Slide).filter(Slide.presentation_id == presentation_id, Slide.id == payload.slideId).first()
    if not slide:
        raise HTTPException(status_code=404, detail="Slide not found")

    live = db.query(LiveSession).filter(LiveSession.presentation_id == presentation_id).first()
    if not live:
        live = LiveSession(id=new_id("live"), presentation_id=presentation_id, presenter_user_id=user.id if user else None)
        db.add(live)
    live.active_slide_id = slide.id
    live.is_live = True
    db.commit()
    await sio.emit("active_slide_changed", {"presentationId": presentation_id, "slideId": slide.id}, room=presentation_id)
    return LiveSessionOut(presentationId=presentation_id, activeSlideId=slide.id, isLive=True)


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
