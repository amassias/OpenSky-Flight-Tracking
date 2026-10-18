import { expect, test } from "@playwright/test";

// Trails are drawn from successive live snapshots, so a second answer with
// moved aircraft must leave a line behind each one.
test.use({
  storageState: { cookies: [], origins: [{ origin: process.env.SKYTRACE_E2E_ORIGIN ?? "http://127.0.0.1:4173", localStorage: [{ name: "skytrace-onboarded", value: "true" }, { name: "skytrace-trails", value: "true" }] }] },
});

test("draws a trail behind aircraft that moved between live refreshes", async ({ page, isMobile }) => {
  test.skip(isMobile, "Wheel zoom is not available in mobile WebKit.");
  let round = 0;
  await page.route("**/api/**", (route) => {
    const path = new URL(route.request().url()).pathname;
    if (path === "/api/health") return route.fulfill({ json: { credentials_configured: true } });
    if (path === "/api/live-flights") {
      // Every answer moves the aircraft a little further east.
      const shift = round++ * 0.05;
      return route.fulfill({ json: { count: 2, time: 1, states: [0, 1].map((i) => ({ icao24: `00000${i}`, callsign: `TEST${i}`, latitude: 48.8 + i / 10, longitude: 2.3 + shift, true_track: 90, baro_altitude: 9000, on_ground: false })) } });
    }
    return route.fulfill({ json: path.endsWith("airports") || path === "/api/search-airports" ? [] : { success: true } });
  });
  await page.goto("/");
  await expect(page.locator(".aircraft-marker")).toHaveCount(2);
  await expect(page.locator(".flight-map")).not.toHaveAttribute("data-map-overlays", /trails/);
  await page.locator(".flight-map").hover();
  await page.mouse.wheel(0, 480);
  const before = round;
  await expect.poll(() => round).toBeGreaterThan(before);
  await expect(page.locator(".flight-map")).toHaveAttribute("data-map-overlays", /trails/);
});
