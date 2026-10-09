from unittest.mock import Mock, patch

import pytest

import aircraft_history
import server
from api_client import OpenSkyClient
from registrations import n_number_to_icao24


def handler():
    return object.__new__(server.FlightServerHandler)


@pytest.mark.parametrize("registration, expected", [
    ("N1", "a00001"), ("N99999", "adf7c7"), ("N283VA", "a2dafc"), ("N2501G", "a25a00"), ("N239DC", "a22a3d"), ("n-239dc", "a22a3d"),
])
def test_us_registrations_convert_to_their_icao24(registration, expected):
    assert n_number_to_icao24(registration) == expected


@pytest.mark.parametrize("value", ["F-HBXA", "N0123", "NI123", "N123456", "N12345A", ""])
def test_other_registrations_do_not_convert(value):
    assert n_number_to_icao24(value) is None


def test_history_follows_an_operator_change_between_snapshots():
    result = aircraft_history.airframe_history("3986e0")
    assert result["found"] and result["airframe"]["serial"] == "17000237"
    newest, oldest = result["history"][0], result["history"][-1]
    assert (newest["registration"], newest["operator"], newest["to"], newest["current"]) == ("F-HBXA", "Hop!", None, True)
    assert oldest["from"] == "2020-11" and oldest["operator"] is None
    assert result["snapshots"]["first"] == "2020-11"


def test_history_links_other_registrations_of_the_same_airframe():
    result = aircraft_history.airframe_history("a2dafc")
    assert "a170d9" in result["linked_icao24"]
    registrations = {entry["registration"] for entry in result["history"]}
    assert {"N283VA", "N192NV"} <= registrations
    faa = next(entry for entry in result["history"] if entry["source"] == "faa")
    assert faa["owner"] == "Allegiant Air LLC" and faa["precision"] == "day" and faa["location"] == "Las Vegas, NV"


def test_faa_history_keeps_organisations_and_hides_individuals():
    company = aircraft_history.airframe_history("a22a3d")["history"][0]
    assert company["owner"] == "Utah State University" and company["private"] is False
    # N2719C is registered to an individual: no name, only the state.
    person = next(entry for entry in aircraft_history.airframe_history("a2adc9")["history"] if entry["source"] == "faa")
    assert person["owner"] is None and person["private"] is True and person["location"].endswith("TX")
    blob = repr(aircraft_history.airframe_history("a2adc9"))
    assert "STREET" not in blob.upper()


def test_unknown_airframe_is_reported_as_not_found():
    assert aircraft_history.airframe_history("000000")["found"] is False
    with pytest.raises(ValueError):
        aircraft_history.airframe_history("xyz")


def registry_response(payload, status=200):
    return Mock(status_code=status, json=Mock(return_value=payload))


def test_registry_lookup_normalises_and_caches():
    client = OpenSkyClient()
    client.session = Mock()
    client.session.get.return_value = registry_response({"response": {"aircraft": {
        "mode_s": "3986E0", "registration": "F-HBXA", "type": "EMB-170 STD", "icao_type": "E170", "manufacturer": "Embraer",
        "registered_owner": "Air France HOP", "registered_owner_country_name": "France", "registered_owner_operator_flag_code": "HOP",
        "url_photo": "https://example.invalid/x.jpg",
    }}})
    result = client.get_aircraft_registry("3986e0")
    assert result["icao24"] == "3986e0" and result["owner"] == "Air France HOP" and "url_photo" not in result
    client.get_aircraft_registry("3986E0")
    assert client.session.get.call_count == 1
    client.session.get.return_value = registry_response({"response": "unknown aircraft"})
    assert client.get_aircraft_registry("a2dafc") is None
    client.get_aircraft_registry("a2dafc")
    assert client.session.get.call_count == 2
    assert client.get_aircraft_registry("../etc/passwd") is None


def test_aircraft_flights_use_the_shared_budget_and_cache(monkeypatch):
    monkeypatch.setenv("FLIGHTAWARE_AEROAPI_KEY", "test-key")
    monkeypatch.setenv("SKYTRACE_AEROAPI_HOURLY_PAGES", "1")
    client = OpenSkyClient()
    client.session = Mock()
    client.session.get.return_value = registry_response({"flights": [
        {"ident": "AF1", "ident_iata": "AF1", "origin": {"code_icao": "LFPG"}, "destination": {"code_icao": "KJFK"}, "actual_out": "2026-10-08T10:00:00Z", "scheduled_out": "2026-10-08T09:55:00Z"},
        {"ident": "AF2", "origin": {"code_icao": "KJFK"}, "destination": {"code_icao": "LFPG"}, "actual_out": "2026-10-09T10:00:00Z"},
    ]})
    first = client.get_flightaware_aircraft_flights("F-HBXA")
    assert [flight["ident"] for flight in first["flights"]] == ["AF2", "AF1"]
    assert client.session.get.call_args.args[0].endswith("/flights/FHBXA")
    client.get_flightaware_aircraft_flights("F-HBXA")
    assert client.session.get.call_count == 1
    assert client.get_flightaware_aircraft_flights("G-EUUU")["reason"] == "budget"


def test_server_handlers_resolve_and_validate():
    with patch.object(server.api_client, "get_aircraft_registry", return_value=None):
        assert handler().handle_aircraft_lookup("N283VA")["icao24"] == "a2dafc"
        assert handler().handle_aircraft_lookup("A2DAFC")["icao24"] == "a2dafc"
        with pytest.raises(ValueError):
            handler().handle_aircraft_lookup("F-ZZZZ")
    with patch.object(server.api_client, "get_aircraft_registry", return_value={"registration": "F-HBXA", "owner": "Air France HOP"}):
        payload = handler().handle_aircraft_history("3986e0")
    assert payload["registration"] == "F-HBXA" and "ADSBDB registry" in payload["sources"]
    with pytest.raises(ValueError):
        handler().handle_aircraft_history("nope")
    with pytest.raises(ValueError):
        handler().handle_aircraft_flights("")


@pytest.mark.parametrize("name, us, shown", [
    ("Wilmington Trust Company Trustee", True, True),
    ("Kellar Robert J Trustee", True, False),
    ("Smith John A", True, False),
    ("Allegiant Air LLC", True, True),
    ("Private", True, False),
    ("Air France HOP", False, True),
    ("Jean Dupont", False, True),
])
def test_owner_names_are_filtered_for_us_registrations_only(name, us, shown):
    assert (aircraft_history._shown_owner(name, us) is not None) is shown


def test_faa_builder_keeps_organisations_and_drops_people():
    import importlib.util
    import os

    path = os.path.join(os.path.dirname(__file__), "..", "scripts", "build_faa_registry.py")
    spec = importlib.util.spec_from_file_location("build_faa_registry", path)
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    keep = module.keep_name
    assert keep("DELTA AIR LINES INC", "3") == "Delta Air Lines Inc"
    assert keep("WELLS FARGO BANK NORTHWEST NA TRUSTEE", "") == "Wells Fargo Bank Northwest Na Trustee"
    assert keep("KELLAR ROBERT J TRUSTEE", "") is None
    assert keep("SMITH JOHN A", "1") is None
    assert keep("SMITH FAMILY TRUST", "1") is None
    assert keep("UTAH STATE UNIVERSITY", "5") == "Utah State University"
    assert keep("", "3") is None
