"""Airframe history assembled from free, open sources.

* OpenSky's monthly aircraft-database snapshots (2020-2025), compared over time
  by scripts/build_aircraft_history.py: registration, owner and operator changes
  for aircraft of every country, dated to the snapshot month.
* The FAA's public aircraft registry (scripts/build_faa_registry.py): the current
  and every earlier US registration of an airframe, with registration and
  cancellation dates, location and export country.

Both are bundled as small gzip shards keyed by the first three hex digits of the
ICAO24 code, so a lookup reads one or two ~200 KB files. Individuals' names are
not stored by the FAA builder; for N-registered aircraft the OpenSky names are
passed through the same organisation filter.
"""

import gzip
import json
import os
import re
from functools import lru_cache
from typing import Any, Dict, List, Optional

BASE = os.path.dirname(__file__)
OPENSKY_DIR = os.path.join(BASE, "data", "aircraft-history")
FAA_DIR = os.path.join(BASE, "data", "faa-registry")
HEX = re.compile(r"^[0-9a-f]{6}$")

ORGANISATION = re.compile(
    r"\b(LLC|INC|CORP|CORPORATION|CO|COMPANY|LTD|LIMITED|LP|LLP|PLC|BANK|LEASING|LEASE|AIRLINES?|AIRWAYS|AIR|AVIATION|"
    r"AIRCRAFT|AEROSPACE|FINANCE|FINANCIAL|CAPITAL|HOLDINGS?|GROUP|SERVICES?|SYSTEMS|INDUSTRIES|ENTERPRISES?|CLUB|AIRPORT|"
    r"UNIVERSITY|COLLEGE|SCHOOL|ACADEMY|DEPARTMENT|COUNTY|CITY OF|STATE OF|FOUNDATION|ASSOCIATION|AUTHORITY|EXPRESS|CARGO|"
    r"CHARTER|JETS?|HELICOPTERS?|FLIGHT|WINGS|AMERICA|AMERICAN|UNITED|DELTA|SOUTHWEST|ALASKA|FRONTIER|SPIRIT|"
    r"SKY\w*|HAWAIIAN|VIRGIN|FEDEX|FEDERAL|UPS|BOEING|AIRBUS|TEXTRON|CESSNA|GULFSTREAM|BOMBARDIER|EMBRAER|PIPER|NETJETS|FLEXJET)\b",
    re.IGNORECASE,
)
# A trustee is a person unless a bank or company is named too; "Smith John A" is a person.
INSTITUTION = re.compile(r"\b(BANK|NATIONAL|COMPANY|CORP|CORPORATION|INC|LLC|LTD|LEASING|FINANCIAL|CAPITAL|AVIATION|AIRCRAFT|AIR|SERVICES?)\b", re.IGNORECASE)
PERSONAL = re.compile(r"\b(TRUSTEE|TRUST|ESTATE|REVOCABLE|FAMILY|LIVING)\b", re.IGNORECASE)
PERSON_SHAPED = re.compile(r"^[A-Z][A-Za-z'\-]+ [A-Z][A-Za-z'\-]+( [A-Z]\.?)?( (JR|SR|II|III|IV)\.?)?( TRUSTEE)?$", re.IGNORECASE)
NO_OWNER = {"", "private", "unknown", "n/a"}


@lru_cache(maxsize=24)
def _shard(directory: str, prefix: str) -> Dict[str, Any]:
    path = os.path.join(directory, f"{prefix}.json.gz")
    try:
        with gzip.open(path, "rt", encoding="utf-8") as handle:
            return json.load(handle)
    except (OSError, ValueError):
        return {}


def snapshot_range() -> Optional[Dict[str, Any]]:
    try:
        with open(os.path.join(OPENSKY_DIR, "index.json"), encoding="utf-8") as handle:
            index = json.load(handle)
    except (OSError, ValueError):
        return None
    months = index.get("snapshots") or []
    return {"first": months[0], "last": months[-1], "count": len(months)} if months else None


def _is_us(registration: str, icao24: str) -> bool:
    return bool(re.match(r"^N[0-9]", registration or "")) or icao24.startswith(("a0", "a1", "a2", "a3", "a4", "a5", "a6", "a7", "a8", "a9", "aa", "ab", "ac", "ad"))


def _shown_owner(name: str, us: bool) -> Optional[str]:
    """An owner name, or None when a US-registered aircraft's owner looks like a person."""
    name = (name or "").strip()
    if name.lower() in NO_OWNER:
        return None
    if us:
        if not ORGANISATION.search(name):
            return None
        if (PERSON_SHAPED.match(name) or PERSONAL.search(name)) and not INSTITUTION.search(name):
            return None
    return name


def _day(value: str) -> Optional[str]:
    return f"{value[:4]}-{value[4:6]}-{value[6:8]}" if value and len(value) == 8 and value.isdigit() else None


def _opensky(icao24: str) -> Optional[Dict[str, Any]]:
    return _shard(OPENSKY_DIR, icao24[:3]).get(icao24)


def _faa(icao24: str):
    shard = _shard(FAA_DIR, icao24[:3])
    return shard.get("a", {}).get(icao24), shard.get("refs", {}), shard.get("l", {}).get(icao24, [])


def _opensky_entries(icao24: str, record: Dict[str, Any]) -> List[Dict[str, Any]]:
    entries = []
    for start, end, registration, owner, operator in record.get("h", []):
        us = _is_us(registration, icao24)
        shown_owner = _shown_owner(owner, us)
        # Operators are organisations by definition; only owners can be people.
        shown_operator = _shown_owner(operator, False)
        entries.append({
            "source": "opensky", "icao24": icao24, "registration": registration or None,
            "from": start, "to": end, "precision": "month",
            "owner": shown_owner, "operator": shown_operator, "private": bool(owner) and shown_owner is None and us,
        })
    return entries


def _faa_entries(icao24: str, rows: List[List[str]], refs: Dict[str, Any], serial_filter: Optional[str]) -> List[Dict[str, Any]]:
    entries = []
    for number, serial, model_code, year, owner, city, state, country, registered, cancelled, export_country in rows:
        # An N-number can be re-issued to another airframe: keep rows for this serial only.
        if serial_filter and serial and serial.lower().lstrip("0") != serial_filter:
            continue
        location = ", ".join(part for part in (city, state if state else country) if part) or None
        model = refs.get(model_code) or []
        entries.append({
            "source": "faa", "icao24": icao24, "registration": number,
            "from": _day(registered), "to": _day(cancelled), "precision": "day",
            "owner": owner, "operator": None, "private": owner is None, "location": location,
            "event": (f"Exported to {export_country.title()}" if export_country else "Registration cancelled") if cancelled else None,
            "model": " ".join(part for part in (model[0], model[1]) if part) if model else None,
        })
    return entries


def _merge_sources(entries: List[Dict[str, Any]]) -> List[Dict[str, Any]]:
    """Fold OpenSky rows into the FAA row for the same registrant and drop empty ones.

    The FAA has exact dates, so it wins; the OpenSky operator is copied onto it.
    A row that says nothing but a registration is kept only when no other row
    mentions that registration.
    """
    faa = {(entry["registration"], (entry["owner"] or "").lower()): entry for entry in entries if entry["source"] == "faa" and entry["owner"]}
    kept: List[Dict[str, Any]] = []
    for entry in entries:
        match = faa.get((entry["registration"], (entry["owner"] or "").lower())) if entry["source"] == "opensky" and entry["owner"] else None
        if match is not None:
            match["operator"] = match["operator"] or entry["operator"]
            continue
        kept.append(entry)
    informative = {entry["registration"] for entry in kept if entry["owner"] or entry["operator"] or entry.get("private") or entry["source"] == "faa"}
    return [
        entry for entry in kept
        if entry["owner"] or entry["operator"] or entry.get("private") or entry["source"] == "faa" or entry["registration"] not in informative
    ]


def airframe_history(icao24: str) -> Dict[str, Any]:
    """Everything known offline about one airframe, newest registration first."""
    icao24 = (icao24 or "").strip().lower()
    if not HEX.match(icao24):
        raise ValueError("icao24 must contain exactly 6 hexadecimal characters.")

    record = _opensky(icao24)
    faa_rows, refs, faa_links = _faa(icao24)
    linked = list(dict.fromkeys([*((record or {}).get("l") or []), *faa_links]))[:8]

    faa_serial = None
    if faa_rows:
        current = faa_rows[0]
        faa_serial = (current[1] or "").lower().lstrip("0") or None
    entries: List[Dict[str, Any]] = []
    if record:
        entries += _opensky_entries(icao24, record)
    if faa_rows:
        entries += _faa_entries(icao24, faa_rows, refs, faa_serial)
    for other in linked:
        other_record = _opensky(other)
        other_rows, other_refs, _ = _faa(other)
        if other_record:
            entries += _opensky_entries(other, other_record)
        if other_rows:
            entries += _faa_entries(other, other_rows, other_refs, faa_serial)

    entries = _merge_sources(entries)

    def sort_key(entry: Dict[str, Any]):
        # Open-ended (current) stays first, then newest start date.
        return (entry["to"] is None, entry["from"] or "", entry["to"] or "")

    entries.sort(key=sort_key, reverse=True)
    entries = [dict(entry, current=bool(index == 0 and entry["to"] is None and entry["icao24"] == icao24)) for index, entry in enumerate(entries)]

    airframe: Dict[str, Any] = {}
    if record:
        airframe = {
            "manufacturer": record.get("m"), "model": record.get("t"), "type_code": record.get("c"),
            "serial": record.get("n"), "built": record.get("b"), "engines": record.get("e"),
            "seats": record.get("q"), "country": record.get("k"),
        }
    if faa_rows:
        newest = faa_rows[0]
        model = refs.get(newest[2]) or []
        airframe.setdefault("manufacturer", model[0] if model else None)
        airframe.setdefault("model", model[1] if len(model) > 1 else None)
        airframe.setdefault("serial", newest[1] or None)
        airframe.setdefault("built", newest[3] or None)
        airframe.setdefault("country", "United States")
        if len(model) > 2 and model[2] and not airframe.get("seats"):
            airframe["seats"] = str(model[2])
    airframe = {key: value for key, value in airframe.items() if value}

    sources = []
    if record or any(entry["source"] == "opensky" for entry in entries):
        sources.append("OpenSky aircraft database snapshots")
    if faa_rows or any(entry["source"] == "faa" for entry in entries):
        sources.append("FAA aircraft registry")
    return {
        "icao24": icao24,
        "found": bool(entries or airframe),
        "airframe": airframe,
        "history": entries,
        "linked_icao24": linked,
        "snapshots": snapshot_range(),
        "sources": sources,
    }
