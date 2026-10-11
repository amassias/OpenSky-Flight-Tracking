import { expect, test, type Page } from "@playwright/test";

// Phone layout with a sheet open: every map control must sit between the
// top bar and the map attribution, uncovered.
test.beforeEach(async ({ page }) => {
  await page.route("**/api/**", (route) => {
    const path = new URL(route.request().url()).pathname;
    if (path === "/api/health") return route.fulfill({ json: { credentials_configured: true } });
    if (path === "/api/live-flights") {
      return route.fulfill({ json: { count: 2, time: 1, states: [0, 1].map((i) => ({ icao24: `39abc${i}`, callsign: `AFR12${i}`, latitude: 48.9 + i / 20, longitude: 2.4, true_track: 90, baro_altitude: 4000, velocity: 200, on_ground: false })) } });
    }
    if (path === "/api/track") return route.fulfill({ json: { success: true, track: { icao24: "39abc0", path: [[1, 48.8, 2.3, 3000, 90, false], [2, 48.9, 2.4, 4000, 90, false]] } } });
    return route.fulfill({ json: path.endsWith("airports") || path === "/api/search-airports" ? [] : { success: true } });
  });
});

async function box(page: Page, selector: string) {
  return (await page.locator(selector).first().boundingBox())!;
}

test("map controls clear the top bar and the attribution with a flight open", async ({ page, isMobile }) => {
  test.skip(!isMobile, "Phone layout only.");
  await page.goto("/");
  await page.getByRole("button", { name: "Open traffic panel" }).click();
  await page.locator(".flight-card").first().click();
  await expect(page.getByRole("complementary", { name: "Selected flight details" })).toBeVisible();
  await expect(page.getByRole("button", { name: "Show full route" })).toBeVisible();

  const topbar = await box(page, ".topbar");
  const attribution = await box(page, ".leaflet-control-attribution");
  const groups = await page.locator(".map-controls > *:visible").evaluateAll((elements) => elements.map((element) => {
    const rect = element.getBoundingClientRect();
    return { top: rect.top, bottom: rect.bottom };
  }));
  expect(groups.length).toBeGreaterThan(0);
  for (const group of groups) {
    expect(group.top).toBeGreaterThanOrEqual(topbar.y + topbar.height);
    expect(group.bottom).toBeLessThanOrEqual(attribution.y);
  }
});
