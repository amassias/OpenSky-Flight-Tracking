import { expect, test, type Page } from "@playwright/test";

const airport = {
  icao: "LFPG", iata: "CDG", name: "Paris Charles de Gaulle", display_name: "Paris Charles de Gaulle (CDG)",
  country: "FR", region: "Île-de-France", latitude: 49.0097, longitude: 2.5479,
};

async function mockApi(page: Page) {
  await page.route("**/api/**", async (route) => {
    const path = new URL(route.request().url()).pathname;
    let body: unknown;
    if (path === "/api/health") body = { success: true, airports_loaded: 7895, credentials_configured: true, server_time_utc: new Date().toISOString() };
    else if (path === "/api/airports" || path === "/api/search-airports") body = [airport];
    else if (path === "/api/live-flights") body = { success: true, time: 1_752_000_000, count: 1, states: [{ icao24: "39abcd", callsign: "AFR123", latitude: 49.1, longitude: 2.7, baro_altitude: 8400, velocity: 220, true_track: 72, on_ground: false }] };
    else if (path === "/api/flights") body = { success: true, airport: "LFPG", airport_meta: airport, airport_name: airport.name, mode: "departure", date: "2026-07-10", date_basis: "UTC", count: 1, summary: { total: 1, live_airborne: 1, live_on_ground: 0, unique_airlines: 1 }, flights: [{ icao24: "39abcd", callsign: "AFR123", airline_name: "Air France", departure_airport: "LFPG", departure_airport_name: airport.name, arrival_airport: "EGLL", arrival_airport_name: "London Heathrow", first_seen: 1_752_000_000, last_seen: 1_752_004_000, primary_time: 1_752_000_000, latitude: 49.1, longitude: 2.7, baro_altitude: 8400, velocity: 220, true_track: 72, on_ground: false, status: "airborne" }] };
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
});

test("supports the mobile search sheet", async ({ page, isMobile }) => {
  test.skip(!isMobile, "Mobile-only interaction");
  await page.getByRole("button", { name: "Open flight search" }).click();
  await expect(page.getByRole("complementary", { name: "Flight search controls" })).toBeVisible();
  await page.getByRole("complementary", { name: "Flight search controls" }).getByRole("button", { name: "Close search" }).click();
});
