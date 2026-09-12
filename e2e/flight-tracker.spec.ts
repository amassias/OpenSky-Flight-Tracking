import { expect, test, type Page } from "@playwright/test";

const airport = {
  icao: "LFPG", iata: "CDG", name: "Paris Charles de Gaulle", display_name: "Paris Charles de Gaulle (CDG)",
  country: "FR", region: "Île-de-France", latitude: 49.0097, longitude: 2.5479,
};

async function mockApi(page: Page, options: { historyUnavailable?: boolean } = {}) {
  await page.route("**/api/**", async (route) => {
    const path = new URL(route.request().url()).pathname;
    let body: unknown;
    if (path === "/api/health") body = { success: true, airports_loaded: 7895, credentials_configured: true, server_time_utc: new Date().toISOString() };
    else if (path === "/api/airports" || path === "/api/search-airports") body = [airport];
    else if (path === "/api/live-flights") body = { success: true, time: 1_752_000_000, count: 1, states: [{ icao24: "39abcd", callsign: "AFR123", latitude: 49.1, longitude: 2.7, baro_altitude: 8400, velocity: 220, true_track: 72, on_ground: false, data_source: "live-nearby" }] };
    else if (path === "/api/flights" && options.historyUnavailable) body = { success: true, airport: "LFPG", airport_meta: airport, airport_name: airport.name, mode: "departure", date: "2026-07-10", date_basis: "UTC", count: 0, summary: { total: 0, live_airborne: 0, live_on_ground: 0, unique_airlines: 0 }, flights: [], source: "unavailable", notice: "OpenSky history is temporarily unavailable. Live traffic remains available on the map." };
    else if (path === "/api/flights") body = { success: true, airport: "LFPG", airport_meta: airport, airport_name: airport.name, mode: "departure", date: "2026-07-10", date_basis: "UTC", count: 1, summary: { total: 1, live_airborne: 1, live_on_ground: 0, unique_airlines: 1 }, flights: [{ icao24: "39abcd", callsign: "AFR123", airline_name: "Air France", departure_airport: "LFPG", departure_airport_name: airport.name, arrival_airport: "EGLL", arrival_airport_name: "London Heathrow", first_seen: 1_752_000_000, last_seen: 1_752_004_000, primary_time: 1_752_000_000, latitude: 49.1, longitude: 2.7, baro_altitude: 8400, velocity: 220, true_track: 72, on_ground: false, status: "airborne" }] };
    else if (path === "/api/flight-info") body = { success: true, icao24: "39abcd", callsign: "AFR123", airline_code: "AFR", airline_name: "Air France", departure_airport: "LFPG", departure_airport_name: airport.name, arrival_airport: "RKSI", arrival_airport_name: "Incheon International Airport", route_source: "callsign", route_provider: "ADSBDB", registration: "F-HABC", aircraft_type: "A359", aircraft_description: "AIRBUS A-350-941", aircraft_owner: "Air France", aircraft_year: "2020", aircraft_category: "A5", messages: 12345, rssi: -12.5, seen_seconds: 0.7, seen_position_seconds: 1.2, nav_modes: ["autopilot", "althold"], flightaware: { provider: "FlightAware", status: "En Route", origin: { code_icao: "LFPG", name: airport.name }, destination: { code_icao: "RKSI", name: "Incheon International Airport" }, progress_percent: 64, scheduled_out: "2026-07-10T08:00:00Z", estimated_in: "2026-07-10T17:00:00Z", departure_delay: 0, route: "DCT" } };
    else if (path === "/api/track") body = { success: true, path_count: 3, track: { path: [[1_752_000_000, 49.0, 2.55, 1000, 60, false], [1_752_001_000, 49.1, 2.7, 5000, 70, false], [1_752_002_000, 49.3, 3.0, 8400, 72, false]] } };
    else return route.fulfill({ status: 404, json: { success: false, error: "Not found" } });
    await route.fulfill({ json: body });
  });
}

test.beforeEach(async ({ page }) => {
  await mockApi(page);
  await page.goto("/");
});

test("searches an airport and opens a shareable flight detail", async ({ page, isMobile }) => {
  if (isMobile) {
    await page.getByRole("button", { name: "Open flight search" }).click();
  } else {
    await expect(page.getByText("Find a flight.")).toBeVisible();
  }
  await expect(page.getByRole("combobox", { name: "Airport" })).toHaveValue(/LFPG/);
  await page.getByRole("button", { name: /explore flights/i }).click();
  await expect(page.getByText("AFR123").first()).toBeVisible();
  await page.getByRole("button", { name: /AFR123/i }).click();
  await expect(page.getByRole("complementary", { name: "Selected flight details" })).toBeVisible();
  await expect(page).toHaveURL(/airport=LFPG.*icao24=39abcd/);
  await expect(page.getByText("Altitude profile")).toBeVisible();
  await expect(page.locator(".altitude-legend")).toHaveCount(2);
  await page.locator(".altitude-hover-target").hover({ position: { x: 24, y: 12 } });
  await expect(page.locator(".altitude-tooltip")).toBeVisible();
  await expect(page.locator(".altitude-hover-readout")).toContainText("Altitude");
});

test("supports the mobile search sheet", async ({ page, isMobile }) => {
  test.skip(!isMobile, "Mobile-only interaction");
  await page.getByRole("button", { name: "Open flight search" }).click();
  await expect(page.getByRole("complementary", { name: "Flight search controls" })).toBeVisible();
  await page.getByRole("complementary", { name: "Flight search controls" }).getByRole("button", { name: "Close search" }).click();
});


test("closing a shared flight keeps it closed", async ({ page }) => {
  await page.goto('/?airport=LFPG&date=2026-07-10&mode=departure&icao24=39abcd');
  await expect(page.getByRole('complementary', {name: 'Selected flight details'})).toBeVisible();
  await page.getByRole('button', {name: 'Close flight details'}).click();
  await expect(page.getByRole('complementary', {name: 'Selected flight details'})).toHaveCount(0);
  await expect(page).not.toHaveURL(/icao24=/);
});

test("airport suggestions dismiss when leaving the field", async ({page, isMobile}) => {
  if (isMobile) await page.getByRole('button', {name: 'Open flight search'}).click();
  await page.getByRole('combobox', {name: 'Airport'}).click();
  await expect(page.getByRole('listbox')).toBeVisible();
  await page.getByRole('complementary', {name: 'Flight search controls'}).click({position: {x: 10, y: 10}});
  await expect(page.getByRole('listbox')).toHaveCount(0);
});

test("resolves origin and destination for a selected live aircraft", async ({ page }) => {
  // Click the Leaflet hit target a user interacts with. The inner plane SVG is
  // rotated and can move under WebKit while a progressive sector settles.
  await page.locator(".leaflet-marker-icon").filter({ has: page.locator(".aircraft-marker") }).first().dispatchEvent("click");
  await expect(page.getByRole("complementary", { name: "Selected flight details" })).toBeVisible();
  await expect(page.getByText("Estimated from callsign")).toBeVisible();
  await expect(page.getByText("Incheon International Airport")).toBeVisible();
  await expect(page.getByText("Aircraft profile")).toBeVisible();
  await expect(page.getByText("F-HABC")).toBeVisible();
  await expect(page.getByText("AIRBUS A-350-941")).toBeVisible();
  await expect(page.getByText("Operations")).toBeVisible();
  await expect(page.getByText("FlightAware", { exact: true })).toBeVisible();
  await expect(page.getByText("64% complete")).toBeVisible();
});

test("keeps airport results populated from the live map snapshot when history is unavailable", async ({ page }) => {
  await page.unroute("**/api/**");
  await mockApi(page, { historyUnavailable: true });
  await page.goto("/?airport=LFPG&date=2026-07-10&mode=departure");
  await expect(page.getByRole("heading", { name: "Live traffic around CDG" })).toBeVisible();
  await expect(page.getByText("Live near airport").first()).toBeVisible();
});

test("shows a location marker after the user grants geolocation", async ({ page, context }) => {
  await context.grantPermissions(["geolocation"]);
  await context.setGeolocation({ latitude: 49.2, longitude: 2.6, accuracy: 35 });
  await page.getByRole("button", { name: "Locate me" }).click();
  await expect(page.locator(".user-location-marker")).toHaveCount(1);
  await expect(page.locator(".leaflet-marker-icon").filter({ has: page.locator(".user-location-marker") })).toHaveCount(1);
});
