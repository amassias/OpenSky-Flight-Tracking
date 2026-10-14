"""Validate the logo catalogue locally; --online checks image availability without editing it."""
import argparse
from concurrent.futures import ThreadPoolExecutor
from datetime import date
import hashlib
import json
from pathlib import Path
import re
import subprocess
import xml.etree.ElementTree as ET

ROOT = Path(__file__).resolve().parent.parent
PLACEHOLDER_HASH = "b34521e5d601195d58a33224df666c96ba9e43491209142133aefbc5c594b3c7"
parser = argparse.ArgumentParser(description=__doc__)
parser.add_argument("--online", action="store_true")
parser.add_argument("--iata", help="Comma-separated codes to check online (local validation always covers all records)")
args = parser.parse_args()
records = json.loads((ROOT / "data/airline-logos.json").read_text())
seen = set()
for item in records:
    code, url = item["iata"], item["url"]
    if not re.fullmatch(r"[A-Z0-9]{2}", code) or code in seen:
        raise SystemExit(f"Invalid or duplicate logo code: {code}")
    seen.add(code)
    date.fromisoformat(item["asset_checked_at"])
    if url.startswith("/airline-logos/"):
        if not re.fullmatch(r"/airline-logos/[A-Z0-9]{2}\.(png|svg)", url) or not item.get("source"):
            raise SystemExit(f"Unsourced/invalid local logo: {code}")
        content = (ROOT / "public" / url.lstrip("/")).read_bytes()
        if url.endswith(".svg"):
            element = ET.fromstring(content)
            if element.tag != "{http://www.w3.org/2000/svg}svg" or b"<script" in content.lower():
                raise SystemExit(f"Invalid SVG logo: {code}")
        elif not content.startswith(b"\x89PNG\r\n\x1a\n"):
            raise SystemExit(f"Invalid local PNG: {code}")
    elif url != f"https://images.kiwi.com/airlines/64x64/{code}.png":
        raise SystemExit(f"Unexpected remote logo URL: {code}")

models = json.loads((ROOT / "data/aircraft-types.json").read_text())
for code, source in json.loads((ROOT / "data/aircraft-type-sources.json").read_text()).items():
    if models.get(code) != source["model"] or not source["source"].startswith("https://www.faa.gov/"):
        raise SystemExit(f"Aircraft source/model mismatch: {code}")
    date.fromisoformat(source["checked_at"])

if args.online:
    selected = set(args.iata.upper().split(",")) if args.iata else seen
    if selected - seen:
        raise SystemExit(f"Unknown requested logo codes: {sorted(selected - seen)}")
    def check(item):
        if item["url"].startswith("/") or item.get("disabled_reason"):
            return None
        response = subprocess.run(["curl", "--fail", "--silent", "--show-error", "--location", "--max-time", "15", "--max-filesize", "262144", item["url"]], capture_output=True)
        if response.returncode or not response.stdout.startswith(b"\x89PNG\r\n\x1a\n"):
            return f"{item['iata']}: image unavailable or not PNG"
        if hashlib.sha256(response.stdout).hexdigest() == PLACEHOLDER_HASH:
            return f"{item['iata']}: generic placeholder, not an airline logo"
        return None
    with ThreadPoolExecutor(max_workers=6) as pool:
        errors = [error for error in pool.map(check, [x for x in records if x["iata"] in selected]) if error]
    if errors:
        raise SystemExit("\n".join(errors))
print(f"Logo catalogue valid: {len(records)} records, {sum(not x.get('disabled_reason') for x in records)} enabled; {len(models)} aircraft types")
