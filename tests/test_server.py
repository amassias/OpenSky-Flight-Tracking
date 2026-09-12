from datetime import datetime, timezone
from unittest.mock import Mock, patch

import pytest

import server
from api_client import OpenSkyAPIError


def handler():
    return object.__new__(server.FlightServerHandler)


def test_health_reports_loaded_data_and_credential_state():
    with patch.object(server.api_client, "credentials_available", return_value=True):
        payload = handler().handle_health()
    assert payload["success"] is True
    assert payload["airports_loaded"] > 1000
    assert payload["credentials_configured"] is True
    assert "flightaware_configured" in payload


def test_airport_validation_rejects_unknown_codes():
    with pytest.raises(ValueError, match="not found"):
        server._validate_airport_icao("ZZZZ")


def test_flights_normalizes_departures_and_summary():
    raw = [{
        "icao24": "39abcd",
        "callsign": "AFR123 ",
        "firstSeen": 1_750_000_000,
        "lastSeen": 1_750_005_000,
        "estDepartureAirport": "LFPG",
        "estArrivalAirport": "EGLL",
    }]
    fake_client = Mock()
    fake_client.get_departures.return_value = raw
    fake_client.get_states.return_value = {"states": []}

    with patch.object(server, "api_client", fake_client):
        payload = handler().handle_flights("LFPG", "2025-06-15", "departure")

    assert payload["success"] is True
    assert payload["summary"]["total"] == 1
    assert payload["flights"][0]["callsign"] == "AFR123"
    assert payload["flights"][0]["airline_code"] == "AFR"


def test_vercel_history_outage_returns_labelled_live_snapshot(monkeypatch):
    monkeypatch.setenv("VERCEL", "1")
    today = datetime.now(timezone.utc).date().isoformat()
    live_state = [
        "39abcd", "AFR123 ", "France", 1_750_000_000, 1_750_000_001,
        2.55, 49.01, 9_000, False, 210, 95, 0, None, 9_100, "7000", False, 0, 4,
    ]
    fake_client = Mock()
    fake_client.get_departures.side_effect = OpenSkyAPIError("proxy timeout", status_code=502)
    fake_client.get_live_fallback_states.return_value = {"time": 1_750_000_001, "states": [live_state]}

    with patch.object(server, "api_client", fake_client):
        payload = handler().handle_flights("LFPG", today, "departure")

    assert payload["success"] is True
    assert payload["source"] == "live-nearby"
    assert payload["notice"]
    assert payload["summary"]["total"] == 1
    assert payload["flights"][0]["data_source"] == "live-nearby"
    assert payload["flights"][0]["departure_airport"] is None
    fake_client.get_live_fallback_states.assert_called_once()


def test_vercel_history_outage_keeps_past_airport_search_useful(monkeypatch):
    monkeypatch.setenv("VERCEL", "1")
    live_state = [
        "39abcd", "AFR123 ", "France", 1_750_000_000, 1_750_000_001,
        2.55, 49.01, 9_000, False, 210, 95, 0, None, 9_100, "7000", False, 0, 4,
    ]
    fake_client = Mock()
    fake_client.get_arrivals.side_effect = OpenSkyAPIError("history forbidden", status_code=403)
    fake_client.get_live_fallback_states.return_value = {"time": 1_750_000_001, "states": [live_state]}

    with patch.object(server, "api_client", fake_client):
        payload = handler().handle_flights("LFPG", "2025-06-15", "arrival")

    assert payload["source"] == "live-nearby"
    assert payload["summary"]["total"] == 1
    assert "2025-06-15" in payload["notice"]
    assert "not recorded arrivals" in payload["notice"]
    fake_client.get_live_fallback_states.assert_called_once()


def test_history_fallback_reuses_recent_live_snapshot_when_provider_blips(monkeypatch):
    monkeypatch.setenv("VERCEL", "1")
    live_state = [
        "39abcd", "AFR123 ", "France", 1_750_000_000, 1_750_000_001,
        2.55, 49.01, 9_000, False, 210, 95, 0, None, 9_100, "7000", False, 0, 4,
    ]
    fake_client = Mock()
    fake_client.get_states.return_value = {"time": 1_750_000_001, "states": [live_state]}
    fake_client.get_departures.side_effect = OpenSkyAPIError("history timeout", status_code=502)
    service = handler()

    with patch.object(server, "api_client", fake_client):
        live_payload = service.handle_live_flights(48.7, 2.1, 49.3, 3.0)
        fake_client.get_states.side_effect = OpenSkyAPIError("live provider timeout", status_code=503)
        fake_client.get_live_fallback_states.side_effect = OpenSkyAPIError("live provider timeout", status_code=503)
        history_payload = service.handle_flights("LFPG", "2026-09-09", "departure")

    assert live_payload["count"] == 1
    assert history_payload["source"] == "live-nearby"
    assert history_payload["summary"]["total"] == 1
    assert fake_client.get_states.call_count == 1
    fake_client.get_live_fallback_states.assert_called_once()


def test_live_flights_validates_bounds():
    with pytest.raises(ValueError, match="ordering"):
        handler().handle_live_flights(50, 3, 49, 2)


def test_live_flights_normalizes_state_vectors():
    state = ["39abcd", "AFR123 ", "France", 100, 101, 2.5, 49.0, 9000, False, 230, 90, 0, None, 9100, "1234", False, 0, 4]
    fake_client = Mock()
    fake_client.get_states.return_value = {"time": 101, "states": [state]}
    with patch.object(server, "api_client", fake_client):
        payload = handler().handle_live_flights(48, 2, 50, 3)
    assert payload["count"] == 1
    assert payload["states"][0]["callsign"] == "AFR123"
    assert payload["states"][0]["category"] == 4
    assert payload["states"][0]["data_source"] == "live-nearby"


def test_live_flights_exposes_provider_and_aircraft_profile_metadata():
    state = [
        "39abcd", "AFR123 ", "France", 100, 101, 2.5, 49.0, 9000, False, 230, 90, 0,
        None, 9100, "1234", False, 0, "A5",
        {"registration": "F-HABC", "aircraft_type": "A359", "aircraft_owner": "Air France", "messages": 1234},
    ]
    fake_client = Mock()
    fake_client.get_states.return_value = {
        "time": 101,
        "states": [state],
        "provider": "opensky",
        "credit_cost": 2,
        "refresh_after_seconds": 60,
    }
    with patch.object(server, "api_client", fake_client):
        payload = handler().handle_live_flights(48, 2, 50, 3)

    assert payload["provider"] == "opensky"
    assert payload["credit_cost"] == 2
    assert payload["refresh_after_seconds"] == 60
    assert payload["states"][0]["registration"] == "F-HABC"
    assert payload["states"][0]["aircraft_type"] == "A359"


def test_flight_info_resolves_live_route_from_callsign_when_history_is_empty():
    live_state = [
        "39abcd", "AFR123 ", "France", 100, 101, 2.7, 49.1, 8400, False, 220, 72, 0,
        None, 8500, "7000", False, 0, 4,
    ]
    fake_client = Mock()
    fake_client.get_states.return_value = {"states": [live_state]}
    fake_client.get_flights_by_aircraft.return_value = []
    fake_client.get_callsign_route.return_value = {
        "callsign": "AFR123",
        "airline_code": "AFR",
        "airline_name": "Air France",
        "departure_airport": "LFPG",
        "departure_airport_name": "Charles de Gaulle International Airport",
        "arrival_airport": "RKSI",
        "arrival_airport_name": "Incheon International Airport",
        "route_source": "callsign",
        "route_provider": "ADSBDB",
    }

    with patch.object(server, "api_client", fake_client):
        payload = handler().handle_flight_info("39abcd")

    assert payload["callsign"] == "AFR123"
    assert payload["departure_airport"] == "LFPG"
    assert payload["arrival_airport"] == "RKSI"
    assert payload["route_source"] == "callsign"
    assert payload["route_provider"] == "ADSBDB"
    fake_client.get_callsign_route.assert_called_once_with("AFR123")


def test_flight_info_uses_browser_callsign_before_slow_opensky_sources():
    fake_client = Mock()
    fake_client.get_callsign_route.return_value = {
        "callsign": "AFR123",
        "airline_code": "AFR",
        "airline_name": "Air France",
        "departure_airport": "LFPG",
        "departure_airport_name": "Charles de Gaulle International Airport",
        "arrival_airport": "RKSI",
        "arrival_airport_name": "Incheon International Airport",
        "route_source": "callsign",
        "route_provider": "ADSBDB",
    }

    with patch.object(server, "api_client", fake_client):
        payload = handler().handle_flight_info("39abcd", "AFR123")

    assert payload["route_source"] == "callsign"
    fake_client.get_states.assert_not_called()
    fake_client.get_flights_by_aircraft.assert_not_called()


def test_flight_info_uses_flightaware_route_and_operations_when_other_routes_are_empty():
    fake_client = Mock()
    fake_client.get_aircraft_profile.return_value = None
    fake_client.get_callsign_route.return_value = None
    fake_client.get_flightaware_details.return_value = {
        "provider": "FlightAware",
        "ident": "AFR123",
        "status": "En Route",
        "origin": {"code_icao": "LFPG", "name": "Paris Charles de Gaulle"},
        "destination": {"code_icao": "EGLL", "name": "London Heathrow"},
        "progress_percent": 58,
        "scheduled_out": "2026-09-12T08:00:00Z",
        "estimated_in": "2026-09-12T10:00:00Z",
    }

    with patch.object(server, "api_client", fake_client):
        payload = handler().handle_flight_info("39abcd", "AFR123")

    assert payload["route_source"] == "flightaware"
    assert payload["route_provider"] == "FlightAware"
    assert payload["departure_airport"] == "LFPG"
    assert "Charles de Gaulle" in payload["departure_airport_name"]
    assert payload["arrival_airport"] == "EGLL"
    assert "Heathrow" in payload["arrival_airport_name"]
    assert payload["flightaware"]["progress_percent"] == 58
    fake_client.get_flightaware_details.assert_called_once_with("AFR123", None)


def test_vercel_live_provider_outage_returns_degraded_success(monkeypatch):
    monkeypatch.setenv("VERCEL", "1")
    fake_client = Mock()
    fake_client.get_states.side_effect = OpenSkyAPIError("provider timeout", status_code=503)

    with patch.object(server, "api_client", fake_client):
        payload = handler().handle_live_flights(48, 2, 49, 3)

    assert payload["success"] is True
    assert payload["degraded"] is True
    assert payload["count"] == 0
    assert payload["states"] == []
    assert payload["notice"]


def test_progressive_live_tile_bypasses_slow_opensky_proxy(monkeypatch):
    monkeypatch.setenv("VERCEL", "1")
    fake_client = Mock()
    fake_client.get_live_fallback_states.return_value = {"time": 1_750_000_001, "states": []}

    with patch.object(server, "api_client", fake_client):
        payload = handler().handle_live_flights(48, 2, 49, 3, fallback_only=True)

    assert payload["success"] is True
    fake_client.get_live_fallback_states.assert_called_once_with(bbox=(48.0, 2.0, 49.0, 3.0))
    fake_client.get_states.assert_not_called()


def test_flight_info_expands_b738_type_code_to_aircraft_name():
    fake_client = Mock()
    fake_client.get_aircraft_profile.return_value = {
        "state": [
            "39abcd", "AFR123", "France", 1, 1, 2.5, 49.0, 9000, False,
            210, 90, 0, None, 9100, "7000", False, 0, 4,
            {"aircraft_type": "B738", "registration": "F-TEST"},
        ]
    }
    fake_client.get_callsign_route.return_value = None
    fake_client.get_flightaware_details.return_value = None

    with patch.object(server, "api_client", fake_client):
        payload = handler().handle_flight_info("39abcd", "AFR123")

    assert payload["aircraft_type"] == "B738"
    assert payload["aircraft_description"] == "Boeing 737-800"


def test_vercel_live_provider_outage_reuses_recent_viewport_snapshot(monkeypatch):
    monkeypatch.setenv("VERCEL", "1")
    live_state = [
        "39abcd", "AFR123 ", "France", 1_750_000_000, 1_750_000_001,
        2.55, 49.01, 9_000, False, 210, 95, 0, None, 9_100, "7000", False, 0, 4,
    ]
    fake_client = Mock()
    fake_client.get_states.return_value = {"time": 1_750_000_001, "states": [live_state]}
    service = handler()

    with patch.object(server, "api_client", fake_client):
        fresh = service.handle_live_flights(48.7, 2.1, 49.3, 3.0)
        fake_client.get_states.side_effect = OpenSkyAPIError("provider timeout", status_code=503)
        degraded = service.handle_live_flights(48.7, 2.1, 49.3, 3.0)

    assert fresh["count"] == 1
    assert degraded["success"] is True
    assert degraded["degraded"] is True
    assert degraded["count"] == 1
    assert degraded["states"][0]["icao24"] == "39abcd"
    assert "last snapshot" in degraded["notice"]


def test_track_returns_graceful_empty_result():
    fake_client = Mock()
    fake_client.get_track.return_value = {}
    fake_client.get_flights_by_aircraft.return_value = []
    with patch.object(server, "api_client", fake_client):
        payload = handler().handle_track("39abcd", "0")
    assert payload["success"] is True
    assert payload["path_count"] == 0
    assert "No track data" in payload["message"]


def test_track_returns_immediately_on_vercel(monkeypatch):
    monkeypatch.setenv("VERCEL", "1")
    fake_client = Mock()
    with patch.object(server, "api_client", fake_client):
        payload = handler().handle_track("39abcd", "0")
    assert payload["success"] is True
    assert payload["path_count"] == 0
    assert "serverless" in payload["message"]
    fake_client.get_track.assert_not_called()
