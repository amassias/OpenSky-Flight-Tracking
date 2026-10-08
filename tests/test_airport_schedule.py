from unittest.mock import Mock, patch

import pytest

import server
from api_client import OpenSkyClient

# Shaped like AeroAPI v4 GET /airports/{id}/flights/scheduled_arrivals.
ARRIVAL = {
    "ident": "AFR1234", "ident_icao": "AFR1234", "ident_iata": "AF1234", "atc_ident": "AFR1234",
    "fa_flight_id": "AFR1234-1-0", "operator": "AFR", "operator_icao": "AFR", "flight_number": "1234",
    "registration": "F-HBXA", "codeshares_iata": ["KL2004", "DL8401"],
    "origin": {"code": "EDDB", "code_icao": "EDDB", "code_iata": "BER", "name": "Berlin Brandenburg", "city": "Berlin", "timezone": "Europe/Berlin"},
    "destination": {"code": "LFPG", "code_icao": "LFPG", "code_iata": "CDG", "name": "Charles de Gaulle", "city": "Paris", "timezone": "Europe/Paris"},
    "departure_delay": 600, "arrival_delay": 420, "progress_percent": 64, "status": "En Route / Delayed",
    "aircraft_type": "A320", "route_distance": 545, "cancelled": False, "diverted": False,
    "scheduled_out": "2026-10-09T07:00:00Z", "estimated_out": "2026-10-09T07:10:00Z", "actual_out": "2026-10-09T07:10:00Z",
    "scheduled_on": "2026-10-09T08:35:00Z", "estimated_on": "2026-10-09T08:42:00Z",
    "scheduled_in": "2026-10-09T08:45:00Z", "estimated_in": "2026-10-09T08:52:00Z",
    "gate_origin": "B12", "gate_destination": "K45", "terminal_origin": "1", "terminal_destination": "2F", "baggage_claim": "25",
}


def client_with(response, monkeypatch):
    monkeypatch.setenv("FLIGHTAWARE_AEROAPI_KEY", "test-key")
    client = OpenSkyClient()
    client.session = Mock()
    client.session.get.return_value = response
    return client


def ok(payload):
    return Mock(status_code=200, json=Mock(return_value=payload))


def test_schedule_normalises_aeroapi_fields_and_seeds_the_flight_cache(monkeypatch):
    client = client_with(ok({"scheduled_arrivals": [ARRIVAL], "links": None, "num_pages": 1}), monkeypatch)
    result = client.get_flightaware_airport_schedule("LFPG", "arrival")
    flight = result["flights"][0]
    assert result["available"] is True
    assert flight["gate_dest"] == "K45" and flight["terminal_dest"] == "2F" and flight["baggage_claim"] == "25"
    assert flight["ident_iata"] == "AF1234" and flight["codeshares_iata"] == ["KL2004", "DL8401"]
    assert flight["progress_percent"] == 64 and flight["route_distance"] == 545
    params = client.session.get.call_args.kwargs["params"]
    assert params["max_pages"] == 1 and params["type"] == "Airline"
    assert client.session.get.call_args.args[0].endswith("/airports/LFPG/flights/scheduled_arrivals")

    # Cached for ten minutes, and the selected-aircraft lookup reuses the record.
    client.get_flightaware_airport_schedule("LFPG", "arrival")
    assert client.get_flightaware_details("AFR1234")["gate_dest"] == "K45"
    assert client.session.get.call_count == 1


def test_schedule_respects_the_page_budget(monkeypatch):
    monkeypatch.setenv("SKYTRACE_AEROAPI_HOURLY_PAGES", "1")
    client = client_with(ok({"scheduled_departures": []}), monkeypatch)
    assert client.get_flightaware_airport_schedule("LFPG", "departure")["available"] is True
    blocked = client.get_flightaware_airport_schedule("EGLL", "departure")
    assert blocked == {"available": False, "reason": "budget", "flights": []}
    assert client.session.get.call_count == 1
    assert client.flightaware_budget_state()["hour_pages"] == 1


def test_schedule_without_a_key_makes_no_request(monkeypatch):
    monkeypatch.delenv("FLIGHTAWARE_AEROAPI_KEY", raising=False)
    client = OpenSkyClient()
    client.session = Mock()
    assert client.get_flightaware_airport_schedule("LFPG", "arrival")["reason"] == "unconfigured"
    client.session.get.assert_not_called()


def test_schedule_keeps_the_last_board_through_a_provider_error(monkeypatch):
    client = client_with(ok({"scheduled_arrivals": [ARRIVAL]}), monkeypatch)
    client.get_flightaware_airport_schedule("LFPG", "arrival")
    client._flightaware_schedule_cache["LFPG:scheduled_arrivals"]["fetched_at"] -= 700
    client.session.get.return_value = Mock(status_code=503)
    stale = client.get_flightaware_airport_schedule("LFPG", "arrival")
    assert stale["stale"] is True and stale["flights"][0]["ident"] == "AFR1234"


def test_schedule_endpoint_names_airlines_and_validates_direction():
    handler = object.__new__(server.FlightServerHandler)
    with patch.object(server.api_client, "get_flightaware_airport_schedule", return_value={"available": True, "flights": [{"ident_icao": "AFR1234"}]}):
        payload = handler.handle_airport_schedule("lfpg", "arrival")
    assert payload["airport"] == "LFPG" and payload["flights"][0]["airline_name"] == "Air France"
    with pytest.raises(ValueError):
        handler.handle_airport_schedule("LFPG", "sideways")


def test_budget_month_key_rolls_over(monkeypatch):
    client = OpenSkyClient()
    client._flightaware_pages = {"m2020-01": 9999, "h2020-01-01T00": 9999}
    assert client._flightaware_budget_allows(1)
    assert "m2020-01" not in client._flightaware_pages


def test_operator_codes_are_not_used_as_airline_names(monkeypatch):
    client = client_with(ok({"scheduled_arrivals": [ARRIVAL]}), monkeypatch)
    flight = client.get_flightaware_airport_schedule("LFPG", "arrival")["flights"][0]
    assert flight["airline_code"] == "AFR" and "airline_name" not in flight
    handler = object.__new__(server.FlightServerHandler)
    with patch.object(server.api_client, "get_flightaware_airport_schedule", return_value={"available": True, "flights": [flight]}):
        assert handler.handle_airport_schedule("LFPG", "arrival")["flights"][0]["airline_name"] == "Air France"
