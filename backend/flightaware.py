"""Pure FlightAware AeroAPI selection and normalisation: no network, no state.

Split out of backend/api_client.py (backlog B67) so the rules that decide which record
describes the flight we are looking at can be read and tested on their own.
"""

import re
import time
from datetime import datetime, timezone
from typing import Any, Dict, Optional


def _flightaware_ident(value: Any) -> str:
    """Normalise a callsign or registration for an AeroAPI path segment."""
    return "".join(character for character in str(value or "").upper() if character.isalnum())[:16]


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


def _pick_flightaware_flight(
    payload: Dict[str, Any],
    callsign: str,
    registration: Optional[str] = None,
) -> Optional[Dict[str, Any]]:
    """Choose the current record from AeroAPI's list response.

    ``/flights/{ident}`` can contain a scheduled, en-route and completed
    record at once. Prefer an exact identifier/tail match, then a record
    in progress, then the one whose departure-to-arrival window is
    closest to now.
    """
    flights = payload.get("flights")
    if not isinstance(flights, list):
        return None
    target_callsign = _flightaware_ident(callsign)
    target_registration = _flightaware_ident(registration)
    now = int(time.time())

    def score(item: Dict[str, Any]):
        # Identity first: the record must be this flight (and airframe).
        identity = 0
        atc_ident = _flightaware_ident(item.get("atc_ident"))
        ident = _flightaware_ident(item.get("ident"))
        item_registration = _flightaware_ident(item.get("registration") or item.get("tailnumber"))
        if target_callsign and atc_ident == target_callsign:
            identity += 150
        if target_callsign and ident == target_callsign:
            identity += 120
        if target_registration and item_registration == target_registration:
            identity += 90

        # Then the instance happening now. The list mixes yesterday's
        # completed leg with today's; ranking completed records higher
        # (as before) showed a departing BAW33 as "Arrived, 100%".
        status = str(item.get("status") or "").lower()
        active = bool(item.get("actual_out") or item.get("actual_off")) and not item.get("actual_in") \
            and not item.get("cancelled") and not status.startswith(("arriv", "land", "cancel"))
        start = next((value for value in (
            _provider_timestamp(item.get(key)) for key in ("actual_out", "estimated_out", "scheduled_out")
        ) if value is not None), None)
        finish = next((value for value in (
            _provider_timestamp(item.get(key)) for key in ("actual_in", "estimated_in", "scheduled_in")
        ) if value is not None), None)
        if start is None and finish is None:
            distance = 86_400 * 7
        elif start is not None and finish is not None and start <= now <= finish:
            distance = 0
        else:
            distance = min(abs(now - edge) for edge in (start, finish) if edge is not None)
        return identity, 1 if active else 0, -distance

    candidates = [item for item in flights if isinstance(item, dict)]
    return max(candidates, key=score) if candidates else None


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


def _normalize_flightaware_flight(flight: Dict[str, Any], queried_ident: str) -> Dict[str, Any]:
    """Return a compact, stable contract instead of forwarding raw data."""
    airline = flight.get("airline") or flight.get("operator")
    airline_code = None
    airline_name = None
    if isinstance(airline, dict):
        airline_code = airline.get("icao") or airline.get("iata") or airline.get("code")
        airline_name = airline.get("name") or airline.get("display_name")
    elif airline not in (None, ""):
        text = str(airline).strip()
        # AeroAPI's `operator` is an ICAO/IATA code ("AFR"), not a name;
        # the server resolves names from the bundled airline table.
        if text.isalnum() and text.isupper() and len(text) <= 3:
            airline_code = text
        else:
            airline_name = text

    fields = {
        "provider": "FlightAware",
        "queried_ident": queried_ident,
        "fa_flight_id": flight.get("fa_flight_id"),
        "ident": flight.get("ident"),
        "atc_ident": flight.get("atc_ident"),
        "status": flight.get("status"),
        "airline_code": airline_code,
        "airline_name": airline_name,
        "origin": _flightaware_airport(flight.get("origin")),
        "destination": _flightaware_airport(flight.get("destination")),
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
        # AeroAPI v4 names these gate_origin/gate_destination; the
        # short names are kept as the public contract.
        "gate_orig": flight.get("gate_origin") or flight.get("gate_orig"),
        "gate_dest": flight.get("gate_destination") or flight.get("gate_dest"),
        "ident_icao": flight.get("ident_icao"),
        "ident_iata": flight.get("ident_iata"),
        "codeshares_iata": flight.get("codeshares_iata"),
        "baggage_claim": flight.get("baggage_claim"),
        "route_distance": flight.get("route_distance"),
        "terminal_orig": flight.get("terminal_origin") or flight.get("terminal_orig"),
        "terminal_dest": flight.get("terminal_destination") or flight.get("terminal_dest"),
        "filed_ete": flight.get("filed_ete"),
        "filed_airspeed": flight.get("filed_airspeed"),
        "filed_altitude": flight.get("filed_altitude"),
    }
    # Keep numeric values numeric and omit provider-specific blanks. This
    # also prevents an unexpected nested object from reaching the browser.
    allowed_numbers = {
        "progress_percent", "departure_delay", "arrival_delay", "filed_ete",
        "filed_airspeed", "filed_altitude", "route_distance",
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
        elif key == "codeshares_iata":
            if isinstance(value, list):
                normalized[key] = [str(item) for item in value[:8] if item]
        else:
            normalized[key] = value
    return normalized
