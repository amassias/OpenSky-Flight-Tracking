"""Pure helpers for the flight API: no network, no module-level state.

Kept apart from backend/server.py so they can be tested and reused without importing the
HTTP handler (backlog B66).
"""

import re
import time
from datetime import date, datetime, timezone


def _safe_int(value, default=None):
    try:
        if value is None or value == "":
            return default
        return int(float(value))
    except (TypeError, ValueError):
        return default


def _safe_float(value, default=None):
    try:
        if value is None or value == "":
            return default
        return float(value)
    except (TypeError, ValueError):
        return default


def _iso_from_timestamp(timestamp):
    if timestamp is None:
        return None
    ts = _safe_int(timestamp)
    if ts is None:
        return None
    return datetime.fromtimestamp(ts, tz=timezone.utc).isoformat()


def _extract_current_flight_leg(path, gap_seconds=1800):
    """Trim a multi-rotation trace down to just the most recent flight leg.

    Track providers (OpenSky and the adsb.lol fallback alike) can return one
    continuous trace covering every takeoff and landing an aircraft made
    during the trace window, not just the flight the caller asked about. Each
    waypoint is ``[time, lat, lon, baro_altitude, true_track, on_ground]``.
    A leg boundary is a landing (on_ground True) followed later by another
    takeoff (on_ground False again), or a reception gap wider than
    ``gap_seconds`` with no data at all. We keep only the last leg, which is
    the aircraft's current or most recently completed flight.
    """
    if not path:
        return path

    leg_start = 0
    for index in range(1, len(path)):
        previous_point = path[index - 1]
        point = path[index]
        previous_time = previous_point[0] if len(previous_point) > 0 else None
        current_time = point[0] if len(point) > 0 else None
        on_ground = point[5] if len(point) > 5 else None
        previous_on_ground = previous_point[5] if len(previous_point) > 5 else None

        if (
            isinstance(previous_time, (int, float))
            and isinstance(current_time, (int, float))
            and current_time - previous_time > gap_seconds
        ):
            leg_start = index
            continue

        if previous_on_ground and not on_ground:
            # A takeoff following a ground stop starts a new leg.
            leg_start = index

    return path[leg_start:]


def _chunked(items, chunk_size):
    for i in range(0, len(items), chunk_size):
        yield items[i : i + chunk_size]


def _parse_utc_date(date_str: str) -> date:
    try:
        return datetime.strptime(date_str, "%Y-%m-%d").date()
    except ValueError as exc:
        raise ValueError("Invalid date format. Use YYYY-MM-DD.") from exc


def _operations_match_current_flight(operations, callsign, state=None, now=None):
    if not isinstance(operations, dict):
        return False
    normalize = lambda value: re.sub(r"[^A-Z0-9]", "", str(value or "").upper())
    identifier = operations.get("atc_ident") or operations.get("queried_ident") or operations.get("ident")
    if not identifier or normalize(identifier) != normalize(callsign):
        return False
    state = state or {}
    if state.get("callsign") and normalize(state["callsign"]) != normalize(callsign):
        return False
    if state.get("registration") and operations.get("registration") and normalize(state["registration"]) != normalize(operations["registration"]):
        return False
    def timestamp(value):
        try:
            parsed = datetime.fromisoformat(str(value).replace("Z", "+00:00"))
            return parsed.timestamp() if parsed.tzinfo is not None else None
        except (ValueError, TypeError, OverflowError):
            return None
    start = timestamp(operations.get("actual_out") or operations.get("actual_off") or operations.get("scheduled_out"))
    landed = timestamp(operations.get("actual_in") or operations.get("actual_on"))
    now = time.time() if now is None else now
    if start is None or not 0 <= now - start < 36 * 3600:
        return False
    if landed is not None:
        if state.get("on_ground") is False or not 0 <= now - landed < 2 * 3600:
            return False
    return True
