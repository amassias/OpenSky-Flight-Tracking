"""Bulk import must not turn a missing mark into an incorrect operator identity."""
import io
import json
import zipfile

import pytest
from PIL import Image
from scripts.import_airline_logos import validate_image, candidates, import_catalogue, read_archive


def png(color='red'):
    output = io.BytesIO()
    image = Image.new('RGBA', (16, 16), 'white')
    for x in range(3, 13):
        for y in range(3, 13):
            image.putpixel((x, y), (255, 0, 0, 255) if color == 'red' else (0, 0, 255, 255))
    image.save(output, format='PNG')
    return output.getvalue()


def test_decodes_real_images_and_rejects_corrupt_empty_and_unsafe_files():
    validate_image(png(), '.png')
    for content in [b'not a png', png()[:50]]:
        with pytest.raises(ValueError):
            validate_image(content, '.png')
    stream = io.BytesIO()
    Image.new('RGBA', (16, 16), (0, 0, 0, 0)).save(stream, format='PNG')
    with pytest.raises(ValueError, match='empty'):
        validate_image(stream.getvalue(), '.png')
    for svg in [b'<svg xmlns="http://www.w3.org/2000/svg"><script/></svg>', b'<svg xmlns="http://www.w3.org/2000/svg"><image href="https://evil.test/a"/></svg>']:
        with pytest.raises(ValueError):
            validate_image(svg, '.svg')


def test_candidate_matching_excludes_ambiguous_reassigned_and_blocked_codes():
    rows = [dict(icao_code=c, iata_code=i, name=c, logo=f'./images/{c}.png') for c, i in [('NEW', None), ('OLD', 'AA'), ('BAD', 'BB'), ('AMB', 'CC'), ('YES', 'DD')]]
    accepted, rejected = candidates(rows, {'AA': ['NOW'], 'BB': ['BAD'], 'CC': ['AMB', 'OTH'], 'DD': ['YES']}, {'BAD'}, {'OLD'}, set())
    assert {x['icao'] for x in accepted} == {'NEW', 'YES'}
    assert {x['icao'] for x in rejected} == {'OLD', 'BAD', 'AMB'}


def test_import_handles_missing_corruption_secondary_fallback_and_is_idempotent(tmp_path):
    rows = [dict(icao_code=c, iata_code=None, name=c, logo=f'./images/{c}.png') for c in ['NEW', 'BAD', 'NIL']]
    first = {'airlines.json': json.dumps({'data': rows}).encode(), 'images/NEW.png': png(), 'images/BAD.png': b'broken'}
    second = {'data/airlines.json': json.dumps([{'icao': 'SEC', 'iata': 'SS', 'name': 'Secondary'}]).encode(), 'data/logos/SS.svg': b'<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 16 16"><path d="M0 0h16v16z"/></svg>'}
    def run():
        return import_catalogue(tmp_path, [first, second], {'SS': ['SEC']}, set(), set(), set())
    result = run()
    assert set(result) == {'NEW', 'SEC'}
    snapshots = {p.relative_to(tmp_path): p.read_bytes() for p in tmp_path.rglob('*') if p.is_file()}
    assert run() == result
    assert snapshots == {p.relative_to(tmp_path): p.read_bytes() for p in tmp_path.rglob('*') if p.is_file()}
    report = json.loads((tmp_path / 'data/airline-logo-import-report.json').read_text())
    assert any(x['icao'] == 'BAD' for x in report['rejected'])
    assert any(x['icao'] == 'NIL' for x in report['missing'])


def test_archive_rejects_traversal_and_source_failure_keeps_catalogue(tmp_path):
    stream = io.BytesIO()
    with zipfile.ZipFile(stream, 'w') as archive:
        archive.writestr('repo/../escape.png', png())
    with pytest.raises(ValueError):
        read_archive(stream.getvalue())
    target = tmp_path / 'data/airline-operator-logos.json'
    target.parent.mkdir()
    target.write_text('{"existing":true}')
    with pytest.raises(ValueError):
        import_catalogue(tmp_path, [{}, {}], {}, set(), set(), set())
    assert target.read_text() == '{"existing":true}'


def test_network_failure_does_not_modify_existing_catalogue(tmp_path, monkeypatch):
    import subprocess
    import scripts.import_airline_logos as importer
    target = tmp_path / 'data/airline-operator-logos.json'
    target.parent.mkdir()
    target.write_text('{"existing":true}')
    monkeypatch.setattr(importer, 'ROOT', tmp_path)
    monkeypatch.setattr('sys.argv', ['import_airline_logos.py'])
    def fail(*args, **kwargs):
        raise subprocess.CalledProcessError(22, 'curl')
    monkeypatch.setattr(importer.subprocess, 'run', fail)
    with pytest.raises(subprocess.CalledProcessError):
        importer.main()
    assert target.read_text() == '{"existing":true}'
