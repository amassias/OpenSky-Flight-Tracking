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
