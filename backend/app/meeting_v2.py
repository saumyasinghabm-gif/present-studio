"""Meeting v2: persistent guest admission, session-scoped co-hosts and moderation RBAC."""
from __future__ import annotations

from datetime import datetime, timedelta, timezone
from urllib.parse import quote

from . import socket_manager as sm
from .database import SessionLocal
from .live_state import utc_now
from .models import LiveSession, MeetingParticipantGrant, Presentation, ShareLink
from .security import new_id, new_share_token


_legacy_end_session = sm.end_session
_legacy_participant_left = sm.meeting_participant_left
_legacy_disconnect = sm.disconnect
cohost_controller_sids: dict[str, dict[str, str]] = {}


def _aware(value: datetime | None) -> datetime | None:
    if value is None:
        return None
    return value if value.tzinfo else value.replace(tzinfo=timezone.utc)


def _current_live(db, presentation_id: str) -> LiveSession | None:
    return db.query(LiveSession).filter(LiveSession.presentation_id == presentation_id).first()


def _grant(db, presentation_id: str, meeting_instance_id: str, guest_id: str) -> MeetingParticipantGrant | None:
    if not meeting_instance_id or not guest_id:
        return None
    return db.query(MeetingParticipantGrant).filter(
        MeetingParticipantGrant.presentation_id == presentation_id,
        MeetingParticipantGrant.meeting_instance_id == meeting_instance_id,
        MeetingParticipantGrant.guest_id == guest_id,
    ).first()


def _revoke_cohost_share(db, grant: MeetingParticipantGrant | None) -> None:
    if not grant or not grant.cohost_share_id:
        return
    share = db.get(ShareLink, grant.cohost_share_id)
    if share:
        share.is_active = False
    grant.cohost_share_id = None


def _revoke_instance(db, presentation_id: str, meeting_instance_id: str) -> None:
    if not meeting_instance_id:
        return
    grants = db.query(MeetingParticipantGrant).filter(
        MeetingParticipantGrant.presentation_id == presentation_id,
        MeetingParticipantGrant.meeting_instance_id == meeting_instance_id,
    ).all()
    for grant in grants:
        _revoke_cohost_share(db, grant)
        grant.status = "revoked"
        grant.role = "audience"
        grant.updated_at = utc_now()


def _ensure_meeting_instance(db, presentation_id: str) -> LiveSession:
    live = _current_live(db, presentation_id)
    if not live:
        live = LiveSession(
            id=new_id("live"),
            presentation_id=presentation_id,
            meeting_instance_id=new_id("meeting"),
            is_live=True,
        )
        db.add(live)
        db.flush()
        return live

    if not live.is_live or not live.meeting_instance_id:
        old_instance_id = live.meeting_instance_id or ""
        if old_instance_id:
            _revoke_instance(db, presentation_id, old_instance_id)
        live.meeting_instance_id = new_id("meeting")
        live.is_live = True
        live.media_updated_at = utc_now()
        db.flush()
    return live


def _upsert_grant(
    db,
    presentation_id: str,
    meeting_instance_id: str,
    guest_id: str,
    name: str,
    *,
    status: str = "approved",
    role: str | None = None,
) -> MeetingParticipantGrant:
    grant = _grant(db, presentation_id, meeting_instance_id, guest_id)
    if not grant:
        grant = MeetingParticipantGrant(
            id=new_id("meetinggrant"),
            presentation_id=presentation_id,
            meeting_instance_id=meeting_instance_id,
            guest_id=guest_id,
            display_name=name or "Guest",
            status=status,
            role=role or "audience",
        )
        db.add(grant)
    else:
        grant.display_name = name or grant.display_name or "Guest"
        grant.status = status
        if role is not None:
            grant.role = role
        grant.updated_at = utc_now()
    db.flush()
    return grant


def _active_cohost_share(db, grant: MeetingParticipantGrant) -> ShareLink | None:
    if not grant.cohost_share_id:
        return None
    share = db.get(ShareLink, grant.cohost_share_id)
    if not share or not share.is_active or share.permission != "presenter":
        return None
    expires_at = _aware(share.expires_at)
    if expires_at and expires_at <= datetime.now(timezone.utc):
        share.is_active = False
        return None
    return share


def _ensure_cohost_share(db, grant: MeetingParticipantGrant) -> ShareLink:
    share = _active_cohost_share(db, grant)
    if share:
        return share
    share = ShareLink(
        id=new_id("share"),
        presentation_id=grant.presentation_id,
        token=new_share_token(),
        permission="presenter",
        is_active=True,
        expires_at=datetime.now(timezone.utc) + timedelta(hours=24),
    )
    db.add(share)
    db.flush()
    grant.cohost_share_id = share.id
    grant.updated_at = utc_now()
    db.flush()
    return share


def _controller_url(grant: MeetingParticipantGrant, token: str) -> str:
    return (
        f"/controller.html?id={quote(grant.presentation_id)}"
        f"&token={quote(token)}"
        f"&cohost=1"
        f"&cohostGuestId={quote(grant.guest_id)}"
        f"&cohostName={quote(grant.display_name or 'Co-host')}"
    )


def _grant_payload(db, grant: MeetingParticipantGrant) -> dict:
    payload = {
        "role": grant.role,
        "meetingInstanceId": grant.meeting_instance_id,
    }
    if grant.role == "cohost" and grant.status == "approved":
        share = _ensure_cohost_share(db, grant)
        payload["controllerUrl"] = _controller_url(grant, share.token)
    return payload


def meeting_client_is_admitted(presentation_id: str, client_id: str) -> bool:
    guest_id = str(client_id or "").strip()[:128]
    if not presentation_id or not guest_id:
        return False
    with SessionLocal() as db:
        live = _current_live(db, presentation_id)
        if not live or not live.is_live or not live.meeting_instance_id:
            return False
        grant = _grant(db, presentation_id, live.meeting_instance_id, guest_id)
        return bool(grant and grant.status == "approved" and grant.role in {"audience", "cohost"})


sm.meeting_client_is_admitted = meeting_client_is_admitted


def _lobby_payload(presentation_id: str) -> dict:
    pending = sm.waiting_participants.get(presentation_id, {})
    active = sm.active_participants.get(presentation_id, {})
    shares = sm.screen_share_requests.get(presentation_id, {})
    roles: dict[str, str] = {}
    meeting_instance_id = ""
    with SessionLocal() as db:
        live = _current_live(db, presentation_id)
        if live and live.meeting_instance_id:
            meeting_instance_id = live.meeting_instance_id
            grants = db.query(MeetingParticipantGrant).filter(
                MeetingParticipantGrant.presentation_id == presentation_id,
                MeetingParticipantGrant.meeting_instance_id == live.meeting_instance_id,
                MeetingParticipantGrant.status == "approved",
            ).all()
            roles = {grant.guest_id: grant.role for grant in grants}
    return {
        "presentationId": presentation_id,
        "meetingInstanceId": meeting_instance_id,
        "pending": [
            {"clientId": item["clientId"], "name": item["name"]}
            for item in pending.values()
        ],
        "active": [
            {
                "clientId": item["clientId"],
                "identity": item.get("identity", ""),
                "name": item["name"],
                "role": roles.get(item["clientId"], "audience"),
            }
            for item in active.values()
        ],
        "screenShareRequests": [
            {
                "clientId": item["clientId"],
                "identity": item.get("identity", ""),
                "name": item["name"],
            }
            for item in shares.values()
        ],
    }


sm._lobby_payload = _lobby_payload


async def _emit_decision(
    sid: str,
    presentation_id: str,
    guest_id: str,
    accepted: bool,
    grant_id: str | None = None,
) -> None:
    payload = {
        "presentationId": presentation_id,
        "clientId": guest_id,
        "accepted": accepted,
    }
    if accepted and grant_id:
        with SessionLocal() as db:
            fresh = db.get(MeetingParticipantGrant, grant_id)
            if fresh:
                payload.update(_grant_payload(db, fresh))
                db.commit()

    # Send directly to the requesting socket first.
    await sm.sio.emit("meeting_admission_decision", payload, room=sid)

    # Also broadcast inside the presentation Socket.IO room as a delivery backup.
    # Other audience clients ignore decisions whose clientId is not theirs.
    await sm.sio.emit(
        "meeting_admission_decision",
        payload,
        room=presentation_id,
        skip_sid=sid,
    )


def _cohost_sid_for(presentation_id: str, guest_id: str) -> str | None:
    return cohost_controller_sids.get(presentation_id, {}).get(guest_id)


async def _revoke_cohost_controller(presentation_id: str, guest_id: str, reason: str) -> None:
    sid = _cohost_sid_for(presentation_id, guest_id)
    if not sid:
        return
    sm.controller_sids.get(presentation_id, set()).discard(sid)
    if not sm.controller_sids.get(presentation_id):
        sm.controller_sids.pop(presentation_id, None)
    cohost_controller_sids.get(presentation_id, {}).pop(guest_id, None)
    if not cohost_controller_sids.get(presentation_id):
        cohost_controller_sids.pop(presentation_id, None)
    await sm.sio.emit(
        "meeting_controller_revoked",
        {"presentationId": presentation_id, "clientId": guest_id, "reason": reason},
        room=sid,
    )



@sm.sio.event
async def disconnect(sid):
    for presentation_id, mapping in list(cohost_controller_sids.items()):
        removed = [guest_id for guest_id, controller_sid in mapping.items() if controller_sid == sid]
        for guest_id in removed:
            mapping.pop(guest_id, None)
        if not mapping:
            cohost_controller_sids.pop(presentation_id, None)
    await _legacy_disconnect(sid)


@sm.sio.event
async def meeting_controller_register(sid, data):
    presentation_id = data.get("presentationId")
    if not presentation_id or not sm._presenter_allowed(data):
        await sm.sio.emit("presenter_rejected", {"message": "Presenter permission required"}, room=sid)
        return

    cohost_guest_id = str(data.get("cohostGuestId") or "").strip()[:128]
    with SessionLocal() as db:
        live = _ensure_meeting_instance(db, presentation_id)
        if cohost_guest_id:
            grant = _grant(db, presentation_id, live.meeting_instance_id, cohost_guest_id)
            if not grant or grant.status != "approved" or grant.role != "cohost":
                await sm.sio.emit("presenter_rejected", {"message": "Co-host access is no longer active"}, room=sid)
                return
        db.commit()

    sm.controller_sids.setdefault(presentation_id, set()).add(sid)
    if cohost_guest_id:
        cohost_controller_sids.setdefault(presentation_id, {})[cohost_guest_id] = sid
    await sm.sio.emit("meeting_lobby_state", _lobby_payload(presentation_id), room=sid)


@sm.sio.event
async def meeting_admission_request(sid, data):
    presentation_id = data.get("presentationId")
    guest_id = str(data.get("clientId") or "").strip()[:128]
    _, name = sm._clean_meeting_identity(data)
    if not presentation_id or not guest_id:
        return

    # Admission must not depend on join_presentation winning a race in the
    # browser. Put this exact socket in the presentation room here.
    try:
        await sm.sio.enter_room(sid, presentation_id)
    except ValueError:
        # Tests/disconnected sockets can raise here. Presentation validation
        # below remains authoritative.
        pass

    with SessionLocal() as db:
        if not db.get(Presentation, presentation_id):
            return
        live = _ensure_meeting_instance(db, presentation_id)
        grant = _grant(db, presentation_id, live.meeting_instance_id, guest_id)

        if grant and grant.status == "approved":
            active = {
                "clientId": guest_id,
                "sid": sid,
                "name": name,
            }
            sm.waiting_participants.get(presentation_id, {}).pop(guest_id, None)
            sm.active_participants.setdefault(presentation_id, {})[guest_id] = active
            grant.display_name = name
            grant.updated_at = utc_now()
            grant_id = grant.id
            db.commit()
            await _emit_decision(sid, presentation_id, guest_id, True, grant_id)
            await sm._emit_lobby_state(presentation_id)
            return

        if not sm.controller_sids.get(presentation_id):
            grant = _upsert_grant(
                db,
                presentation_id,
                live.meeting_instance_id,
                guest_id,
                name,
                status="approved",
                role="audience",
            )
            sm.active_participants.setdefault(presentation_id, {})[guest_id] = {
                "clientId": guest_id,
                "sid": sid,
                "name": name,
            }
            grant_id = grant.id
            db.commit()
            await _emit_decision(sid, presentation_id, guest_id, True, grant_id)
            return

        sm.waiting_participants.setdefault(presentation_id, {})[guest_id] = {
            "clientId": guest_id,
            "sid": sid,
            "name": name,
        }
        db.commit()
    await sm._emit_lobby_state(presentation_id)


@sm.sio.event
async def meeting_admission_decide(sid, data):
    presentation_id = data.get("presentationId")
    if not presentation_id or not sm._presenter_allowed(data):
        await sm.sio.emit("presenter_rejected", {"message": "Presenter permission required"}, room=sid)
        return

    raw_ids = data.get("clientIds")
    client_ids = raw_ids if isinstance(raw_ids, list) else [data.get("clientId")]
    pending = sm.waiting_participants.setdefault(presentation_id, {})
    active = sm.active_participants.setdefault(presentation_id, {})
    accepted = data.get("accepted") is True

    with SessionLocal() as db:
        live = _ensure_meeting_instance(db, presentation_id)
        decisions = []
        for raw_guest_id in client_ids[:100]:
            guest_id = str(raw_guest_id or "").strip()[:128]
            item = pending.pop(guest_id, None)
            if not item:
                continue
            grant = _upsert_grant(
                db,
                presentation_id,
                live.meeting_instance_id,
                guest_id,
                item["name"],
                status="approved" if accepted else "revoked",
                role="audience",
            )
            _revoke_cohost_share(db, grant)
            if accepted:
                active[guest_id] = item

            # Save only the scalar id before commit/session close. Passing the
            # ORM object out of this session can leave it detached/expired and
            # prevent the approval event from ever being emitted.
            decisions.append((item["sid"], guest_id, grant.id if accepted else None))
        db.commit()

    for target_sid, guest_id, grant_id in decisions:
        await _emit_decision(target_sid, presentation_id, guest_id, accepted, grant_id)
    await sm._emit_lobby_state(presentation_id)


@sm.sio.event
async def meeting_participant_joined(sid, data):
    presentation_id = data.get("presentationId")
    guest_id = str(data.get("clientId") or "").strip()[:128]
    identity, name = sm._clean_meeting_identity(data)
    if not presentation_id or not guest_id or not identity:
        return
    with SessionLocal() as db:
        live = _current_live(db, presentation_id)
        grant = (
            _grant(db, presentation_id, live.meeting_instance_id, guest_id)
            if live and live.is_live and live.meeting_instance_id
            else None
        )
        if not grant or grant.status != "approved" or grant.role not in {"audience", "cohost"}:
            return
        item = sm.active_participants.setdefault(presentation_id, {}).setdefault(
            guest_id,
            {"clientId": guest_id, "sid": sid, "name": name},
        )
        item.update({"sid": sid, "identity": identity, "name": name})
        sm.waiting_participants.get(presentation_id, {}).pop(guest_id, None)
        grant.display_name = name
        grant.updated_at = utc_now()
        db.commit()
    await sm._emit_lobby_state(presentation_id)


@sm.sio.event
async def meeting_participant_left(sid, data):
    # Preserve the persistent grant: Leave/refresh/reconnect must not require
    # another host approval within the same meeting instance.
    await _legacy_participant_left(sid, data)


@sm.sio.event
async def meeting_remove_participant(sid, data):
    presentation_id = data.get("presentationId")
    guest_id = str(data.get("clientId") or "").strip()[:128]
    if not presentation_id or not guest_id or not sm._presenter_allowed(data):
        await sm.sio.emit("presenter_rejected", {"message": "Presenter permission required"}, room=sid)
        return

    item = sm.active_participants.get(presentation_id, {}).pop(guest_id, None)
    if not item:
        return

    with SessionLocal() as db:
        live = _current_live(db, presentation_id)
        if live and live.meeting_instance_id:
            grant = _grant(db, presentation_id, live.meeting_instance_id, guest_id)
            if grant:
                _revoke_cohost_share(db, grant)
                grant.status = "revoked"
                grant.role = "audience"
                grant.updated_at = utc_now()
                db.commit()

    await _revoke_cohost_controller(presentation_id, guest_id, "removed")
    item.pop("identity", None)
    sm.waiting_participants.setdefault(presentation_id, {})[guest_id] = item
    sm.screen_share_requests.get(presentation_id, {}).pop(guest_id, None)
    await sm.sio.emit(
        "meeting_removed_by_controller",
        {"presentationId": presentation_id, "clientId": guest_id},
        room=item["sid"],
    )
    await sm._emit_lobby_state(presentation_id)


@sm.sio.event
async def meeting_role_update(sid, data):
    presentation_id = data.get("presentationId")
    guest_id = str(data.get("clientId") or "").strip()[:128]
    next_role = str(data.get("role") or "").strip().lower()
    if next_role not in {"audience", "cohost"}:
        return
    if not presentation_id or not guest_id or not sm._presenter_allowed(data):
        await sm.sio.emit("presenter_rejected", {"message": "Presenter permission required"}, room=sid)
        return

    active_item = sm.active_participants.get(presentation_id, {}).get(guest_id)
    if not active_item:
        return

    with SessionLocal() as db:
        live = _ensure_meeting_instance(db, presentation_id)
        grant = _upsert_grant(
            db,
            presentation_id,
            live.meeting_instance_id,
            guest_id,
            active_item.get("name") or "Guest",
            status="approved",
        )
        grant.role = next_role
        grant.updated_at = utc_now()
        if next_role == "cohost":
            share = _ensure_cohost_share(db, grant)
            controller_url = _controller_url(grant, share.token)
        else:
            _revoke_cohost_share(db, grant)
            controller_url = None
        db.commit()

    if next_role == "audience":
        await _revoke_cohost_controller(presentation_id, guest_id, "demoted")

    payload = {
        "presentationId": presentation_id,
        "clientId": guest_id,
        "role": next_role,
        "controllerUrl": controller_url,
    }
    await sm.sio.emit("meeting_role_changed", payload, room=active_item["sid"])
    await sm._emit_lobby_state(presentation_id)


@sm.sio.event
async def end_session(sid, data):
    presentation_id = data.get("presentationId")
    allowed = bool(presentation_id and sm._presenter_allowed(data))
    meeting_instance_id = ""
    if allowed:
        with SessionLocal() as db:
            live = _current_live(db, presentation_id)
            meeting_instance_id = live.meeting_instance_id if live and live.meeting_instance_id else ""

    # Let the legacy handler validate the still-active presenter/co-host token and
    # end the live session before revoking session-scoped co-host credentials.
    await _legacy_end_session(sid, data)

    if allowed:
        with SessionLocal() as db:
            if meeting_instance_id:
                _revoke_instance(db, presentation_id, meeting_instance_id)
                db.commit()
        for guest_id in list(cohost_controller_sids.get(presentation_id, {})):
            await _revoke_cohost_controller(presentation_id, guest_id, "session-ended")


# Make direct imports/tests see the upgraded handlers too.
sm.disconnect = disconnect
sm.meeting_controller_register = meeting_controller_register
sm.meeting_admission_request = meeting_admission_request
sm.meeting_admission_decide = meeting_admission_decide
sm.meeting_participant_joined = meeting_participant_joined
sm.meeting_participant_left = meeting_participant_left
sm.meeting_remove_participant = meeting_remove_participant
sm.meeting_role_update = meeting_role_update
sm.end_session = end_session


def install_router_guards(presentations_module) -> None:
    """Make temporary co-host links expire with the active meeting instance."""
    legacy_active_share_link = presentations_module.active_share_link

    def guarded_active_share_link(db, presentation_id: str, token: str):
        share = legacy_active_share_link(db, presentation_id, token)
        if not share:
            return None
        expires_at = _aware(share.expires_at)
        if expires_at and expires_at <= datetime.now(timezone.utc):
            return None

        grant = db.query(MeetingParticipantGrant).filter(
            MeetingParticipantGrant.cohost_share_id == share.id
        ).first()
        if not grant:
            return share

        live = _current_live(db, presentation_id)
        if (
            not live
            or not live.is_live
            or live.meeting_instance_id != grant.meeting_instance_id
            or grant.status != "approved"
            or grant.role != "cohost"
        ):
            return None
        return share

    presentations_module.active_share_link = guarded_active_share_link

    legacy_screen_code_share = presentations_module.screen_code_share

    def guarded_screen_code_share(db, presentation_id: str, share=None):
        protected = legacy_screen_code_share(db, presentation_id, share)
        if protected:
            return protected
        if not share:
            return None
        grant = db.query(MeetingParticipantGrant).filter(
            MeetingParticipantGrant.cohost_share_id == share.id,
            MeetingParticipantGrant.presentation_id == presentation_id,
            MeetingParticipantGrant.status == "approved",
            MeetingParticipantGrant.role == "cohost",
        ).first()
        if not grant:
            return None
        live = _current_live(db, presentation_id)
        if not live or not live.is_live or live.meeting_instance_id != grant.meeting_instance_id:
            return None
        # A promoted co-host's high-entropy, session-scoped presenter token is
        # sufficient to open the presentation screen without a second 4-digit code.
        return share

    presentations_module.screen_code_share = guarded_screen_code_share
