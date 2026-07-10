from unittest.mock import patch

from fastapi.testclient import TestClient

from api.index import app
import server


client = TestClient(app)


def test_health_route_reuses_service_health_contract():
    with patch.object(server.api_client, "credentials_available", return_value=True):
        response = client.get("/api/health")

    assert response.status_code == 200
    payload = response.json()
    assert payload["success"] is True
    assert payload["credentials_configured"] is True
    assert payload["airports_loaded"] > 1000


def test_search_route_supports_existing_api_path():
    response = client.get("/api/search-airports", params={"q": "Paris", "limit": 2})
    assert response.status_code == 200
    payload = response.json()
    assert len(payload) == 2
    assert payload[0]["icao"] == "LFPG"


def test_serverless_route_preserves_validation_errors():
    response = client.get("/api/flights", params={"airport": "ZZZZ", "date": "2026-07-09"})
    assert response.status_code == 400
    assert response.json()["success"] is False
