import pytest
from unittest.mock import Mock, patch

import requests

from api_client import OpenSkyAPIError, OpenSkyClient


def _json_response(payload, status_code=200):
    response = Mock()
    response.status_code = status_code
    response.content = b"{}"
    response.text = "{}"
    response.headers = {"Content-Type": "application/json"}
    response.json.return_value = payload
    return response


def test_request_falls_back_to_anonymous_when_oauth_is_unreachable(monkeypatch):
    monkeypatch.setenv("OPEN_SKY_CLIENT_ID", "client")
    monkeypatch.setenv("OPEN_SKY_CLIENT_SECRET", "secret")
    client = OpenSkyClient()
    client.session.request = Mock(return_value=_json_response({"states": []}))

    with patch.object(
        client,
        "_get_token",
        side_effect=OpenSkyAPIError(
            "OAuth timed out",
            payload={"authentication_unreachable": True},
        ),
    ):
        result = client.get_states()

    assert result == {"states": []}
    assert client.session.request.call_args.kwargs["headers"] == {}
    assert client.oauth_unavailable_until > 0


def test_invalid_credentials_do_not_fall_back_to_anonymous(monkeypatch):
    monkeypatch.setenv("OPEN_SKY_CLIENT_ID", "client")
    monkeypatch.setenv("OPEN_SKY_CLIENT_SECRET", "secret")
    client = OpenSkyClient()

    with patch.object(
        client,
        "_get_token",
        side_effect=OpenSkyAPIError("Invalid credentials", status_code=401),
    ):
        try:
            client.get_states()
        except OpenSkyAPIError as exc:
            assert exc.status_code == 401
        else:
            raise AssertionError("Invalid credentials should not be hidden by anonymous fallback")


def test_missing_credentials_use_anonymous_access(monkeypatch):
    monkeypatch.delenv("OPEN_SKY_CLIENT_ID", raising=False)
    monkeypatch.delenv("OPEN_SKY_CLIENT_SECRET", raising=False)
    client = OpenSkyClient()
    client.session.request = Mock(return_value=_json_response({"states": []}))

    assert client.get_states() == {"states": []}
    assert client.session.request.call_args.kwargs["headers"] == {}


def test_token_connection_error_is_marked_as_reachable_fallback(monkeypatch):
    monkeypatch.setenv("OPEN_SKY_CLIENT_ID", "client")
    monkeypatch.setenv("OPEN_SKY_CLIENT_SECRET", "secret")
    client = OpenSkyClient()
    client.session.post = Mock(side_effect=requests.Timeout("timed out"))

    try:
        client._get_token()
    except OpenSkyAPIError as exc:
        assert exc.payload == {"authentication_unreachable": True}
    else:
        raise AssertionError("A token timeout should raise OpenSkyAPIError")


def test_vercel_live_states_use_fallback_and_convert_units(monkeypatch):
    monkeypatch.setenv("VERCEL", "1")
    monkeypatch.delenv("OPEN_SKY_PROXY_SECRET", raising=False)
    client = OpenSkyClient()
    response = _json_response(
        {
            "now": 1_750_000_000_000,
            "ac": [
                {
                    "hex": "abc123",
                    "flight": "TEST42 ",
                    "lat": 48.8,
                    "lon": 2.3,
                    "alt_baro": 10_000,
                    "alt_geom": 10_500,
                    "gs": 200,
                    "track": 90,
                    "baro_rate": 500,
                    "seen": 1.2,
                    "seen_pos": 2.4,
                    "squawk": "7000",
                },
                {"hex": "outside", "lat": 60.0, "lon": 2.3},
            ],
        }
    )
    response.raise_for_status = Mock()
    client.session.get = Mock(return_value=response)

    result = client.get_states(bbox=(47.0, 1.0, 50.0, 4.0), extended=True)

    assert result["provider"] == "adsb.lol"
    assert len(result["states"]) == 1
    state = result["states"][0]
    assert state[0] == "abc123"
    assert state[1] == "TEST42"
    assert state[7] == 3048.0
    assert round(state[9], 3) == 102.889
    assert state[10] == 90
    assert state[11] == 2.54
    request_url = client.session.get.call_args.args[0]
    assert request_url.startswith("https://api.adsb.lol/v2/point/")


def test_vercel_live_states_use_authenticated_proxy_for_complete_bbox(monkeypatch):
    monkeypatch.setenv("VERCEL", "1")
    monkeypatch.setenv("OPEN_SKY_PROXY_BASE_URL", "https://deployment.example")
    monkeypatch.setenv("OPEN_SKY_PROXY_SECRET", "internal-secret")
    client = OpenSkyClient()
    client.session.request = Mock(return_value=_json_response({
        "time": 1_750_000_000,
        "states": [["abc123", "WIDE1 ", "France", 1_750_000_000, 1_750_000_000, 7.0, 52.0, 9000, False, 220, 90, 0, None, 9100, "7000", False, 0, 4]],
    }))
    client.session.get = Mock()

    result = client.get_states(bbox=(30.0, -10.0, 60.0, 20.0), extended=True)

    assert result["provider"] == "opensky"
    assert result["credit_cost"] == 4
    assert result["refresh_after_seconds"] >= 100
    client.session.get.assert_not_called()
    call = client.session.request.call_args
    assert call.args[1] == "https://deployment.example/api/opensky-proxy"
    assert call.kwargs["headers"] == {"X-SkyTrace-Proxy-Secret": "internal-secret"}
    assert call.kwargs["params"]["endpoint"] == "/states/all"
    assert call.kwargs["params"]["lamin"] == 30.0


def test_vercel_proxy_anonymous_fallback_marks_safe_cadence(monkeypatch):
    monkeypatch.setenv("VERCEL", "1")
    monkeypatch.setenv("OPEN_SKY_PROXY_BASE_URL", "https://deployment.example")
    monkeypatch.setenv("OPEN_SKY_PROXY_SECRET", "internal-secret")
    client = OpenSkyClient()
    client._make_request = Mock(return_value={
        "time": 1_750_000_000,
        "states": [],
        "_skytrace_auth_mode": "anonymous",
    })

    result = client.get_states(bbox=(30.0, -10.0, 60.0, 20.0), extended=True)

    assert result["provider"] == "opensky-anonymous"
    assert result["credit_cost"] == 4
    assert result["refresh_after_seconds"] >= 864
    assert "_skytrace_auth_mode" not in result


def test_aircraft_profile_keeps_provider_metadata(monkeypatch):
    monkeypatch.setenv("VERCEL", "1")
    monkeypatch.delenv("OPEN_SKY_PROXY_SECRET", raising=False)
    client = OpenSkyClient()
    response = _json_response({
        "now": 1_750_000_000_000,
        "ac": [{
            "hex": "abc123", "flight": "AFR123 ", "lat": 49.1, "lon": 2.7,
            "alt_baro": 28000, "t": "A359", "r": "F-HABC",
            "desc": "AIRBUS A-350-941", "ownOp": "Air France",
            "year": "2020", "category": "A5", "messages": 12345,
            "rssi": -12.5, "seen": 0.7, "seen_pos": 1.2,
        }],
    })
    response.raise_for_status = Mock()
    client.session.get = Mock(return_value=response)

    result = client.get_aircraft_profile("abc123")

    assert result["provider"] == "adsb.lol"
    assert result["profile"]["registration"] == "F-HABC"
    assert result["profile"]["aircraft_type"] == "A359"
    assert result["profile"]["aircraft_owner"] == "Air France"
    assert result["state"][18]["messages"] == 12345


def test_live_viewport_grid_covers_wide_view_and_reuses_a_recent_response(monkeypatch):
    monkeypatch.setenv("VERCEL", "1")
    client = OpenSkyClient()
    response = _json_response({
        "now": 1_750_000_000_000,
        "ac": [{"hex": "abc123", "flight": "WIDE1", "lat": 48.8, "lon": 2.3}],
    })
    response.raise_for_status = Mock()
    client.session.get = Mock(return_value=response)

    bbox = (40.0, -5.0, 55.0, 10.0)
    first = client.get_states(bbox=bbox)
    second = client.get_states(bbox=bbox)

    assert first == second
    assert first["provider"] == "adsb.lol"
    assert first["coverage_tiles"] == 6
    assert first["coverage_complete"] is True
    assert len(first["states"]) == 1
    assert client.session.get.call_count == 6


def test_vercel_uses_private_edge_proxy_for_opensky(monkeypatch):
    monkeypatch.setenv("VERCEL", "1")
    monkeypatch.delenv("VERCEL_URL", raising=False)
    monkeypatch.setenv("OPEN_SKY_PROXY_BASE_URL", "https://deployment.example")
    monkeypatch.setenv("OPEN_SKY_PROXY_SECRET", "internal-secret")
    client = OpenSkyClient()
    client.session.request = Mock(return_value=_json_response([]))

    result = client.get_departures("LFPG", 100, 200)

    assert result == []
    call = client.session.request.call_args
    assert call.args[1] == "https://deployment.example/api/opensky-proxy"
    assert call.kwargs["headers"] == {"X-SkyTrace-Proxy-Secret": "internal-secret"}
    assert call.kwargs["params"] == {
        "endpoint": "/flights/departure",
        "airport": "LFPG",
        "begin": 100,
        "end": 200,
    }


def test_vercel_track_fallback_builds_altitude_path(monkeypatch):
    monkeypatch.setenv("VERCEL", "1")
    client = OpenSkyClient()
    response = _json_response({
        "timestamp": 1_750_000_000.0,
        "trace": [
            [0.0, 48.0, 2.0, "ground", 0, 90, 0, 0, {"flight": "TEST42 "}],
            [60.0, 48.1, 2.1, 10_000, 200, 95, 0, 500],
        ],
    })
    response.raise_for_status = Mock()
    client.session.get = Mock(return_value=response)

    result = client.get_track("abc123", 0)

    assert result["callsign"] == "TEST42"
    assert result["source"] == "adsb.lol"
    assert result["path"] == [
        [1_750_000_000, 48.0, 2.0, 0.0, 90, True],
        [1_750_000_060, 48.1, 2.1, 3048.0, 95, False],
    ]


def test_live_provider_outage_uses_independent_fallback(monkeypatch):
    monkeypatch.setenv("VERCEL", "1")
    client = OpenSkyClient()
    response = _json_response({"ac": [], "now": 1750000000000})
    response.raise_for_status = Mock()
    client.session.get = Mock(side_effect=[requests.HTTPError("503"), response])
    result = client.get_states(bbox=(48, 2, 49, 3))
    assert result["provider"] == "airplanes.live"
    assert result["states"] == []
    assert client.session.get.call_count == 2


def test_all_live_providers_unavailable(monkeypatch):
    monkeypatch.setenv("VERCEL", "1")
    client = OpenSkyClient()
    client.session.get = Mock(side_effect=requests.Timeout("timeout"))
    with pytest.raises(OpenSkyAPIError) as error:
        client.get_states(bbox=(48, 2, 49, 3))
    assert error.value.status_code == 503
    assert client.session.get.call_count == 2


def test_callsign_route_normalizes_origin_and_destination(monkeypatch):
    monkeypatch.delenv("SKYTRACE_ROUTE_API_BASE_URL", raising=False)
    monkeypatch.setenv("SKYTRACE_ROUTE_LOOKUP_ENABLED", "1")
    client = OpenSkyClient()
    response = _json_response({
        "response": {
            "flightroute": {
                "callsign": "AFR123",
                "airline": {"icao": "AFR", "name": "Air France"},
                "origin": {
                    "icao_code": "LFPG", "iata_code": "CDG", "name": "Charles de Gaulle International Airport",
                    "municipality": "Paris", "latitude": 49.0128, "longitude": 2.55,
                },
                "destination": {
                    "icao_code": "RKSI", "iata_code": "ICN", "name": "Incheon International Airport",
                    "municipality": "Seoul", "latitude": 37.4691, "longitude": 126.451,
                },
            }
        }
    })
    client.session.get = Mock(return_value=response)

    result = client.get_callsign_route(" afr123 ")

    assert result["callsign"] == "AFR123"
    assert result["airline_name"] == "Air France"
    assert result["departure_airport"] == "LFPG"
    assert result["arrival_airport"] == "RKSI"
    assert result["route_source"] == "callsign"
    assert result["route_provider"] == "ADSBDB"
    assert client.session.get.call_args.args[0].endswith("/AFR123")


def test_callsign_route_caches_empty_404_response(monkeypatch):
    monkeypatch.setenv("SKYTRACE_ROUTE_LOOKUP_ENABLED", "1")
    client = OpenSkyClient()
    response = _json_response({}, status_code=404)
    client.session.get = Mock(return_value=response)

    assert client.get_callsign_route("UNKNOWN1") is None
    assert client.get_callsign_route("UNKNOWN1") is None
    client.session.get.assert_called_once()


def test_flightaware_details_selects_and_caches_operational_record(monkeypatch):
    monkeypatch.setenv("FLIGHTAWARE_AEROAPI_KEY", "test-flightaware-key")
    monkeypatch.setenv("FLIGHTAWARE_MIN_INTERVAL_SECONDS", "1")
    response = _json_response({
        "flights": [
            {
                "ident": "AFR123",
                "atc_ident": "AFR123",
                "status": "En Route",
                "airline": {"icao": "AFR", "name": "Air France"},
                "origin": {"code_icao": "LFPG", "code_iata": "CDG", "name": "Paris Charles de Gaulle", "city": "Paris"},
                "destination": {"code_icao": "EGLL", "code_iata": "LHR", "name": "London Heathrow", "city": "London"},
                "aircraft_type": "A359",
                "registration": "F-HABC",
                "progress_percent": 64,
                "departure_delay": 300,
                "scheduled_out": "2026-09-12T08:00:00Z",
                "estimated_in": "2026-09-12T10:00:00Z",
                "route": "DCT DVR",
                "cancelled": False,
                "diverted": False,
            },
        ]
    })
    response.raise_for_status = Mock()
    client = OpenSkyClient()
    client.session.get = Mock(return_value=response)

    result = client.get_flightaware_details(" afr123 ", "F-HABC")
    cached = client.get_flightaware_details("AFR123", "F-HABC")

    assert result == cached
    assert result["provider"] == "FlightAware"
    assert result["status"] == "En Route"
    assert result["origin"]["code_icao"] == "LFPG"
    assert result["destination"]["code_iata"] == "LHR"
    assert result["progress_percent"] == 64
    assert result["departure_delay"] == 300
    assert result["route"] == "DCT DVR"
    assert client.session.get.call_count == 1
    assert client.session.get.call_args.kwargs["headers"]["x-apikey"] == "test-flightaware-key"
    assert client.session.get.call_args.args[0].endswith("/AFR123")


def test_flightaware_missing_key_is_a_noop(monkeypatch):
    monkeypatch.delenv("FLIGHTAWARE_AEROAPI_KEY", raising=False)
    client = OpenSkyClient()
    client.session.get = Mock()

    assert client.get_flightaware_details("AFR123") is None
    client.session.get.assert_not_called()
