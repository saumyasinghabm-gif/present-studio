from fastapi.testclient import TestClient
from unittest.mock import AsyncMock, patch
from uuid import uuid4
from app.database import SessionLocal
from app.main import fastapi_app
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
    with TestClient(fastapi_app) as client:
        login = client.post("/api/auth/login", json={"email": "owner@presentstudio.local", "password": "password123"})
        token = login.json()["accessToken"]
        response = client.post(
            "/api/presentations",
            json={"title": "Builder test presentation"},
            headers={"Authorization": f"Bearer {token}"},
        )
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

        presenter_payload = client.get(f"/api/presentations/pres_demo?token={presenter_link.json()['token']}")
        assert presenter_payload.status_code == 200
        assert presenter_payload.json()["permission"] == "presenter"


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
