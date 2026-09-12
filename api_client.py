import os
import time
from datetime import datetime, timezone
from math import asin, cos, radians, sin, sqrt
from typing import Any, Dict, Iterable, Optional
from urllib.parse import quote

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
        self._route_cache: Dict[str, tuple[float, Optional[Dict[str, Any]]]] = {}
        # Live map requests are usually repeated for the same quantised
        # viewport. Keep a short in-process cache so a polling tick or a
        # resize cannot turn into a burst of provider requests. Vercel may
        # create more than one function instance, so this is an optimisation
        # and the server layer still keeps its own stale snapshot fallback.
        self._live_cache: Dict[str, Dict[str, Any]] = {}
        self._live_provider_unavailable_until = 0.0
        # OpenSky's authenticated states endpoint is the only live source that
        # accepts the complete viewport bounding box. Keep a separate cache and
        # a small request gate for the Vercel proxy so a pan/zoom burst cannot
        # spend the daily credits on near-identical boxes.
        self._opensky_live_cache: Dict[str, Dict[str, Any]] = {}
        self._opensky_live_next_request_at = 0.0
        # FlightAware is an on-demand enrichment source. Keep it completely
        # outside the map polling loop and cache both positive and empty
        # responses so a user opening the same aircraft again cannot spend a
        # second API call during the provider's retry window.
        self._flightaware_cache: Dict[str, Dict[str, Any]] = {}
        self._flightaware_next_request_at = 0.0

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
        proxy_secret = os.getenv("OPEN_SKY_PROXY_SECRET") if os.getenv("VERCEL") else None
        proxy_base_url = os.getenv("OPEN_SKY_PROXY_BASE_URL", "").rstrip("/")
        deployment_host = os.getenv("VERCEL_URL")
        if not proxy_base_url and deployment_host:
            proxy_base_url = f"https://{deployment_host}"
        using_proxy = bool(proxy_secret and proxy_base_url)

        if using_proxy:
            url = f"{proxy_base_url}/api/opensky-proxy"
            request_params = {"endpoint": endpoint}
            if params:
                request_params.update(params)
        else:
            url = f"https://opensky-network.org/api{endpoint}"
            request_params = params

        # A Vercel proxy failure is deterministic for this request (the OpenSky
        # host can block hyperscaler egress), so do not spend a second timeout
        # retrying it before the caller can use its fallback.
        request_attempts = 1 if using_proxy else 2
        # A cold Vercel proxy may need one round trip for OAuth and another for
        # the states request. Three seconds caused every first wide-viewport
        # request to fall back to a centre-radius provider before the proxy
        # could finish. Keep a bounded ten-second window so complete-bbox
        # coverage wins while an actual outage still degrades gracefully.
        proxy_timeout = float(os.getenv("OPEN_SKY_PROXY_TIMEOUT_SECONDS", "10"))
        request_timeout = min(timeout_sec, max(1.0, proxy_timeout)) if using_proxy else timeout_sec

        for attempt in range(request_attempts):
            headers = (
                {"X-SkyTrace-Proxy-Secret": str(proxy_secret)}
                if using_proxy
                else self._authorization_headers()
            )

            try:
                response = self.session.request(
                    method,
                    url,
                    headers=headers,
                    params=request_params,
                    data=data,
                    timeout=request_timeout,
                )
            except requests.RequestException as exc:
                if attempt == 0:
                    continue
                raise OpenSkyAPIError(f"OpenSky request failed: {exc}") from exc

            if response.status_code == 401 and attempt == 0 and headers and not using_proxy:
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

            if "application/json" in content_type or body_text.startswith(("{", "[", '"')):
                parsed = response.json()
                if isinstance(parsed, str):
                    raise OpenSkyAPIError(
                        "OpenSky returned a textual JSON response.",
                        status_code=502,
                        payload={"response_preview": parsed[:240]},
                    )
                if using_proxy and isinstance(parsed, dict) and response.headers.get("X-SkyTrace-Auth"):
                    parsed = dict(parsed)
                    parsed["_skytrace_auth_mode"] = response.headers.get("X-SkyTrace-Auth")
                return parsed

            return body_text

        raise OpenSkyAPIError("OpenSky request failed after retries")

    @staticmethod
    def _distance_nm(lat1: float, lon1: float, lat2: float, lon2: float) -> float:
        """Return great-circle distance in nautical miles."""
        dlat = radians(lat2 - lat1)
        dlon = radians(lon2 - lon1)
        a = sin(dlat / 2) ** 2 + cos(radians(lat1)) * cos(radians(lat2)) * sin(dlon / 2) ** 2
        return 3440.065 * 2 * asin(sqrt(a))

    @staticmethod
    def _states_credit_cost(bbox: Optional[tuple]) -> int:
        """Return OpenSky's documented credit cost for a viewport."""
        if not bbox:
            return 4
        lat_min, lon_min, lat_max, lon_max = (float(value) for value in bbox)
        area = max(0.0, lat_max - lat_min) * max(0.0, lon_max - lon_min)
        if area <= 25:
            return 1
        if area <= 100:
            return 2
        if area <= 400:
            return 3
        return 4

    @classmethod
    def _states_refresh_seconds(cls, bbox: Optional[tuple]) -> int:
        """Choose a polling interval that leaves headroom in a free quota.

        The standard OpenSky allowance is 4,000 credits per endpoint/day. A
        target of 3,000 credits keeps room for an occasional manual refresh or
        a selected-flight lookup while still updating small airport views
        about every 30 seconds.
        """
        try:
            daily_budget = int(float(os.getenv("SKYTRACE_OPENSKY_DAILY_BUDGET", "3000")))
        except (TypeError, ValueError):
            daily_budget = 3000
        daily_budget = max(1, min(4000, daily_budget))
        cost = cls._states_credit_cost(bbox)
        interval = int((24 * 60 * 60 * cost + daily_budget - 1) / daily_budget)
        return max(30, min(300, interval))

    @classmethod
    def _states_anonymous_refresh_seconds(cls, bbox: Optional[tuple]) -> int:
        """Keep the documented 400-credit anonymous bucket below its limit."""
        cost = cls._states_credit_cost(bbox)
        # Five minutes is enough for a small airport box; wider boxes use a
        # longer interval so even four-credit requests stay under 400/day.
        return max(300, int((24 * 60 * 60 * cost + 399) / 400))

    @staticmethod
    def _state_params(icao24_list: Optional[Iterable[str]], bbox: Optional[tuple], extended: bool, time_sec: Optional[int]) -> Dict[str, Any]:
        params: Dict[str, Any] = {}
        if icao24_list:
            params["icao24"] = [str(code).lower() for code in list(icao24_list)[:50] if code]
        if bbox:
            params.update({"lamin": bbox[0], "lomin": bbox[1], "lamax": bbox[2], "lomax": bbox[3]})
        if extended:
            params["extended"] = 1
        if time_sec is not None:
            params["time"] = int(time_sec)
        return params

    @staticmethod
    def _state_cache_key(params: Dict[str, Any]) -> str:
        parts = []
        for key in sorted(params):
            value = params[key]
            if isinstance(value, list):
                value = ",".join(str(item) for item in value)
            parts.append(f"{key}={value}")
        return "&".join(parts) or "all"

    def _vercel_opensky_proxy_enabled(self) -> bool:
        if not os.getenv("VERCEL"):
            return False
        if not os.getenv("OPEN_SKY_PROXY_SECRET"):
            return False
        return bool(os.getenv("OPEN_SKY_PROXY_BASE_URL") or os.getenv("VERCEL_URL"))

    def _get_opensky_live_states(self, params: Dict[str, Any], bbox: Optional[tuple]):
        """Fetch a complete viewport through the authenticated Vercel proxy."""
        key = self._state_cache_key(params)
        refresh_seconds = self._states_refresh_seconds(bbox)
        now = time.time()
        cached = self._opensky_live_cache.get(key)
        if cached:
            age = now - float(cached.get("fetched_at", 0))
            if age <= refresh_seconds:
                return cached["result"]

        try:
            min_interval = max(1.2, float(os.getenv("SKYTRACE_OPENSKY_MIN_INTERVAL_SECONDS", "5")))
        except (TypeError, ValueError):
            min_interval = 5.0
        if now < self._opensky_live_next_request_at:
            if cached and now - float(cached.get("fetched_at", 0)) <= max(refresh_seconds * 3, 120):
                stale = dict(cached["result"])
                stale["degraded"] = True
                stale["notice"] = "OpenSky refresh throttled. Showing the last viewport snapshot."
                return stale
            raise OpenSkyAPIError(
                "OpenSky live refresh is being throttled.",
                status_code=503,
                payload={"retry_after_seconds": max(1, int(self._opensky_live_next_request_at - now))},
            )

        result = self._make_request("GET", "/states/all", params=params)
        if not isinstance(result, dict):
            raise OpenSkyAPIError("OpenSky returned an invalid live state response.", status_code=502)
        result = dict(result)
        anonymous = result.pop("_skytrace_auth_mode", None) == "anonymous"
        if anonymous:
            refresh_seconds = max(refresh_seconds, self._states_anonymous_refresh_seconds(bbox))
        result["provider"] = "opensky-anonymous" if anonymous else "opensky"
        result["credit_cost"] = self._states_credit_cost(bbox)
        result["refresh_after_seconds"] = refresh_seconds
        self._opensky_live_next_request_at = now + min_interval
        if len(self._opensky_live_cache) >= 64:
            oldest_key = min(self._opensky_live_cache, key=lambda item: self._opensky_live_cache[item].get("fetched_at", 0))
            self._opensky_live_cache.pop(oldest_key, None)
        self._opensky_live_cache[key] = {"fetched_at": now, "result": result}
        return result

    @staticmethod
    def _airplanes_live_row(aircraft: Dict[str, Any], now_sec: int):
        """Convert an Airplanes.live aircraft object to an OpenSky state vector."""
        altitude_ft = aircraft.get("alt_baro")
        on_ground = altitude_ft == "ground"
        baro_altitude = None if altitude_ft is None else (0.0 if on_ground else float(altitude_ft) * 0.3048 if isinstance(altitude_ft, (int, float)) else None)
        geo_altitude_ft = aircraft.get("alt_geom")
        geo_altitude = float(geo_altitude_ft) * 0.3048 if isinstance(geo_altitude_ft, (int, float)) else None
        speed_knots = aircraft.get("gs")
        velocity = float(speed_knots) * 0.514444 if isinstance(speed_knots, (int, float)) else None
        vertical_fpm = aircraft.get("baro_rate")
        vertical_rate = float(vertical_fpm) * 0.00508 if isinstance(vertical_fpm, (int, float)) else None
        seen_pos = aircraft.get("seen_pos")
        seen = aircraft.get("seen")

        details = {
            "registration": aircraft.get("r"),
            "aircraft_type": aircraft.get("t"),
            "aircraft_description": aircraft.get("desc"),
            "aircraft_owner": aircraft.get("ownOp"),
            "aircraft_year": aircraft.get("year"),
            "aircraft_category": aircraft.get("category"),
            "emergency": aircraft.get("emergency"),
            "nav_qnh": aircraft.get("nav_qnh"),
            "nav_altitude_mcp": aircraft.get("nav_altitude_mcp"),
            "nav_heading": aircraft.get("nav_heading"),
            "nav_modes": aircraft.get("nav_modes"),
            "messages": aircraft.get("messages"),
            "rssi": aircraft.get("rssi"),
            "seen_seconds": aircraft.get("seen"),
            "seen_position_seconds": aircraft.get("seen_pos"),
            "nic": aircraft.get("nic"),
            "rc": aircraft.get("rc"),
            "nac_p": aircraft.get("nac_p"),
            "nac_v": aircraft.get("nac_v"),
            "sil": aircraft.get("sil"),
            "sil_type": aircraft.get("sil_type"),
            "source": aircraft.get("type"),
        }
        details = {key: value for key, value in details.items() if value not in (None, "", [])}

        return [
            str(aircraft.get("hex") or "").lower(),
            str(aircraft.get("flight") or "").strip(),
            "Unknown",
            now_sec - int(float(seen_pos)) if isinstance(seen_pos, (int, float)) else None,
            now_sec - int(float(seen)) if isinstance(seen, (int, float)) else now_sec,
            aircraft.get("lon"),
            aircraft.get("lat"),
            baro_altitude,
            on_ground,
            velocity,
            aircraft.get("track"),
            vertical_rate,
            None,
            geo_altitude,
            aircraft.get("squawk"),
            False,
            0,
            aircraft.get("category"),
            details,
        ]

    def _get_airplanes_live_states(
        self,
        icao24_list: Optional[Iterable[str]] = None,
        bbox: Optional[tuple] = None,
    ):
        """Fetch live ADS-B positions from the public production fallback."""
        if icao24_list:
            codes = [str(code).lower() for code in list(icao24_list)[:50] if code]
            endpoint = f"hex/{','.join(codes)}"
        elif bbox:
            lat_min, lon_min, lat_max, lon_max = (float(value) for value in bbox)
            center_lat = (lat_min + lat_max) / 2
            center_lon = (lon_min + lon_max) / 2
            # The old 250 NM cap covered an airport-sized box only. When the
            # user zooms out, the provider still returned a central sliver of
            # the map and the other visible aircraft disappeared. Size the
            # request from the farthest viewport corner and keep a bounded
            # ceiling so a world view cannot create an enormous response.
            corner_distances = (
                self._distance_nm(center_lat, center_lon, lat_min, lon_min),
                self._distance_nm(center_lat, center_lon, lat_min, lon_max),
                self._distance_nm(center_lat, center_lon, lat_max, lon_min),
                self._distance_nm(center_lat, center_lon, lat_max, lon_max),
            )
            try:
                radius_limit = float(os.getenv("SKYTRACE_LIVE_MAX_RADIUS_NM", "1000"))
            except (TypeError, ValueError):
                radius_limit = 1000.0
            radius_limit = max(250.0, min(2500.0, radius_limit))
            radius = min(radius_limit, max(1.0, max(corner_distances)))
            endpoint = f"point/{center_lat:.5f}/{center_lon:.5f}/{radius:.1f}"
        else:
            raise OpenSkyAPIError("A bounding box or aircraft code is required for live fallback data.")

        now = time.time()
        try:
            cache_seconds = max(5.0, float(os.getenv("SKYTRACE_LIVE_CACHE_SECONDS", "15")))
        except (TypeError, ValueError):
            cache_seconds = 15.0
        try:
            stale_seconds = max(cache_seconds, float(os.getenv("SKYTRACE_LIVE_STALE_SECONDS", "90")))
        except (TypeError, ValueError):
            stale_seconds = max(cache_seconds, 90.0)

        cached = self._live_cache.get(endpoint)
        if cached:
            age = now - float(cached.get("fetched_at", 0))
            if age <= cache_seconds:
                return cached["result"]

        # A provider rate limit applies to the function instance, so avoid
        # immediately repeating the same failed request. A stale exact
        # viewport is still useful to the map, but it is explicitly marked so
        # the UI never presents it as a fresh update.
        if now < self._live_provider_unavailable_until:
            if cached and now - float(cached.get("fetched_at", 0)) <= stale_seconds:
                stale_result = dict(cached["result"])
                stale_result["degraded"] = True
                stale_result["notice"] = "Live refresh delayed. Showing the last snapshot."
                return stale_result
            raise OpenSkyAPIError("Live aircraft providers are temporarily unavailable.", status_code=503)

        # Independent public providers use the same ADS-B schema. A provider
        # outage must not make all live traffic unavailable on Vercel.
        last_error = None
        last_status = None
        rate_limited = False
        rate_limit_payload: Dict[str, Any] = {}
        for provider in ("adsb.lol", "airplanes.live"):
            try:
                response = self.session.get(
                    f"https://api.{provider}/v2/{endpoint}",
                    headers={
                        "Accept-Encoding": "gzip",
                        "User-Agent": "SkyTrace/2.0 (+https://github.com/amassias/OpenSky-Flight-Tracking; contact: massias.arthur@gmail.com)",
                    },
                    timeout=8,
                )
                response_status = getattr(response, "status_code", None)
                if isinstance(response_status, int) and response_status >= 400:
                    last_status = response_status
                    if response_status == 429:
                        rate_limited = True
                        rate_limit_payload = {
                            "retry_after_seconds": response.headers.get("X-Rate-Limit-Retry-After-Seconds")
                            or response.headers.get("Retry-After"),
                            "provider": provider,
                        }
                response.raise_for_status()
                payload = response.json()
                if not isinstance(payload, dict) or not isinstance(payload.get("ac"), list):
                    raise ValueError("Invalid live aircraft response")
                break
            except (requests.RequestException, ValueError) as exc:
                last_error = exc
        else:
            self._live_provider_unavailable_until = now + 15
            if rate_limited:
                raise OpenSkyAPIError(
                    "Live aircraft providers are rate limited.",
                    status_code=429,
                    payload=rate_limit_payload,
                ) from last_error
            raise OpenSkyAPIError("Live aircraft providers are temporarily unavailable.", status_code=503) from last_error

        now_sec = int((payload.get("now") or time.time() * 1000) / 1000)
        aircraft = payload.get("ac") or []
        if bbox:
            lat_min, lon_min, lat_max, lon_max = (float(value) for value in bbox)
            aircraft = [
                item for item in aircraft
                if isinstance(item.get("lat"), (int, float))
                and isinstance(item.get("lon"), (int, float))
                and lat_min <= item["lat"] <= lat_max
                and lon_min <= item["lon"] <= lon_max
            ]

        result = {
            "time": now_sec,
            "states": [self._airplanes_live_row(item, now_sec) for item in aircraft if item.get("hex")],
            "provider": provider,
            "refresh_after_seconds": 20,
            "credit_cost": 0,
        }
        self._live_provider_unavailable_until = 0.0
        if len(self._live_cache) >= 128:
            oldest_key = min(self._live_cache, key=lambda key: self._live_cache[key].get("fetched_at", 0))
            self._live_cache.pop(oldest_key, None)
        self._live_cache[endpoint] = {"fetched_at": now, "result": result}
        return result

    def get_departures(self, airport_icao: str, begin_timestamp: int, end_timestamp: int):
        params = {
            "airport": airport_icao,
            "begin": int(begin_timestamp),
            "end": int(end_timestamp),
        }
        return self._make_request("GET", "/flights/departure", params=params, not_found_value=[])

    def get_callsign_route(self, callsign: str) -> Optional[Dict[str, Any]]:
        """Resolve a live callsign to its current scheduled origin/destination.

        This is a deliberately small, on-demand lookup. It is only called after
        a user selects a live aircraft and is cached briefly to avoid repeated
        provider requests while the map refreshes.
        """
        if os.getenv("SKYTRACE_ROUTE_LOOKUP_ENABLED", "1").strip().lower() in {"0", "false", "no", "off"}:
            return None

        normalized = "".join(str(callsign or "").upper().split())
        if not normalized or len(normalized) > 16 or not all(character.isalnum() or character in "-_" for character in normalized):
            return None

        now = time.time()
        cached = self._route_cache.get(normalized)
        if cached and cached[0] > now:
            return cached[1]

        base_url = os.getenv("SKYTRACE_ROUTE_API_BASE_URL", "https://api.adsbdb.com/v0/callsign").rstrip("/")
        url = f"{base_url}/{quote(normalized, safe='')}"
        try:
            timeout = float(os.getenv("SKYTRACE_ROUTE_TIMEOUT_SECONDS", "4"))
            response = self.session.get(
                url,
                headers={
                    "Accept": "application/json",
                    "User-Agent": "SkyTrace/2.0 (+https://github.com/amassias/OpenSky-Flight-Tracking; route lookup)",
                },
                timeout=timeout,
            )
            if response.status_code == 404 or response.status_code >= 400:
                result = None
            else:
                payload = response.json()
                flight_route = ((payload or {}).get("response") or {}).get("flightroute") if isinstance(payload, dict) else None
                result = self._normalize_callsign_route(flight_route, normalized)
        except (requests.RequestException, ValueError, TypeError):
            result = None

        # Cache both successful and empty responses for a short period so an
        # unknown callsign cannot create a request on every detail render.
        ttl = max(30, float(os.getenv("SKYTRACE_ROUTE_CACHE_SECONDS", "300")))
        if len(self._route_cache) >= 256:
            oldest_key = min(self._route_cache, key=lambda key: self._route_cache[key][0])
            self._route_cache.pop(oldest_key, None)
        self._route_cache[normalized] = (now + ttl, result)
        return result

    def get_aircraft_profile(self, icao24: str) -> Optional[Dict[str, Any]]:
        """Fetch a rich, on-demand profile for one selected aircraft.

        The public ADS-B ``hex`` endpoint includes registration, type,
        operator and signal fields that are not part of an OpenSky state
        vector. The normal live cache makes repeated clicks inexpensive, and
        callers treat a missing profile as an enrichment failure.
        """
        code = str(icao24 or "").strip().lower()
        if len(code) != 6:
            return None
        try:
            result = self._get_airplanes_live_states(icao24_list=[code])
        except (OpenSkyAPIError, ValueError, TypeError):
            return None
        if not isinstance(result, dict):
            return None
        rows = result.get("states") or []
        if not rows:
            return None
        row = rows[0]
        if not isinstance(row, list) or not row:
            return None
        profile = row[18] if len(row) > 18 and isinstance(row[18], dict) else {}
        return {
            "state": row,
            "profile": profile,
            "provider": result.get("provider"),
        }

    @staticmethod
    def _flightaware_ident(value: Any) -> str:
        """Normalise a callsign or registration for an AeroAPI path segment."""
        return "".join(character for character in str(value or "").upper() if character.isalnum())[:16]

    @staticmethod
    def _provider_timestamp(value: Any) -> Optional[int]:
        """Parse an AeroAPI ISO timestamp for flight selection scoring."""
        if value in (None, ""):
            return None
        if isinstance(value, (int, float)):
            raw = float(value)
            return int(raw / 1000) if raw > 10_000_000_000 else int(raw)
        try:
            parsed = datetime.fromisoformat(str(value).replace("Z", "+00:00"))
            if parsed.tzinfo is None:
                parsed = parsed.replace(tzinfo=timezone.utc)
            return int(parsed.timestamp())
        except (TypeError, ValueError, OverflowError):
            return None

    @classmethod
    def _pick_flightaware_flight(
        cls,
        payload: Dict[str, Any],
        callsign: str,
        registration: Optional[str] = None,
    ) -> Optional[Dict[str, Any]]:
        """Choose the current record from AeroAPI's list response.

        ``/flights/{ident}`` can contain a scheduled, en-route and completed
        record at once. Prefer an exact identifier/tail match and records with
        operational timestamps, then choose the one closest to now.
        """
        flights = payload.get("flights")
        if not isinstance(flights, list):
            return None
        target_callsign = cls._flightaware_ident(callsign)
        target_registration = cls._flightaware_ident(registration)
        now = int(time.time())

        def score(item: Dict[str, Any]):
            score_value = 0
            atc_ident = cls._flightaware_ident(item.get("atc_ident"))
            ident = cls._flightaware_ident(item.get("ident"))
            item_registration = cls._flightaware_ident(item.get("registration") or item.get("tailnumber"))
            if target_callsign and atc_ident == target_callsign:
                score_value += 150
            if target_callsign and ident == target_callsign:
                score_value += 120
            if target_registration and item_registration == target_registration:
                score_value += 90
            if item.get("actual_out"):
                score_value += 120
            if item.get("actual_in"):
                score_value += 100
            status = str(item.get("status") or "").lower()
            if status.startswith("arriv") or status.startswith("land"):
                score_value += 100
            elif status.startswith("en route") or status.startswith("airborne"):
                score_value += 80
            elif status.startswith("scheduled"):
                score_value += 20
            scheduled_out = cls._provider_timestamp(item.get("scheduled_out"))
            distance = abs(now - scheduled_out) if scheduled_out is not None else 86_400
            progress = item.get("progress_percent")
            try:
                score_value += max(0, min(10, int(float(progress) // 10)))
            except (TypeError, ValueError):
                pass
            return score_value, 1 if item.get("actual_out") else 0, -distance

        candidates = [item for item in flights if isinstance(item, dict)]
        return max(candidates, key=score) if candidates else None

    @staticmethod
    def _flightaware_airport(value: Any) -> Optional[Dict[str, Any]]:
        """Keep only the public airport fields needed by the details panel."""
        if not isinstance(value, dict):
            return None
        result: Dict[str, Any] = {}
        for key in ("code_icao", "code_iata", "code", "name", "city", "latitude", "longitude", "timezone"):
            item = value.get(key)
            if item in (None, ""):
                continue
            if key in {"latitude", "longitude"}:
                try:
                    result[key] = float(item)
                except (TypeError, ValueError):
                    continue
            else:
                result[key] = str(item).strip()
        return result or None

    @classmethod
    def _normalize_flightaware_flight(cls, flight: Dict[str, Any], queried_ident: str) -> Dict[str, Any]:
        """Return a compact, stable contract instead of forwarding raw data."""
        airline = flight.get("airline") or flight.get("operator")
        airline_code = None
        airline_name = None
        if isinstance(airline, dict):
            airline_code = airline.get("icao") or airline.get("iata") or airline.get("code")
            airline_name = airline.get("name") or airline.get("display_name")
        elif airline not in (None, ""):
            airline_name = str(airline).strip()

        fields = {
            "provider": "FlightAware",
            "queried_ident": queried_ident,
            "fa_flight_id": flight.get("fa_flight_id"),
            "ident": flight.get("ident"),
            "atc_ident": flight.get("atc_ident"),
            "status": flight.get("status"),
            "airline_code": airline_code,
            "airline_name": airline_name,
            "origin": cls._flightaware_airport(flight.get("origin")),
            "destination": cls._flightaware_airport(flight.get("destination")),
            "route": flight.get("route"),
            "aircraft_type": flight.get("aircraft_type") or flight.get("type"),
            "registration": flight.get("registration") or flight.get("tailnumber"),
            "progress_percent": flight.get("progress_percent"),
            "departure_delay": flight.get("departure_delay"),
            "arrival_delay": flight.get("arrival_delay"),
            "cancelled": flight.get("cancelled"),
            "diverted": flight.get("diverted"),
            "position_only": flight.get("position_only"),
            "foresight_predictions_available": flight.get("foresight_predictions_available"),
            "scheduled_out": flight.get("scheduled_out"),
            "estimated_out": flight.get("estimated_out"),
            "actual_out": flight.get("actual_out"),
            "scheduled_off": flight.get("scheduled_off"),
            "estimated_off": flight.get("estimated_off"),
            "actual_off": flight.get("actual_off"),
            "scheduled_on": flight.get("scheduled_on"),
            "estimated_on": flight.get("estimated_on"),
            "actual_on": flight.get("actual_on"),
            "scheduled_in": flight.get("scheduled_in"),
            "estimated_in": flight.get("estimated_in"),
            "actual_in": flight.get("actual_in"),
            "gate_orig": flight.get("gate_orig"),
            "gate_dest": flight.get("gate_dest"),
            "terminal_orig": flight.get("terminal_orig"),
            "terminal_dest": flight.get("terminal_dest"),
            "filed_ete": flight.get("filed_ete"),
            "filed_airspeed": flight.get("filed_airspeed"),
            "filed_altitude": flight.get("filed_altitude"),
        }
        # Keep numeric values numeric and omit provider-specific blanks. This
        # also prevents an unexpected nested object from reaching the browser.
        allowed_numbers = {
            "progress_percent", "departure_delay", "arrival_delay", "filed_ete",
            "filed_airspeed", "filed_altitude",
        }
        normalized: Dict[str, Any] = {}
        for key, value in fields.items():
            if value in (None, "", []):
                continue
            if key in allowed_numbers:
                try:
                    normalized[key] = int(float(value))
                except (TypeError, ValueError):
                    continue
            elif key in {"cancelled", "diverted", "position_only", "foresight_predictions_available"}:
                normalized[key] = bool(value)
            elif key in {"origin", "destination"}:
                if isinstance(value, dict):
                    normalized[key] = value
            else:
                normalized[key] = value
        return normalized

    def get_flightaware_details(
        self,
        callsign: str,
        registration: Optional[str] = None,
    ) -> Optional[Dict[str, Any]]:
        """Fetch one operational FlightAware record after a user selects an aircraft.

        The key is server-side only. A successful response is cached for 15
        minutes (24 hours for completed/cancelled flights), while empty or
        failed lookups are cached for the retry window. This keeps FlightAware
        outside the live map polling path and protects a free-plan allowance.
        """
        if os.getenv("SKYTRACE_FLIGHTAWARE_ENABLED", "1").strip().lower() in {"0", "false", "no", "off"}:
            return None
        api_key = (os.getenv("FLIGHTAWARE_AEROAPI_KEY") or "").strip()
        if not api_key:
            return None

        primary_ident = self._flightaware_ident(callsign) or self._flightaware_ident(registration)
        if not primary_ident:
            return None
        registration_ident = self._flightaware_ident(registration)
        now = time.time()
        cached = self._flightaware_cache.get(primary_ident)
        if cached and now < float(cached.get("expires_at", 0)):
            result = cached.get("result")
            return result if isinstance(result, dict) else None

        try:
            min_retry = max(30.0, float(os.getenv("FLIGHTAWARE_MIN_RETRY_SECONDS", "900")))
        except (TypeError, ValueError):
            min_retry = 900.0
        if cached and now - float(cached.get("checked_at", 0)) < min_retry:
            result = cached.get("result")
            return result if isinstance(result, dict) else None

        # A small process-wide gate protects a burst of different aircraft
        # selections. The browser's React query cache provides the primary
        # deduplication; this gate is the serverless-instance safety net.
        try:
            min_interval = max(1.0, float(os.getenv("FLIGHTAWARE_MIN_INTERVAL_SECONDS", "5")))
        except (TypeError, ValueError):
            min_interval = 5.0
        if now < self._flightaware_next_request_at:
            if cached:
                result = cached.get("result")
                return result if isinstance(result, dict) else None
            return None

        candidates = [primary_ident]
        if registration_ident and registration_ident not in candidates:
            candidates.append(registration_ident)
        try:
            timeout = max(2.0, min(10.0, float(os.getenv("FLIGHTAWARE_TIMEOUT_SECONDS", "5"))))
        except (TypeError, ValueError):
            timeout = 5.0

        selected: Optional[Dict[str, Any]] = None
        queried_ident = primary_ident
        for ident in candidates:
            url = f"https://aeroapi.flightaware.com/aeroapi/flights/{quote(ident, safe='')}"
            try:
                response = self.session.get(
                    url,
                    headers={
                        "Accept": "application/json",
                        "x-apikey": api_key,
                        "User-Agent": "SkyTrace/2.0 (+https://github.com/amassias/OpenSky-Flight-Tracking; FlightAware enrichment)",
                    },
                    timeout=timeout,
                )
                if response.status_code in (401, 403, 404, 429):
                    continue
                response.raise_for_status()
                payload = response.json()
                if not isinstance(payload, dict):
                    continue
                selected = self._pick_flightaware_flight(payload, callsign, registration)
                queried_ident = ident
                if selected:
                    break
            except (requests.RequestException, ValueError, TypeError):
                continue

        self._flightaware_next_request_at = now + min_interval
        result: Optional[Dict[str, Any]] = None
        if selected:
            result = self._normalize_flightaware_flight(selected, queried_ident)

        try:
            cache_ttl = max(60.0, float(os.getenv("FLIGHTAWARE_CACHE_TTL_SECONDS", "900")))
            stable_ttl = max(cache_ttl, float(os.getenv("FLIGHTAWARE_STABLE_CACHE_TTL_SECONDS", "86400")))
        except (TypeError, ValueError):
            cache_ttl, stable_ttl = 900.0, 86_400.0
        status = str((result or {}).get("status") or "").lower()
        stable = bool((result or {}).get("actual_in")) or status.startswith(("arriv", "land", "cancel", "divert"))
        expires_at = now + (stable_ttl if stable else cache_ttl)
        if len(self._flightaware_cache) >= 256:
            oldest_key = min(self._flightaware_cache, key=lambda key: self._flightaware_cache[key].get("checked_at", 0))
            self._flightaware_cache.pop(oldest_key, None)
        self._flightaware_cache[primary_ident] = {
            "checked_at": now,
            "expires_at": expires_at if result else now + min_retry,
            "result": result,
        }
        return result

    @staticmethod
    def _normalize_callsign_route(flight_route: Any, callsign: str) -> Optional[Dict[str, Any]]:
        if not isinstance(flight_route, dict):
            return None

        airline = flight_route.get("airline") if isinstance(flight_route.get("airline"), dict) else {}

        def airport_value(key: str, field: str):
            airport = flight_route.get(key)
            if not isinstance(airport, dict):
                return None
            value = airport.get(field)
            return value if value not in (None, "") else None

        departure = airport_value("origin", "icao_code")
        arrival = airport_value("destination", "icao_code")
        if not departure and not arrival:
            return None

        return {
            "callsign": str(flight_route.get("callsign") or callsign).strip(),
            "airline_code": str(airline.get("icao") or "").strip().upper() or None,
            "airline_name": str(airline.get("name") or "").strip() or None,
            "departure_airport": str(departure).strip().upper() if departure else None,
            "departure_airport_iata": airport_value("origin", "iata_code"),
            "departure_airport_name": airport_value("origin", "name"),
            "departure_airport_city": airport_value("origin", "municipality"),
            "departure_latitude": airport_value("origin", "latitude"),
            "departure_longitude": airport_value("origin", "longitude"),
            "arrival_airport": str(arrival).strip().upper() if arrival else None,
            "arrival_airport_iata": airport_value("destination", "iata_code"),
            "arrival_airport_name": airport_value("destination", "name"),
            "arrival_airport_city": airport_value("destination", "municipality"),
            "arrival_latitude": airport_value("destination", "latitude"),
            "arrival_longitude": airport_value("destination", "longitude"),
            "route_source": "callsign",
            "route_provider": "ADSBDB",
        }

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
        params = self._state_params(icao24_list, bbox, extended, time_sec)

        # The authenticated proxy can return the complete visible bounding
        # box in one request. This fixes the zoom-out coverage gap caused by a
        # point-radius fallback that only covered the map centre.
        if os.getenv("VERCEL") and time_sec is None and self._vercel_opensky_proxy_enabled():
            try:
                return self._get_opensky_live_states(params, bbox)
            except OpenSkyAPIError:
                # Public ADS-B providers remain the resilience path when the
                # proxy or OpenSky itself is briefly unavailable.
                return self._get_airplanes_live_states(icao24_list=icao24_list, bbox=bbox)

        # Vercel cannot route directly to OpenSky's single public IP when the
        # private proxy is not configured. Keep live traffic available through
        # the public ADS-B fallback in that case.
        if os.getenv("VERCEL") and time_sec is None:
            return self._get_airplanes_live_states(icao24_list=icao24_list, bbox=bbox)

        try:
            return self._make_request("GET", "/states/all", params=params)
        except OpenSkyAPIError:
            if os.getenv("VERCEL") and time_sec is None:
                return self._get_airplanes_live_states(icao24_list=icao24_list, bbox=bbox)
            raise

    def get_track(self, icao24: str, time_sec: int):
        if os.getenv("VERCEL"):
            return self._get_adsb_lol_track(icao24)

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

    def _get_adsb_lol_track(self, icao24: str):
        """Return a recent ADS-B trace using the OpenSky track response shape."""
        code = str(icao24).lower()
        suffix = code[-2:]
        url = f"https://adsb.lol/data/traces/{suffix}/trace_recent_{code}.json"
        try:
            response = self.session.get(
                url,
                headers={"Accept-Encoding": "gzip", "User-Agent": "SkyTrace/2.0"},
                timeout=15,
            )
            if response.status_code == 404:
                return {}
            response.raise_for_status()
            payload = response.json()
        except (requests.RequestException, ValueError) as exc:
            raise OpenSkyAPIError(f"Recent ADS-B track request failed: {exc}") from exc

        base_time = float(payload.get("timestamp") or 0)
        path = []
        callsign = ""
        for point in payload.get("trace") or []:
            if not isinstance(point, list) or len(point) < 6:
                continue
            offset, latitude, longitude, altitude_ft, _speed, track = point[:6]
            if not isinstance(latitude, (int, float)) or not isinstance(longitude, (int, float)):
                continue
            on_ground = altitude_ft == "ground"
            altitude_m = 0.0 if on_ground else (
                float(altitude_ft) * 0.3048 if isinstance(altitude_ft, (int, float)) else None
            )
            timestamp = int(base_time + float(offset))
            path.append([timestamp, latitude, longitude, altitude_m, track, on_ground])
            if len(point) > 8 and isinstance(point[8], dict) and point[8].get("flight"):
                callsign = str(point[8]["flight"]).strip()

        if not path:
            return {}
        return {
            "icao24": code,
            "callsign": callsign,
            "startTime": path[0][0],
            "endTime": path[-1][0],
            "path": path,
            "source": "adsb.lol",
        }

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
