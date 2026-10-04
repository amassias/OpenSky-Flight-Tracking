import { expect, test, type Page } from "@playwright/test";

const airport = {
  icao: "LFPG", iata: "CDG", name: "Paris Charles de Gaulle", display_name: "Paris Charles de Gaulle (CDG)",
  country: "FR", region: "Île-de-France", latitude: 49.0097, longitude: 2.5479,
};

// A 1×1 PNG stands in for the Planespotters thumbnail so e2e never calls out.
const PIXEL_PNG = Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNkYAAAAAYAAjCB0C8AAAAASUVORK5CYII=", "base64");

async function mockApi(page: Page, options: { historyUnavailable?: boolean } = {}) {
  await page.route("https://api.planespotters.net/**", (route) => route.fulfill({
    headers: { "access-control-allow-origin": "*" },
    json: { photos: [{ id: "1", thumbnail_large: { src: "https://t.plnspttrs.net/1/1_280.jpg", size: { width: 420, height: 280 } }, link: "https://www.planespotters.net/photo/1/f-habc", photographer: "Test Photographer" }] },
  }));
  await page.route("https://t.plnspttrs.net/**", (route) => route.fulfill({ contentType: "image/png", body: PIXEL_PNG }));
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
    await page.getByRole("button", { name: "Search airports and flights" }).click();
  } else {
    await expect(page.getByText("Find a flight.")).toBeVisible();
  }
  await expect(page.getByRole("combobox", { name: "Airport" })).toHaveValue(/LFPG/);
  await page.getByRole("button", { name: /explore flights/i }).click();
  await expect(page.getByText("AFR123").first()).toBeVisible();
  await page.getByRole("button", { name: /AFR123/i }).click();
  await expect(page.getByRole("complementary", { name: "Selected flight details" })).toBeVisible();
  await expect(page).toHaveURL(/airport=LFPG.*icao24=39abcd/);
  const photoLink = page.locator(".aircraft-photo-link");
  await expect(photoLink).toHaveAttribute("href", "https://www.planespotters.net/photo/1/f-habc");
  await expect(page.getByText("© Test Photographer")).toBeVisible();
  await expect(page.getByText("Altitude profile")).toBeVisible();
  await expect(page.locator(".altitude-legend")).toHaveCount(2);
  await page.locator(".altitude-hover-target").hover({ position: { x: 24, y: 12 } });
  await expect(page.locator(".altitude-tooltip")).toBeVisible();
  await expect(page.locator(".altitude-hover-readout")).toContainText("Altitude");
});

test("supports the mobile search sheet", async ({ page, isMobile }) => {
  test.skip(!isMobile, "Mobile-only interaction");
  await page.getByRole("button", { name: "Search airports and flights" }).click();
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
  if (isMobile) await page.getByRole('button', {name: 'Search airports and flights'}).click();
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
  await expect(page.getByText("F-HABC", { exact: true })).toBeVisible();
  await expect(page.getByText("F-HABC · A359")).toBeVisible();
  await expect(page.getByText("AIRBUS A-350-941")).toBeVisible();
  await expect(page.getByText("Operations")).toBeVisible();
  await expect(page.getByText("FlightAware", { exact: true })).toBeVisible();
  await expect(page.getByText("64% complete")).toBeVisible();
});

test("anchors the selected aircraft to the latest trace point", async ({ page }) => {
  await page.locator(".leaflet-marker-icon").filter({ has: page.locator(".aircraft-marker") }).first().dispatchEvent("click");
  await expect(page.locator(".route-endpoint-marker")).toHaveCount(2);
  await expect.poll(async () => {
    const aircraftBox = await page.locator('.aircraft-marker[data-icao24="39abcd"]').boundingBox();
    const endpointBox = await page.locator(".route-endpoint-end").boundingBox();
    if (!aircraftBox || !endpointBox) return Number.POSITIVE_INFINITY;
    return Math.hypot(
      aircraftBox.x + aircraftBox.width / 2 - endpointBox.x - endpointBox.width / 2,
      aircraftBox.y + aircraftBox.height / 2 - endpointBox.y - endpointBox.height / 2,
    );
  }, { timeout: 2_000 }).toBeLessThan(3);
});

test("keeps airport results populated from the live map snapshot when history is unavailable", async ({ page }) => {
  await page.unroute("**/api/**");
  await mockApi(page, { historyUnavailable: true });
  await page.goto("/?airport=LFPG&date=2026-07-10&mode=departure");
  await expect(page.getByRole("heading", { name: "Live traffic around CDG" })).toBeVisible();
  await expect(page.getByText("Live position").first()).toBeVisible();
});

test("shows a location marker after the user grants geolocation", async ({ page, context }) => {
  await context.grantPermissions(["geolocation"]);
  await context.setGeolocation({ latitude: 49.2, longitude: 2.6, accuracy: 35 });
  await page.getByRole("button", { name: "Locate me" }).click();
  await expect(page.locator(".user-location-marker")).toHaveCount(1);
  await expect(page.locator(".leaflet-marker-icon").filter({ has: page.locator(".user-location-marker") })).toHaveCount(1);
});

test("follows the selected aircraft until the map is dragged", async ({ page, isMobile }) => {
  test.skip(isMobile, "Dragging the map is covered on desktop pointers.");
  await page.locator(".leaflet-marker-icon").filter({ has: page.locator(".aircraft-marker") }).first().dispatchEvent("click");
  const follow = page.getByRole("button", { name: "Follow selected aircraft" });
  await follow.click();
  await expect(page.getByRole("button", { name: "Stop following aircraft" })).toHaveAttribute("aria-pressed", "true");
  // Let the follow fly-in settle; Leaflet ignores drags during a zoom animation.
  await expect(page.locator(".leaflet-zoom-anim")).toHaveCount(0);
  await page.waitForTimeout(1_000);
  const map = page.locator(".leaflet-container");
  const box = (await map.boundingBox())!;
  // Grab open map away from the centred aircraft, clear of the panels.
  const start = { x: box.x + box.width / 2 + 100, y: box.y + 110 };
  await page.mouse.move(start.x, start.y);
  await page.mouse.down();
  await page.mouse.move(start.x + 120, start.y + 60, { steps: 6 });
  await page.mouse.up();
  await expect(page.getByRole("button", { name: "Follow selected aircraft" })).toHaveAttribute("aria-pressed", "false");
});

test("flags an emergency squawk above the board and on the map", async ({ page }) => {
  await page.unroute("**/api/**");
  await mockApi(page);
  await page.route("**/api/live-flights**", (route) => route.fulfill({ json: {
    success: true, time: 1_752_000_000, count: 1,
    states: [{ icao24: "3c1234", callsign: "DLH7AB", latitude: 49.05, longitude: 2.6, baro_altitude: 3000, velocity: 150, true_track: 120, on_ground: false, squawk: "7700", data_source: "live-nearby" }],
  } }));
  await page.reload();
  const alert = page.getByRole("alert").filter({ hasText: "Squawk 7700" });
  await expect(alert).toContainText("DLH7AB · General emergency");
  await expect(page.locator(".aircraft-marker.emergency")).toHaveCount(1);
  await alert.getByRole("button").click();
  await expect(page.getByRole("complementary", { name: "Selected flight details" })).toBeVisible();
});

test("filters live aircraft by registration and type, then sorts by altitude", async ({ page, isMobile }) => {
  await page.route("**/api/live-flights**", (route) => route.fulfill({ json: {
    success: true, time: 1_752_000_000, count: 2,
    states: [
      { icao24: "39abcd", callsign: "AFR123", registration: "F-HABC", aircraft_type: "A359", latitude: 49.1, longitude: 2.7, baro_altitude: 8400, velocity: 220, on_ground: false },
      { icao24: "39abce", callsign: "EZY456", registration: "G-EZAB", aircraft_type: "A320", latitude: 49.2, longitude: 2.8, baro_altitude: 10000, velocity: 240, on_ground: false },
    ],
  } }));
  await page.reload();
  const results = page.getByRole("region", { name: "Flight results", exact: true });
  await expect(results.getByRole("button", { name: /AFR123/ })).toBeVisible();
  await results.getByRole("textbox", { name: "Filter flights" }).fill("a359 f-habc");
  await expect(results.getByText("1 of 2 shown")).toBeVisible();
  await expect(results.getByRole("button", { name: /EZY456/ })).toHaveCount(0);
  await results.getByRole("button", { name: "Clear", exact: true }).click();
  await results.getByRole("combobox", { name: "Sort order" }).selectOption("altitude_desc");
  await expect(results.locator(".flight-card").first()).toContainText("EZY456");
  await expect(results.locator(".flight-card").last()).toContainText("AFR123");
  if (isMobile) await expect(page.locator("body")).toHaveJSProperty("scrollWidth", await page.locator("body").evaluate((body) => body.clientWidth));
});

test("recovers from an airport search error without losing the query", async ({ page, isMobile }) => {
  let failed = true;
  await page.route("**/api/search-airports**", (route) => failed
    ? route.fulfill({ status: 503, json: { error: "Temporarily unavailable" } })
    : route.fulfill({ json: [airport] }));
  if (isMobile) await page.getByRole("button", { name: "Search airports and flights" }).click();
  const input = page.getByRole("combobox", { name: "Airport" });
  await expect(input).toHaveValue(/LFPG/);
  await input.fill("Paris");
  await expect(page.getByText("Airport search could not connect. Check your connection and try again.")).toBeVisible({ timeout: 15000 });
  await expect(input).toHaveValue("Paris");
  await expect(page.getByText(/No airport found/)).toHaveCount(0);
  failed = false;
  await page.getByRole("button", { name: "Retry airport search" }).click();
  await page.getByRole("button", { name: /CDG Paris Charles/ }).click();
  await expect(input).toHaveValue(/LFPG/);
  await expect(page.getByRole("button", { name: "Explore flights" })).toBeEnabled();
});
