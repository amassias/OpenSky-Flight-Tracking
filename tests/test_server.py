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
    fake_client.get_states.return_value = {"time": 1_750_000_001, "states": [live_state]}

    with patch.object(server, "api_client", fake_client):
        payload = handler().handle_flights("LFPG", today, "departure")

    assert payload["success"] is True
    assert payload["source"] == "live-nearby"
    assert payload["notice"]
    assert payload["summary"]["total"] == 1
    assert payload["flights"][0]["data_source"] == "live-nearby"
    assert payload["flights"][0]["departure_airport"] is None
    fake_client.get_states.assert_called_once()


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
