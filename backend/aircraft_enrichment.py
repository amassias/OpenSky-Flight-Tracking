"""Small, source-backed catalogue. No network requests in the selection path."""
import json
import re
from pathlib import Path

DATA = Path(__file__).resolve().parent.parent / "data"
AIRCRAFT_TYPES = json.loads((DATA / "aircraft-types.json").read_text())
CABINS = json.loads((DATA / "cabin-configurations.json").read_text())


def aircraft_enrichment(operator, type_code, registration=""):
    operator = str(operator or "").strip().upper()
    type_code = str(type_code or "").strip().upper()
    registration = str(registration or "").strip().upper()
    if not re.fullmatch(r"[A-Z0-9]{0,3}", operator) or not re.fullmatch(r"[A-Z0-9]{0,4}", type_code):
        raise ValueError("Invalid operator or aircraft type.")
    if not re.fullmatch(r"[A-Z0-9-]{0,12}", registration):
        raise ValueError("Invalid aircraft registration.")
    variants = [entry for entry in CABINS if operator in entry["operators"] and entry["aircraft_type"] == type_code]
    # An exact match requires a sourced registration assignment; fleet/type alone
    # is never enough. The initial catalogue intentionally has no such claims.
    exact = [entry for entry in variants if registration and registration in entry.get("registrations", []) and entry.get("assignment_source")]
    return {"success": True, "operator_code": operator, "aircraft_type": type_code,
            "model": AIRCRAFT_TYPES.get(type_code),
            "match_level": "airframe" if exact else "operator_type" if variants else None,
            "configurations": exact or variants}
