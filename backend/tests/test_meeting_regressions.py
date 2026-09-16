from fastapi.testclient import TestClient

from app.main import fastapi_app


def owner_headers(client: TestClient) -> dict[str, str]:
    login = client.post(
        "/api/auth/login",
        json={"email": "owner@presentstudio.local", "password": "password123"},
    )
    assert login.status_code == 200
    return {"Authorization": f"Bearer {login.json()['accessToken']}"}


def test_logged_in_owner_is_not_downgraded_by_viewer_link():
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
    assert result.json()["permission"] == "presenter"


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


def test_current_meeting_link_lookup_requires_owner_access():
    with TestClient(fastapi_app) as client:
        response = client.get("/api/presentations/pres_demo/share/current")
    assert response.status_code == 401
