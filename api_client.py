import os
import time
from typing import Any, Dict, Iterable, Optional

import requests
from dotenv import load_dotenv

# Load environment variables
load_dotenv()


class OpenSkyAPIError(Exception):
    """API-level error with optional status code and metadata."""

    def __init__(self, message: str, status_code: Optional[int] = None, payload: Optional[Dict[str, Any]] = None):
        super().__init__(message)
        self.status_code = status_code
        self.payload = payload or {}


class OpenSkyClient:
    def __init__(self):
        self.client_id = os.getenv("OPEN_SKY_CLIENT_ID")
        self.client_secret = os.getenv("OPEN_SKY_CLIENT_SECRET")
        self.token: Optional[str] = None
        self.token_expiry = 0.0
        self.oauth_unavailable_until = 0.0
        self.session = requests.Session()

        if not self.client_id or not self.client_secret:
            print("Warning: OpenSky credentials not found in environment variables.")

    def credentials_available(self) -> bool:
        return bool(self.client_id and self.client_secret)

    def _get_token(self) -> str:
        """Retrieve or refresh the OAuth2 access token."""
        if not self.credentials_available():
            raise OpenSkyAPIError(
                "Missing OpenSky credentials. Set OPEN_SKY_CLIENT_ID and OPEN_SKY_CLIENT_SECRET.",
                status_code=401,
            )

        current_time = time.time()
        if self.token and current_time < self.token_expiry:
            return self.token

        url = "https://auth.opensky-network.org/auth/realms/opensky-network/protocol/openid-connect/token"
        data = {
            "grant_type": "client_credentials",
            "client_id": self.client_id,
            "client_secret": self.client_secret,
        }

        try:
            auth_timeout = float(os.getenv("OPEN_SKY_AUTH_TIMEOUT_SECONDS", "5"))
            response = self.session.post(url, data=data, timeout=auth_timeout)
        except requests.RequestException as exc:
            raise OpenSkyAPIError(
                f"Error getting OpenSky token: {exc}",
                payload={"authentication_unreachable": True},
            ) from exc

        if response.status_code >= 400:
            detail = response.text.strip()
            raise OpenSkyAPIError(
                f"Token request failed ({response.status_code}). {detail}",
                status_code=response.status_code,
                payload={"detail": detail},
            )

        token_data = response.json()
        self.token = token_data.get("access_token")
        if not self.token:
            raise OpenSkyAPIError("OpenSky token response did not include access_token.")

        # OpenSky tokens usually expire in 1800 seconds. Renew one minute early.
        self.token_expiry = current_time + token_data.get("expires_in", 1800) - 60
        return self.token

    def _authorization_headers(self) -> Dict[str, str]:
        """Prefer OAuth, with a short anonymous fallback when auth is unreachable."""
        if not self.credentials_available() or time.time() < self.oauth_unavailable_until:
            return {}

        try:
            token = self._get_token()
        except OpenSkyAPIError as exc:
            if not exc.payload.get("authentication_unreachable"):
                raise

            # OpenSky officially permits anonymous API requests. Avoid retrying an
            # unreachable OAuth host on every request in the same server instance.
            fallback_seconds = int(os.getenv("OPEN_SKY_AUTH_FALLBACK_SECONDS", "300"))
            self.oauth_unavailable_until = time.time() + fallback_seconds
            return {}

        return {"Authorization": f"Bearer {token}"}

    def _make_request(
        self,
        method: str,
        endpoint: str,
        *,
        params: Optional[Dict[str, Any]] = None,
        data: Optional[Dict[str, Any]] = None,
        not_found_value: Any = None,
        timeout_sec: int = 30,
    ) -> Any:
        """Make an API request with OAuth when available and useful error semantics."""
        base_url = "https://opensky-network.org/api"
        url = f"{base_url}{endpoint}"

        for attempt in range(2):
            headers = self._authorization_headers()

            try:
                response = self.session.request(
                    method,
                    url,
                    headers=headers,
                    params=params,
                    data=data,
                    timeout=timeout_sec,
                )
            except requests.RequestException as exc:
                if attempt == 0:
                    continue
                raise OpenSkyAPIError(f"OpenSky request failed: {exc}") from exc

            if response.status_code == 401 and attempt == 0 and headers:
                # Token might be stale; force refresh and retry once.
                self.token = None
                continue

            if response.status_code == 404:
                if not_found_value is not None:
                    return not_found_value
                raise OpenSkyAPIError("OpenSky resource not found", status_code=404)

            if response.status_code == 429:
                retry_after = response.headers.get("X-Rate-Limit-Retry-After-Seconds")
                remaining = response.headers.get("X-Rate-Limit-Remaining")
                message = "OpenSky rate limit exceeded."
                if retry_after:
                    message += f" Retry after {retry_after}s."
                raise OpenSkyAPIError(
                    message,
                    status_code=429,
                    payload={
                        "retry_after_seconds": retry_after,
                        "rate_limit_remaining": remaining,
                    },
                )

            if response.status_code >= 400:
                detail = response.text.strip()
                raise OpenSkyAPIError(
                    f"OpenSky request failed ({response.status_code}): {detail}",
                    status_code=response.status_code,
                    payload={"detail": detail},
                )

            if not response.content:
                return None

            content_type = response.headers.get("Content-Type", "")
            body_text = response.text.strip()

            if "application/json" in content_type or (body_text.startswith("{") or body_text.startswith("[")):
                return response.json()

            return body_text

        raise OpenSkyAPIError("OpenSky request failed after retries")

    def get_departures(self, airport_icao: str, begin_timestamp: int, end_timestamp: int):
        params = {
            "airport": airport_icao,
            "begin": int(begin_timestamp),
            "end": int(end_timestamp),
        }
        return self._make_request("GET", "/flights/departure", params=params, not_found_value=[])

    def get_arrivals(self, airport_icao: str, begin_timestamp: int, end_timestamp: int):
        params = {
            "airport": airport_icao,
            "begin": int(begin_timestamp),
            "end": int(end_timestamp),
        }
        return self._make_request("GET", "/flights/arrival", params=params, not_found_value=[])

    def get_states(
        self,
        icao24_list: Optional[Iterable[str]] = None,
        bbox: Optional[tuple] = None,
        *,
        extended: bool = False,
        time_sec: Optional[int] = None,
    ):
        params: Dict[str, Any] = {}

        if icao24_list:
            # API expects repeated query params. requests handles list expansion.
            params["icao24"] = [str(code).lower() for code in list(icao24_list)[:50] if code]

        if bbox:
            params["lamin"] = bbox[0]
            params["lomin"] = bbox[1]
            params["lamax"] = bbox[2]
            params["lomax"] = bbox[3]

        if extended:
            params["extended"] = 1

        if time_sec is not None:
            params["time"] = int(time_sec)

        return self._make_request("GET", "/states/all", params=params)

    def get_track(self, icao24: str, time_sec: int):
        params = {
            "icao24": str(icao24).lower(),
            "time": int(time_sec),
        }

        # Some docs mention /tracks, while examples use /tracks/all. Try /tracks/all first.
        for endpoint in ("/tracks/all", "/tracks"):
            try:
                result = self._make_request("GET", endpoint, params=params, not_found_value={})
                return result or {}
            except OpenSkyAPIError as exc:
                if endpoint == "/tracks/all" and exc.status_code in (400, 404, 429, 500, 502, 503):
                    continue
                raise

        return {}

    def get_flights_by_aircraft(self, icao24: str, begin_timestamp: int, end_timestamp: int):
        params = {
            "icao24": str(icao24).lower(),
            "begin": int(begin_timestamp),
            "end": int(end_timestamp),
        }
        return self._make_request("GET", "/flights/aircraft", params=params, not_found_value=[])

    def get_flights_all(self, begin_timestamp: int, end_timestamp: int):
        params = {
            "begin": int(begin_timestamp),
            "end": int(end_timestamp),
        }
        return self._make_request("GET", "/flights/all", params=params, not_found_value=[])
