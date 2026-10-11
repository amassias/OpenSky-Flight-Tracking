import AxeBuilder from "@axe-core/playwright";
import { expect, test } from "@playwright/test";

const airport = { icao: "LFPG", iata: "CDG", name: "Paris Charles de Gaulle", display_name: "Paris Charles de Gaulle (CDG)", country: "FR", region: "Île-de-France", latitude: 49, longitude: 2.5 };

test.beforeEach(async ({ page }) => {
  await page.route("**/api/**", (route) => {
    const path = new URL(route.request().url()).pathname;
    if (path === "/api/health") return route.fulfill({ json: { credentials_configured: true } });
    if (path === "/api/live-flights") {
      return route.fulfill({ json: { count: 3, time: 1, states: Array.from({ length: 3 }, (_, i) => ({ icao24: `39abc${i}`, callsign: `AFR12${i}`, airline_name: "Air France", latitude: 49 + i / 20, longitude: 2.5 + i / 20, true_track: 90, baro_altitude: 3000 + i * 2000, velocity: 200, on_ground: false })) } });
    }
    if (path.endsWith("airports") || path === "/api/search-airports") return route.fulfill({ json: [airport] });
    if (path === "/api/airport-conditions") {
      return route.fulfill({ json: {
        success: true, airport: { ...airport, elevation_ft: 392, wikipedia: null },
        weather: { station: "LFPG", observed_at: 1_750_000_000, raw: "METAR LFPG 082100Z 25006KT CAVOK 09/03 Q1025", flight_category: "VFR", wind_dir: 250, wind_variable: false, wind_kt: 6, gust_kt: null, visibility: { meters: 10000, at_least: true }, cover: "CAVOK", clouds: [], ceiling_ft: null, temperature_c: 9, dewpoint_c: 3, qnh_hpa: 1025, taf: null },
        runways: [{ ends: [{ ident: "09R", heading: 86, headwind_kt: -5.8, crosswind_kt: 1.4 }, { ident: "27L", heading: 266, headwind_kt: 5.8, crosswind_kt: 1.4 }], length_ft: 13780, width_ft: 148, surface: "ASP", lighted: true }],
        favoured_runways: ["27L"], runway_basis: "wind", frequencies: [], delays: null, unavailable: [], generated_at: new Date().toISOString(),
      } });
    }
    if (path === "/api/airport-board") {
      return route.fulfill({ json: { success: true, airport: "LFPG", time: Math.floor(Date.now() / 1000), provider: "adsb.lol", radius_nm: 150, aircraft_scanned: 1, routes_pending: 0, generated_at: new Date().toISOString(),
        departures: [{ icao24: "3944ef", callsign: "AFR1234", airline_name: "Air France", aircraft_type: "A320", on_ground: true, velocity: 6, latitude: 49.0, longitude: 2.55, phase: "taxiing", origin: null, destination: { icao: "EDDB", iata: "BER", city: "Berlin" }, distance_km: 1.2, route_known: true }],
        arrivals: [] } });
    }
    if (path === "/api/airport-schedule") return route.fulfill({ json: { success: true, airport: "LFPG", direction: "departure", provider: "FlightAware AeroAPI", available: false, reason: "unconfigured", flights: [] } });
    return route.fulfill({ json: { success: true } });
  });
});

// Map tiles and markers are drawn by Leaflet; the audit covers the app chrome.
async function audit(page: import("@playwright/test").Page) {
  const results = await new AxeBuilder({ page }).exclude(".leaflet-pane").exclude(".leaflet-control-container").withTags(["wcag2a", "wcag2aa"]).analyze();
  return results.violations.map((violation) => `${violation.id}: ${violation.nodes.map((node) => node.target.join(" ")).join(", ")}`);
}

test("the live view has no WCAG A/AA violations", async ({ page }) => {
  await page.goto("/");
  await expect(page.locator(".aircraft-marker")).toHaveCount(3);
  expect(await audit(page)).toEqual([]);
});

test("the shortcuts sheet has no WCAG A/AA violations", async ({ page, isMobile }) => {
  test.skip(isMobile, "The sheet is keyboard-only.");
  await page.goto("/");
  await expect(page.locator(".aircraft-marker")).toHaveCount(3);
  await page.locator("body").press("?");
  await expect(page.getByRole("dialog", { name: "Keyboard shortcuts" })).toBeVisible();
  expect(await audit(page)).toEqual([]);
});

test("a selected flight has no WCAG A/AA violations", async ({ page }) => {
  await page.goto("/");
  await expect(page.locator(".aircraft-marker")).toHaveCount(3);
  const reopen = page.getByRole("button", { name: "Open traffic panel" });
  if (await reopen.isVisible()) await reopen.click();
  await page.locator(".flight-card").first().click();
  await expect(page.getByRole("complementary", { name: "Selected flight details" })).toBeVisible();
  expect(await audit(page)).toEqual([]);
});

test("the airport board has no WCAG A/AA violations", async ({ page }) => {
  await page.goto("/?airport=LFPG");
  await expect(page.locator(".airport-identity")).toBeVisible();
  await expect(page.getByText("AFR1234")).toBeVisible();
  await expect(page.getByText("VFR")).toBeVisible();
  expect(await audit(page)).toEqual([]);
});

test.describe("dark theme", () => {
  test.use({ colorScheme: "dark" });

  test("the live view and a selected flight have no WCAG A/AA violations", async ({ page }) => {
    await page.goto("/");
    await expect(page.locator(".app")).toHaveClass(/theme-dark/);
    await expect(page.locator(".aircraft-marker")).toHaveCount(3);
    expect(await audit(page)).toEqual([]);
    const reopen = page.getByRole("button", { name: "Open traffic panel" });
    if (await reopen.isVisible()) await reopen.click();
    await page.locator(".flight-card").first().click();
    await expect(page.getByRole("complementary", { name: "Selected flight details" })).toBeVisible();
    expect(await audit(page)).toEqual([]);
  });

  test("the airport board has no WCAG A/AA violations", async ({ page }) => {
    await page.goto("/?airport=LFPG");
    await expect(page.getByText("AFR1234")).toBeVisible();
    expect(await audit(page)).toEqual([]);
  });
});
