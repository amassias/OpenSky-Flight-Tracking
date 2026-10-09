#!/usr/bin/env python3
"""Build data/faa-registry/ from the FAA's releasable aircraft database.

The FAA publishes its aircraft registry daily as a public download
(https://www.faa.gov/licenses_certificates/aircraft_certification/aircraft_registry/releasable_aircraft_download):

    curl -L -A "Mozilla/5.0" -o ReleasableAircraft.zip https://registry.faa.gov/database/ReleasableAircraft.zip
    unzip ReleasableAircraft.zip -d faa
    python3 scripts/build_faa_registry.py faa

MASTER.txt lists every aircraft currently registered in the United States; DEREG.txt
lists registrations that ended, with the registrant at cancellation and the export
country. Both carry the Mode S code, which is the ICAO24 the live feeds use.

Privacy: street addresses are never kept. A registrant name is kept only when it is
an organisation (a company, bank, club, school or government body); individuals,
partnerships and co-owners appear as "private owner" with only the state.

Output: data/faa-registry/<first three hex digits>.json.gz, a mapping with
    refs  {model code: [manufacturer, model, seats, engines]}
    a     {icao24: [row, ...]}  newest registration first, where
    row = [n_number, serial, model_code, year_built, owner|None, city, state, country,
           registered_YYYYMMDD, cancelled_YYYYMMDD|"", export_country]
    l     {icao24: [other icao24 of the same airframe]}  (same model code and serial)
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
OUT = os.path.join(ROOT, "data", "faa-registry")

# MASTER "TYPE REGISTRANT": 3 corporation, 5 government, 7 LLC, 8 non-citizen corporation.
ORGANISATION_TYPES = {"3", "5", "7", "8"}
ORGANISATION = re.compile(
    r"\b(LLC|L L C|INC|INCORPORATED|CORP|CORPORATION|CO|COMPANY|LTD|LIMITED|LP|L P|LLP|PLC|BANK|LEASING|LEASE|AIRLINES?|AIRWAYS|"
    r"AIR|AVIATION|AIRCRAFT|AEROSPACE|FINANCE|FINANCIAL|CAPITAL|HOLDINGS?|GROUP|SERVICES?|SYSTEMS|INDUSTRIES|ENTERPRISES?|"
    r"FLYING CLUB|AERO CLUB|CLUB|AIRPORT|UNIVERSITY|COLLEGE|SCHOOL|ACADEMY|DEPARTMENT|DEPT|COUNTY|CITY OF|STATE OF|UNITED STATES|"
    r"FOUNDATION|ASSOCIATION|ASSN|AUTHORITY|SECURITY|EXPRESS|CARGO|CHARTER|JET|JETS|HELICOPTERS?|FLIGHT|WINGS|"
    r"AMERICA|AMERICAN|UNITED|DELTA|SOUTHWEST|ALASKA|FRONTIER|SPIRIT|HAWAIIAN|VIRGIN|FEDEX|FEDERAL|BOEING|AIRBUS|TEXTRON|"
    r"CESSNA|GULFSTREAM|BOMBARDIER|EMBRAER|PIPER|NETJETS|FLEXJET)\b"
)
# Registry quirks that look like organisations but name a person.
PERSONAL = re.compile(r"\b(TRUSTEE|TRUST|ESTATE|REVOCABLE|FAMILY|LIVING)\b")
# Words that make a name an organisation even when it is also a trustee.
INSTITUTION = re.compile(r"\b(BANK|NATIONAL|COMPANY|CORP|CORPORATION|INC|LLC|LTD|LEASING|FINANCIAL|CAPITAL|AVIATION|AIRCRAFT|AIR|SERVICES?)\b")


PERSON_SHAPED = re.compile(r"^[A-Z][A-Za-z'\-]+ [A-Z][A-Za-z'\-]+( [A-Z]\.?)?( (JR|SR|II|III|IV)\.?)?( TRUSTEE)?$", re.IGNORECASE)


def text(value):
    return re.sub(r"\s+", " ", (value or "").strip())


def keep_name(name, registrant_type):
    if not name:
        return None
    if PERSON_SHAPED.match(name) and not INSTITUTION.search(name):
        return None
    if registrant_type in ORGANISATION_TYPES or ORGANISATION.search(name):
        # A trust or estate is a person's holding vehicle unless a bank or company runs it.
        if PERSONAL.search(name) and not INSTITUTION.search(name):
            return None
        return name.title().replace(" Llc", " LLC").replace(" Lp", " LP").replace(" Inc", " Inc")
    return None


def read(path):
    with open(path, encoding="utf-8-sig", errors="replace", newline="") as handle:
        reader = csv.reader(handle)
        header = [column.strip() for column in next(reader)]
        for row in reader:
            if len(row) >= len(header) - 1:
                yield {header[index]: text(value) for index, value in enumerate(row[: len(header)])}


def valid_hex(value):
    return len(value) == 6 and all(character in "0123456789abcdef" for character in value)


def main(folder):
    refs = {}
    for row in read(os.path.join(folder, "ACFTREF.txt")):
        refs[row["CODE"]] = [row["MFR"].title(), row["MODEL"], int(row["NO-SEATS"]) if row["NO-SEATS"].isdigit() else 0,
                             int(row["NO-ENG"]) if row["NO-ENG"].isdigit() else 0]

    records = defaultdict(list)
    for row in read(os.path.join(folder, "MASTER.txt")):
        icao24 = row["MODE S CODE HEX"].lower()
        if not valid_hex(icao24):
            continue
        records[icao24].append([
            "N" + row["N-NUMBER"], row["SERIAL NUMBER"], row["MFR MDL CODE"], row["YEAR MFR"],
            keep_name(row["NAME"], row["TYPE REGISTRANT"]), row["CITY"].title(), row["STATE"],
            "" if row["COUNTRY"] in ("US", "") else row["COUNTRY"],
            row["CERT ISSUE DATE"], "", "",
        ])
    for row in read(os.path.join(folder, "DEREG.txt")):
        icao24 = row["MODE S CODE HEX"].lower()
        if not valid_hex(icao24):
            continue
        records[icao24].append([
            "N" + row["N-NUMBER"], row["SERIAL-NUMBER"], row["MFR-MDL-CODE"], row["YEAR-MFR"],
            keep_name(row["NAME"], ""), row["CITY-MAIL"].title(), row["STATE-ABBREV-MAIL"],
            "" if row["COUNTRY-MAIL"] in ("US", "") else row["COUNTRY-MAIL"],
            row["CERT-ISSUE-DATE"], row["CANCEL-DATE"], row["EXP-COUNTRY"],
        ])

    groups = defaultdict(set)
    for icao24, rows in records.items():
        for row in rows:
            serial = row[1].lower().replace(" ", "").lstrip("0")
            if len(serial) >= 3 and row[2]:
                groups[(row[2], serial)].add(icao24)
    links = defaultdict(list)
    for members in groups.values():
        if 1 < len(members) <= 6:
            for icao24 in members:
                links[icao24] = sorted(members - {icao24})

    shards = defaultdict(lambda: {"refs": {}, "a": {}, "l": {}})
    for icao24, rows in records.items():
        # Newest first: the current registration (no cancel date), then by cancel date.
        rows.sort(key=lambda row: (row[9] == "", row[9] or row[8]), reverse=True)
        shard = shards[icao24[:3]]
        shard["a"][icao24] = rows
        if icao24 in links:
            shard["l"][icao24] = links[icao24]
        for row in rows:
            if row[2] in refs:
                shard["refs"][row[2]] = refs[row[2]]

    os.makedirs(OUT, exist_ok=True)
    for stale in os.listdir(OUT):
        if stale.endswith(".json.gz"):
            os.remove(os.path.join(OUT, stale))
    for prefix, shard in shards.items():
        with gzip.open(os.path.join(OUT, f"{prefix}.json.gz"), "wt", encoding="utf-8", compresslevel=9) as handle:
            json.dump(shard, handle, ensure_ascii=False, separators=(",", ":"))
    size = sum(os.path.getsize(os.path.join(OUT, name)) for name in os.listdir(OUT))
    with open(os.path.join(OUT, "index.json"), "w", encoding="utf-8") as handle:
        json.dump({
            "built_at": date.today().isoformat(),
            "source": "https://registry.faa.gov/database/ReleasableAircraft.zip",
            "license_note": "FAA aircraft registry, public record. Street addresses and individuals' names are not kept.",
            "airframes": len(records), "shards": len(shards),
        }, handle, indent=1)
    print(f"{len(records):,} airframes in {len(shards)} shards, {size / 1e6:.1f} MB")


if __name__ == "__main__":
    if len(sys.argv) != 2:
        sys.exit(__doc__)
    main(sys.argv[1])
