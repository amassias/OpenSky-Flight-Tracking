"""On-demand readsb traces with independent providers and flight-safe caching.

Public trace files may lag behind their recent counterpart. Merge only files
from one provider, retain their observations, and validate before accepting a
provider so a stale/wrong flight cannot suppress the independent fallback.
"""

import math
import re
import time
from collections import OrderedDict
from threading import Lock

import requests

PROVIDERS = (
    ("theairtraffic.com", "https://globe.theairtraffic.com"),
    ("adsb.lol", "https://adsb.lol"),
)
MAX_AGE = 15 * 60


class TraceUnavailable(Exception):
    """No matching trace could be obtained because a provider failed."""


def _number(value):
    return isinstance(value, (int, float)) and not isinstance(value, bool) and math.isfinite(value)


def _callsign(value):
    return "".join(str(value or "").upper().split())


def _observations(payload, code):
    if not isinstance(payload, dict):
        return []
    identity = str(payload.get("icao") or payload.get("icao24") or code).lower()
    if identity != code:
        return []
    base = payload.get("timestamp")
    points = payload.get("trace")
    if not _number(base) or not isinstance(points, list):
        return []
    result = []
    for point in points:
        if not isinstance(point, list) or len(point) < 6:
            continue
        offset, latitude, longitude = point[:3]
        if not all(_number(v) for v in (offset, latitude, longitude)) or not (-90 <= latitude <= 90 and -180 <= longitude <= 180):
            continue
        result.append((base + offset, point))
    return result


def normalize_trace(code, source, files, now, expected_callsign=""):
    # Recent wins at the same timestamp. Never blend separate provider clocks
    # or attach another aircraft's observations to this requested hex.
    observations = {}
    for _kind, payload in files:
        for timestamp, point in _observations(payload, code):
            observations[int(timestamp)] = point
    if not observations:
        return {}
    latest = max(observations)
    if not now - MAX_AGE <= latest <= now + 60:
        return {}
    path, events = [], []
    callsign = ""
    current_event = None
    leg_start = None
    for raw_timestamp, point in sorted(observations.items()):
        timestamp = int(raw_timestamp)
        if raw_timestamp > now + 60:
            continue
        _, latitude, longitude, altitude_ft, _speed, heading = point[:6]
        ground = altitude_ft == "ground"
        altitude = 0.0 if ground else float(altitude_ft) * 0.3048 if _number(altitude_ft) else None
        path.append([timestamp, latitude, longitude, altitude, heading if _number(heading) else None, ground])
        if len(point) > 6 and isinstance(point[6], int) and point[6] & 2:
            leg_start = timestamp
        details = point[8] if len(point) > 8 and isinstance(point[8], dict) else {}
        observed_callsign = _callsign(details.get("flight"))
        if observed_callsign:
            if callsign and observed_callsign != callsign:
                leg_start = timestamp
            callsign = observed_callsign
        squawk = str(details.get("squawk") or "").strip()
        emergency = str(details.get("emergency") or "").lower()
        event_code = squawk if squawk in {"7500", "7600", "7700"} else emergency if emergency in {"general", "lifeguard", "minfuel", "nordo", "unlawful", "downed"} else None
        if event_code:
            if current_event is None or current_event["code"] != event_code or current_event["callsign"] != callsign:
                if current_event is not None:
                    current_event["ended_at"] = timestamp
                current_event = {"code": event_code, "callsign": callsign, "first_seen": timestamp, "last_seen": timestamp, "ended_at": None}
                events.append(current_event)
            else:
                current_event["last_seen"] = timestamp
        elif current_event is not None and ("squawk" in details or "emergency" in details):
            current_event["ended_at"] = timestamp
            current_event = None
    if expected_callsign and callsign and _callsign(expected_callsign) != callsign:
        return {}
    return {
        "icao24": code, "callsign": callsign, "startTime": path[0][0],
        "endTime": path[-1][0], "path": path, "source": source,
        "trace_kind": "full" if any(kind == "full" and _observations(payload, code) for kind, payload in files) else "recent",
        "leg_start": leg_start, "emergency_events": events,
    }


class AircraftTracks:
    def __init__(self, session):
        self.session = session
        self._cache = OrderedDict()
        self._down_until = {}
        self._next_request = {}
        # Coalesce concurrent requests rather than burst the small public hosts.
        # This lock and cache are per function instance, not a global quota.
        self._lock = Lock()

    def get(self, icao24, callsign="", *, providers=PROVIDERS):
        code = str(icao24).lower()
        if not re.fullmatch(r"[0-9a-f]{6}", code):
            raise ValueError("icao24 must contain six hexadecimal characters")
        key = (code, _callsign(callsign), tuple(name for name, _url in providers))
        with self._lock:
            now = time.time()
            cached = self._cache.get(key)
            if cached and now < cached[0]:
                self._cache.move_to_end(key)
                return cached[1]
            had_error = False
            for name, origin in providers:
                if now < self._down_until.get(name, 0):
                    had_error = True
                    continue
                files = []
                failed = False
                result = {}
                for kind in ("full", "recent"):
                    wait = self._next_request.get(name, 0) - time.time()
                    if wait > 0:
                        time.sleep(wait)
                    self._next_request[name] = time.time() + 1.05
                    try:
                        response = self.session.get(
                            f"{origin}/data/traces/{code[-2:]}/trace_{kind}_{code}.json",
                            headers={"Accept-Encoding": "gzip", "User-Agent": "SkyTrace/2.0 (+https://github.com/amassias/OpenSky-Flight-Tracking)"},
                            timeout=(2, 4),
                        )
                        if response.status_code == 404:
                            continue
                        if response.status_code in (401, 403, 420, 429):
                            failed = True
                            self._down_until[name] = time.time() + 120
                            break
                        response.raise_for_status()
                        payload = response.json()
                        if not isinstance(payload, dict):
                            failed = True
                            continue
                        files.append((kind, payload))
                        result = normalize_trace(code, name, files, time.time(), callsign)
                        # A fresh full file needs no extra lookup. Otherwise
                        # update the tail from recent without losing full history.
                        if result and time.time() - result["endTime"] <= 60:
                            break
                    except (requests.RequestException, ValueError, TypeError):
                        failed = True
                if result:
                    ttl = min(90, MAX_AGE - (time.time() - result["endTime"]))
                    self._remember(key, result, max(1, ttl))
                    return result
                if failed:
                    self._down_until[name] = time.time() + 120
                    had_error = True
            if had_error:
                raise TraceUnavailable("Recorded flight paths are temporarily unavailable. Please try again shortly.")
            self._remember(key, {}, 30)
            return {}

    def _remember(self, key, result, ttl):
        self._cache[key] = (time.time() + ttl, result)
        self._cache.move_to_end(key)
        while len(self._cache) > 256:
            self._cache.popitem(last=False)
