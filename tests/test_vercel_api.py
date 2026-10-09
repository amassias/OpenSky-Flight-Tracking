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


def test_airport_live_routes_are_served_with_cache_headers():
    with patch.object(server.FlightServerHandler, "handle_airport_conditions", return_value={"success": True}) as conditions, \
         patch.object(server.FlightServerHandler, "handle_airport_board", return_value={"success": True}) as board:
        conditions_response = client.get("/api/airport-conditions", params={"airport": "LFPG"})
        board_response = client.get("/api/airport-board", params={"airport": "LFPG"})
    assert conditions_response.status_code == 200 and board_response.status_code == 200
    conditions.assert_called_once_with("LFPG")
    board.assert_called_once_with("LFPG")
    assert "s-maxage=120" in conditions_response.headers["cache-control"]
    assert "s-maxage=15" in board_response.headers["cache-control"]


def test_airport_live_routes_validate_the_airport():
    response = client.get("/api/airport-board", params={"airport": "ZZZZ"})
    assert response.status_code == 400


def test_airport_schedule_is_cached_at_the_cdn_only_when_available():
    with patch.object(server.FlightServerHandler, "handle_airport_schedule", return_value={"success": True, "available": True, "flights": []}):
        available = client.get("/api/airport-schedule", params={"airport": "LFPG", "direction": "arrival"})
    with patch.object(server.FlightServerHandler, "handle_airport_schedule", return_value={"success": True, "available": False, "flights": []}):
        unavailable = client.get("/api/airport-schedule", params={"airport": "LFPG"})
    assert "s-maxage=600" in available.headers["cache-control"]
    assert "s-maxage=120" in unavailable.headers["cache-control"]


def test_aircraft_routes_return_json_and_cache_headers():
    with patch.object(server.FlightServerHandler, "handle_aircraft_history", return_value={"success": True, "found": True}), \
         patch.object(server.FlightServerHandler, "handle_aircraft_flights", return_value={"success": True, "available": True}), \
         patch.object(server.FlightServerHandler, "handle_aircraft_lookup", return_value={"success": True, "icao24": "3986e0"}):
        history = client.get("/api/aircraft-history", params={"icao24": "3986e0"})
        flights = client.get("/api/aircraft-flights", params={"registration": "F-HBXA"})
        lookup = client.get("/api/aircraft-lookup", params={"q": "F-HBXA"})
    assert history.status_code == flights.status_code == lookup.status_code == 200
    assert "s-maxage=86400" in history.headers["cache-control"]
    assert "s-maxage=3600" in flights.headers["cache-control"]
    assert client.get("/api/aircraft-history", params={"icao24": "zz"}).status_code == 400
