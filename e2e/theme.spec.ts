import { expect, test } from "@playwright/test";

// B13: a light-theme capture beside the dark default, plus the theme rules
// that are easy to break: the system preference on a first visit, the saved
// choice afterwards, and the browser chrome colour that follows the map.
test.use({
  colorScheme: "light",
  storageState: { cookies: [], origins: [{ origin: process.env.SKYTRACE_E2E_ORIGIN ?? "http://127.0.0.1:4173", localStorage: [{ name: "skytrace-onboarded", value: "true" }] }] },
});

test.beforeEach(async ({ page }) => {
  await page.route("**/api/**", (route) => {
    const path = new URL(route.request().url()).pathname;
    if (path === "/api/health") return route.fulfill({ json: { credentials_configured: true } });
    if (path === "/api/live-flights") {
      return route.fulfill({ json: { count: 3, time: 1, states: Array.from({ length: 3 }, (_, i) => ({ icao24: `00000${i}`, callsign: `AFR12${i}`, latitude: 49 + i / 20, longitude: 2.5 + i / 20, true_track: 90, baro_altitude: 3000 + i * 2000 })) } });
    }
    return route.fulfill({ json: path.endsWith("airports") || path === "/api/search-airports" ? [] : { success: true } });
  });
});

test("a first visit follows a light system theme and T switches it", async ({ page }, testInfo) => {
  await page.goto("/");
  await expect(page.locator(".app")).toHaveClass(/theme-light/);
  await expect(page.locator('meta[name="theme-color"]')).toHaveAttribute("content", "#f5f5f7");
  await expect(page.locator(".aircraft-marker")).toHaveCount(3);
  await page.screenshot({ path: testInfo.outputPath("light-theme.png") });

  await page.locator(".flight-map").click({ position: { x: 20, y: 200 } });
  await page.keyboard.press("t");
  await expect(page.locator(".app")).toHaveClass(/theme-dark/);
  await expect(page.locator('meta[name="theme-color"]')).toHaveAttribute("content", "#0b0b0c");

  // The choice made in the app now wins over the system preference.
  await page.reload();
  await expect(page.locator(".app")).toHaveClass(/theme-dark/);
});
