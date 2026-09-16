import asyncio
from unittest.mock import AsyncMock, patch
from uuid import uuid4

from app import meeting_v2
from app.database import Base, SessionLocal, engine
from app.main import repair_live_session_schema
from app.models import LiveSession, MeetingParticipantGrant, Presentation, ShareLink, User
from app.security import hash_password, resolve_share_permission


Base.metadata.create_all(bind=engine)
repair_live_session_schema()


def _ids():
    suffix = uuid4().hex
    return {
        "user": f"usr_{suffix}",
        "presentation": f"pres_{suffix}",
        "live": f"live_{suffix}",
        "meeting": f"meeting_{suffix}",
        "guest": f"guest-{suffix}",
    }


def _create_meeting(*, approved=True):
    ids = _ids()
    with SessionLocal() as db:
        db.add(
            User(
                id=ids["user"],
                name="Meeting V2 Owner",
                email=f"meeting-v2-{ids['user']}@example.com",
                password_hash=hash_password("securepass123"),
                role="owner",
            )
        )
        db.add(
            Presentation(
                id=ids["presentation"],
                title="Meeting V2 Test",
                owner_id=ids["user"],
            )
        )
        db.add(
            LiveSession(
                id=ids["live"],
                presentation_id=ids["presentation"],
                meeting_instance_id=ids["meeting"],
                is_live=True,
                presenter_user_id=ids["user"],
            )
        )
        if approved:
            db.add(
                MeetingParticipantGrant(
                    id=f"meetinggrant_{uuid4().hex}",
                    presentation_id=ids["presentation"],
                    meeting_instance_id=ids["meeting"],
                    guest_id=ids["guest"],
                    display_name="Returning Guest",
                    role="audience",
                    status="approved",
                )
            )
        db.commit()
    return ids


def _cleanup(ids):
    presentation_id = ids["presentation"]
    meeting_v2.sm.waiting_participants.pop(presentation_id, None)
    meeting_v2.sm.active_participants.pop(presentation_id, None)
    meeting_v2.sm.screen_share_requests.pop(presentation_id, None)
    meeting_v2.sm.controller_sids.pop(presentation_id, None)
    meeting_v2.cohost_controller_sids.pop(presentation_id, None)
    with SessionLocal() as db:
        db.query(MeetingParticipantGrant).filter(
            MeetingParticipantGrant.presentation_id == presentation_id
        ).delete(synchronize_session=False)
        db.query(ShareLink).filter(
            ShareLink.presentation_id == presentation_id
        ).delete(synchronize_session=False)
        db.query(LiveSession).filter(
            LiveSession.presentation_id == presentation_id
        ).delete(synchronize_session=False)
        db.query(Presentation).filter(
            Presentation.id == presentation_id
        ).delete(synchronize_session=False)
        db.query(User).filter(User.id == ids["user"]).delete(synchronize_session=False)
        db.commit()


def test_approved_guest_rejoins_without_second_host_admission():
    ids = _create_meeting(approved=True)
    try:
        assert meeting_v2.meeting_client_is_admitted(ids["presentation"], ids["guest"]) is True
        meeting_v2.sm.controller_sids[ids["presentation"]] = {"host-sid"}

        with patch.object(
            meeting_v2.sm.sio, "rooms", return_value=[ids["presentation"]]
        ), patch.object(meeting_v2.sm.sio, "emit", new_callable=AsyncMock) as emit:
            asyncio.run(
                meeting_v2.meeting_admission_request(
                    "audience-sid-1",
                    {
                        "presentationId": ids["presentation"],
                        "clientId": ids["guest"],
                        "name": "Returning Guest",
                    },
                )
            )
            assert ids["guest"] in meeting_v2.sm.active_participants[ids["presentation"]]

            asyncio.run(
                meeting_v2.meeting_participant_left(
                    "audience-sid-1",
                    {
                        "presentationId": ids["presentation"],
                        "clientId": ids["guest"],
                    },
                )
            )
            assert ids["guest"] not in meeting_v2.sm.active_participants.get(ids["presentation"], {})
            assert meeting_v2.meeting_client_is_admitted(ids["presentation"], ids["guest"]) is True

            asyncio.run(
                meeting_v2.meeting_admission_request(
                    "audience-sid-2",
                    {
                        "presentationId": ids["presentation"],
                        "clientId": ids["guest"],
                        "name": "Returning Guest",
                    },
                )
            )

            item = meeting_v2.sm.active_participants[ids["presentation"]][ids["guest"]]
            assert item["sid"] == "audience-sid-2"
            decisions = [
                call for call in emit.await_args_list
                if call.args and call.args[0] == "meeting_admission_decision"
            ]
            assert decisions
            assert decisions[-1].args[1]["accepted"] is True
    finally:
        _cleanup(ids)


def test_admission_request_enters_room_before_waiting_lobby():
    ids = _create_meeting(approved=False)
    try:
        meeting_v2.sm.controller_sids[ids["presentation"]] = {"host-sid"}

        with patch.object(
            meeting_v2.sm.sio, "enter_room", new_callable=AsyncMock
        ) as enter_room, patch.object(
            meeting_v2.sm, "_emit_lobby_state", new_callable=AsyncMock
        ):
            asyncio.run(
                meeting_v2.meeting_admission_request(
                    "audience-sid",
                    {
                        "presentationId": ids["presentation"],
                        "clientId": ids["guest"],
                        "name": "First Time Guest",
                    },
                )
            )

        enter_room.assert_awaited_once_with("audience-sid", ids["presentation"])
        assert ids["guest"] in meeting_v2.sm.waiting_participants[ids["presentation"]]
    finally:
        _cleanup(ids)


def test_admission_decision_is_delivered_directly_and_to_room_backup():
    ids = _create_meeting(approved=False)
    try:
        meeting_v2.sm.controller_sids[ids["presentation"]] = {"host-sid"}
        meeting_v2.sm.waiting_participants[ids["presentation"]] = {
            ids["guest"]: {
                "clientId": ids["guest"],
                "sid": "audience-sid",
                "name": "First Time Guest",
            }
        }

        with patch.object(
            meeting_v2.sm, "_presenter_allowed", return_value=True
        ), patch.object(
            meeting_v2.sm.sio, "emit", new_callable=AsyncMock
        ) as emit:
            asyncio.run(
                meeting_v2.meeting_admission_decide(
                    "host-sid",
                    {
                        "presentationId": ids["presentation"],
                        "authToken": "owner-token",
                        "clientId": ids["guest"],
                        "accepted": True,
                    },
                )
            )

        decision_calls = [
            call for call in emit.await_args_list
            if call.args and call.args[0] == "meeting_admission_decision"
        ]
        assert len(decision_calls) >= 2
        assert any(
            call.kwargs.get("room") == "audience-sid"
            for call in decision_calls
        )
        assert any(
            call.kwargs.get("room") == ids["presentation"]
            for call in decision_calls
        )

        # The successful host decision must be persisted, so this exact client
        # may rejoin later without asking the host a second time.
        assert meeting_v2.meeting_client_is_admitted(
            ids["presentation"], ids["guest"]
        ) is True
    finally:
        _cleanup(ids)


def test_controller_remove_revokes_persistent_guest_admission():
    ids = _create_meeting(approved=True)
    try:
        meeting_v2.sm.active_participants[ids["presentation"]] = {
            ids["guest"]: {
                "clientId": ids["guest"],
                "sid": "audience-sid",
                "name": "Guest",
                "identity": "participant-1",
            }
        }

        with patch.object(meeting_v2.sm, "_presenter_allowed", return_value=True), patch.object(
            meeting_v2.sm.sio, "emit", new_callable=AsyncMock
        ):
            asyncio.run(
                meeting_v2.meeting_remove_participant(
                    "host-sid",
                    {
                        "presentationId": ids["presentation"],
                        "clientId": ids["guest"],
                    },
                )
            )

        with SessionLocal() as db:
            grant = db.query(MeetingParticipantGrant).filter(
                MeetingParticipantGrant.presentation_id == ids["presentation"],
                MeetingParticipantGrant.guest_id == ids["guest"],
            ).one()
            assert grant.status == "revoked"
            assert grant.role == "audience"

        assert meeting_v2.meeting_client_is_admitted(ids["presentation"], ids["guest"]) is False
    finally:
        _cleanup(ids)


def test_promote_and_demote_cohost_creates_and_revokes_controller_access():
    ids = _create_meeting(approved=True)
    try:
        meeting_v2.sm.active_participants[ids["presentation"]] = {
            ids["guest"]: {
                "clientId": ids["guest"],
                "sid": "audience-sid",
                "name": "Co-host Candidate",
                "identity": "participant-1",
            }
        }

        with patch.object(meeting_v2.sm, "_presenter_allowed", return_value=True), patch.object(
            meeting_v2.sm.sio, "emit", new_callable=AsyncMock
        ):
            asyncio.run(
                meeting_v2.meeting_role_update(
                    "host-sid",
                    {
                        "presentationId": ids["presentation"],
                        "clientId": ids["guest"],
                        "role": "cohost",
                    },
                )
            )

        with SessionLocal() as db:
            grant = db.query(MeetingParticipantGrant).filter(
                MeetingParticipantGrant.presentation_id == ids["presentation"],
                MeetingParticipantGrant.guest_id == ids["guest"],
            ).one()
            assert grant.status == "approved"
            assert grant.role == "cohost"
            assert grant.cohost_share_id
            share = db.get(ShareLink, grant.cohost_share_id)
            assert share is not None
            assert share.is_active is True
            token = share.token
            assert resolve_share_permission(db, ids["presentation"], token) == "presenter"

        with patch.object(meeting_v2.sm, "_presenter_allowed", return_value=True), patch.object(
            meeting_v2.sm.sio, "emit", new_callable=AsyncMock
        ):
            asyncio.run(
                meeting_v2.meeting_role_update(
                    "host-sid",
                    {
                        "presentationId": ids["presentation"],
                        "clientId": ids["guest"],
                        "role": "audience",
                    },
                )
            )

        with SessionLocal() as db:
            grant = db.query(MeetingParticipantGrant).filter(
                MeetingParticipantGrant.presentation_id == ids["presentation"],
                MeetingParticipantGrant.guest_id == ids["guest"],
            ).one()
            assert grant.role == "audience"
            assert grant.cohost_share_id is None
            share = db.query(ShareLink).filter(ShareLink.token == token).one()
            assert share.is_active is False
            assert resolve_share_permission(db, ids["presentation"], token) is None
    finally:
        _cleanup(ids)


def test_unauthorized_role_change_is_rejected():
    ids = _create_meeting(approved=True)
    try:
        meeting_v2.sm.active_participants[ids["presentation"]] = {
            ids["guest"]: {
                "clientId": ids["guest"],
                "sid": "audience-sid",
                "name": "Audience",
                "identity": "participant-1",
            }
        }

        with patch.object(meeting_v2.sm, "_presenter_allowed", return_value=False), patch.object(
            meeting_v2.sm.sio, "emit", new_callable=AsyncMock
        ) as emit:
            asyncio.run(
                meeting_v2.meeting_role_update(
                    "untrusted-sid",
                    {
                        "presentationId": ids["presentation"],
                        "clientId": ids["guest"],
                        "role": "cohost",
                    },
                )
            )

            rejected = [
                call for call in emit.await_args_list
                if call.args and call.args[0] == "presenter_rejected"
            ]
            assert rejected

        with SessionLocal() as db:
            grant = db.query(MeetingParticipantGrant).filter(
                MeetingParticipantGrant.presentation_id == ids["presentation"],
                MeetingParticipantGrant.guest_id == ids["guest"],
            ).one()
            assert grant.role == "audience"
            assert grant.cohost_share_id is None
    finally:
        _cleanup(ids)
