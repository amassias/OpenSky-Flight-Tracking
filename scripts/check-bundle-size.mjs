// Fails when the gzip size of the entry or vendor JS passes its budget (docs/adr/0001, backlog B70).
import { readdirSync, readFileSync } from "node:fs";
import { gzipSync } from "node:zlib";

const budgets = { index: 62_000, vendor: 165_000 }; // bytes gzip, ~10% above the 2026-10-14 measurement
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
