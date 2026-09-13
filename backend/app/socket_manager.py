import socketio
from .database import SessionLocal
from .live_state import apply_controller_state, live_session_payload, utc_now
from .models import LiveSession, Presentation, Slide
from .security import can_present_with_credentials, new_id


sio = socketio.AsyncServer(async_mode="asgi", cors_allowed_origins="*")


@sio.event
async def connect(sid, environ):
    print("socket-connected", sid)


@sio.event
async def disconnect(sid):
    print("socket-disconnected", sid)


@sio.event
async def join_presentation(sid, data):
    presentation_id = data.get("presentationId")
    if not presentation_id:
        return
    await sio.enter_room(sid, presentation_id)
    with SessionLocal() as db:
        live = db.query(LiveSession).filter(LiveSession.presentation_id == presentation_id).first()
        if live:
            live.audience_count += 1
            db.commit()
            await sio.emit("presentation_state", live_session_payload(live, presentation_id), room=sid)
            await sio.emit(
                "active_slide_changed",
                {"presentationId": presentation_id, "slideId": live.active_slide_id},
                room=sid,
            )
    await sio.emit("presence", {"message": "joined", "presentationId": presentation_id}, room=sid)


@sio.event
async def slide_changed(sid, data):
    presentation_id = data.get("presentationId")
    slide_id = data.get("slideId")
    auth_token = data.get("authToken") or ""
    share_token = data.get("shareToken") or ""
    if not presentation_id or not slide_id:
        return
    with SessionLocal() as db:
        presentation = db.get(Presentation, presentation_id)
        if not presentation or not can_present_with_credentials(db, presentation, auth_token=auth_token, share_token=share_token):
            await sio.emit("presenter_rejected", {"message": "Presenter permission required"}, room=sid)
            return
        live = db.query(LiveSession).filter(LiveSession.presentation_id == presentation_id).first()
        if not live:
            live = LiveSession(id=new_id("live"), presentation_id=presentation_id)
            db.add(live)
        apply_controller_state(live, slide_id=slide_id, playing=False, muted=bool(data.get("muted", False)))
        db.commit()
        state = live_session_payload(live, presentation_id)
    await sio.emit("active_slide_changed", {"presentationId": presentation_id, "slideId": slide_id}, room=presentation_id, skip_sid=sid)
    await sio.emit("presentation_state", state, room=presentation_id, skip_sid=sid)


@sio.event
async def media_selected(sid, data):
    presentation_id = data.get("presentationId")
    slide_id = data.get("slideId")
    media_id = data.get("mediaId")
    kind = data.get("kind") or "slide"
    auth_token = data.get("authToken") or ""
    share_token = data.get("shareToken") or ""
    if not presentation_id or not slide_id:
        return
    with SessionLocal() as db:
        presentation = db.get(Presentation, presentation_id)
        if not presentation or not can_present_with_credentials(db, presentation, auth_token=auth_token, share_token=share_token):
            await sio.emit("presenter_rejected", {"message": "Presenter permission required"}, room=sid)
            return
        live = db.query(LiveSession).filter(LiveSession.presentation_id == presentation_id).first()
        if not live:
            live = LiveSession(id=new_id("live"), presentation_id=presentation_id)
            db.add(live)
        apply_controller_state(
            live,
            slide_id=slide_id,
            kind=kind,
            media_id=str(media_id)[:128] if media_id is not None else None,
            playing=bool(data.get("playing", kind in {"video", "audio"})),
            muted=bool(data.get("muted", False)),
        )
        db.commit()
        state = live_session_payload(live, presentation_id)
    await sio.emit(
        "presentation_media_changed",
        {"presentationId": presentation_id, "slideId": slide_id, "mediaId": media_id, "kind": kind},
        room=presentation_id,
        skip_sid=sid,
    )
    await sio.emit("presentation_state", state, room=presentation_id, skip_sid=sid)


@sio.event
async def controller_state(sid, data):
    presentation_id = data.get("presentationId")
    slide_id = data.get("slideId")
    kind = data.get("kind") or "slide"
    media_id = data.get("mediaId")
    auth_token = data.get("authToken") or ""
    share_token = data.get("shareToken") or ""
    if not presentation_id or not slide_id or kind not in {"slide", "image", "video", "audio", "blank"}:
        return
    try:
        position = max(0.0, min(float(data.get("position") or 0), 86400.0))
    except (TypeError, ValueError):
        return
    with SessionLocal() as db:
        presentation = db.get(Presentation, presentation_id)
        if not presentation or not can_present_with_credentials(db, presentation, auth_token=auth_token, share_token=share_token):
            await sio.emit("presenter_rejected", {"message": "Presenter permission required"}, room=sid)
            return
        slide = db.query(Slide).filter(Slide.presentation_id == presentation_id, Slide.id == slide_id).first()
        if not slide:
            return
        live = db.query(LiveSession).filter(LiveSession.presentation_id == presentation_id).first()
        if not live:
            live = LiveSession(id=new_id("live"), presentation_id=presentation_id)
            db.add(live)
        selection_changed = (
            live.active_slide_id != slide_id
            or (live.active_media_kind or "slide") != kind
            or live.active_media_id != (str(media_id)[:128] if media_id is not None else None)
        )
        apply_controller_state(
            live,
            slide_id=slide_id,
            kind=kind,
            media_id=str(media_id)[:128] if media_id is not None else None,
            position=position,
            playing=bool(data.get("playing", False)),
            muted=bool(data.get("muted", False)),
        )
        db.commit()
        state = live_session_payload(live, presentation_id)
    await sio.emit("presentation_state", state, room=presentation_id, skip_sid=sid)
    if selection_changed:
        if kind == "slide":
            await sio.emit("active_slide_changed", {"presentationId": presentation_id, "slideId": slide_id}, room=presentation_id, skip_sid=sid)
        elif kind == "blank":
            await sio.emit("presentation_media_control", {"presentationId": presentation_id, "action": "stop"}, room=presentation_id, skip_sid=sid)
        else:
            await sio.emit(
                "presentation_media_changed",
                {"presentationId": presentation_id, "slideId": slide_id, "mediaId": media_id, "kind": kind},
                room=presentation_id,
                skip_sid=sid,
            )


@sio.event
async def media_control(sid, data):
    presentation_id = data.get("presentationId")
    action = data.get("action")
    position = data.get("position")
    auth_token = data.get("authToken") or ""
    share_token = data.get("shareToken") or ""
    if not presentation_id or action not in {"toggle", "play", "pause", "stop", "replay", "set_audio"}:
        return
    try:
        position = max(0.0, min(float(position), 86400.0)) if position is not None else None
    except (TypeError, ValueError):
        position = None
    with SessionLocal() as db:
        presentation = db.get(Presentation, presentation_id)
        if not presentation or not can_present_with_credentials(db, presentation, auth_token=auth_token, share_token=share_token):
            await sio.emit("presenter_rejected", {"message": "Presenter permission required"}, room=sid)
            return
        live = db.query(LiveSession).filter(LiveSession.presentation_id == presentation_id).first()
        if live:
            if position is not None:
                live.media_position = position
            if action == "toggle":
                live.media_playing = not live.media_playing
            elif action in {"play", "replay"}:
                live.media_playing = True
            elif action in {"pause", "stop"}:
                live.media_playing = False
            if action == "replay":
                live.media_position = 0
            if action == "set_audio":
                live.media_muted = bool(data.get("muted", False))
            live.media_updated_at = utc_now()
            db.commit()
            state = live_session_payload(live, presentation_id)
        else:
            state = None
    payload = {"presentationId": presentation_id, "action": action}
    if position is not None:
        payload["position"] = position
    if action == "set_audio":
        payload["muted"] = bool(data.get("muted", False))
    await sio.emit("presentation_media_control", payload, room=presentation_id, skip_sid=sid)
    if state and not data.get("legacyOnly"):
        await sio.emit("presentation_state", state, room=presentation_id, skip_sid=sid)


@sio.event
async def annotation_event(sid, data):
    presentation_id = data.get("presentationId")
    auth_token = data.get("authToken") or ""
    share_token = data.get("shareToken") or ""
    event_type = data.get("type")
    payload = data.get("payload") or {}
    if not presentation_id or event_type not in {"draw", "text", "clear", "viewport"}:
        return
    with SessionLocal() as db:
        presentation = db.get(Presentation, presentation_id)
        if not presentation or not can_present_with_credentials(db, presentation, auth_token=auth_token, share_token=share_token):
            await sio.emit("presenter_rejected", {"message": "Presenter permission required"}, room=sid)
            return
    await sio.emit(
        "presentation_annotation",
        {"presentationId": presentation_id, "type": event_type, "payload": payload},
        room=presentation_id,
    )


@sio.event
async def end_session(sid, data):
    presentation_id = data.get("presentationId")
    auth_token = data.get("authToken") or ""
    share_token = data.get("shareToken") or ""
    if not presentation_id:
        return
    with SessionLocal() as db:
        presentation = db.get(Presentation, presentation_id)
        if not presentation or not can_present_with_credentials(db, presentation, auth_token=auth_token, share_token=share_token):
            await sio.emit("presenter_rejected", {"message": "Presenter permission required"}, room=sid)
            return
        live = db.query(LiveSession).filter(LiveSession.presentation_id == presentation_id).first()
        if live:
            live.is_live = False
            live.media_playing = False
            live.media_updated_at = utc_now()
            db.commit()
    await sio.emit("session_ended", {"presentationId": presentation_id}, room=presentation_id)
