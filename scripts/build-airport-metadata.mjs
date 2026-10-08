/** Rebuild the compact metadata snapshot from an explicitly downloaded OurAirports CSV. */
import { readFile, writeFile } from 'node:fs/promises';
import { execFileSync } from 'node:child_process';
import { find } from 'geo-tz/all';
const source = process.argv[2];
if (!source) throw new Error('Usage: node scripts/build-airport-metadata.mjs /path/to/airports.csv');
const records = JSON.parse(execFileSync('python3', ['-c', `
import csv,json,sys
base={r['icao']:r for r in csv.DictReader(open('data/iata-icao.csv',encoding='utf-8')) if r['icao']}
rows={}
for r in csv.DictReader(open(sys.argv[1],encoding='utf-8')):
    code=r.get('icao_code') or r['ident']
    if code in base: rows[code]=r
print(json.dumps({'base':base,'rows':rows}))
`, source], { maxBuffer: 12 * 1024 * 1024 }));
const airports = {};
for (const [icao, base] of Object.entries(records.base)) {
  const row = records.rows[icao];
  const timezone = find(Number(base.latitude), Number(base.longitude))[0] ?? null;
  airports[icao] = { timezone };
  if (row) Object.assign(airports[icao], {
    city: row.municipality || null, airport_type: row.type,
    scheduled_service: row.scheduled_service === 'yes',
    military_designation: /\b(military|air base|airbase|air force|naval air station|RAF)\b/i.test(`${row.name} ${row.keywords}`),
    website: /^https?:\/\//.test(row.home_link) ? row.home_link : null,
    metadata_source: 'OurAirports',
  });
}
const meta = { retrieved_at: new Date().toISOString().slice(0, 10),
  source: 'https://ourairports.com/data/', license: 'Public domain',
  source_csv_bytes: (await readFile(source)).length,
  timezone_source: 'geo-tz 8.1.9 all / timezone-boundary-builder (ODbL)', airports };
await writeFile('data/airport-metadata.json', JSON.stringify(meta));
console.log(`Metadata: ${Object.keys(airports).length} airports, ${Object.keys(records.rows).length} OurAirports matches`);
