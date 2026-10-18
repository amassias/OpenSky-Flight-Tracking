from unittest.mock import Mock

import pytest
import requests

from backend.aircraft_tracks import AircraftTracks, TraceUnavailable

NOW = 1_800_000_000


def response(payload=None, status=200):
    result = Mock(status_code=status, headers={})
    result.json.return_value = payload
    return result


def trace(age=10, *, code="abc123", callsign="TEST42", altitude=10000):
    return {"icao": code, "timestamp": NOW - age - 30, "trace": [
        [0, 48, 2, altitude, 200, 90, 2, 0, {"flight": callsign, "squawk": "1000"}],
        [30, 48.1, 2.1, altitude + 1000, 200, 90],
    ]}


@pytest.fixture(autouse=True)
def clock(monkeypatch):
    monkeypatch.setattr("backend.aircraft_tracks.time.time", lambda: NOW)
    monkeypatch.setattr("backend.aircraft_tracks.time.sleep", lambda _: None)


def test_independent_source_and_metres_are_returned_and_cached():
    session = Mock()
    session.get.return_value = response(trace())
    client = AircraftTracks(session)
    result = client.get("ABC123", "TEST42")
    assert result["source"] == "theairtraffic.com"
    assert result["icao24"] == "abc123"
    assert result["callsign"] == "TEST42"
    assert result["path"][-1][3] == pytest.approx(3352.8)
    assert client.get("abc123", "TEST42") == result
    session.get.assert_called_once()
    assert session.get.call_args.args[0].startswith("https://globe.theairtraffic.com/data/traces/23/")


def test_secondary_provider_recovers_after_primary_outage():
    session = Mock()
    session.get.side_effect = [requests.Timeout(), requests.Timeout(), response(trace())]
    result = AircraftTracks(session).get("abc123", "TEST42")
    assert result["source"] == "adsb.lol"
    assert "adsb.lol/data/traces" in session.get.call_args.args[0]


def test_recent_points_update_full_trace_without_losing_history():
    full = trace(age=600)
    recent = trace(age=5)
    session = Mock()
    session.get.side_effect = [response(full), response(recent)]
    result = AircraftTracks(session).get("abc123", "TEST42")
    assert len(result["path"]) == 4
    assert result["trace_kind"] == "full"
    assert result["endTime"] == NOW - 5
    assert result["startTime"] == NOW - 630
    assert [p[0] for p in result["path"]] == sorted(p[0] for p in result["path"])


def test_recent_overlap_replaces_duplicate_full_point():
    full = trace(age=70)
    recent = trace(age=40, altitude=12000)
    session = Mock()
    session.get.side_effect = [response(full), response(recent)]
    result = AircraftTracks(session).get("abc123", "TEST42")
    assert len(result["path"]) == 3
    assert result["path"][1][3] == pytest.approx(3657.6)


@pytest.mark.parametrize("bad", [trace(code="aaaaaa"), trace(callsign="OTHER"), trace(age=3600), trace(age=-120)])
def test_wrong_aircraft_flight_or_time_falls_back(bad):
    session = Mock()
    session.get.side_effect = [response(bad), response({}, 404), response(trace())]
    result = AircraftTracks(session).get("abc123", "TEST42")
    assert result["source"] == "adsb.lol"
    assert result["callsign"] == "TEST42"


def test_recent_new_callsign_excludes_previous_leg_points():
    session = Mock()
    session.get.side_effect = [response(trace(age=600, callsign="OLD42")), response(trace(callsign="TEST42"))]
    result = AircraftTracks(session).get("abc123", "TEST42")
    assert result["callsign"] == "TEST42"
    assert result["leg_start"] == NOW - 40


def test_all_missing_is_empty_and_cached_but_outage_is_retryable():
    session = Mock()
    session.get.return_value = response({}, 404)
    client = AircraftTracks(session)
    assert client.get("abc123") == {}
    assert client.get("abc123") == {}
    assert session.get.call_count == 4
    session = Mock()
    session.get.side_effect = requests.Timeout("unavailable")
    with pytest.raises(TraceUnavailable):
        AircraftTracks(session).get("abc123")


def test_access_denial_skips_recent_and_cools_down_only_that_provider():
    session = Mock()
    session.get.side_effect = [response({}, 403), response(trace()), response(trace(code="abc124"))]
    client = AircraftTracks(session)
    assert client.get("abc123")["source"] == "adsb.lol"
    assert client.get("abc124")["source"] == "adsb.lol"
    assert session.get.call_count == 3
    assert "adsb.lol" in session.get.call_args.args[0]


def test_callsign_cache_cannot_reuse_another_flight_on_same_aircraft():
    session = Mock()
    session.get.side_effect = [response(trace()), response(trace(callsign="NEXT42"))]
    client = AircraftTracks(session)
    client.get("abc123", "TEST42")
    assert client.get("abc123", "NEXT42")["callsign"] == "NEXT42"
    assert session.get.call_count == 2


def test_malformed_points_do_not_break_good_observations():
    payload = trace()
    payload["trace"] += [["bad", 48, 2, 1000, 200, 90], [31, 95, 2, 1000, 200, 90], [32, 48, float("nan"), 1000, 200, 90]]
    session = Mock()
    session.get.return_value = response(payload)
    result = AircraftTracks(session).get("abc123")
    assert len(result["path"]) == 2
