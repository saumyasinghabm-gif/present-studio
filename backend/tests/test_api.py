from fastapi.testclient import TestClient
from unittest.mock import AsyncMock, patch
from uuid import uuid4
from app.main import fastapi_app


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

        viewer_link = client.post("/api/presentations/pres_demo/share", json={"permission": "viewer"}, headers=headers)
        assert viewer_link.status_code == 200
        assert viewer_link.json()["permission"] == "viewer"
        assert "/screen.html?" in viewer_link.json()["url"]

        viewer_payload = client.get(f"/api/presentations/pres_demo?token={viewer_link.json()['token']}")
        assert viewer_payload.status_code == 200
        assert viewer_payload.json()["permission"] == "viewer"

        presenter_link = client.post("/api/presentations/pres_demo/share", json={"permission": "presenter"}, headers=headers)
        assert presenter_link.status_code == 200
        assert presenter_link.json()["permission"] == "presenter"
        assert "/controller.html?" in presenter_link.json()["url"]

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
        client.post(f"/api/presentations/{created['id']}/share", json={"permission": "viewer"}, headers=headers)
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
