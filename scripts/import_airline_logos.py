"""Import pinned airline-logo archives in bulk; never fetch assets during application use.

Install requirements-dev.txt; run python3 scripts/import_airline_logos.py.
--offline reuses the verified source archives in .cache/airline-logos.
"""
import argparse
from collections import Counter, defaultdict
import hashlib
import io
import json
from pathlib import Path, PurePosixPath
import re
import subprocess
import zipfile
import xml.etree.ElementTree as ET

from PIL import Image, UnidentifiedImageError

ROOT = Path(__file__).resolve().parents[1]
SOURCES = [
    {'repository': 'imgmongelli/airlines-logos-dataset', 'revision': '7b001fb8d5d0a2f875d57b2b5a8a8056b2fbc63a', 'metadata': 'airlines.json', 'licence': 'MIT (README); airline trademarks belong to their owners'},
    {'repository': 'amannuhman/airlines-and-logos', 'revision': 'f90a5a8e1481dd0e0379936e4a5b477f4cf9f60e', 'metadata': 'data/airlines.json', 'licence': 'Apache-2.0; airline trademarks belong to their owners'},
]
PLACEHOLDER_HASH = 'b34521e5d601195d58a33224df666c96ba9e43491209142133aefbc5c594b3c7'
MAX_IMAGE = 2 * 1024 * 1024


def read_archive(payload):
    """Read bounded archives in memory without extracting arbitrary source paths."""
    result = {}
    with zipfile.ZipFile(io.BytesIO(payload)) as archive:
        if sum(x.file_size for x in archive.infolist()) > 128 * 1024 * 1024:
            raise ValueError('Source archive is too large')
        for entry in archive.infolist():
            path = PurePosixPath(entry.filename)
            if path.is_absolute() or '..' in path.parts:
                raise ValueError('Unsafe archive path')
            relative = '/'.join(path.parts[1:])
            if entry.is_dir() or not relative:
                continue
            if entry.file_size > MAX_IMAGE and relative.endswith(('.png', '.svg')):
                continue
            result[relative] = archive.read(entry)
    return result


def validate_image(payload, extension):
    if not payload or len(payload) > MAX_IMAGE or hashlib.sha256(payload).hexdigest() == PLACEHOLDER_HASH:
        raise ValueError('empty, oversized or placeholder image')
    if extension == '.png':
        try:
            with Image.open(io.BytesIO(payload)) as image:
                if image.format != 'PNG' or min(image.size) < 8 or max(image.size) > 2048:
                    raise ValueError('Invalid PNG dimensions/format')
                image.verify()
            with Image.open(io.BytesIO(payload)) as image:
                rgba = image.convert('RGBA')
                bounds = rgba.getbbox()
                if not bounds or len(rgba.crop(bounds).getcolors(1) or []) == 1:
                    raise ValueError('empty or single-colour image')
        except (UnidentifiedImageError, OSError, SyntaxError) as error:
            raise ValueError('Corrupt PNG') from error
    elif extension == '.svg':
        # Allow static vector artwork only, including styles but no URL references,
        # events, foreign HTML, entities, embedded images or executable elements.
        if re.search(rb'<!|\\|@|\b(?:href|on\w+)\s*=|url\s*\(|javascript:', payload, re.I):
            raise ValueError('Unsafe SVG reference')
        try:
            svg = ET.fromstring(payload)
        except ET.ParseError as error:
            raise ValueError('Corrupt SVG') from error
        allowed = {'svg', 'g', 'path', 'rect', 'circle', 'ellipse', 'polygon', 'polyline', 'line', 'defs', 'style', 'title', 'desc', 'clipPath', 'linearGradient', 'radialGradient', 'stop'}
        if svg.tag != '{http://www.w3.org/2000/svg}svg' or any(not x.tag.startswith('{http://www.w3.org/2000/svg}') or x.tag.split('}')[-1] not in allowed for x in svg.iter()):
            raise ValueError('Unsafe SVG element')
        if not any(x.tag.split('}')[-1] in {'path', 'rect', 'circle', 'polygon'} for x in svg.iter()):
            raise ValueError('empty SVG')
    else:
        raise ValueError('Unsupported image format')


def candidates(rows, assignments, blocked, obsolete, existing, secondary=False):
    accepted, rejected = [], []
    counts = Counter(row.get('icao' if secondary else 'icao_code') for row in rows)
    operator_iata = defaultdict(set)
    for iata, operators in assignments.items():
        for operator in operators:
            operator_iata[operator].add(iata)
    for row in rows:
        icao, iata = row.get('icao' if secondary else 'icao_code'), row.get('iata' if secondary else 'iata_code')
        if not re.fullmatch('[A-Z]{3}', icao or ''):
            continue
        item = {'icao': icao, 'iata': iata, 'name': row.get('name', ''), 'path': f'data/logos/{iata}.svg' if secondary else (row.get('logo') or '').removeprefix('./')}
        reason = None
        if icao in existing:
            reason = 'already present'
        elif icao in blocked or icao in obsolete:
            reason = 'protected exclusion or reassigned code'
        elif counts[icao] > 1:
            reason = 'duplicate operator identity in source'
        elif iata and ((iata in assignments and assignments[iata] != [icao]) or (operator_iata[icao] and iata not in operator_iata[icao])):
            reason = 'conflicting or ambiguous IATA/ICAO assignment'
        elif secondary and (not iata or assignments.get(iata) != [icao]):
            reason = 'secondary source lacks a corroborated assignment'
        elif not item['path']:
            reason = 'source has no logo'
        elif not re.fullmatch(r'(?:images/[A-Z]{3}\.png|data/logos/[A-Z0-9]{2}\.svg)', item['path']):
            reason = 'unexpected source image path'
        elif not secondary and item['path'] != f'images/{icao}.png':
            reason = 'image filename does not match operator'
        (rejected if reason else accepted).append({**item, 'reason': reason} if reason else item)
    return accepted, rejected


def import_catalogue(root, archives, assignments, blocked, obsolete, existing):
    # All source metadata must be available before any output is changed.
    metadata = []
    for source, archive in zip(SOURCES, archives, strict=True):
        if source['metadata'] not in archive:
            raise ValueError(f"Source metadata unavailable: {source['repository']}")
        raw = json.loads(archive[source['metadata']])
        metadata.append(raw['data'] if isinstance(raw, dict) else raw)
    output, assets = {}, {}
    report = {'sources': SOURCES, 'added': [], 'already_present': [], 'rejected': [], 'missing': []}
    for index, (source, archive, rows) in enumerate(zip(SOURCES, archives, metadata, strict=True)):
        accepted, rejected = candidates(rows, assignments, blocked, obsolete, existing, secondary=index == 1)
        for item in rejected:
            report['already_present' if item['reason'] == 'already present' else 'missing' if item['reason'] == 'source has no logo' else 'rejected'].append(item)
        # A repeated source image across unrelated operators is a likely placeholder.
        hashes = Counter(hashlib.sha256(archive[x['path']]).hexdigest() for x in accepted if x['path'] in archive)
        for item in accepted:
            code, path = item['icao'], item['path']
            if code in output:
                continue
            if path not in archive:
                report['missing'].append(item)
                continue
            payload = archive[path]
            digest = hashlib.sha256(payload).hexdigest()
            try:
                if hashes[digest] > 3:
                    raise ValueError('shared image across unrelated operators; possible placeholder')
                validate_image(payload, Path(path).suffix)
            except ValueError as error:
                report['rejected'].append({**item, 'reason': str(error)})
                continue
            url = f'/airline-logos/operators/{code}{Path(path).suffix}'
            output[code] = {'name': item['name'], 'iata': item['iata'], 'url': url,
                            'source': f"https://github.com/{source['repository']}/blob/{source['revision']}/{path}",
                            'revision': source['revision'], 'sha256': digest, 'licence': source['licence']}
            assets[url] = payload
            report['added'].append(code)
    # Pinned sources make this report and all output byte-for-byte reproducible.
    for source, archive in zip(SOURCES, archives, strict=True):
        for name in ('README.md', 'LICENSE'):
            if name in archive:
                target = root / 'data/airline-logo-sources' / source['repository'].split('/')[0] / name
                target.parent.mkdir(parents=True, exist_ok=True)
                target.write_bytes(archive[name])
    for url, payload in assets.items():
        target = root / 'public' / url.lstrip('/')
        target.parent.mkdir(parents=True, exist_ok=True)
        target.write_bytes(payload)
    def save(path, value):
        target = root / path
        target.parent.mkdir(parents=True, exist_ok=True)
        target.write_text(json.dumps(value, indent=2, sort_keys=True) + '\n')
    save('data/airline-operator-logos.json', output)
    save('data/airline-logo-import-report.json', report)
    groups = defaultdict(list)
    for code, item in sorted(output.items()):
        groups[Path(item['url']).suffix].append(code)
    compact = '// Generated by scripts/import_airline_logos.py. Provenance: data/airline-operator-logos.json.\nexport const OPERATOR_LOGOS: Readonly<Record<string, string>> = Object.fromEntries([\n'
    for extension, codes in sorted(groups.items()):
        compact += f'  ..."{" ".join(codes)}".split(" ").map(code => [code, `/airline-logos/operators/${{code}}{extension}`]),\n'
    compact += ']);\n'
    target = root / 'src/shared/airlineOperatorLogos.ts'
    target.parent.mkdir(parents=True, exist_ok=True)
    target.write_text(compact)
    return output


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--offline', action='store_true')
    args = parser.parse_args()
    archives = []
    lock_path = ROOT / 'data/airline-logo-source-lock.json'
    lock = json.loads(lock_path.read_text()) if lock_path.exists() else {}
    for source in SOURCES:
        revision = source['revision']
        cache = ROOT / '.cache/airline-logos' / f'{revision}.zip'
        if not cache.exists():
            if args.offline:
                raise SystemExit(f'Missing cached archive: {cache}')
            cache.parent.mkdir(parents=True, exist_ok=True)
            temporary = cache.with_suffix('.tmp')
            subprocess.run(['curl', '--fail', '--location', '--silent', '--show-error', '--max-time', '120', '--max-filesize', '67108864', '--retry', '2', f"https://codeload.github.com/{source['repository']}/zip/{revision}", '-o', str(temporary)], check=True)
            temporary.replace(cache)
        payload = cache.read_bytes()
        checksum = hashlib.sha256(payload).hexdigest()
        if revision in lock and lock[revision]['sha256'] != checksum:
            raise SystemExit(f'Archive checksum mismatch: {revision}')
        lock[revision] = {'repository': source['repository'], 'sha256': checksum}
        archives.append(read_archive(payload))
    table = (ROOT / 'src/shared/airlineCodes.ts').read_text().split(' = ', 1)[1].strip().removesuffix(';')
    assignments = json.loads(table)
    legacy = json.loads((ROOT / 'data/airline-logos.json').read_text())
    # Use exactly the resolver's legacy mappings, including its explicit aliases.
    identity = (ROOT / 'src/shared/aircraftIdentity.ts').read_text()
    overrides = dict(re.findall(r'\b([A-Z]{3}): "([A-Z0-9]{2})"', identity.split('const OVERRIDES', 1)[1].split('};', 1)[0]))
    enabled = {x['iata'] for x in legacy if not x.get('disabled_reason')}
    existing = {op for op, iata in overrides.items() if iata in enabled}
    blocked = {op for x in legacy if x.get('disabled_reason') for op in assignments.get(x['iata'], [])}
    existing |= {ops[0] for iata, ops in assignments.items() if iata in enabled and len(ops) == 1}
    # Corrections remove old operator associations from the generated table. Preserve that exclusion.
    import csv
    obsolete = set()
    corrections = json.loads((ROOT / 'data/airline-code-corrections.json').read_text())
    corrected = {x['iata']: x['icao'] for x in corrections}
    for row in csv.reader((ROOT / 'data/Airlines data').open()):
        if len(row) >= 5 and row[3] in corrected and row[4] not in corrected[row[3]] and row[4] not in {op for ops in assignments.values() for op in ops}:
            obsolete.add(row[4])
    result = import_catalogue(ROOT, archives, assignments, blocked, obsolete, existing)
    lock_path.write_text(json.dumps(lock, indent=2, sort_keys=True) + '\n')
    report = json.loads((ROOT / 'data/airline-logo-import-report.json').read_text())
    print(json.dumps({key: len(report[key]) for key in ['added', 'already_present', 'rejected', 'missing']}))
    print(f'{len(result)} local operator logos; no legacy logos or exclusions changed.')


if __name__ == '__main__':
    main()
