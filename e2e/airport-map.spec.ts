import { expect, test } from "@playwright/test";

const airport = { icao: "LFPO", iata: "ORY", name: "Paris Orly", latitude: 46.5, longitude: 2.2 };
test("catalog airport opens arrivals and departures from a blue map marker", async ({ page }, testInfo) => {
  await page.route("**/api/**", async (route) => {
    const url = new URL(route.request().url());
    const body = url.pathname === "/api/map-airports" ? [airport]
      : url.pathname === "/api/health" ? { credentials_configured: true, live_available: true }
      : url.pathname === "/api/live-flights" ? { count: 0, states: [] }
      : url.pathname === "/api/airport-conditions" ? { success: true, airport, weather: null, runways: [], favoured_runways: [], runway_basis: "no-wind", frequencies: [], delays: null, unavailable: [] }
      : url.pathname === "/api/airport-board" ? { success: true, airport: url.searchParams.get("airport"), time: Math.floor(Date.now() / 1000), radius_nm: 150, aircraft_scanned: 0, routes_pending: 0, departures: [], arrivals: [] }
      : url.pathname === "/api/flights" ? { success: true, airport: "LFPO", airport_meta: airport, airport_name: airport.name, mode: url.searchParams.get("mode"), date: "2026-10-08", count: 0, flights: [], summary: { total: 0, live_airborne: 0, live_on_ground: 0, unique_airlines: 0 }, source: "opensky" }
      : [];
    await route.fulfill({ json: body });
  });
  await page.goto("/");
  const marker = page.getByTitle("Paris Orly · Arrivals & departures", { exact: true });
  await expect(marker).toBeVisible();
  await expect(marker.locator("i")).toHaveCSS("background-color", /rgb\((41, 151, 255|0, 102, 204)\)/);
  await page.screenshot({ path: testInfo.outputPath("blue-airports.png") });
  await marker.click();
  await expect(page.getByRole("heading", { name: /ORY Paris Orly/ })).toBeVisible();
  await expect(page.getByRole("region", { name: "Live departures" })).toContainText("No departures observed right now");
  await page.getByRole("button", { name: "Arrivals", exact: true }).click();
  await expect(page.getByRole("region", { name: "Live arrivals" })).toBeVisible();
  await page.getByRole("button", { name: "History", exact: true }).click();
  await expect(page.getByRole("heading", { name: "Arrivals at ORY" })).toBeVisible();
  await page.screenshot({ path: testInfo.outputPath("airport-board.png") });
});

const secondAirport = { icao: "LFBX", iata: "PGX", name: "Second test airport", latitude: 46.501, longitude: 2.201 };
async function catalogApi(page: import("@playwright/test").Page, options: { unavailable?: boolean } = {}) {
  await page.route("**/api/**", async (route) => {
    const url = new URL(route.request().url());
    const body = url.pathname === "/api/map-airports" ? [airport, secondAirport]
      : url.pathname === "/api/health" ? { credentials_configured: true, live_available: true }
      : url.pathname === "/api/live-flights" ? { count: 1, states: [{ icao24: "abcd12", callsign: "NEAR123", latitude: 46.51, longitude: 2.21, true_track: 90 }] }
      : url.pathname === "/api/airport-conditions" ? { success: true, airport, weather: null, runways: [], favoured_runways: [], runway_basis: "no-wind", frequencies: [], delays: null, unavailable: [] }
      : url.pathname === "/api/airport-board" ? { success: true, airport: url.searchParams.get("airport"), time: Math.floor(Date.now() / 1000), radius_nm: 150, aircraft_scanned: 0, routes_pending: 0, departures: [], arrivals: [] }
      : url.pathname === "/api/flights" ? { success: true, airport: url.searchParams.get("airport"), airport_meta: airport, airport_name: airport.name, mode: url.searchParams.get("mode"), date: "2026-10-08", count: 0, flights: [], summary: { total: 0, live_airborne: 0, live_on_ground: 0, unique_airlines: 0 }, source: options.unavailable ? "unavailable" : "opensky" }
      : [];
    await route.fulfill({ json: body });
  });
}

test("groups nearby airports and expands the group to selectable markers", async ({ page }) => {
  await catalogApi(page);
  await page.goto("/");
  const cluster = page.getByTitle("2 airports · Zoom to explore", { exact: true });
  await expect(cluster).toBeVisible();
  await cluster.click();
  await expect(page.locator(".leaflet-zoom-anim")).toHaveCount(0);
  await cluster.click();
  await expect(page.getByTitle("Paris Orly · Arrivals & departures", { exact: true })).toBeVisible();
  await expect(page.getByTitle("Second test airport · Arrivals & departures", { exact: true })).toBeVisible();
});

test("shows only saved airports and persists the map preference", async ({ page }) => {
  await page.addInitScript((saved) => localStorage.setItem("skytrace-favorites", JSON.stringify([saved])), airport);
  await catalogApi(page);
  await page.goto("/");
  await page.getByRole("button", { name: "Display", exact: true }).click();
  await page.getByText("Favourite airports only", { exact: true }).click();
  await expect(page.locator(".airport-cluster-wrap")).toHaveCount(0);
  await expect(page.getByTitle("Paris Orly · Arrivals & departures", { exact: true })).toBeVisible();
  await page.reload();
  await expect(page.locator(".airport-pin-wrap")).toHaveCount(1);
});

test("lists nearest airports from geolocation and opens a nearby board", async ({ page, context }, testInfo) => {
  await context.grantPermissions(["geolocation"]);
  await context.setGeolocation({ latitude: 46.5, longitude: 2.2, accuracy: 20 });
  await catalogApi(page);
  await page.goto("/");
  await page.getByRole("button", { name: "Nearby airports", exact: true }).click();
  const nearby = page.getByRole("region", { name: "Nearby airports", exact: true });
  await expect(nearby.getByRole("button", { name: /ORY.*0.0 km/ })).toBeVisible();
  await expect(nearby.locator("li").first()).toContainText("Paris Orly");
  await page.screenshot({ path: testInfo.outputPath("nearby-airports.png") });
  await nearby.getByRole("button", { name: /ORY.*0.0 km/ }).click();
  await expect(page.getByRole("heading", { name: /ORY Paris Orly/ })).toBeVisible();
});

test("clearly labels nearby traffic when recorded movements are unavailable", async ({ page }) => {
  await page.addInitScript((saved) => localStorage.setItem("skytrace-favorites", JSON.stringify([saved])), airport);
  await catalogApi(page, { unavailable: true });
  await page.goto("/");
  await page.getByRole("button", { name: "Display", exact: true }).click();
  await page.getByText("Favourite airports only", { exact: true }).click();
  await page.getByRole("button", { name: "Display", exact: true }).click();
  await page.getByTitle("Paris Orly · Arrivals & departures", { exact: true }).click();
  await page.getByRole("button", { name: "History", exact: true }).click();
  await expect(page.getByRole("heading", { name: "Live traffic around ORY" })).toBeVisible();
  await expect(page.locator(".source-pill")).toHaveText("Nearby traffic");
  await expect(page.locator(".board-heading")).toContainText("Current observations");
  await expect(page.locator(".flight-card").filter({ hasText: "NEAR123" })).toBeVisible();
});

test("old Oslo timetable links open observed traffic without regional provider requests", async ({ page }) => {
  const oslo = { ...airport, icao: "ENGM", iata: "OSL", name: "Oslo Airport", latitude: 60.2, longitude: 11.1, timetable_provider: "Avinor" };
  const regionalRequests: string[] = [];
  page.on("request", (request) => {
    if (/timetable|avinor\.no/.test(request.url())) regionalRequests.push(request.url());
  });
  await page.route("**/api/**", async (route) => {
    const url = new URL(route.request().url());
    const body = ["/api/search-airports", "/api/map-airports", "/api/airports"].includes(url.pathname) ? [oslo]
      : url.pathname === "/api/health" ? { live_available: true }
      : url.pathname === "/api/live-flights" ? { count: 0, states: [] }
      : url.pathname === "/api/airport-conditions" ? { success: true, airport: oslo, weather: null, runways: [], favoured_runways: [], runway_basis: "no-wind", frequencies: [], delays: null, unavailable: [] }
      : url.pathname === "/api/airport-board" ? { success: true, airport: url.searchParams.get("airport"), time: Math.floor(Date.now() / 1000), radius_nm: 150, aircraft_scanned: 0, routes_pending: 0, departures: [], arrivals: [] }
      : url.pathname === "/api/flights" ? { success: true, airport: "ENGM", airport_meta: oslo, airport_name: oslo.name, mode: url.searchParams.get("mode"), flights: [], summary: { total: 0, live_airborne: 0, unique_airlines: 0 }, source: "opensky" }
      : [];
    await route.fulfill({ json: body });
  });
  await page.goto("/?airport=ENGM&view=schedule");
  await expect(page.getByRole("region", { name: "Live departures" })).toBeVisible();
  await expect(page.getByRole("button", { name: "Timetable", exact: true })).toHaveCount(0);
  await expect(page.getByRole("link", { name: "Flydata fra Avinor" })).toHaveCount(0);
  await page.getByRole("button", { name: "Arrivals", exact: true }).click();
  await expect(page.getByRole("region", { name: "Live arrivals" })).toBeVisible();
  await expect(page).not.toHaveURL(/view=schedule/);
  expect(regionalRequests).toEqual([]);
});
