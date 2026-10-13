import time
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


def test_live_flights_are_cached_at_the_cdn_unless_degraded():
    fresh = {"success": True, "time": 1, "count": 0, "states": []}
    with patch.object(server.FlightServerHandler, "handle_live_flights", return_value=fresh):
        response = client.get("/api/live-flights", params={"lamin": 48, "lomin": 1, "lamax": 50, "lomax": 4})
    assert "s-maxage=10" in response.headers["cache-control"]
    with patch.object(server.FlightServerHandler, "handle_live_flights", return_value={**fresh, "degraded": True}):
        degraded = client.get("/api/live-flights", params={"lamin": 48, "lomin": 1, "lamax": 50, "lomax": 4})
    assert "s-maxage" not in degraded.headers.get("cache-control", "")


def test_callsign_lookup_finds_the_aircraft_flying_a_callsign():
    aircraft = {"icao24": "406a3d", "callsign": "BAW557H", "latitude": 49.1, "longitude": 3.3, "last_contact": time.time()}
    row = ["406a3d", "BAW557H"]
    with patch.object(server.api_client, "get_live_callsign_states", return_value={"states": [row]}), \
         patch.object(server.FlightServerHandler, "_parse_states", return_value=[aircraft]), \
         patch.object(server.FlightServerHandler, "_enrich_live_states"):
        response = client.get("/api/callsign-lookup", params={"callsign": "baw 557h"})
    assert response.status_code == 200
    assert response.json()["aircraft"]["icao24"] == "406a3d"
    assert client.get("/api/callsign-lookup", params={"callsign": "x"}).status_code == 400


def test_static_airport_answers_are_cdn_cacheable():
    for path, params in (("/api/airports", {}), ("/api/search-airports", {"q": "CDG"})):
        response = client.get(path, params=params)
        assert response.status_code == 200
        assert "s-maxage=86400" in response.headers["cache-control"]


def test_global_emergency_route_returns_open_data_and_cache_headers():
    now = int(time.time())
    row = ["abc123", "TEST1", "Unknown", now, now, 2, 49, 9000, False, 220, 90, 0, None, 9100, "7700", False, 0]
    with patch.object(server.api_client, "get_emergency_states", return_value={"time": now, "provider": "adsb.lol", "states": [row]}):
        response = client.get("/api/emergencies")
    assert response.status_code == 200
    assert response.json()["count"] == 1
    assert response.json()["states"][0]["squawk"] == "7700"
    assert "s-maxage=60" in response.headers["cache-control"]


def test_delayed_emergency_snapshot_is_not_cached_by_the_cdn():
    now = int(time.time())
    with patch.object(server.api_client, "get_emergency_states", return_value={"time": now - 90, "provider": "adsb.lol", "states": [], "status": "delayed", "last_success_at": now - 90, "retry_after_seconds": 30}):
        response = client.get("/api/emergencies")
    assert response.status_code == 200
    assert response.json()["status"] == "delayed"
    assert response.json()["observed_at"] == now - 90
    assert response.headers["cache-control"] == "no-store"


def test_free_aircraft_enrichment_endpoint_and_validation():
    result = client.get("/api/aircraft-enrichment?operator=AFR&type=A359")
    assert result.status_code == 200
    assert result.json()["match_level"] == "operator_type"
    assert len(result.json()["configurations"]) == 2
    assert client.get("/api/aircraft-enrichment?operator=AFR&type=invalid").status_code == 400
