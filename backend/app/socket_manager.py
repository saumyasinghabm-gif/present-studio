import json
import socketio
from .database import SessionLocal
from .live_state import apply_controller_state, live_session_payload, meeting_control_payload, utc_now
from .models import LiveSession, Presentation, Slide
from .security import can_present_with_credentials, new_id


sio = socketio.AsyncServer(async_mode="asgi", cors_allowed_origins="*")

# Ephemeral meeting moderation state. Live media itself remains in LiveKit;
# these maps coordinate the waiting room and presenter approvals.
controller_sids = {}
waiting_participants = {}
active_participants = {}
screen_share_requests = {}


def _presenter_allowed(data):
    presentation_id = data.get("presentationId")
    if not presentation_id:
        return False
    with SessionLocal() as db:
        presentation = db.get(Presentation, presentation_id)
        return bool(presentation and can_present_with_credentials(
            db,
            presentation,
            auth_token=data.get("authToken") or "",
            share_token=data.get("shareToken") or "",
        ))


def _lobby_payload(presentation_id):
    pending = waiting_participants.get(presentation_id, {})
    active = active_participants.get(presentation_id, {})
    shares = screen_share_requests.get(presentation_id, {})
    return {
        "presentationId": presentation_id,
        "pending": [{"clientId": item["clientId"], "name": item["name"]} for item in pending.values()],
        "active": [
            {"clientId": item["clientId"], "identity": item.get("identity", ""), "name": item["name"]}
            for item in active.values()
        ],
        "screenShareRequests": [
            {"clientId": item["clientId"], "identity": item.get("identity", ""), "name": item["name"]}
            for item in shares.values()
        ],
    }


def _sid_is_admitted(presentation_id, sid):
    if sid in controller_sids.get(presentation_id, set()):
        return True
    return any(item.get("sid") == sid for item in active_participants.get(presentation_id, {}).values())


def meeting_admission_required(presentation_id):
    return bool(controller_sids.get(presentation_id))


def meeting_client_is_admitted(presentation_id, client_id):
    return bool(client_id and client_id in active_participants.get(presentation_id, {}))


async def _emit_lobby_state(presentation_id):
    payload = _lobby_payload(presentation_id)
    for controller_sid in tuple(controller_sids.get(presentation_id, set())):
        await sio.emit("meeting_lobby_state", payload, room=controller_sid)


@sio.event
async def connect(sid, environ):
    print("socket-connected", sid)


@sio.event
async def disconnect(sid):
    affected = set()
    for presentation_id, sids in list(controller_sids.items()):
        if sid in sids:
            sids.discard(sid)
            if not sids:
                controller_sids.pop(presentation_id, None)
    for registry in (waiting_participants, active_participants, screen_share_requests):
        for presentation_id, entries in list(registry.items()):
            removed = [client_id for client_id, item in entries.items() if item.get("sid") == sid]
            for client_id in removed:
                entries.pop(client_id, None)
                affected.add(presentation_id)
            if not entries:
                registry.pop(presentation_id, None)
    for presentation_id in affected:
        await _emit_lobby_state(presentation_id)
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
        control_state = meeting_control_payload(live, presentation_id)
    await sio.emit("meeting_control_state", control_state, room=sid)
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
            video_volume=data.get("videoVolume"),
            audio_volume=data.get("audioVolume"),
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
            video_volume=data.get("videoVolume"),
            audio_volume=data.get("audioVolume"),
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
async def meeting_control(sid, data):
    presentation_id = data.get("presentationId")
    auth_token = data.get("authToken") or ""
    share_token = data.get("shareToken") or ""
    if not presentation_id:
        return
    raw_featured_identity = data.get("featuredShareIdentity")
    featured_identity = (raw_featured_identity.strip()[:128] or None) if isinstance(raw_featured_identity, str) else None
    raw_muted = data.get("mutedParticipants")
    if not isinstance(raw_muted, list):
        raw_muted = []
    muted_identities = list(dict.fromkeys(identity.strip()[:128] for identity in raw_muted if isinstance(identity, str) and identity.strip()))[:100]
    with SessionLocal() as db:
        presentation = db.get(Presentation, presentation_id)
        if not presentation or not can_present_with_credentials(db, presentation, auth_token=auth_token, share_token=share_token):
            await sio.emit("presenter_rejected", {"message": "Presenter permission required"}, room=sid)
            return
        live = db.query(LiveSession).filter(LiveSession.presentation_id == presentation_id).first()
        if not live:
            live = LiveSession(id=new_id("live"), presentation_id=presentation_id)
            db.add(live)
        live.featured_share_identity = featured_identity
        live.meeting_muted = data.get("meetingMuted") is True
        live.muted_participant_identities = json.dumps(muted_identities, separators=(",", ":"))
        db.commit()
        state = meeting_control_payload(live, presentation_id)
    await sio.emit("meeting_control_state", state, room=presentation_id)


@sio.event
async def meeting_participant_audio(sid, data):
    """Relay a presenter's mute command or consent-based unmute request."""
    presentation_id = data.get("presentationId")
    auth_token = data.get("authToken") or ""
    share_token = data.get("shareToken") or ""
    raw_target = data.get("targetIdentity")
    target_identity = raw_target.strip()[:128] if isinstance(raw_target, str) else ""
    if not presentation_id or not target_identity:
        return
    with SessionLocal() as db:
        presentation = db.get(Presentation, presentation_id)
        if not presentation or not can_present_with_credentials(db, presentation, auth_token=auth_token, share_token=share_token):
            await sio.emit("presenter_rejected", {"message": "Presenter permission required"}, room=sid)
            return
    await sio.emit(
        "meeting_participant_audio_command",
        {
            "presentationId": presentation_id,
            "targetIdentity": target_identity,
            "muted": data.get("muted") is True,
            "requestUnmute": data.get("muted") is not True,
        },
        room=presentation_id,
    )


def _clean_meeting_identity(data):
    identity = data.get("identity")
    name = data.get("name")
    return (
        identity.strip()[:128] if isinstance(identity, str) else "",
        " ".join(name.split())[:80] if isinstance(name, str) and name.strip() else "Guest",
    )


@sio.event
async def meeting_chat(sid, data):
    presentation_id = data.get("presentationId")
    text = data.get("text")
    if not presentation_id or not _sid_is_admitted(presentation_id, sid) or not isinstance(text, str) or not text.strip():
        return
    with SessionLocal() as db:
        if not db.get(Presentation, presentation_id):
            return
    identity, name = _clean_meeting_identity(data)
    await sio.emit(
        "meeting_chat_message",
        {
            "presentationId": presentation_id,
            "identity": identity,
            "name": name,
            "text": text.strip()[:500],
            "sentAt": int(utc_now().timestamp() * 1000),
        },
        room=presentation_id,
    )


@sio.event
async def meeting_reaction(sid, data):
    presentation_id = data.get("presentationId")
    reaction = data.get("reaction")
    if not presentation_id or not _sid_is_admitted(presentation_id, sid) or reaction not in {"clap", "party", "heart"}:
        return
    identity, name = _clean_meeting_identity(data)
    await sio.emit(
        "meeting_reaction_event",
        {"presentationId": presentation_id, "identity": identity, "name": name, "reaction": reaction},
        room=presentation_id,
    )


@sio.event
async def meeting_hand(sid, data):
    presentation_id = data.get("presentationId")
    if not presentation_id or not _sid_is_admitted(presentation_id, sid):
        return
    identity, name = _clean_meeting_identity(data)
    if not identity:
        return
    await sio.emit(
        "meeting_hand_state",
        {"presentationId": presentation_id, "identity": identity, "name": name, "raised": data.get("raised") is True},
        room=presentation_id,
    )


@sio.event
async def meeting_controller_register(sid, data):
    presentation_id = data.get("presentationId")
    if not presentation_id or not _presenter_allowed(data):
        await sio.emit("presenter_rejected", {"message": "Presenter permission required"}, room=sid)
        return
    controller_sids.setdefault(presentation_id, set()).add(sid)
    await sio.emit("meeting_lobby_state", _lobby_payload(presentation_id), room=sid)


@sio.event
async def meeting_admission_request(sid, data):
    presentation_id = data.get("presentationId")
    client_id = str(data.get("clientId") or "").strip()[:128]
    _, name = _clean_meeting_identity(data)
    if not presentation_id or not client_id or presentation_id not in sio.rooms(sid):
        return
    with SessionLocal() as db:
        if not db.get(Presentation, presentation_id):
            return
    active = active_participants.get(presentation_id, {}).get(client_id)
    if active and active.get("sid") == sid:
        await sio.emit("meeting_admission_decision", {"presentationId": presentation_id, "clientId": client_id, "accepted": True}, room=sid)
        return
    if not controller_sids.get(presentation_id):
        active_participants.setdefault(presentation_id, {})[client_id] = {
            "clientId": client_id, "sid": sid, "name": name,
        }
        await sio.emit("meeting_admission_decision", {"presentationId": presentation_id, "clientId": client_id, "accepted": True}, room=sid)
        return
    waiting_participants.setdefault(presentation_id, {})[client_id] = {
        "clientId": client_id, "sid": sid, "name": name,
    }
    await _emit_lobby_state(presentation_id)


@sio.event
async def meeting_admission_decide(sid, data):
    presentation_id = data.get("presentationId")
    if not presentation_id or not _presenter_allowed(data):
        await sio.emit("presenter_rejected", {"message": "Presenter permission required"}, room=sid)
        return
    raw_ids = data.get("clientIds")
    client_ids = raw_ids if isinstance(raw_ids, list) else [data.get("clientId")]
    pending = waiting_participants.setdefault(presentation_id, {})
    active = active_participants.setdefault(presentation_id, {})
    accepted = data.get("accepted") is True
    for raw_client_id in client_ids[:100]:
        client_id = str(raw_client_id or "").strip()[:128]
        item = pending.pop(client_id, None)
        if not item:
            continue
        if accepted:
            active[client_id] = item
        await sio.emit(
            "meeting_admission_decision",
            {"presentationId": presentation_id, "clientId": client_id, "accepted": accepted},
            room=item["sid"],
        )
    await _emit_lobby_state(presentation_id)


@sio.event
async def meeting_participant_joined(sid, data):
    presentation_id = data.get("presentationId")
    client_id = str(data.get("clientId") or "").strip()[:128]
    identity, name = _clean_meeting_identity(data)
    item = active_participants.get(presentation_id, {}).get(client_id) if presentation_id else None
    if not item or item.get("sid") != sid or not identity:
        return
    item.update({"identity": identity, "name": name})
    await _emit_lobby_state(presentation_id)


@sio.event
async def meeting_participant_left(sid, data):
    presentation_id = data.get("presentationId")
    client_id = str(data.get("clientId") or "").strip()[:128]
    if not presentation_id or not client_id:
        return
    item = active_participants.get(presentation_id, {}).get(client_id)
    if item and item.get("sid") == sid:
        active_participants[presentation_id].pop(client_id, None)
        screen_share_requests.get(presentation_id, {}).pop(client_id, None)
        await _emit_lobby_state(presentation_id)


@sio.event
async def meeting_remove_participant(sid, data):
    presentation_id = data.get("presentationId")
    client_id = str(data.get("clientId") or "").strip()[:128]
    if not presentation_id or not client_id or not _presenter_allowed(data):
        await sio.emit("presenter_rejected", {"message": "Presenter permission required"}, room=sid)
        return
    item = active_participants.get(presentation_id, {}).pop(client_id, None)
    if not item:
        return
    item.pop("identity", None)
    waiting_participants.setdefault(presentation_id, {})[client_id] = item
    screen_share_requests.get(presentation_id, {}).pop(client_id, None)
    await sio.emit("meeting_removed_by_controller", {"presentationId": presentation_id, "clientId": client_id}, room=item["sid"])
    await _emit_lobby_state(presentation_id)


@sio.event
async def meeting_screen_share_request(sid, data):
    presentation_id = data.get("presentationId")
    client_id = str(data.get("clientId") or "").strip()[:128]
    active = active_participants.get(presentation_id, {}).get(client_id) if presentation_id else None
    if not active or active.get("sid") != sid:
        return
    identity, name = _clean_meeting_identity(data)
    screen_share_requests.setdefault(presentation_id, {})[client_id] = {
        "clientId": client_id, "sid": sid, "identity": identity, "name": name,
    }
    await _emit_lobby_state(presentation_id)


@sio.event
async def meeting_screen_share_decide(sid, data):
    presentation_id = data.get("presentationId")
    if not presentation_id or not _presenter_allowed(data):
        await sio.emit("presenter_rejected", {"message": "Presenter permission required"}, room=sid)
        return
    raw_ids = data.get("clientIds")
    client_ids = raw_ids if isinstance(raw_ids, list) else [data.get("clientId")]
    requests = screen_share_requests.setdefault(presentation_id, {})
    accepted = data.get("accepted") is True
    for raw_client_id in client_ids[:100]:
        client_id = str(raw_client_id or "").strip()[:128]
        item = requests.pop(client_id, None)
        if not item:
            continue
        await sio.emit(
            "meeting_screen_share_decision",
            {"presentationId": presentation_id, "clientId": client_id, "accepted": accepted},
            room=item["sid"],
        )
    await _emit_lobby_state(presentation_id)


@sio.event
async def meeting_screen_share_revoke(sid, data):
    presentation_id = data.get("presentationId")
    target_identity = str(data.get("targetIdentity") or "").strip()[:128]
    if not presentation_id or not target_identity or not _presenter_allowed(data):
        await sio.emit("presenter_rejected", {"message": "Presenter permission required"}, room=sid)
        return
    await sio.emit(
        "meeting_screen_share_revoke_command",
        {"presentationId": presentation_id, "targetIdentity": target_identity},
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
            live.featured_share_identity = None
            live.meeting_muted = False
            live.muted_participant_identities = "[]"
            db.commit()
    waiting_participants.pop(presentation_id, None)
    active_participants.pop(presentation_id, None)
    screen_share_requests.pop(presentation_id, None)
    await sio.emit("session_ended", {"presentationId": presentation_id}, room=presentation_id)
