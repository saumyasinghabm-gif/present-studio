from datetime import datetime, timedelta, timezone
import json
from urllib.parse import urlsplit, urlunsplit
from fastapi import APIRouter, Depends, HTTPException, Request
import jwt
from sqlalchemy import func
from sqlalchemy.orm import Session
from ..config import get_settings
from ..database import get_db
from ..live_state import apply_controller_state, live_session_payload
from ..models import LiveSession, Presentation, PresentationMember, ShareLink, Slide, User
from ..schemas import LiveMediaTokenOut, LiveMediaTokenRequest, LiveSessionOut, LiveSlideUpdate, PresentationCreate, PresentationOut, PresentationPayload, PresentationSave, ScreenAccessRequest, ShareLinkCreate, ShareLinkOut, SlideOut
from ..security import can_edit_presentation, can_view_presentation, current_user, hash_password, new_id, optional_current_user, resolve_share_permission, verify_password
from ..socket_manager import sio


router = APIRouter(prefix="/api/presentations", tags=["presentations"])
LOCAL_HOSTS = {"localhost", "127.0.0.1", "::1"}


def serialize_live_session(live: LiveSession | None, presentation_id: str) -> LiveSessionOut:
    state = live_session_payload(live, presentation_id)
    return LiveSessionOut(
        presentationId=presentation_id,
        activeSlideId=state["slideId"],
        isLive=state["isLive"],
        kind=state["kind"],
        mediaId=state["mediaId"],
        position=state["position"],
        playing=state["playing"],
        muted=state["muted"],
        serverTime=state["serverTime"],
    )


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


def unique_slide_id(slide_id: str, used_ids: set[str]) -> str:
    clean_id = (slide_id or "").strip()[:64]
    if clean_id and clean_id not in used_ids:
        used_ids.add(clean_id)
        return clean_id
    while True:
        candidate = new_id("slide")
        if candidate not in used_ids:
            used_ids.add(candidate)
            return candidate


def create_livekit_join_token(room_name: str, identity: str, name: str, permission: str) -> str:
    """Create a short-lived LiveKit join token without exposing server credentials."""
    settings = get_settings()
    ttl_seconds = max(1, settings.livekit_token_minutes) * 60
    metadata = json.dumps({"role": permission}, separators=(",", ":"))
    try:
        from livekit import api
    except ImportError:
        now = datetime.now(timezone.utc)
        payload = {
            "iss": settings.livekit_api_key,
            "sub": identity,
            "name": name,
            "metadata": metadata,
            "nbf": int(now.timestamp()),
            "exp": int((now + timedelta(seconds=ttl_seconds)).timestamp()),
            "video": {
                "roomJoin": True,
                "room": room_name,
                "canPublish": True,
                "canSubscribe": True,
                "canPublishData": False,
            },
        }
        return jwt.encode(payload, settings.livekit_api_secret, algorithm="HS256")

    return (
        api.AccessToken(settings.livekit_api_key, settings.livekit_api_secret)
        .with_identity(identity)
        .with_name(name)
        .with_metadata(metadata)
        .with_ttl(timedelta(seconds=ttl_seconds))
        .with_grants(
            api.VideoGrants(
                room_join=True,
                room=room_name,
                can_publish=True,
                can_subscribe=True,
                can_publish_data=False,
            )
        )
        .to_jwt()
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
    used_slide_ids: set[str] = set()
    saved_slide_ids: list[str] = []
    for slide in payload.slides:
        slide_id = unique_slide_id(slide.id, used_slide_ids)
        saved_slide_ids.append(slide_id)
        db.add(
            Slide(
                id=slide_id,
                presentation_id=presentation.id,
                order=slide.order,
                title=slide.title.strip()[:255] or "Untitled Slide",
                canvas=slide.canvas,
            )
        )
    live = db.query(LiveSession).filter(LiveSession.presentation_id == presentation.id).first()
    if live and live.active_slide_id not in saved_slide_ids:
        if saved_slide_ids:
            apply_controller_state(live, slide_id=saved_slide_ids[0])
        else:
            live.active_slide_id = None
            live.active_media_id = None
            live.active_media_kind = "slide"
            live.media_position = 0
            live.media_playing = False
    db.commit()
    db.refresh(presentation)
    serialized = serialize_presentation(presentation)
    await sio.emit(
        "presentation_updated",
        {
            "presentationId": presentation.id,
            "presentation": serialized.model_dump(),
            "activeSlideId": live.active_slide_id if live else (saved_slide_ids[0] if saved_slide_ids else None),
            "liveState": live_session_payload(live, presentation.id),
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
    screen_share = None
    if payload.permission == "presenter":
        screen_share = ShareLink(
            id=new_id("share"),
            presentation_id=presentation.id,
            token=new_id("token"),
            permission="viewer",
            screen_access_code_hash=hash_password(payload.screenAccessCode),
        )
        db.add(screen_share)
    db.commit()
    base = public_share_base_url(request)
    page = "controller.html" if share.permission == "presenter" else "screen.html"
    return ShareLinkOut(
        url=f"{base}/{page}?id={presentation_id}&token={share.token}",
        token=share.token,
        permission=share.permission,
        requiresScreenCode=True,
        screenUrl=f"{base}/screen.html?id={presentation_id}&token={screen_share.token}" if screen_share else None,
        screenToken=screen_share.token if screen_share else None,
        audienceUrl=f"{base}/present.html?id={presentation_id}&token={(screen_share or share).token}",
    )


@router.post("/{presentation_id}/live/media-token")
def create_live_media_token(
    presentation_id: str,
    payload: LiveMediaTokenRequest,
    request: Request,
    db: Session = Depends(get_db),
) -> LiveMediaTokenOut:
    presentation = db.get(Presentation, presentation_id)
    if not presentation:
        raise HTTPException(status_code=404, detail="Presentation not found")

    settings = get_settings()
    if not all((settings.livekit_url, settings.livekit_api_key, settings.livekit_api_secret)):
        raise HTTPException(status_code=503, detail="Interactive audio/video is not configured")

    user = optional_current_user(request, db)
    permission = None
    default_name = "Guest"
    if user and can_view_presentation(db, presentation, user):
        permission = "presenter" if can_edit_presentation(db, presentation, user) else "viewer"
        default_name = user.name
    elif payload.shareToken:
        share = active_share_link(db, presentation_id, payload.shareToken)
        if share:
            permission = share.permission if share.permission in {"viewer", "presenter"} else "viewer"
            default_name = "Presenter" if permission == "presenter" else "Guest"
            if permission == "viewer" and not verify_screen_access_code(share, payload.screenAccessCode):
                raise HTTPException(status_code=403, detail="Screen access code is required")
    if not permission:
        raise HTTPException(status_code=403, detail="A valid presentation session is required")

    participant_name = " ".join((payload.displayName or default_name).strip().split())[:80] or default_name
    participant_identity = new_id("participant")
    token = create_livekit_join_token(presentation_id, participant_identity, participant_name, permission)
    return LiveMediaTokenOut(
        url=settings.livekit_url,
        token=token,
        roomName=presentation_id,
        participantIdentity=participant_identity,
        participantName=participant_name,
        permission=permission,
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
    live.media_playing = False
    live.media_updated_at = datetime.now(timezone.utc)
    db.commit()
    return serialize_live_session(live, presentation_id)


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
    apply_controller_state(live, slide_id=slide.id)
    db.commit()
    await sio.emit("active_slide_changed", {"presentationId": presentation_id, "slideId": slide.id}, room=presentation_id)
    await sio.emit("presentation_state", live_session_payload(live, presentation_id), room=presentation_id)
    return serialize_live_session(live, presentation_id)


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
    return serialize_live_session(live, presentation_id)


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
