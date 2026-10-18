// Measures the real aircraft layer with 10,000 mocked aircraft while the map pans and zooms
// (docs/audits/2026-10-18-aircraft-layer-measurement.md). Usage:
//   npm run dev -- --port 4400    (in one shell)
//   node scripts/bench-aircraft-layer.mjs http://127.0.0.1:4400 [cpuThrottle=1] [seconds=10]
// Run it on a real phone through remote debugging to evaluate the deck.gl fallback condition
// (docs/adr/0009-maplibre-gl-aircraft-layer.md).
import { chromium } from "@playwright/test";

const [base = "http://127.0.0.1:4173", throttle = "1", seconds = "10"] = process.argv.slice(2);
const FIELDS = ["icao24", "callsign", "latitude", "longitude", "baro_altitude", "geo_altitude", "velocity", "true_track", "vertical_rate", "on_ground", "squawk", "category", "source", "fix_age"];
const now = Math.floor(Date.now() / 1000);
const rows = Array.from({ length: 10_000 }, (_, i) => [i.toString(16).padStart(6, "0"), `SNAP${i}`, 40 + (i % 100) * 0.16, -8 + Math.floor(i / 100) * 0.28, 10000, 10000, 220, (i * 37) % 360, 0, 0, null, 3, "adsb", 5]);

// Hardware GL (ANGLE/Metal on macOS) like the prototype; Playwright's default headless shell uses SwiftShader.
const browser = await chromium.launch({ args: process.env.SOFTWARE_GL ? [] : ["--use-gl=angle", "--use-angle=metal", "--ignore-gpu-blocklist"] });
const mobile = Number(throttle) > 1;
const context = await browser.newContext(mobile ? { viewport: { width: 390, height: 844 }, deviceScaleFactor: 3, hasTouch: true } : { viewport: { width: 1280, height: 800 } });
await context.addInitScript(() => localStorage.setItem("skytrace-onboarded", "true"));
const page = await context.newPage();
await page.route("**/api/**", (route) => {
  const path = new URL(route.request().url()).pathname;
  if (path === "/api/health") return route.fulfill({ json: { credentials_configured: true } });
  if (path === "/api/global-snapshot") return route.fulfill({ json: { success: true, provider: "opensky", time: now, count: rows.length, fields: FIELDS, aircraft: rows, age_seconds: 0, refresh_after_seconds: 86 } });
  return route.fulfill({ json: path.endsWith("airports") ? [] : { success: true, flights: [], count: 0, states: [] } });
});
await page.goto(`${base}/?at=48,5,${mobile ? 3 : 5}`);
await page.waitForSelector(".aircraft-gl", { timeout: 30_000 });
await page.waitForFunction(() => Number(document.querySelector(".aircraft-gl")?.getAttribute("data-aircraft-drawn")) > 5_000, null, { timeout: 30_000 });
if (mobile) await (await context.newCDPSession(page)).send("Emulation.setCPUThrottlingRate", { rate: Number(throttle) });

const frames = await page.evaluate(async (ms) => {
  const intervals = [];
  let last = performance.now();
  const end = last + ms;
  const map = document.querySelector(".leaflet-container");
  const box = map.getBoundingClientRect();
  const fire = (type, x, y) => map.dispatchEvent(new MouseEvent(type, { bubbles: true, clientX: x, clientY: y, button: 0 }));
  let step = 0;
  return await new Promise((resolve) => {
    const tick = (t) => {
      intervals.push(t - last);
      last = t;
      // A slow continuous drag of the map keeps the camera moving for the whole run.
      const x = box.x + box.width / 2 + Math.sin(step / 40) * 120;
      const y = box.y + box.height / 2 + Math.cos(step / 50) * 60;
      if (step === 0) fire("mousedown", x, y);
      fire("mousemove", x, y);
      step += 1;
      if (t < end) requestAnimationFrame(tick); else { fire("mouseup", x, y); resolve(intervals); }
    };
    requestAnimationFrame(tick);
  });
}, Number(seconds) * 1000);

frames.shift();
frames.sort((a, b) => a - b);
const mean = frames.reduce((sum, value) => sum + value, 0) / frames.length;
const p = (q) => frames[Math.min(frames.length - 1, Math.floor(frames.length * q))];
console.log(JSON.stringify({ throttle: Number(throttle), seconds: Number(seconds), endView: new URL(page.url()).searchParams.get("at"), aircraft: await page.locator(".aircraft-gl").getAttribute("data-aircraft-drawn"), avgFps: +(1000 / mean).toFixed(1), p95FrameMs: +p(0.95).toFixed(1), worstFrameMs: +frames.at(-1).toFixed(1) }));
await browser.close();
