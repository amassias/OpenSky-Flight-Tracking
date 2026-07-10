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
