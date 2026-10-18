import time

import pytest
from unittest.mock import Mock, patch

import requests

from backend.api_client import OpenSkyAPIError, OpenSkyClient


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

    assert result["provider"] == "adsb.fi"
    assert len(result["states"]) == 1
    state = result["states"][0]
    assert state[0] == "abc123"
    assert state[1] == "TEST42"
    assert state[7] == 3048.0
    assert round(state[9], 3) == 102.889
    assert state[10] == 90
    assert state[11] == 2.54
    request_url = client.session.get.call_args.args[0]
    assert request_url.startswith("https://opendata.adsb.fi/api/v3/lat/")


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

    assert result["provider"] == "adsb.fi"
    assert result["profile"]["registration"] == "F-HABC"
    assert result["profile"]["aircraft_type"] == "A359"
    assert result["profile"]["aircraft_owner"] == "Air France"
    assert result["state"][18]["messages"] == 12345


def test_live_viewport_grid_covers_wide_view_and_reuses_a_recent_response(monkeypatch):
    monkeypatch.setenv("VERCEL", "1")
    monkeypatch.setenv("SKYTRACE_LIVE_TILE_INTERVAL_SECONDS", "0")
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
    assert first["provider"] == "adsb.fi"
    assert first["coverage_tiles"] == 6
    assert first["coverage_complete"] is True
    assert len(first["states"]) == 1
    assert client.session.get.call_count == 6


def test_live_viewport_stops_fanning_out_when_both_providers_are_down(monkeypatch):
    monkeypatch.setenv("VERCEL", "1")
    monkeypatch.setenv("SKYTRACE_LIVE_TILE_INTERVAL_SECONDS", "0")
    monkeypatch.setenv("SKYTRACE_LIVE_FAILURE_BREAK_COUNT", "2")
    client = OpenSkyClient()
    response = _json_response({}, status_code=503)
    response.raise_for_status = Mock()
    client.session.get = Mock(return_value=response)

    with pytest.raises(OpenSkyAPIError) as error:
        client.get_states(bbox=(20.0, -30.0, 60.0, 30.0))

    assert error.value.status_code == 503
    # A wide viewport may produce many safe cells, but two consecutive
    # upstream failures per provider are enough; only the two public providers are tried.
    assert client.session.get.call_count == 4


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
    monkeypatch.setattr(time, "time", lambda: 1_750_000_060)
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
    assert result["source"] == "theairtraffic.com"
    assert result["trace_kind"] == "full"
    assert "trace_full_abc123.json" in client.session.get.call_args.args[0]
    assert result["path"] == [
        [1_750_000_000, 48.0, 2.0, 0.0, 90, True],
        [1_750_000_060, 48.1, 2.1, 3048.0, 95, False],
    ]


@pytest.mark.parametrize("details", [{"flight": "TEST42"}, {"flight": "TEST42", "squawk": "7700"}])
def test_trace_metadata_preserves_aircraft_identity_and_cache(monkeypatch, details):
    monkeypatch.setenv("VERCEL", "1")
    client = OpenSkyClient()
    client.session.get = Mock(return_value=_json_response({
        "timestamp": time.time(),
        "trace": [[0, 48, 2, 10000, 200, 90, 0, 0, details]],
    }))
    result = client.get_track("abc123", 0)
    assert result["icao24"] == "abc123"
    assert client.get_track("abc123", 0) == result
    assert client.session.get.call_count == 1


def test_current_trace_tries_recent_when_full_file_is_stale(monkeypatch):
    monkeypatch.setenv("VERCEL", "1")
    client = OpenSkyClient()
    now = time.time()
    client.session.get = Mock(side_effect=[
        _json_response({"timestamp": now - 3600, "trace": [[0, 48, 2, 10000, 200, 90]]}),
        _json_response({"timestamp": now, "trace": [[0, 49, 3, 12000, 220, 90]]}),
    ])
    result = client.get_track("abc123", 0)
    assert result["trace_kind"] == "full"
    assert len(result["path"]) == 2
    assert result["endTime"] == int(now)
    assert client.session.get.call_count == 2



def test_stale_full_trace_cannot_hide_recent_provider_outage(monkeypatch):
    monkeypatch.setenv("VERCEL", "1")
    client = OpenSkyClient()
    client.session.get = Mock(side_effect=[
        _json_response({"timestamp": time.time() - 3600, "trace": [[0, 48, 2, 10000, 200, 90]]}),
        requests.Timeout("unavailable"), requests.Timeout("unavailable"), requests.Timeout("unavailable"),
    ])
    with pytest.raises(OpenSkyAPIError) as error:
        client.get_track("abc123", 0)
    assert error.value.status_code == 503


def test_cold_live_request_starts_with_reachable_provider(monkeypatch):
    monkeypatch.setenv("VERCEL", "1")
    monkeypatch.delenv("OPEN_SKY_PROXY_SECRET", raising=False)
    client = OpenSkyClient()
    client.session.get = Mock(return_value=_json_response({"now": time.time(), "aircraft": []}))
    client.get_states(bbox=(48, 2, 49, 3))
    assert "opendata.adsb.fi" in client.session.get.call_args.args[0]


def test_track_falls_back_to_recent_when_full_trace_is_missing(monkeypatch):
    monkeypatch.setattr(time, "time", lambda: 1_750_000_000)
    monkeypatch.setenv("VERCEL", "1")
    client = OpenSkyClient()
    missing = _json_response({}, status_code=404)
    recent = _json_response({
        "timestamp": 1_750_000_000.0,
        "trace": [[0.0, 48.0, 2.0, 12_000, 220, 90]],
    })
    recent.raise_for_status = Mock()
    client.session.get = Mock(side_effect=[missing, recent])

    result = client.get_track("abc123", 0)

    assert result["trace_kind"] == "recent"
    assert client.session.get.call_count == 2
    assert "trace_recent_abc123.json" in client.session.get.call_args_list[1].args[0]


def test_live_provider_outage_uses_independent_fallback(monkeypatch):
    monkeypatch.setenv("VERCEL", "1")
    client = OpenSkyClient()
    response = _json_response({"ac": [], "now": 1750000000000})
    response.raise_for_status = Mock()
    client.session.get = Mock(side_effect=[requests.HTTPError("503"), response])
    result = client.get_states(bbox=(48, 2, 49, 3))
    assert result["provider"] == "adsb.lol"
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


def test_failed_provider_is_tried_last_on_next_viewport(monkeypatch):
    monkeypatch.setenv("VERCEL", "1")
    monkeypatch.setenv("SKYTRACE_LIVE_TILE_INTERVAL_SECONDS", "0")
    client = OpenSkyClient()
    urls = []

    def fake_get(url, **_kwargs):
        urls.append(url)
        if "api.adsb.lol" in url:
            return _json_response({"now": 1000.5, "aircraft": [{"hex": "abc123", "lat": 48.5, "lon": 2.5, "alt_baro": 3000}]})
        raise requests.Timeout("down")

    client.session.get = Mock(side_effect=fake_get)
    result = client.get_states(bbox=(48, 2, 49, 3))
    assert result["provider"] == "adsb.lol"
    assert [state[0] for state in result["states"]] == ["abc123"]
    assert "opendata.adsb.fi/api/v3/lat/" in urls[0]
    assert "api.adsb.lol" in urls[-1]

    urls.clear()
    client._live_cache.clear()
    client._live_provider_unavailable_until = 0.0
    client.get_states(bbox=(48, 2, 49, 3))
    assert "api.adsb.lol" in urls[0]  # providers that just failed no longer go first


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


def test_aircraft_profile_reuses_the_map_live_cache(monkeypatch):
    import time as time_module

    client = OpenSkyClient()
    client.session.get = Mock(side_effect=AssertionError("provider must not be called"))
    row = ["398604", "AFR28VV ", "France", 1, 1, 2.5, 49.0, 9000, False, 200, 90, 0, None, 9100, "1000", False, 0, 3,
           {"registration": "F-HBQE", "aircraft_type": "E190"}]
    client._live_cache["box"] = {"fetched_at": time_module.time(), "result": {"states": [row]}}

    profile = client.get_aircraft_profile("398604")

    assert profile["provider"] == "cache"
    assert profile["profile"]["registration"] == "F-HBQE"


def test_aircraft_profile_ignores_stale_cache():
    client = OpenSkyClient()
    row = ["398604", "AFR28VV", "France", 1, 1, 2.5, 49.0, 9000, False, 200, 90, 0, None, 9100, "1000", False, 0, 3, {"registration": "F-HBQE"}]
    client._live_cache["old"] = {"fetched_at": 0, "result": {"states": [row]}}
    assert client._recent_live_row("398604") is None


def _iso(seconds_from_now: float) -> str:
    return time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime(time.time() + seconds_from_now))


def test_flightaware_prefers_todays_leg_over_yesterdays_arrival():
    # A real case: BAW33 had just taken off while FlightAware also listed
    # yesterday's BAW33, arrived, which used to win and read "100% flown".
    yesterday = {
        "ident": "BAW33", "atc_ident": "BAW33", "status": "Arrived / Gate Arrival", "progress_percent": 100,
        "scheduled_out": _iso(-24 * 3600), "actual_out": _iso(-24 * 3600), "actual_in": _iso(-12 * 3600),
    }
    today = {
        "ident": "BAW33", "atc_ident": "BAW33", "status": "En Route / On Time", "progress_percent": 1,
        "scheduled_out": _iso(-600), "actual_out": _iso(-900), "estimated_in": _iso(12 * 3600),
    }
    picked = OpenSkyClient._pick_flightaware_flight({"flights": [yesterday, today]}, "BAW33")
    assert picked is today


def test_flightaware_keeps_a_fresh_arrival_over_tomorrows_schedule():
    arrived = {"ident": "BAW33", "atc_ident": "BAW33", "status": "Arrived", "actual_out": _iso(-13 * 3600), "actual_in": _iso(-600)}
    tomorrow = {"ident": "BAW33", "atc_ident": "BAW33", "status": "Scheduled", "scheduled_out": _iso(20 * 3600)}
    picked = OpenSkyClient._pick_flightaware_flight({"flights": [tomorrow, arrived]}, "BAW33")
    assert picked is arrived


def test_global_emergency_feed_is_cached_and_excludes_stale_or_regular_codes():
    client = OpenSkyClient()
    now = 1_800_000_000
    response = _json_response({"now": now * 1000, "ac": [
        {"hex": "abc123", "flight": "TEST1", "squawk": "7700", "seen": 1, "lat": 49, "lon": 2},
        {"hex": "abc124", "squawk": "7600", "seen": 180},
        {"hex": "abc125", "squawk": "2021", "seen": 1},
    ]})
    client.session.get = Mock(return_value=response)
    with patch("backend.api_client.time.time", return_value=now):
        first = client.get_emergency_states()
        second = client.get_emergency_states()
    assert len(first["states"]) == 1
    assert first == second
    assert first["states"][0][0] == "abc123"
    client.session.get.assert_called_once()


def test_global_emergency_feed_rejects_an_old_snapshot():
    client = OpenSkyClient()
    client.session.get = Mock(return_value=_json_response({"now": 1_700_000_000_000, "ac": []}))
    with patch("backend.api_client.time.time", return_value=1_800_000_000), pytest.raises(OpenSkyAPIError):
        client.get_emergency_states()


def test_adsb_trace_keeps_emergency_observations_and_leg_boundary(monkeypatch):
    monkeypatch.setattr(time, "time", lambda: 1_800_000_060)
    monkeypatch.setenv("VERCEL", "1")
    client = OpenSkyClient()
    client.session.get = Mock(return_value=_json_response({"timestamp": 1_800_000_000, "trace": [
        [0, 49, 2, 9000, 200, 90, 2, 0, {"flight": "BAW52T", "squawk": "7700", "emergency": "general"}],
        [30, 49.1, 2.1, 8000, 200, 90, 0, 0, {"flight": "BAW52T", "squawk": "7700"}],
        [60, 49.2, 2.2, 7000, 200, 90, 0, 0, {"flight": "BAW52T", "squawk": "2021", "emergency": "none"}],
    ]}))
    result = client.get_track("abc123", 0)
    assert result["leg_start"] == 1_800_000_000
    assert result["emergency_events"] == [{"code": "7700", "callsign": "BAW52T", "first_seen": 1_800_000_000, "last_seen": 1_800_000_030, "ended_at": 1_800_000_060}]


def test_emergency_feed_retries_a_timeout_and_recovers():
    client = OpenSkyClient()
    now = 1_800_000_000
    client.session.get = Mock(side_effect=[requests.Timeout(), _json_response({"now": now * 1000, "ac": []})])
    with patch("backend.api_client.time.time", return_value=now), patch("backend.api_client.time.sleep"):
        result = client.get_emergency_states()
    assert result["status"] == "fresh"
    assert result["states"] == []
    assert client.session.get.call_count == 2


def test_emergency_failure_keeps_only_a_bounded_last_observation():
    client = OpenSkyClient()
    now = 1_800_000_000
    client.session.get = Mock(return_value=_json_response({"now": now * 1000, "ac": []}))
    with patch("backend.api_client.time.time", return_value=now):
        client.get_emergency_states()
    client.session.get = Mock(side_effect=requests.Timeout())
    with patch("backend.api_client.time.time", return_value=now + 61), patch("backend.api_client.time.sleep"):
        delayed = client.get_emergency_states()
        again = client.get_emergency_states()
    assert delayed["status"] == "delayed"
    assert delayed["time"] == now
    assert delayed == again
    assert client.session.get.call_count == 2  # concurrent/repeated failures respect cooldown
    with patch("backend.api_client.time.time", return_value=now + 301), patch("backend.api_client.time.sleep"), pytest.raises(OpenSkyAPIError):
        client.get_emergency_states()


def test_emergency_rate_limit_is_not_retried_immediately():
    client = OpenSkyClient()
    response = _json_response({}, 429)
    response.headers["Retry-After"] = "120"
    response.raise_for_status.side_effect = requests.HTTPError(response=response)
    client.session.get = Mock(return_value=response)
    with patch("backend.api_client.time.time", return_value=1_800_000_000), pytest.raises(OpenSkyAPIError) as error:
        client.get_emergency_states()
    assert error.value.payload["retry_after_seconds"] == 120
    client.session.get.assert_called_once()


def test_emergency_feed_accepts_seconds_and_rejects_missing_time():
    client = OpenSkyClient()
    now = 1_800_000_000
    client.session.get = Mock(return_value=_json_response({"now": now, "ac": []}))
    with patch("backend.api_client.time.time", return_value=now):
        assert client.get_emergency_states()["observed_at"] == now
    client._emergency_cache = {}
    client.session.get = Mock(return_value=_json_response({"ac": []}))
    with patch("backend.api_client.time.time", return_value=now), patch("backend.api_client.time.sleep"), pytest.raises(OpenSkyAPIError):
        client.get_emergency_states()


def test_emergency_requests_are_shared_across_threads():
    from concurrent.futures import ThreadPoolExecutor
    client = OpenSkyClient()
    now = 1_800_000_000
    client.session.get = Mock(return_value=_json_response({"now": now * 1000, "ac": []}))
    with patch("backend.api_client.time.time", return_value=now), ThreadPoolExecutor(max_workers=4) as pool:
        results = list(pool.map(lambda _: client.get_emergency_states(), range(4)))
    assert all(result["status"] == "fresh" for result in results)
    client.session.get.assert_called_once()


def test_emergency_feed_falls_back_to_individual_codes_and_deduplicates():
    client = OpenSkyClient()
    now = 1_800_000_000
    def get(url, **kwargs):
        if "," in url:
            response = _json_response({}, 400)
            response.raise_for_status.side_effect = requests.HTTPError(response=response)
            return response
        return _json_response({"now": now * 1000, "ac": [
            {"hex": "abc123", "flight": "TEST1", "squawk": "7700", "seen": 1, "lat": 49, "lon": 2},
        ]})
    client.session.get = Mock(side_effect=get)
    with patch("backend.api_client.time.time", return_value=now), patch("backend.api_client.time.sleep"):
        result = client.get_emergency_states()
    assert len(result["states"]) == 1
    assert client.session.get.call_count == 4
    assert {call.args[0].rsplit("/", 1)[-1] for call in client.session.get.call_args_list} == {"7500,7600,7700", "7500", "7600", "7700"}


def test_incomplete_individual_emergency_queries_do_not_claim_empty_skies():
    client = OpenSkyClient()
    def get(url, **kwargs):
        if "," in url:
            return _json_response({"ac": []})  # malformed combined response
        if url.endswith("7500"):
            raise requests.Timeout()
        return _json_response({"now": 1_800_000_000_000, "ac": []})
    client.session.get = Mock(side_effect=get)
    with patch("backend.api_client.time.time", return_value=1_800_000_000), patch("backend.api_client.time.sleep"), pytest.raises(OpenSkyAPIError):
        client.get_emergency_states()


def test_public_traces_never_answer_a_historical_request(monkeypatch):
    monkeypatch.setenv("VERCEL", "1")
    client = OpenSkyClient()
    client.session.get = Mock()
    assert client.get_track("abc123", 1_750_000_000) == {}
    client.session.get.assert_not_called()


def test_live_failover_never_calls_restricted_airplanes_api(monkeypatch):
    monkeypatch.setenv("VERCEL", "1")
    monkeypatch.delenv("OPEN_SKY_PROXY_SECRET", raising=False)
    monkeypatch.setenv("SKYTRACE_LIVE_TILE_INTERVAL_SECONDS", "0")
    client = OpenSkyClient()
    client.session.get = Mock(side_effect=requests.Timeout("unavailable"))
    with pytest.raises(OpenSkyAPIError):
        client.get_states(bbox=(48, 2, 49, 3))
    urls = [call.args[0] for call in client.session.get.call_args_list]
    assert len(urls) == 2
    assert all("airplanes.live" not in url for url in urls)


def test_global_states_use_the_private_proxy_without_a_bounding_box(monkeypatch):
    monkeypatch.setenv("SKYTRACE_GLOBAL_SNAPSHOT_URL", "off")  # opt out of the published snapshot
    monkeypatch.setenv("VERCEL", "1")
    monkeypatch.setenv("OPEN_SKY_PROXY_BASE_URL", "https://deployment.example")
    monkeypatch.setenv("OPEN_SKY_PROXY_SECRET", "internal-secret")
    client = OpenSkyClient()
    client.session.request = Mock(return_value=_json_response({"time": 1_750_000_000, "states": []}))
    client.session.get = Mock()

    result = client.get_global_states()

    assert result["provider"] == "opensky" and result["credit_cost"] == 4
    call = client.session.request.call_args
    assert call.args[1] == "https://deployment.example/api/opensky-proxy"
    assert call.kwargs["headers"] == {"X-SkyTrace-Proxy-Secret": "internal-secret"}
    assert call.kwargs["params"] == {"endpoint": "/states/all", "extended": 1}
    client.session.get.assert_not_called()


def _proxy_client(monkeypatch):
    monkeypatch.setenv("VERCEL", "1")
    monkeypatch.setenv("OPEN_SKY_PROXY_BASE_URL", "https://deployment.example")
    monkeypatch.setenv("OPEN_SKY_PROXY_SECRET", "internal-secret")
    client = OpenSkyClient()
    client._get_public_live_states = Mock(return_value={"provider": "adsb.fi", "states": []})
    return client


def test_an_unreachable_opensky_is_skipped_for_a_while_instead_of_costing_a_timeout_every_time(monkeypatch):
    client = _proxy_client(monkeypatch)
    client.session.request = Mock(side_effect=requests.ConnectTimeout("no route to opensky-network.org"))
    bbox = (48.0, 2.0, 49.0, 3.0)

    first = client.get_states(bbox=bbox)
    second = client.get_states(bbox=bbox)

    assert first["provider"] == second["provider"] == "adsb.fi"
    assert client.session.request.call_count == 1  # the second request never waited on OpenSky


def test_opensky_is_tried_again_once_the_cooldown_has_passed(monkeypatch):
    client = _proxy_client(monkeypatch)
    client.session.request = Mock(side_effect=requests.ConnectTimeout("no route"))
    bbox = (48.0, 2.0, 49.0, 3.0)
    client.get_states(bbox=bbox)

    client._opensky_down_until = 0.0  # the cooldown has elapsed
    client.get_states(bbox=bbox)

    assert client.session.request.call_count == 2


def test_a_rate_limit_is_not_treated_as_an_outage(monkeypatch):
    client = _proxy_client(monkeypatch)
    limited = Mock(status_code=429, headers={}, content=b"x", text="x")
    client.session.request = Mock(return_value=limited)

    client.get_states(bbox=(48.0, 2.0, 49.0, 3.0))

    assert client._opensky_down_until == 0.0


PUBLISHED_URL = "https://example.test/snapshot.json"


def _published_client(monkeypatch, snapshot_age=300):
    monkeypatch.setenv("VERCEL", "1")
    monkeypatch.setenv("SKYTRACE_GLOBAL_SNAPSHOT_URL", PUBLISHED_URL)
    client = OpenSkyClient()
    now = int(time.time())
    client.session.get = Mock(return_value=_json_response({"time": now - snapshot_age, "states": [["abc123"]]}))
    client.session.request = Mock()
    return client


def test_on_vercel_the_world_comes_from_the_published_snapshot_not_from_opensky(monkeypatch):
    client = _published_client(monkeypatch)

    result = client.get_global_states()

    assert client.session.get.call_args.args[0] == PUBLISHED_URL
    client.session.request.assert_not_called()  # Vercel cannot reach OpenSky
    assert result["credit_cost"] == 0 and result["provider"] == "opensky-published"
    assert result["states"] == [["abc123"]]


def test_a_stale_published_snapshot_is_refused_instead_of_shown_as_current(monkeypatch):
    client = _published_client(monkeypatch, snapshot_age=3 * 3600)

    with pytest.raises(OpenSkyAPIError) as error:
        client.get_global_states()
    assert error.value.status_code == 503


def test_the_published_snapshot_is_used_on_vercel_without_any_configuration(monkeypatch):
    monkeypatch.setenv("VERCEL", "1")
    monkeypatch.delenv("SKYTRACE_GLOBAL_SNAPSHOT_URL", raising=False)
    client = OpenSkyClient()
    client.session.get = Mock(return_value=_json_response({"time": int(time.time()), "states": []}))

    client.get_global_states()

    assert "raw.githubusercontent.com/amassias/OpenSky-Flight-Tracking/refs/heads/data/global-snapshot/" in client.session.get.call_args.args[0]


def test_off_vercel_the_world_is_fetched_from_opensky_directly(monkeypatch):
    monkeypatch.delenv("VERCEL", raising=False)
    monkeypatch.delenv("SKYTRACE_GLOBAL_SNAPSHOT_URL", raising=False)
    client = OpenSkyClient()
    client.session.get = Mock()
    client.session.request = Mock(return_value=_json_response({"time": int(time.time()), "states": []}))

    result = client.get_global_states()

    assert result["credit_cost"] == 4
    client.session.get.assert_not_called()


def test_global_states_never_fall_back_to_a_radius_provider(monkeypatch):
    monkeypatch.setenv("SKYTRACE_GLOBAL_SNAPSHOT_URL", "off")  # the proxy path, never the network
    monkeypatch.setenv("VERCEL", "1")
    monkeypatch.setenv("OPEN_SKY_PROXY_BASE_URL", "https://deployment.example")
    monkeypatch.setenv("OPEN_SKY_PROXY_SECRET", "internal-secret")
    client = OpenSkyClient()
    client._make_request = Mock(side_effect=OpenSkyAPIError("down", status_code=503))
    client._get_public_live_states = Mock()

    with pytest.raises(OpenSkyAPIError):
        client.get_global_states()
    client._get_public_live_states.assert_not_called()


def test_adsb_fi_v3_is_used_for_areas_but_callsigns_stay_on_the_endpoint_that_exists(monkeypatch):
    # Measured 2026-10-18: v3 answers lat/lon/dist only; v3 callsign and hex return 400.
    monkeypatch.setenv("VERCEL", "1")
    client = OpenSkyClient()
    response = _json_response({"now": 1_750_000_000_000, "ac": []})
    response.raise_for_status = Mock()
    client.session.get = Mock(return_value=response)

    client.get_live_callsign_states("AFR35BR")

    assert client.session.get.call_args.args[0] == "https://opendata.adsb.fi/api/v2/callsign/AFR35BR"


def _local_feed_client(monkeypatch, aircraft=None):
    monkeypatch.setenv("VERCEL", "1")
    monkeypatch.delenv("SKYTRACE_LIVE_CACHE_SECONDS", raising=False)
    monkeypatch.setenv("SKYTRACE_LIVE_TILE_INTERVAL_SECONDS", "0")
    client = OpenSkyClient()
    response = _json_response({"now": 1_750_000_000_000, "ac": aircraft or []})
    response.raise_for_status = Mock()
    client.session.get = Mock(return_value=response)
    return client


def test_local_feed_asks_to_be_refreshed_every_5_to_10_seconds(monkeypatch):
    client = _local_feed_client(monkeypatch)
    result = client.get_live_fallback_states(bbox=(48.0, 2.0, 49.0, 3.0))
    assert 5 <= result["refresh_after_seconds"] <= 10


def test_local_feed_cache_is_short_and_shared_by_viewports_in_the_same_cell(monkeypatch):
    client = _local_feed_client(monkeypatch)
    clock = [1_000.0]
    monkeypatch.setattr("backend.api_client.time.time", lambda: clock[0])

    client.get_live_fallback_states(bbox=(48.000, 2.000, 49.000, 3.000))
    # A second visitor with a slightly different box lands in the same quantised cell.
    client.get_live_fallback_states(bbox=(48.004, 2.003, 49.003, 3.004))
    assert client.session.get.call_count == 1

    clock[0] += 6  # past the 5 s cache, inside the 5 to 10 s refresh window
    client.get_live_fallback_states(bbox=(48.000, 2.000, 49.000, 3.000))
    assert client.session.get.call_count == 2

    client.get_live_fallback_states(bbox=(52.0, 2.0, 53.0, 3.0))  # another cell
    assert client.session.get.call_count == 3


def test_overlapping_cells_keep_the_newest_fix_per_aircraft(monkeypatch):
    monkeypatch.setenv("VERCEL", "1")
    monkeypatch.setenv("SKYTRACE_LIVE_TILE_INTERVAL_SECONDS", "0")
    client = OpenSkyClient()
    # Same aircraft in overlapping cells: seen 30 s ago, then 2 s ago, then 60 s ago.
    seen = [(48.0, 2.0, 30.0), (48.2, 2.2, 2.0)] + [(47.9, 1.9, 60.0)] * 4
    answers = iter(seen)

    def fake_get(*_args, **_kwargs):
        lat, lon, seen_pos = next(answers)
        return _json_response({"now": 1_750_000_000_000, "ac": [{"hex": "abc123", "lat": lat, "lon": lon, "seen_pos": seen_pos}]})

    client.session.get = Mock(side_effect=fake_get)

    result = client.get_live_fallback_states(bbox=(40.0, -5.0, 55.0, 10.0))

    assert [row[0] for row in result["states"]] == ["abc123"]
    assert result["states"][0][6] == 48.2


def test_each_aircraft_carries_the_label_of_the_feed_that_gave_its_fix(monkeypatch):
    monkeypatch.setenv("VERCEL", "1")
    monkeypatch.setenv("SKYTRACE_LIVE_TILE_INTERVAL_SECONDS", "0")
    client = OpenSkyClient()

    def fake_get(url, **_kwargs):
        if "adsb.fi" in url:
            raise requests.Timeout("down")
        return _json_response({"now": 1_750_000_000_000, "ac": [{"hex": "abc123", "lat": 48.5, "lon": 2.5}]})

    client.session.get = Mock(side_effect=fake_get)
    result = client.get_live_fallback_states(bbox=(48, 2, 49, 3))

    assert result["provider"] == "adsb.lol"
    assert result["states"][0][18]["feed"] == "adsb.lol"


def test_viewport_merge_keeps_absolute_fix_times_across_differently_aged_provider_tiles(monkeypatch):
    monkeypatch.setenv("SKYTRACE_LIVE_TILE_INTERVAL_SECONDS", "0")
    now = 1_800_000_000
    client = OpenSkyClient()
    old = {"now": (now - 60) * 1000, "ac": [
        {"hex": "abc001", "lat": 48.8, "lon": 2.1, "seen": 0, "seen_pos": 0},
        {"hex": "abc002", "lat": 48.8, "lon": 2.2, "seen": 0, "seen_pos": 0},
    ]}
    fresh = {"now": now * 1000, "ac": [
        {"hex": "abc001", "lat": 48.8, "lon": 2.3, "seen": 5, "seen_pos": 5},
    ]}
    client.session.get = Mock(side_effect=[_json_response(old) for _ in range(5)] + [_json_response(fresh)])
    with patch("backend.api_client.time.time", return_value=now):
        result = client.get_live_fallback_states(bbox=(40.0, -5.0, 55.0, 10.0))
    rows = {row[0]: row for row in result["states"]}
    assert rows["abc001"][3] == now - 5
    assert rows["abc001"][5] == 2.3
    assert rows["abc002"][3] == now - 60
