from fastapi.testclient import TestClient
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

        viewer_payload = client.get(f"/api/presentations/pres_demo?token={viewer_link.json()['token']}")
        assert viewer_payload.status_code == 200
        assert viewer_payload.json()["permission"] == "viewer"

        presenter_link = client.post("/api/presentations/pres_demo/share", json={"permission": "presenter"}, headers=headers)
        assert presenter_link.status_code == 200
        assert presenter_link.json()["permission"] == "presenter"

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
