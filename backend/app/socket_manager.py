import socketio
from .database import SessionLocal
from .models import LiveSession, Presentation
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
        live.active_slide_id = slide_id
        live.is_live = True
        db.commit()
    await sio.emit("active_slide_changed", {"presentationId": presentation_id, "slideId": slide_id}, room=presentation_id)


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
            db.commit()
    await sio.emit("session_ended", {"presentationId": presentation_id}, room=presentation_id)
