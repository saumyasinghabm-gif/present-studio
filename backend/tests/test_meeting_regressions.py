from types import SimpleNamespace
from unittest.mock import AsyncMock, patch
from uuid import uuid4

from fastapi.testclient import TestClient

from app.database import SessionLocal
from app.main import fastapi_app
from app.models import LiveSession, MeetingParticipantGrant, ShareLink


def owner_headers(client: TestClient) -> dict[str, str]:
    login = client.post(
        "/api/auth/login",
        json={"email": "owner@presentstudio.local", "password": "password123"},
    )
    assert login.status_code == 200
    return {"Authorization": f"Bearer {login.json()['accessToken']}"}


def ensure_demo_live(db, *, meeting_instance_id: str | None, is_live: bool) -> LiveSession:
    live = db.query(LiveSession).filter(
        LiveSession.presentation_id == "pres_demo"
    ).first()
    if not live:
        live = LiveSession(
            id=f"live_regression_{uuid4().hex}",
            presentation_id="pres_demo",
        )
        db.add(live)
        db.flush()
    live.meeting_instance_id = meeting_instance_id
    live.is_live = is_live
    return live


def test_viewer_link_stays_audience_even_for_logged_in_owner():
    with TestClient(fastapi_app) as client:
        headers = owner_headers(client)
        viewer_link = client.post(
            "/api/presentations/pres_demo/share",
            json={"permission": "viewer", "screenAccessCode": "8642"},
            headers=headers,
        )
        assert viewer_link.status_code == 200
        result = client.get(
            f"/api/presentations/pres_demo?token={viewer_link.json()['token']}",
            headers=headers,
        )
    assert result.status_code == 200
    assert result.json()["permission"] == "viewer"


def test_current_meeting_links_are_returned_before_generating_another_bundle():
    with TestClient(fastapi_app) as client:
        headers = owner_headers(client)
        created = client.post(
            "/api/presentations/pres_demo/share",
            json={"permission": "presenter", "screenAccessCode": "2468"},
            headers=headers,
        )
        assert created.status_code == 200
        current = client.get(
            "/api/presentations/pres_demo/share/current",
            headers=headers,
        )
    assert current.status_code == 200
    payload = current.json()
    assert payload["token"] == created.json()["token"]
    assert payload["url"] == created.json()["url"]
    assert payload["screenToken"] == created.json()["screenToken"]
    assert payload["audienceUrl"] == created.json()["audienceUrl"]


def test_presenter_link_can_resolve_its_paired_screen_link():
    with TestClient(fastapi_app) as client:
        headers = owner_headers(client)
        created = client.post(
            "/api/presentations/pres_demo/share",
            json={"permission": "presenter", "screenAccessCode": "2468"},
            headers=headers,
        )
        assert created.status_code == 200
        paired = client.get(
            f"/api/presentations/pres_demo/share/screen?token={created.json()['token']}"
        )
    assert paired.status_code == 200
    assert paired.json()["permission"] == "viewer"
    assert paired.json()["token"] == created.json()["screenToken"]
    assert paired.json()["screenUrl"] == created.json()["screenUrl"]
    assert paired.json()["audienceUrl"] == created.json()["audienceUrl"]


def test_current_meeting_link_lookup_requires_owner_access():
    with TestClient(fastapi_app) as client:
        response = client.get("/api/presentations/pres_demo/share/current")
    assert response.status_code == 401



def test_replacing_meeting_bundle_ends_old_session_and_invalidates_links():
    with TestClient(fastapi_app) as client:
        headers = owner_headers(client)
        first = client.post(
            "/api/presentations/pres_demo/share",
            json={"permission": "presenter", "screenAccessCode": "2468"},
            headers=headers,
        )
        assert first.status_code == 200
        old_presenter_token = first.json()["token"]
        old_audience_token = first.json()["screenToken"]

        with SessionLocal() as db:
            live = ensure_demo_live(
                db,
                meeting_instance_id="meeting_regression_old",
                is_live=True,
            )
            db.query(MeetingParticipantGrant).filter(
                MeetingParticipantGrant.presentation_id == "pres_demo",
                MeetingParticipantGrant.guest_id == "guest-restart-regression",
            ).delete(synchronize_session=False)
            db.add(
                MeetingParticipantGrant(
                    id="meetinggrant_restart_regression",
                    presentation_id="pres_demo",
                    meeting_instance_id="meeting_regression_old",
                    guest_id="guest-restart-regression",
                    display_name="Old Guest",
                    role="audience",
                    status="approved",
                )
            )
            db.commit()

        with patch("app.meeting_v2.sm.sio.emit", new_callable=AsyncMock) as emit:
            second = client.post(
                "/api/presentations/pres_demo/share",
                json={"permission": "presenter", "screenAccessCode": "1357"},
                headers=headers,
            )
            assert second.status_code == 200
            ended = [
                call for call in emit.await_args_list
                if call.args and call.args[0] == "session_ended"
            ]
            assert ended
            assert ended[-1].args[1]["presentationId"] == "pres_demo"
            assert ended[-1].args[1]["reason"] == "restarted"

        assert second.json()["token"] != old_presenter_token
        assert second.json()["screenToken"] != old_audience_token

        old_presenter = client.get(
            f"/api/presentations/pres_demo?token={old_presenter_token}"
        )
        old_audience = client.get(
            f"/api/presentations/shared/{old_audience_token}"
        )
        assert old_presenter.status_code == 403
        assert old_audience.status_code == 404

        with SessionLocal() as db:
            live = db.query(LiveSession).filter(
                LiveSession.presentation_id == "pres_demo"
            ).one()
            assert live.is_live is False
            assert live.meeting_instance_id is None
            grant = db.query(MeetingParticipantGrant).filter(
                MeetingParticipantGrant.presentation_id == "pres_demo",
                MeetingParticipantGrant.guest_id == "guest-restart-regression",
            ).one()
            assert grant.status == "revoked"
            assert grant.role == "audience"

            old_rows = db.query(ShareLink).filter(
                ShareLink.presentation_id == "pres_demo",
                ShareLink.token.in_([old_presenter_token, old_audience_token]),
            ).all()
            assert old_rows
            assert all(row.is_active is False for row in old_rows)


def test_live_media_room_changes_when_meeting_is_restarted():
    with TestClient(fastapi_app) as client:
        headers = owner_headers(client)

        with SessionLocal() as db:
            ensure_demo_live(
                db,
                meeting_instance_id=None,
                is_live=False,
            )
            db.commit()

        fake_settings = SimpleNamespace(
            livekit_url="wss://livekit.test",
            livekit_api_key="test-key",
            livekit_api_secret="test-secret",
        )

        with patch("app.routers.presentations.get_settings", return_value=fake_settings), patch(
            "app.routers.presentations.create_livekit_join_token",
            side_effect=lambda room, identity, name, permission: f"jwt:{room}",
        ):
            first_media = client.post(
                "/api/presentations/pres_demo/live/media-token",
                json={"displayName": "Owner"},
                headers=headers,
            )
            assert first_media.status_code == 200
            first_room = first_media.json()["roomName"]
            assert first_room.startswith("pres_demo--meeting_")

            with patch("app.meeting_v2.sm.sio.emit", new_callable=AsyncMock):
                replacement = client.post(
                    "/api/presentations/pres_demo/share",
                    json={"permission": "presenter", "screenAccessCode": "9753"},
                    headers=headers,
                )
                assert replacement.status_code == 200

            second_media = client.post(
                "/api/presentations/pres_demo/live/media-token",
                json={"displayName": "Owner"},
                headers=headers,
            )
            assert second_media.status_code == 200
            second_room = second_media.json()["roomName"]

        assert second_room.startswith("pres_demo--meeting_")
        assert second_room != first_room
