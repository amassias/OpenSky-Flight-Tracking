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
    if (path === "/api/track") return route.fulfill({ json: { success: true, track: { icao24: "39abc0", path: [[Math.floor(Date.now()/1000)-60, 48.8, 2.3, 3000, 90, false], [Math.floor(Date.now()/1000), 48.9, 2.4, 4000, 90, false]] } } });
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
  const attribution = await box(page, ".maplibregl-ctrl-attrib");
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

// One minimum-hit-area token: every control below reaches 44 px on a touch screen.
async function expectTouchTarget(locator: ReturnType<Page["locator"]>, label: string) {
  const rect = (await locator.first().boundingBox())!;
  expect(rect, label).not.toBeNull();
  expect(rect.width, `${label} width`).toBeGreaterThanOrEqual(43.5);
  expect(rect.height, `${label} height`).toBeGreaterThanOrEqual(43.5);
}

test("clear, guide-close and segmented controls reach 44 px on touch screens", async ({ page, isMobile }) => {
  test.skip(!isMobile, "Phone layout only.");
  await page.goto("/");
  await expectTouchTarget(page.getByRole("button", { name: "Dismiss map hints" }), "map data guide close");

  await page.getByRole("button", { name: /^Display/ }).click();
  const units = page.getByRole("group", { name: "Units" }).getByRole("button");
  await expectTouchTarget(units.first(), "segmented button");
  await expectTouchTarget(units.last(), "segmented button");
  await page.getByRole("combobox", { name: /search flights and airports/i }).fill("AFR");
  await expectTouchTarget(page.getByRole("button", { name: "Clear search" }), "clear search");

});

test("secondary buttons reach 44 px on touch screens", async ({ page, isMobile }) => {
  test.skip(!isMobile, "Phone layout only.");
  await page.goto("/");
  await page.getByRole("button", { name: "Open traffic panel" }).click();
  await page.getByPlaceholder("Filter this list").fill("zzzz");
  await expectTouchTarget(page.getByRole("button", { name: "Clear filters" }), "secondary button");
});

test("map icons name themselves on keyboard focus", async ({ page }) => {
  await page.goto("/");
  for (const name of ["Locate me", "Pause live traffic", "Hide panels"]) {
    const button = page.getByRole("button", { name }).first();
    await button.focus();
    const tip = await button.evaluate((element) => getComputedStyle(element, "::after").content);
    expect(tip, name).toContain(name);
  }
});
