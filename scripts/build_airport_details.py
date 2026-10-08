#!/usr/bin/env python3
"""Rebuild data/airport-details.json from explicitly downloaded OurAirports CSVs.

Usage:
    python3 scripts/build_airport_details.py airports.csv runways.csv airport-frequencies.csv

Only airports already in data/iata-icao.csv are kept, so the snapshot stays
small enough to load in the API function. OurAirports data is public domain:
https://ourairports.com/data/
"""

import csv
import json
import os
import sys
from datetime import date

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
# Frequencies a visitor can actually listen to or recognise on a chart.
# Ordered the way a pilot works through them, from ATIS to departure.
FREQUENCY_TYPES = ["ATIS", "D-ATIS", "DEL", "CLD", "GND", "TWR", "AFIS", "CTAF", "UNIC", "APP", "DEP", "RDO"]


def number(value, digits=None):
    try:
        parsed = float(value)
    except (TypeError, ValueError):
        return None
    if digits == 0:
        return int(round(parsed))
    return round(parsed, digits) if digits is not None else parsed


def main(airports_csv, runways_csv, frequencies_csv):
    with open(os.path.join(ROOT, "data", "iata-icao.csv"), encoding="utf-8") as handle:
        wanted = {row["icao"].strip() for row in csv.DictReader(handle) if row.get("icao", "").strip()}

    refs = {}
    details = {}
    with open(airports_csv, encoding="utf-8") as handle:
        for row in csv.DictReader(handle):
            code = row.get("icao_code") or row["ident"]
            if code not in wanted:
                continue
            refs[row["id"]] = code
            entry = {"runways": [], "frequencies": []}
            elevation = number(row.get("elevation_ft"), 0)
            if elevation is not None:
                entry["elevation_ft"] = elevation
            if row.get("wikipedia_link", "").startswith("https://"):
                entry["wikipedia"] = row["wikipedia_link"]
            details[code] = entry

    with open(runways_csv, encoding="utf-8") as handle:
        for row in csv.DictReader(handle):
            code = refs.get(row["airport_ref"])
            if not code or row.get("closed") == "1":
                continue
            le, he = row.get("le_ident", "").strip(), row.get("he_ident", "").strip()
            # Helipads and water lanes have no useful wind geometry for the board.
            if not le or le.upper().startswith("H"):
                continue
            details[code]["runways"].append([
                le, he or None,
                number(row.get("length_ft"), 0), number(row.get("width_ft"), 0),
                row.get("surface", "").strip() or None,
                row.get("lighted") == "1",
                number(row.get("le_heading_degT"), 1), number(row.get("he_heading_degT"), 1),
            ])

    with open(frequencies_csv, encoding="utf-8") as handle:
        for row in csv.DictReader(handle):
            code = refs.get(row["airport_ref"])
            kind = row.get("type", "").strip().upper()
            mhz = number(row.get("frequency_mhz"), 3)
            if not code or kind not in FREQUENCY_TYPES or mhz is None:
                continue
            details[code]["frequencies"].append([kind, row.get("description", "").strip() or None, mhz])

    for entry in details.values():
        entry["runways"].sort(key=lambda runway: -(runway[2] or 0))
        entry["frequencies"].sort(key=lambda item: (FREQUENCY_TYPES.index(item[0]), item[2]))

    meta = {
        "retrieved_at": date.today().isoformat(),
        "source": "https://ourairports.com/data/",
        "license": "Public domain",
        "fields": {
            "runways": ["le_ident", "he_ident", "length_ft", "width_ft", "surface", "lighted", "le_heading_degT", "he_heading_degT"],
            "frequencies": ["type", "description", "frequency_mhz"],
        },
        "airports": details,
    }
    target = os.path.join(ROOT, "data", "airport-details.json")
    with open(target, "w", encoding="utf-8") as handle:
        json.dump(meta, handle, ensure_ascii=False, separators=(",", ":"))
    with_runways = sum(1 for entry in details.values() if entry["runways"])
    print(f"Details: {len(details)} airports, {with_runways} with runways -> {target}")


if __name__ == "__main__":
    if len(sys.argv) != 4:
        sys.exit(__doc__)
    main(*sys.argv[1:])
