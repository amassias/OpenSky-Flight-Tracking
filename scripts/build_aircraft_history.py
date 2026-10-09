#!/usr/bin/env python3
"""Build data/aircraft-history/ from OpenSky's monthly aircraft-database snapshots.

OpenSky publishes dated copies of its crowdsourced aircraft database in a
public bucket (https://s3.opensky-network.org/data-samples/metadata/, see its
README.TXT). Comparing the copies over time shows when an airframe changed
registration, owner or operator, which no free API serves directly.

Usage:
    python3 scripts/build_aircraft_history.py /path/to/snapshots

The folder holds files named `aircraftDatabase-YYYY-MM.csv` or
`aircraft-database-complete-YYYY-MM.csv` as published by OpenSky. Output:

    data/aircraft-history/<first three hex digits of icao24>.json.gz   one shard per prefix
    data/aircraft-history/index.json                                 provenance and counts

A shard maps icao24 to a record:
    m manufacturer, t model, c type code, n serial (MSN), b year built, e engines,
    q seat configuration, k country, h history [[from, to, registration, owner, operator], ...]
    (months as "YYYY-MM"; `to` is the last snapshot showing that state, null for the latest),
    l other icao24 codes of the same airframe (same manufacturer, type and serial).

OpenSky's data is crowdsourced and provided as is; owner and operator fields are
often blank or generic, and a change is dated only to the snapshot interval.
"""

import csv
import gzip
import json
import os
import re
import sys
from collections import defaultdict
from datetime import date

csv.field_size_limit(10**8)
ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
OUT = os.path.join(ROOT, "data", "aircraft-history")
NAME = re.compile(r"(?:aircraftDatabase|aircraft-database-complete)-(\d{4}-\d{2})\.csv$")

# Positional layout of the 15-column dumps (blank header line) of 2021-12 to 2024-04.
OLD_COLUMNS = ["icao24", "registration", "manufacturericao", "manufacturername", "model", "typecode", "serialnumber",
               "linenumber", "icaoaircrafttype", "operator", "operatorcallsign", "operatoricao", "operatoriata", "owner",
               "categorydescription"]
SERIAL_JUNK = {"", "0", "unknown", "unknow", "n/a", "na", "none", "tbd", "-"}


def clean(value):
    return re.sub(r"\s+", " ", (value or "").replace(" ", " ")).strip()


def rows(path):
    """Yield dicts with lower-cased column names from either OpenSky layout."""
    with open(path, encoding="utf-8", errors="replace", newline="") as handle:
        head = handle.readline()
        handle.seek(0)
        quote = "'" if head.startswith("'icao24'") else '"'
        reader = csv.reader(handle, quotechar=quote)
        first = next(reader, None)
        if first is None:
            return
        if first and first[0].lower() == "icao24":
            columns = [column.lower() for column in first]
        else:
            columns = OLD_COLUMNS
            if any(first):
                yield dict(zip(columns, first))
        for row in reader:
            if row:
                yield dict(zip(columns, row))


def valid_hex(value):
    return len(value) == 6 and all(character in "0123456789abcdef" for character in value)


def main(folder):
    snapshots = sorted((match.group(1), name) for name in os.listdir(folder) if (match := NAME.search(name)))
    if len(snapshots) < 2:
        sys.exit("Need at least two snapshots.")
    months = [month for month, _ in snapshots]
    print("Snapshots:", ", ".join(months))

    static = {}              # icao24 -> latest static fields
    history = defaultdict(list)   # icao24 -> [[from, to, reg, owner, operator]]
    for month, name in snapshots:
        seen = 0
        for row in rows(os.path.join(folder, name)):
            icao24 = clean(row.get("icao24")).lower()
            if not valid_hex(icao24):
                continue
            registration = clean(row.get("registration")).upper()
            owner = clean(row.get("owner"))
            operator = clean(row.get("operator"))
            serial = clean(row.get("serialnumber"))
            model = clean(row.get("model"))
            typecode = clean(row.get("typecode")).upper()
            # Rows with nothing but a hex code say nothing about the airframe.
            if not (registration or owner or operator or serial or model or typecode):
                continue
            seen += 1
            state = [registration, owner, operator]
            timeline = history[icao24]
            if timeline and timeline[-1][2:5] == state:
                timeline[-1][1] = month
            else:
                timeline.append([month, month, *state])
            built = clean(row.get("built"))[:4]
            fields = {
                "m": clean(row.get("manufacturername")) or clean(row.get("manufacturericao")),
                "t": model, "c": typecode, "n": serial,
                "b": built if built.isdigit() else "",
                "e": clean(row.get("engines")),
                "q": clean(row.get("seatconfiguration")),
                "k": clean(row.get("country")),
            }
            previous = static.get(icao24, {})
            # The newest snapshot wins, but never replace a value with a blank.
            static[icao24] = {key: (value or previous.get(key, "")) for key, value in fields.items()}
        print(f"  {month}: {seen:,} aircraft with data")

    latest = months[-1]
    for timeline in history.values():
        if timeline[-1][1] == latest:
            timeline[-1][1] = None

    # Link registrations of one airframe across icao24 codes (a re-registration in
    # another country gives the aircraft a new code): same maker, type and serial.
    groups = defaultdict(set)
    for icao24, fields in static.items():
        serial = fields["n"].lower().replace(" ", "")
        if serial in SERIAL_JUNK or len(serial) < 3 or not (fields["c"] or fields["t"]):
            continue
        groups[(fields["m"].lower(), fields["c"] or fields["t"].lower(), serial)].add(icao24)
    links = {}
    for members in groups.values():
        if 1 < len(members) <= 6:
            for icao24 in members:
                links[icao24] = sorted(members - {icao24})

    shards = defaultdict(dict)
    kept = changed = 0
    for icao24, fields in static.items():
        record = {key: value for key, value in fields.items() if value}
        # A model alone is too thin to keep a record for general-aviation noise.
        if not (record.get("c") or record.get("n") or any(entry[3] or entry[4] for entry in history[icao24])):
            continue
        record["h"] = history[icao24]
        if icao24 in links:
            record["l"] = links[icao24]
        if len(history[icao24]) > 1 or icao24 in links:
            changed += 1
        shards[icao24[:3]][icao24] = record
        kept += 1

    os.makedirs(OUT, exist_ok=True)
    for stale in os.listdir(OUT):
        if stale.endswith(".json.gz"):
            os.remove(os.path.join(OUT, stale))
    for prefix, records in shards.items():
        with gzip.open(os.path.join(OUT, f"{prefix}.json.gz"), "wt", encoding="utf-8", compresslevel=9) as handle:
            json.dump(records, handle, ensure_ascii=False, separators=(",", ":"))
    size = sum(os.path.getsize(os.path.join(OUT, name)) for name in os.listdir(OUT))
    with open(os.path.join(OUT, "index.json"), "w", encoding="utf-8") as handle:
        json.dump({
            "built_at": date.today().isoformat(),
            "source": "https://s3.opensky-network.org/data-samples/metadata/",
            "license_note": "OpenSky Network crowdsourced aircraft database, provided as is.",
            "snapshots": months, "airframes": kept, "with_changes_or_siblings": changed,
        }, handle, indent=1)
    print(f"{kept:,} airframes ({changed:,} with a change or sibling) in {len(shards)} shards, {size / 1e6:.1f} MB")


if __name__ == "__main__":
    if len(sys.argv) != 2:
        sys.exit(__doc__)
    main(sys.argv[1])
