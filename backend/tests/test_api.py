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
