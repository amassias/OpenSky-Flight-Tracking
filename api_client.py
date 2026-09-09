import os
import time
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
        proxy_timeout = float(os.getenv("OPEN_SKY_PROXY_TIMEOUT_SECONDS", "3"))
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
    def _airplanes_live_row(aircraft: Dict[str, Any], now_sec: int):
        """Convert an Airplanes.live aircraft object to an OpenSky state vector."""
        altitude_ft = aircraft.get("alt_baro")
        on_ground = altitude_ft == "ground"
        baro_altitude = None if altitude_ft is None else (0.0 if on_ground else float(altitude_ft) * 0.3048)
        geo_altitude_ft = aircraft.get("alt_geom")
        geo_altitude = float(geo_altitude_ft) * 0.3048 if isinstance(geo_altitude_ft, (int, float)) else None
        speed_knots = aircraft.get("gs")
        velocity = float(speed_knots) * 0.514444 if isinstance(speed_knots, (int, float)) else None
        vertical_fpm = aircraft.get("baro_rate")
        vertical_rate = float(vertical_fpm) * 0.00508 if isinstance(vertical_fpm, (int, float)) else None
        seen_pos = aircraft.get("seen_pos")
        seen = aircraft.get("seen")

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
            None,
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
            radius = min(250.0, max(1.0, self._distance_nm(center_lat, center_lon, lat_max, lon_max)))
            endpoint = f"point/{center_lat:.5f}/{center_lon:.5f}/{radius:.1f}"
        else:
            raise OpenSkyAPIError("A bounding box or aircraft code is required for live fallback data.")

        # Independent public providers use the same ADS-B schema. A provider
        # outage must not make all live traffic unavailable on Vercel.
        last_error = None
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
                response.raise_for_status()
                payload = response.json()
                if not isinstance(payload, dict) or not isinstance(payload.get("ac"), list):
                    raise ValueError("Invalid live aircraft response")
                break
            except (requests.RequestException, ValueError) as exc:
                last_error = exc
        else:
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

        return {
            "time": now_sec,
            "states": [self._airplanes_live_row(item, now_sec) for item in aircraft if item.get("hex")],
            "provider": provider,
        }

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
        # Vercel cannot route to OpenSky's single public IP. Keep live traffic
        # fast there instead of waiting for the historical-data proxy timeout.
        if os.getenv("VERCEL") and time_sec is None:
            return self._get_airplanes_live_states(icao24_list=icao24_list, bbox=bbox)

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
