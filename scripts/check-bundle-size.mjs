// Fails when the gzip size of the entry, vendor or on-demand MapLibre JS passes its budget (docs/adr/0001, docs/adr/0009, backlog B70).
import { readdirSync, readFileSync } from "node:fs";
import { gzipSync } from "node:zlib";

// bytes gzip, ~10% above the 2026-10-18 measurement of #23 (index 73.8, vendor 158.9, maplibre 256.2 kB).
// maplibre is a lazy chunk, fetched only when a view holds more than 750 aircraft.
const budgets = { index: 81_000, vendor: 175_000, maplibre: 282_000 };
const dir = "dist/assets";
let failed = false;
for (const [prefix, limit] of Object.entries(budgets)) {
  const file = readdirSync(dir).find(name => name.startsWith(`${prefix}-`) && name.endsWith(".js"));
  if (!file) { console.error(`No ${prefix} chunk found in ${dir}`); failed = true; continue; }
  const size = gzipSync(readFileSync(`${dir}/${file}`)).length;
  const ok = size <= limit;
  console.log(`${ok ? "ok  " : "FAIL"} ${prefix}: ${(size / 1000).toFixed(1)} kB gzip (budget ${(limit / 1000).toFixed(0)} kB)`);
  if (!ok) failed = true;
}
process.exit(failed ? 1 : 0);
