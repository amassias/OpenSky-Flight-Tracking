"""Contract of the Global snapshot endpoint (issue #13, ADR 0008).

The seam is the HTTP route plus the upstream OpenSky call, which is replaced by
a fake. Time is injected, so cadence and budget are tested without sleeping.
"""
import json

import pytest
from fastapi.testclient import TestClient

from api import index
from backend import server
from backend.api_client import OpenSkyAPIError
from backend.global_snapshot import GlobalSnapshot

NOW = 1_750_000_000


def opensky_row(icao24="abc123", lat=48.85612, lon=2.35223, time_position=NOW - 12):
    return [icao24, "AFR1234 ", "France", time_position, NOW - 5, lon, lat, 10668.0, False,
            231.456, 87.6, 0.0, None, 10700.0, "7000", False, 0, 4]


def upstream(rows, provider="opensky"):
    return {"time": NOW, "states": rows, "provider": provider, "credit_cost": 4}


class Clock:
    def __init__(self):
        self.now = float(NOW)

    def __call__(self):
        return self.now


class FakeUpstream:
    def __init__(self, *responses):
        self.responses = list(responses)
        self.calls = 0

    def __call__(self):
        self.calls += 1
        result = self.responses.pop(0) if len(self.responses) > 1 else self.responses[0]
        if isinstance(result, Exception):
            raise result
        return result


@pytest.fixture
def client_with(monkeypatch):
    def build(fake, clock=None, **kwargs):
        monkeypatch.setattr(server, "_global_snapshot", GlobalSnapshot(fake, clock=clock or Clock(), **kwargs))
        return TestClient(index.app)
    return build


def test_payload_is_compact_with_source_and_fix_age(client_with):
    client = client_with(FakeUpstream(upstream([opensky_row()])))

    response = client.get("/api/global-snapshot")

    assert response.status_code == 200
    payload = response.json()
    assert payload["success"] is True
    assert payload["provider"] == "opensky"
    assert payload["time"] == NOW
    assert payload["count"] == 1
    aircraft = dict(zip(payload["fields"], payload["aircraft"][0]))
    assert aircraft["icao24"] == "abc123"
    assert aircraft["callsign"] == "AFR1234"
    assert aircraft["latitude"] == 48.856 and aircraft["longitude"] == 2.352
    assert aircraft["source"] == "adsb"
    assert aircraft["fix_age"] == 12
    assert aircraft["on_ground"] == 0


def test_aircraft_without_position_are_dropped_and_unknown_fix_age_stays_unknown(client_with):
    rows = [opensky_row("aaa111", lat=None), opensky_row("bbb222", time_position=None)]
    payload = client_with(FakeUpstream(upstream(rows))).get("/api/global-snapshot").json()

    assert payload["count"] == 1
    aircraft = dict(zip(payload["fields"], payload["aircraft"][0]))
    assert aircraft["icao24"] == "bbb222"
    assert aircraft["fix_age"] is None


def test_response_is_gzip_compressed_when_large(client_with):
    rows = [opensky_row(f"{i:06x}", lat=10 + i % 50, lon=i % 90) for i in range(2000)]
    client = client_with(FakeUpstream(upstream(rows)))

    response = client.get("/api/global-snapshot", headers={"Accept-Encoding": "gzip"})

    assert response.headers["content-encoding"] == "gzip"
    assert response.json()["count"] == 2000


def test_only_the_snapshot_route_is_compressed(client_with):
    client = client_with(FakeUpstream(upstream([opensky_row()])))

    # /api/map-airports is a large static catalogue; the platform compresses it, this app must not.
    response = client.get("/api/map-airports", headers={"Accept-Encoding": "gzip"})

    assert response.status_code == 200
    assert len(response.content) > 1024
    assert "content-encoding" not in response.headers


def test_cdn_shares_one_answer_between_visitors(client_with):
    response = client_with(FakeUpstream(upstream([opensky_row()]))).get("/api/global-snapshot")

    cache = response.headers["cache-control"]
    assert "public" in cache
    assert "s-maxage=60" in cache
    assert "stale-while-revalidate" in cache


def test_visitors_share_one_upstream_call_within_the_cadence(client_with):
    clock = Clock()
    fake = FakeUpstream(upstream([opensky_row()]))
    client = client_with(fake, clock)

    for _ in range(5):
        client.get("/api/global-snapshot")
        clock.now += 20

    assert fake.calls == 1


def test_cadence_keeps_the_daily_credit_budget_with_margin():
    snapshot = GlobalSnapshot(FakeUpstream(upstream([])), clock=Clock())
    calls_per_day = 86_400 / snapshot.refresh_seconds
    assert calls_per_day * 4 <= 3_000
    assert calls_per_day * 4 < 4_000  # free tier, with margin


def test_refreshes_after_the_cadence_and_never_exceeds_the_daily_budget():
    clock = Clock()
    clock.now = (NOW // 86_400) * 86_400 + 100  # early in a UTC day
    fake = FakeUpstream(upstream([opensky_row()]))
    # Cadence forced below what the budget allows: the budget is the hard stop.
    snapshot = GlobalSnapshot(fake, clock=clock, daily_budget=12, refresh_seconds=10)  # three calls

    served = []
    for _ in range(20):
        served.append(snapshot.get())
        clock.now += 11

    assert fake.calls == 3
    assert all(item["count"] == 1 for item in served)
    assert served[-1]["degraded"] is True
    assert "budget" in served[-1]["notice"].lower()


def test_budget_resets_with_the_utc_day():
    clock = Clock()
    clock.now = (NOW // 86_400) * 86_400 + 100
    fake = FakeUpstream(upstream([opensky_row()]))
    snapshot = GlobalSnapshot(fake, clock=clock, daily_budget=4, refresh_seconds=10)

    snapshot.get()
    clock.now += 11
    assert snapshot.get()["degraded"] is True
    clock.now += 86_400
    assert snapshot.get().get("degraded") is not True
    assert fake.calls == 2


def test_last_snapshot_is_kept_with_its_age_when_opensky_fails(client_with):
    clock = Clock()
    fake = FakeUpstream(upstream([opensky_row()]), OpenSkyAPIError("boom", status_code=429))
    client = client_with(fake, clock)
    client.get("/api/global-snapshot")
    clock.now += 130

    response = client.get("/api/global-snapshot")

    payload = response.json()
    assert response.status_code == 200
    assert payload["count"] == 1
    assert payload["degraded"] is True
    assert payload["age_seconds"] == 130
    # A CDN may serve this answer later: the notice carries no relative age, the snapshot `time` is absolute.
    assert " s ago" not in payload["notice"]
    assert payload["time"] == NOW
    assert "s-maxage=60" not in response.headers["cache-control"]


def test_failure_without_any_snapshot_is_an_error_not_an_empty_map(client_with):
    client = client_with(FakeUpstream(OpenSkyAPIError("down", status_code=503)))

    response = client.get("/api/global-snapshot")

    assert response.status_code == 503
    assert response.json()["success"] is False


def test_credentials_never_reach_the_browser(client_with, monkeypatch):
    monkeypatch.setenv("OPEN_SKY_CLIENT_SECRET", "s3cret-value")
    monkeypatch.setenv("OPEN_SKY_PROXY_SECRET", "proxy-secret")
    response = client_with(FakeUpstream(upstream([opensky_row()]))).get("/api/global-snapshot")

    text = response.text + json.dumps(dict(response.headers))
    assert "s3cret-value" not in text and "proxy-secret" not in text


def test_anonymous_opensky_slows_the_cadence_to_its_small_bucket():
    snapshot = GlobalSnapshot(FakeUpstream(upstream([], provider="opensky-anonymous")), clock=Clock())
    snapshot.get()
    assert 86_400 / snapshot.refresh_seconds * 4 <= 400


def test_degraded_answer_names_the_real_cause(client_with):
    clock = Clock()
    fake = FakeUpstream(upstream([opensky_row()]), OpenSkyAPIError("boom", status_code=503))
    client = client_with(fake, clock)
    client.get("/api/global-snapshot")
    clock.now += 130

    provider_down = client.get("/api/global-snapshot").json()

    assert provider_down["degraded_reason"] == "provider"
    assert provider_down["age_seconds"] == 130


def test_over_quota_answer_names_the_quota_not_the_provider(client_with):
    clock = Clock()
    clock.now = (NOW // 86_400) * 86_400 + 100
    client = client_with(FakeUpstream(upstream([opensky_row()])), clock, daily_budget=4, refresh_seconds=10)
    client.get("/api/global-snapshot")
    clock.now += 11

    payload = client.get("/api/global-snapshot").json()

    assert payload["degraded_reason"] == "quota"
    assert payload["count"] == 1


def test_upstream_rate_limit_is_a_quota_cause(client_with):
    clock = Clock()
    client = client_with(FakeUpstream(upstream([opensky_row()]), OpenSkyAPIError("limit", status_code=429)), clock)
    client.get("/api/global-snapshot")
    clock.now += 130

    assert client.get("/api/global-snapshot").json()["degraded_reason"] == "quota"


def test_healthy_answer_has_no_degraded_reason(client_with):
    payload = client_with(FakeUpstream(upstream([opensky_row()]))).get("/api/global-snapshot").json()

    assert "degraded_reason" not in payload


def test_quota_failure_without_snapshot_is_429(client_with):
    response = client_with(FakeUpstream(OpenSkyAPIError("limit", status_code=429))).get("/api/global-snapshot")

    assert response.status_code == 429


def test_a_failing_upstream_is_not_retried_by_every_visitor(client_with):
    fake = FakeUpstream(OpenSkyAPIError("OpenSky request failed: connect timeout", status_code=502))
    clock = Clock()
    client = client_with(fake, clock=clock)

    first = client.get("/api/global-snapshot")
    clock.now += 5
    second = client.get("/api/global-snapshot")

    assert first.status_code == second.status_code == 502
    assert fake.calls == 1  # the second visitor did not wait out another timeout


def test_the_failing_upstream_is_tried_again_after_the_cooldown(client_with):
    fake = FakeUpstream(OpenSkyAPIError("down", status_code=502), upstream([opensky_row()]))
    clock = Clock()
    client = client_with(fake, clock=clock)
    client.get("/api/global-snapshot")

    clock.now += 120
    response = client.get("/api/global-snapshot")

    assert response.status_code == 200 and fake.calls == 2


def test_reading_the_published_snapshot_spends_no_opensky_credits(client_with):
    published = {"time": NOW, "states": [opensky_row()], "provider": "opensky-published", "credit_cost": 0}
    fake = FakeUpstream(published)
    clock = Clock()
    client = client_with(fake, clock=clock, daily_budget=4, refresh_seconds=60)

    for _ in range(3):  # a budget of one real call would be used up after the first
        assert client.get("/api/global-snapshot").status_code == 200
        clock.now += 61

    assert fake.calls == 3


def test_the_payload_reports_what_the_call_really_cost(client_with):
    published = {"time": NOW, "states": [opensky_row()], "provider": "opensky-published", "credit_cost": 0}
    client = client_with(FakeUpstream(published))

    assert client.get("/api/global-snapshot").json()["credit_cost"] == 0
