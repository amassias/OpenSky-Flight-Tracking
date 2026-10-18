// Usage: node run-bench.mjs [seconds] -> prints a JSON table. Needs `npm run dev` on :5199.
import { chromium } from "playwright";

const SECONDS = Number(process.argv[2] || 10);
const MODES = ["maplibre-setdata", "maplibre-update", "deck"];
const CPU = [1, 4, 6]; // 1 = this machine; 4/6 = CPU-throttled proxy for a mid-range phone
const pct = (a, p) => a[Math.min(a.length - 1, Math.floor(a.length * p))];

const browser = await chromium.launch({ args: ["--enable-gpu", "--ignore-gpu-blocklist", "--use-angle=metal"] });
const rows = [];
for (const cpu of CPU) for (const mode of MODES) {
  const ctx = await browser.newContext({ viewport: cpu === 1 ? { width: 1440, height: 900 } : { width: 390, height: 844 }, deviceScaleFactor: cpu === 1 ? 1 : 3, hasTouch: cpu !== 1 });
  const page = await ctx.newPage();
  const cdp = await ctx.newCDPSession(page);
  await cdp.send("Emulation.setCPUThrottlingRate", { rate: cpu });
  await page.goto(`http://localhost:5199/?mode=${mode}&n=10000`);
  await page.waitForFunction(() => window.__bench?.ready, null, { timeout: 60000 });
  await page.waitForTimeout(2000); // warm-up
  await page.evaluate(() => { window.__bench.frames.length = 0; window.__bench.updates.length = 0; });
  await page.waitForTimeout(SECONDS * 1000);
  const s = await page.evaluate(() => ({ f: window.__bench.frames, u: window.__bench.updates, gpu: window.__bench.gpu }));
  const f = [...s.f].sort((a, b) => a - b), u = [...s.u].sort((a, b) => a - b);
  rows.push({
    cpuThrottle: cpu, viewport: cpu === 1 ? "desktop 1440x900" : "phone 390x844@3x", mode, gpu: s.gpu,
    avgFps: +(s.f.length / (s.f.reduce((a, b) => a + b, 0) / 1000)).toFixed(1),
    p95FrameMs: +pct(f, 0.95).toFixed(1), worstFrameMs: +f[f.length - 1].toFixed(1),
    dataUpdateMsP50: +pct(u, 0.5).toFixed(1), dataUpdateMsP95: +pct(u, 0.95).toFixed(1),
  });
  console.error(JSON.stringify(rows.at(-1)));
  await ctx.close();
}
await browser.close();
console.log(JSON.stringify(rows, null, 2));
