from fastapi.testclient import TestClient
from unittest.mock import AsyncMock, patch
from uuid import uuid4
import jwt
from app.database import SessionLocal
from app.config import get_settings
from app.main import fastapi_app, live_session_repair_statements, share_link_repair_statements
from app.models import Presentation, User
from app.security import hash_password


def test_health():
    with TestClient(fastapi_app) as client:
        response = client.get("/api/health")
    assert response.status_code == 200
    assert response.json()["status"] == "ok"


def test_login_and_list_presentations():
    with TestClient(fastapi_app) as client:
        login = client.post("/api/auth/login", json={"email": "owner@presentstudio.local", "password": "password123"})
        assert login.status_code == 200
        token = login.json()["accessToken"]

        response = client.get("/api/presentations", headers={"Authorization": f"Bearer {token}"})
    assert login.status_code == 200
    assert response.status_code == 200
    assert response.json()["presentations"]


def test_create_presentation_creates_its_live_session():
    email = f"presentation-owner-{uuid4().hex}@example.com"
    with TestClient(fastapi_app) as client:
        signup = client.post(
            "/api/auth/signup",
            json={"name": "Presentation Owner", "email": email, "password": "securepass123"},
        )
        token = signup.json()["accessToken"]
        response = client.post(
            "/api/presentations",
            json={"title": "Builder test presentation"},
            headers={"Authorization": f"Bearer {token}"},
        )
    assert signup.status_code == 200
    assert response.status_code == 200
    assert response.json()["presentation"]["title"] == "Builder test presentation"


def test_share_link_requires_auth():
    with TestClient(fastapi_app) as client:
        response = client.post("/api/presentations/pres_demo/share")
    assert response.status_code == 401


def test_share_link_permissions_are_returned_to_frontend():
    with TestClient(fastapi_app) as client:
        login = client.post("/api/auth/login", json={"email": "owner@presentstudio.local", "password": "password123"})
        assert login.status_code == 200
        token = login.json()["accessToken"]
        headers = {"Authorization": f"Bearer {token}"}

        viewer_link = client.post(
            "/api/presentations/pres_demo/share",
            json={"permission": "viewer", "screenAccessCode": "8642"},
            headers=headers,
        )
        assert viewer_link.status_code == 200
        assert viewer_link.json()["permission"] == "viewer"
        assert viewer_link.json()["url"].startswith("https://")
        assert "/screen.html?" in viewer_link.json()["url"]

        viewer_payload = client.get(f"/api/presentations/pres_demo?token={viewer_link.json()['token']}")
        assert viewer_payload.status_code == 200
        assert viewer_payload.json()["permission"] == "viewer"

        presenter_link = client.post(
            "/api/presentations/pres_demo/share",
            json={"permission": "presenter", "screenAccessCode": "2468"},
            headers=headers,
        )
        assert presenter_link.status_code == 200
        assert presenter_link.json()["permission"] == "presenter"
        assert presenter_link.json()["requiresScreenCode"] is True
        assert presenter_link.json()["url"].startswith("https://")
        assert "/controller.html?" in presenter_link.json()["url"]
        assert "/screen.html?" in presenter_link.json()["screenUrl"]
        assert presenter_link.json()["screenToken"]
        assert "/present.html?" in presenter_link.json()["audienceUrl"]

        presenter_payload = client.get(f"/api/presentations/pres_demo?token={presenter_link.json()['token']}")
        assert presenter_payload.status_code == 200
        assert presenter_payload.json()["permission"] == "presenter"


def test_live_media_token_is_optional_and_requires_configuration():
    settings = get_settings()
    with patch.object(settings, "livekit_url", None), patch.object(settings, "livekit_api_key", None), patch.object(settings, "livekit_api_secret", None):
        with TestClient(fastapi_app) as client:
            login = client.post("/api/auth/login", json={"email": "owner@presentstudio.local", "password": "password123"})
            response = client.post(
                "/api/presentations/pres_demo/live/media-token",
                json={"displayName": "Presenter"},
                headers={"Authorization": f"Bearer {login.json()['accessToken']}"},
            )
    assert response.status_code == 503
    assert response.json()["detail"] == "Interactive audio/video is not configured"


def test_live_media_token_uses_presentation_as_room_and_protects_viewer_links():
    settings = get_settings()
    with TestClient(fastapi_app) as client:
        login = client.post("/api/auth/login", json={"email": "owner@presentstudio.local", "password": "password123"})
        headers = {"Authorization": f"Bearer {login.json()['accessToken']}"}
        link = client.post(
            "/api/presentations/pres_demo/share",
            json={"permission": "viewer", "screenAccessCode": "8642"},
            headers=headers,
        ).json()
    with TestClient(fastapi_app) as client:
        with patch.object(settings, "livekit_url", "wss://example.livekit.cloud"), patch.object(settings, "livekit_api_key", "key"), patch.object(settings, "livekit_api_secret", "secret"), patch("app.routers.presentations.create_livekit_join_token", return_value="signed-token") as signer:
            denied = client.post(
                "/api/presentations/pres_demo/live/media-token",
                json={"displayName": "Audience Member", "shareToken": link["token"], "screenAccessCode": "0000"},
            )
            accepted = client.post(
                "/api/presentations/pres_demo/live/media-token",
                json={"displayName": "  Audience   Member  ", "shareToken": link["token"], "screenAccessCode": "8642"},
            )
            invalid = client.post(
                "/api/presentations/pres_demo/live/media-token",
                json={"displayName": "Unknown", "shareToken": "invalid-token", "screenAccessCode": "8642"},
            )
    assert denied.status_code == 403
    assert invalid.status_code == 403
    assert accepted.status_code == 200
    assert accepted.json()["roomName"] == "pres_demo"
    assert accepted.json()["participantName"] == "Audience Member"
    assert accepted.json()["permission"] == "viewer"
    assert accepted.json()["token"] == "signed-token"
    assert accepted.json()["participantIdentity"].startswith("participant_")
    assert signer.call_args.args[0] == "pres_demo"


def test_livekit_tokens_publish_without_room_admin():
    from app.routers.presentations import create_livekit_join_token

    settings = get_settings()
    with patch.object(settings, "livekit_api_key", "test-key"), patch.object(settings, "livekit_api_secret", "test-secret"):
        tokens = [
            create_livekit_join_token("pres_demo", "participant_presenter", "Presenter", "presenter"),
            create_livekit_join_token("pres_demo", "participant_viewer", "Viewer", "viewer"),
        ]
    for index, token in enumerate(tokens):
        claims = jwt.decode(token, "test-secret", algorithms=["HS256"], options={"verify_aud": False})
        grants = claims["video"]
        assert grants["roomJoin"] is True
        assert grants["room"] == "pres_demo"
        assert grants["canPublish"] is True
        assert grants["canSubscribe"] is True
        assert grants["canPublishData"] is (index == 0)
        assert grants.get("roomAdmin", False) is False


def test_share_link_rejects_invalid_permission():
    with TestClient(fastapi_app) as client:
        login = client.post("/api/auth/login", json={"email": "owner@presentstudio.local", "password": "password123"})
        token = login.json()["accessToken"]

        response = client.post(
            "/api/presentations/pres_demo/share",
            json={"permission": "admin"},
            headers={"Authorization": f"Bearer {token}"},
        )
    assert response.status_code == 422


def test_presenter_share_link_requires_screen_code():
    with TestClient(fastapi_app) as client:
        login = client.post("/api/auth/login", json={"email": "owner@presentstudio.local", "password": "password123"})
        token = login.json()["accessToken"]
        response = client.post(
            "/api/presentations/pres_demo/share",
            json={"permission": "presenter"},
            headers={"Authorization": f"Bearer {token}"},
        )
    assert response.status_code == 422


def test_share_link_schema_repair_covers_legacy_runtime_columns():
    statements = share_link_repair_statements(
        "postgresql",
        {"id", "presentation_id", "token", "permission"},
    )

    assert "ALTER TABLE share_links ADD COLUMN screen_access_code_hash VARCHAR(255)" in statements
    assert "ALTER TABLE share_links ADD COLUMN is_active BOOLEAN DEFAULT TRUE NOT NULL" in statements
    assert "ALTER TABLE share_links ADD COLUMN expires_at TIMESTAMP WITH TIME ZONE" in statements
    assert "ALTER TABLE share_links ADD COLUMN created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP" in statements


def test_share_link_schema_repair_uses_sqlite_defaults():
    statements = share_link_repair_statements(
        "sqlite",
        {"id", "presentation_id", "token", "permission", "created_at"},
    )

    assert "ALTER TABLE share_links ADD COLUMN is_active BOOLEAN DEFAULT 1 NOT NULL" in statements
    assert "ALTER TABLE share_links ADD COLUMN expires_at DATETIME" in statements
    assert not any("created_at" in statement for statement in statements)


def test_screen_code_is_required_and_verified_for_protected_screen():
    email = f"screen-code-owner-{uuid4().hex}@example.com"
    with TestClient(fastapi_app) as client:
        signup = client.post(
            "/api/auth/signup",
            json={"name": "Screen Code Owner", "email": email, "password": "securepass123"},
        )
        token = signup.json()["accessToken"]
        headers = {"Authorization": f"Bearer {token}"}
        created = client.post(
            "/api/presentations",
            json={"title": "Protected screen deck"},
            headers=headers,
        )
        presentation_id = created.json()["presentation"]["id"]
        link = client.post(
            f"/api/presentations/{presentation_id}/share",
            json={"permission": "presenter", "screenAccessCode": "1357"},
            headers=headers,
        )
        share_token = link.json()["token"]
        screen_token = link.json()["screenToken"]

        requirements = client.get(f"/api/presentations/{presentation_id}/screen-access?token={share_token}")
        locked = client.get(f"/api/presentations/{presentation_id}?screen=1&token={share_token}")
        wrong = client.post(
            f"/api/presentations/{presentation_id}/screen-access",
            json={"token": share_token, "screenAccessCode": "2468"},
        )
        right = client.post(
            f"/api/presentations/{presentation_id}/screen-access",
            json={"token": share_token, "screenAccessCode": "1357"},
        )
        unlocked = client.get(f"/api/presentations/{presentation_id}?screen=1&token={share_token}&screenCode=1357")
        viewer_link = client.post(
            f"/api/presentations/{presentation_id}/share",
            json={"permission": "viewer", "screenAccessCode": "8642"},
            headers=headers,
        )
        viewer_token = viewer_link.json()["token"]
        viewer_requirements = client.get(f"/api/presentations/{presentation_id}/screen-access?token={viewer_token}")
        viewer_locked = client.get(f"/api/presentations/{presentation_id}?screen=1&token={viewer_token}")
        viewer_wrong = client.get(f"/api/presentations/{presentation_id}?screen=1&token={viewer_token}&screenCode=1357")
        viewer_unlocked = client.get(f"/api/presentations/{presentation_id}?screen=1&token={viewer_token}&screenCode=8642")
        paired_screen_requirements = client.get(f"/api/presentations/{presentation_id}/screen-access?token={screen_token}")
        paired_screen_locked = client.get(f"/api/presentations/{presentation_id}?screen=1&token={screen_token}")
        paired_screen_unlocked = client.get(f"/api/presentations/{presentation_id}?screen=1&token={screen_token}&screenCode=1357")

    assert signup.status_code == 200
    assert created.status_code == 200
    assert link.status_code == 200
    assert link.json()["screenUrl"].endswith(f"token={screen_token}")
    assert requirements.status_code == 200
    assert requirements.json() == {"requiresCode": True}
    assert locked.status_code == 403
    assert wrong.status_code == 403
    assert right.status_code == 200
    assert right.json() == {"ok": True}
    assert unlocked.status_code == 200
    assert unlocked.json()["permission"] == "presenter"
    assert viewer_link.status_code == 200
    assert viewer_link.json()["requiresScreenCode"] is True
    assert viewer_requirements.json() == {"requiresCode": True}
    assert viewer_locked.status_code == 403
    assert viewer_wrong.status_code == 403
    assert viewer_unlocked.status_code == 200
    assert viewer_unlocked.json()["permission"] == "viewer"
    assert paired_screen_requirements.json() == {"requiresCode": True}
    assert paired_screen_locked.status_code == 403
    assert paired_screen_unlocked.status_code == 200
    assert paired_screen_unlocked.json()["permission"] == "viewer"


def test_viewer_screen_link_requires_its_own_code():
    email = f"viewer-link-owner-{uuid4().hex}@example.com"
    with TestClient(fastapi_app) as client:
        signup = client.post(
            "/api/auth/signup",
            json={"name": "Viewer Link Owner", "email": email, "password": "securepass123"},
        )
        token = signup.json()["accessToken"]
        created = client.post(
            "/api/presentations",
            json={"title": f"Open viewer deck {uuid4().hex}"},
            headers={"Authorization": f"Bearer {token}"},
        )
        presentation_id = created.json()["presentation"]["id"]
        unprotected = client.post(
            f"/api/presentations/{presentation_id}/share",
            json={"permission": "viewer"},
            headers={"Authorization": f"Bearer {token}"},
        )
        link = client.post(
            f"/api/presentations/{presentation_id}/share",
            json={"permission": "viewer", "screenAccessCode": "9753"},
            headers={"Authorization": f"Bearer {token}"},
        )
        share_token = link.json()["token"]
        requirements = client.get(f"/api/presentations/{presentation_id}/screen-access?token={share_token}")
        screen = client.get(f"/api/presentations/{presentation_id}?screen=1&token={share_token}")
        unlocked = client.get(f"/api/presentations/{presentation_id}?screen=1&token={share_token}&screenCode=9753")

    assert signup.status_code == 200
    assert created.status_code == 200
    assert unprotected.status_code == 422
    assert link.status_code == 200
    assert link.json()["requiresScreenCode"] is True
    assert requirements.json() == {"requiresCode": True}
    assert screen.status_code == 403
    assert unlocked.status_code == 200


def test_saving_presentation_emits_live_update():
    with TestClient(fastapi_app) as client:
        login = client.post("/api/auth/login", json={"email": "owner@presentstudio.local", "password": "password123"})
        token = login.json()["accessToken"]
        headers = {"Authorization": f"Bearer {token}"}
        current = client.get("/api/presentations/pres_demo", headers=headers).json()["presentation"]

        with patch("app.routers.presentations.sio.emit", new_callable=AsyncMock) as emit:
            response = client.put("/api/presentations/pres_demo", json=current, headers=headers)

        assert response.status_code == 200
        emit.assert_awaited_once()
        event_name, event = emit.await_args.args
        assert event_name == "presentation_updated"
        assert event["presentationId"] == "pres_demo"
        assert event["presentation"]["slides"]
        assert emit.await_args.kwargs["room"] == "pres_demo"


def test_saving_presentation_normalizes_duplicate_slide_ids():
    email = f"duplicate-slide-owner-{uuid4().hex}@example.com"
    with TestClient(fastapi_app) as client:
        signup = client.post(
            "/api/auth/signup",
            json={"name": "Duplicate Slide Owner", "email": email, "password": "securepass123"},
        )
        headers = {"Authorization": f"Bearer {signup.json()['accessToken']}"}
        created = client.post("/api/presentations", json={"title": "Duplicate slide save"}, headers=headers).json()["presentation"]
        duplicate_id = created["slides"][0]["id"]
        created["slides"] = [
            {**created["slides"][0], "id": duplicate_id, "order": 1, "title": "First"},
            {**created["slides"][0], "id": duplicate_id, "order": 2, "title": "Second"},
        ]
        response = client.put(f"/api/presentations/{created['id']}", json=created, headers=headers)

    assert response.status_code == 200
    slide_ids = [slide["id"] for slide in response.json()["presentation"]["slides"]]
    assert len(slide_ids) == 2
    assert len(set(slide_ids)) == 2


def test_live_session_schema_repair_covers_postgres_media_columns():
    statements = live_session_repair_statements(
        "postgresql",
        {"id", "presentation_id", "active_slide_id", "presenter_user_id", "audience_count", "is_live", "updated_at"},
    )

    assert "ALTER TABLE live_sessions ADD COLUMN active_media_id VARCHAR(128)" in statements
    assert "ALTER TABLE live_sessions ADD COLUMN active_media_kind VARCHAR(16) DEFAULT 'slide' NOT NULL" in statements
    assert "ALTER TABLE live_sessions ADD COLUMN media_position FLOAT DEFAULT 0 NOT NULL" in statements
    assert "ALTER TABLE live_sessions ADD COLUMN media_playing BOOLEAN DEFAULT FALSE NOT NULL" in statements
    assert "ALTER TABLE live_sessions ADD COLUMN media_muted BOOLEAN DEFAULT FALSE NOT NULL" in statements
    assert "ALTER TABLE live_sessions ADD COLUMN media_updated_at TIMESTAMP WITH TIME ZONE" in statements


def test_signup_creates_authenticated_user():
    email = f"new-user-{uuid4().hex}@example.com"
    with TestClient(fastapi_app) as client:
        response = client.post("/api/auth/signup", json={"name": "New Presenter", "email": email, "password": "securepass123"})
        assert response.status_code == 200
        token = response.json()["accessToken"]
        profile = client.get("/api/auth/me", headers={"Authorization": f"Bearer {token}"})

    assert response.json()["user"]["email"] == email
    assert profile.status_code == 200
    assert profile.json()["user"]["name"] == "New Presenter"


def test_signup_rejects_invalid_email():
    with TestClient(fastapi_app) as client:
        response = client.post("/api/auth/signup", json={"name": "New Presenter", "email": "not-an-email", "password": "securepass123"})
    assert response.status_code == 400
    assert response.json()["detail"] == "Enter a valid email address"


def test_owner_can_delete_presentation():
    email = f"delete-owner-{uuid4().hex}@example.com"
    with TestClient(fastapi_app) as client:
        signup = client.post("/api/auth/signup", json={"name": "Delete Owner", "email": email, "password": "securepass123"})
        headers = {"Authorization": f"Bearer {signup.json()['accessToken']}"}
        created = client.post("/api/presentations", json={"title": "Delete me"}, headers=headers).json()["presentation"]
        client.post(f"/api/presentations/{created['id']}/share", json={"permission": "viewer", "screenAccessCode": "2468"}, headers=headers)
        other_login = client.post("/api/auth/login", json={"email": "owner@presentstudio.local", "password": "password123"})
        other_headers = {"Authorization": f"Bearer {other_login.json()['accessToken']}"}
        forbidden = client.delete(f"/api/presentations/{created['id']}", headers=other_headers)

        with patch("app.routers.presentations.sio.emit", new_callable=AsyncMock) as emit:
            deleted = client.delete(f"/api/presentations/{created['id']}", headers=headers)

        missing = client.get(f"/api/presentations/{created['id']}", headers=headers)

    assert deleted.status_code == 200
    assert forbidden.status_code == 404
    assert deleted.json() == {"ok": True, "presentationId": created["id"]}
    assert missing.status_code == 404
    emit.assert_awaited_once_with("presentation_deleted", {"presentationId": created["id"]}, room=created["id"])


def test_admin_dashboard_is_role_protected_and_reports_usage():
    admin_email = f"admin-{uuid4().hex}@example.com"
    owner_email = f"quota-owner-{uuid4().hex}@example.com"
    with TestClient(fastapi_app) as client:
        db = SessionLocal()
        try:
            db.add(
                User(
                    id=f"usr_{uuid4().hex}",
                    name="Test Administrator",
                    email=admin_email,
                    password_hash=hash_password("securepass123"),
                    role="admin",
                )
            )
            db.commit()
        finally:
            db.close()

        owner_signup = client.post(
            "/api/auth/signup",
            json={"name": "Quota Owner", "email": owner_email, "password": "securepass123"},
        )
        owner_headers = {"Authorization": f"Bearer {owner_signup.json()['accessToken']}"}
        forbidden = client.get("/api/admin/users", headers=owner_headers)
        protected_page = client.get("/admin.html", headers=owner_headers)

        admin_login = client.post("/api/auth/login", json={"email": admin_email, "password": "securepass123"})
        admin_headers = {"Authorization": f"Bearer {admin_login.json()['accessToken']}"}
        users = client.get("/api/admin/users", headers=admin_headers)

    assert forbidden.status_code == 403
    assert protected_page.status_code == 403
    assert users.status_code == 200
    owner_usage = next(item for item in users.json()["users"] if item["email"] == owner_email)
    assert owner_usage["presentationUsed"] == 0
    assert owner_usage["presentationRemaining"] == owner_usage["presentationLimit"]
    assert owner_usage["storageLimitBytes"] is None
    assert owner_usage["storageRemainingBytes"] is None
    assert owner_usage["storageStatus"] == "unlimited"


def test_admin_limit_prevents_additional_presentations():
    admin_email = f"limit-admin-{uuid4().hex}@example.com"
    owner_email = f"limited-owner-{uuid4().hex}@example.com"
    with TestClient(fastapi_app) as client:
        db = SessionLocal()
        try:
            db.add(
                User(
                    id=f"usr_{uuid4().hex}",
                    name="Limit Administrator",
                    email=admin_email,
                    password_hash=hash_password("securepass123"),
                    role="admin",
                )
            )
            db.commit()
        finally:
            db.close()

        owner_signup = client.post(
            "/api/auth/signup",
            json={"name": "Limited Owner", "email": owner_email, "password": "securepass123"},
        )
        owner = owner_signup.json()["user"]
        owner_headers = {"Authorization": f"Bearer {owner_signup.json()['accessToken']}"}
        admin_login = client.post("/api/auth/login", json={"email": admin_email, "password": "securepass123"})
        admin_headers = {"Authorization": f"Bearer {admin_login.json()['accessToken']}"}

        updated = client.patch(
            f"/api/admin/users/{owner['id']}/presentation-limit",
            json={"presentationLimit": 1},
            headers=admin_headers,
        )
        first = client.post("/api/presentations", json={"title": "Allowed"}, headers=owner_headers)
        blocked = client.post("/api/presentations", json={"title": "Blocked"}, headers=owner_headers)

    assert updated.status_code == 200
    assert updated.json()["user"]["presentationLimit"] == 1
    assert first.status_code == 200
    assert blocked.status_code == 409
    assert "Presentation limit reached (1/1)" in blocked.json()["detail"]


def test_admin_storage_limit_blocks_uploads_and_can_be_unlimited():
    admin_email = f"storage-admin-{uuid4().hex}@example.com"
    owner_email = f"storage-owner-{uuid4().hex}@example.com"
    with TestClient(fastapi_app) as client:
        db = SessionLocal()
        try:
            db.add(
                User(
                    id=f"usr_{uuid4().hex}",
                    name="Storage Administrator",
                    email=admin_email,
                    password_hash=hash_password("securepass123"),
                    role="admin",
                )
            )
            db.commit()
        finally:
            db.close()

        owner_signup = client.post(
            "/api/auth/signup",
            json={"name": "Storage Owner", "email": owner_email, "password": "securepass123"},
        )
        owner = owner_signup.json()["user"]
        owner_headers = {"Authorization": f"Bearer {owner_signup.json()['accessToken']}"}
        admin_login = client.post("/api/auth/login", json={"email": admin_email, "password": "securepass123"})
        admin_headers = {"Authorization": f"Bearer {admin_login.json()['accessToken']}"}

        limited = client.patch(
            f"/api/admin/users/{owner['id']}/storage-limit",
            json={"storageLimitBytes": 1},
            headers=admin_headers,
        )
        blocked = client.post(
            "/api/media/upload",
            headers=owner_headers,
            files={"file": ("blocked.png", b"xx", "image/png")},
        )
        unlimited = client.patch(
            f"/api/admin/users/{owner['id']}/storage-limit",
            json={"storageLimitBytes": None},
            headers=admin_headers,
        )

    assert limited.status_code == 200
    assert limited.json()["user"]["storageLimitBytes"] == 1
    assert blocked.status_code == 413
    assert "Media storage limit reached" in blocked.json()["detail"]
    assert unlimited.status_code == 200
    assert unlimited.json()["user"]["storageLimitBytes"] is None


def test_admin_can_revoke_user_and_owned_presentations_but_not_self():
    admin_email = f"revoke-admin-{uuid4().hex}@example.com"
    owner_email = f"revoked-owner-{uuid4().hex}@example.com"
    with TestClient(fastapi_app) as client:
        db = SessionLocal()
        try:
            administrator = User(
                id=f"usr_{uuid4().hex}",
                name="Revoke Administrator",
                email=admin_email,
                password_hash=hash_password("securepass123"),
                role="admin",
            )
            db.add(administrator)
            db.commit()
            admin_id = administrator.id
        finally:
            db.close()

        owner_signup = client.post(
            "/api/auth/signup",
            json={"name": "Revoked Owner", "email": owner_email, "password": "securepass123"},
        )
        owner = owner_signup.json()["user"]
        owner_headers = {"Authorization": f"Bearer {owner_signup.json()['accessToken']}"}
        created = client.post(
            "/api/presentations", json={"title": "Removed with owner"}, headers=owner_headers
        ).json()["presentation"]
        client.post(
            f"/api/presentations/{created['id']}/share",
            json={"permission": "viewer", "screenAccessCode": "2468"},
            headers=owner_headers,
        )

        admin_login = client.post("/api/auth/login", json={"email": admin_email, "password": "securepass123"})
        admin_headers = {"Authorization": f"Bearer {admin_login.json()['accessToken']}"}
        self_revoke = client.delete(f"/api/admin/users/{admin_id}", headers=admin_headers)
        revoked = client.delete(f"/api/admin/users/{owner['id']}", headers=admin_headers)
        rejected_login = client.post(
            "/api/auth/login", json={"email": owner_email, "password": "securepass123"}
        )

        db = SessionLocal()
        try:
            user_exists = db.get(User, owner["id"])
            presentation_exists = db.get(Presentation, created["id"])
        finally:
            db.close()

    assert self_revoke.status_code == 409
    assert revoked.status_code == 200
    assert revoked.json() == {"ok": True, "userId": owner["id"]}
    assert rejected_login.status_code == 401
    assert user_exists is None
    assert presentation_exists is None
