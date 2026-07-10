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

    assert result["provider"] == "airplanes.live"
    assert len(result["states"]) == 1
    state = result["states"][0]
    assert state[0] == "abc123"
    assert state[1] == "TEST42"
    assert state[7] == 3048.0
    assert round(state[9], 3) == 102.889
    assert state[10] == 90
    assert state[11] == 2.54
    request_url = client.session.get.call_args.args[0]
    assert request_url.startswith("https://api.airplanes.live/v2/point/")
