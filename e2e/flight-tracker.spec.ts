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

/** Phones start map-first with the traffic panel collapsed; open it where a test reads the board. */
async function openTrafficPanel(page: Page) {
  const reopen = page.getByRole("button", { name: "Open traffic panel" });
  if (await reopen.isVisible()) await reopen.click();
}

test.beforeEach(async ({ page }) => {
  await mockApi(page);
  await page.goto("/");
});

test("searches an airport and opens a shareable flight detail", async ({ page }) => {
  await page.getByRole("combobox", { name: "Search flights and airports" }).fill("Paris");
  await page.getByRole("option", { name: /Paris Charles de Gaulle/ }).click();
  await expect(page.getByRole("heading", { name: "Departures from CDG" })).toBeVisible();
  await expect(page.getByText("AFR123").first()).toBeVisible();
  await page.locator(".flight-card").filter({ hasText: "AFR123" }).click();
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

test("collapses the traffic panel and brings it back", async ({ page }) => {
  const panel = page.getByRole("complementary", { name: "Traffic" });
  if (!(await panel.isVisible())) await page.getByRole("button", { name: "Open traffic panel" }).click();
  await expect(panel).toBeVisible();
  await panel.getByRole("button", { name: "Collapse traffic panel" }).click();
  await expect(panel).toHaveCount(0);
  await page.getByRole("button", { name: "Open traffic panel" }).click();
  await expect(panel).toBeVisible();
});

test("closing a shared flight keeps it closed", async ({ page }) => {
  await page.goto('/?airport=LFPG&date=2026-07-10&mode=departure&icao24=39abcd');
  await expect(page.getByRole('complementary', {name: 'Selected flight details'})).toBeVisible();
  await page.getByRole('button', {name: 'Close flight details'}).click();
  await expect(page.getByRole('complementary', {name: 'Selected flight details'})).toHaveCount(0);
  await expect(page).not.toHaveURL(/icao24=/);
});

test("search suggestions dismiss when leaving the field", async ({ page }) => {
  await page.getByRole("combobox", { name: "Search flights and airports" }).click();
  await expect(page.getByRole("listbox")).toBeVisible();
  await page.locator(".leaflet-map").click({ position: { x: 10, y: 300 } });
  await expect(page.getByRole("listbox")).toHaveCount(0);
});

test("resolves origin and destination for a selected live aircraft", async ({ page }) => {
  // Click the Leaflet hit target a user interacts with. The inner plane SVG is
  // rotated and can move under WebKit while a progressive sector settles.
  await page.locator(".leaflet-marker-icon").filter({ has: page.locator(".aircraft-marker") }).first().dispatchEvent("click");
  await expect(page.getByRole("complementary", { name: "Selected flight details" })).toBeVisible();
  await expect(page.getByText("Estimated from callsign")).toBeVisible();
  await expect(page.getByText("Incheon", { exact: true })).toBeVisible();
  await expect(page.getByText("F-HABC", { exact: true }).first()).toBeVisible();
  await expect(page.getByText("F-HABC · A359")).toBeVisible();
  await expect(page.getByText("AIRBUS A-350-941")).toBeVisible();
  await expect(page.getByText("Operations", { exact: true })).toBeVisible();
  await expect(page.getByText("FlightAware", { exact: true })).toBeVisible();
  await expect(page.getByText("64% complete")).toBeVisible();
});

test("draws the trace from its start up to the selected aircraft", async ({ page }) => {
  await page.locator(".leaflet-marker-icon").filter({ has: page.locator(".aircraft-marker") }).first().dispatchEvent("click");
  await expect(page.locator(".route-endpoint-start")).toHaveCount(1);
  await expect(page.locator(".aircraft-marker.active")).toHaveCount(1);
  await expect(page.getByRole("button", { name: "Show full route" })).toBeEnabled();
});

test("selecting an aircraft moves the map once and then leaves it alone", async ({ page, isMobile }) => {
  test.skip(isMobile, "Desktop camera behaviour is the focus of this change.");
  await page.route("**/api/live-flights**", (route) => route.fulfill({ json: {
    success: true, time: 1_752_000_000, count: 1,
    // Far from the default view, so the camera has to travel.
    states: [{ icao24: "39abcd", callsign: "AFR123", latitude: 47.6, longitude: 5.2, baro_altitude: 8400, velocity: 220, true_track: 72, on_ground: false }],
  } }));
  await page.reload();
  const pane = page.locator(".leaflet-map-pane");
  await page.getByRole("complementary", { name: "Traffic" }).getByRole("button", { name: /AFR123/ }).click();
  await expect(page.getByRole("complementary", { name: "Selected flight details" })).toBeVisible();
  await page.waitForTimeout(1_400);
  const settled = await pane.evaluate((element) => (element as HTMLElement).style.transform);
  // The route arrives after the aircraft is framed; it must not trigger a second flight.
  await page.waitForTimeout(1_500);
  expect(await pane.evaluate((element) => (element as HTMLElement).style.transform)).toBe(settled);
});

test("keeps airport results populated from the live map snapshot when history is unavailable", async ({ page }) => {
  await page.unroute("**/api/**");
  await mockApi(page, { historyUnavailable: true });
  await page.goto("/?airport=LFPG&date=2026-07-10&mode=departure");
  await expect(page.getByRole("heading", { name: "Live traffic around CDG" })).toBeVisible();
  await openTrafficPanel(page);
  await expect(page.locator(".flight-card").filter({ hasText: "AFR123" })).toBeVisible();
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
  await openTrafficPanel(page);
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

test("recovers from an airport search error without losing the query", async ({ page }) => {
  let failed = true;
  await page.route("**/api/search-airports**", (route) => failed
    ? route.fulfill({ status: 503, json: { error: "Temporarily unavailable" } })
    : route.fulfill({ json: [airport] }));
  const input = page.getByRole("combobox", { name: "Search flights and airports" });
  await input.fill("Paris");
  await expect(page.getByText("Airport search is unavailable right now.")).toBeVisible({ timeout: 15000 });
  await expect(input).toHaveValue("Paris");
  failed = false;
  await input.fill("Charles");
  await page.getByRole("option", { name: /Paris Charles/ }).click();
  await expect(page.getByRole("heading", { name: "Departures from CDG" })).toBeVisible();
});

test("one search field serves aircraft and airports, reachable from the keyboard", async ({ page, isMobile }) => {
  test.skip(isMobile, "Keyboard shortcuts are a desktop affordance.");
  const search = page.getByRole("combobox", { name: "Search flights and airports" });
  await page.keyboard.press("ControlOrMeta+k");
  await expect(search).toBeFocused();
  await search.fill("afr");
  await expect(page.getByRole("option", { name: /AFR123/ })).toBeVisible();
  await page.keyboard.press("Enter");
  await expect(page.getByRole("complementary", { name: "Selected flight details" })).toBeVisible();
});

test("filters hide aircraft on the map and say how many", async ({ page }) => {
  await page.route("**/api/live-flights**", (route) => route.fulfill({ json: {
    success: true, time: 1_752_000_000, count: 2,
    states: [
      { icao24: "39abcd", callsign: "AFR123", latitude: 49.1, longitude: 2.7, baro_altitude: 11000, velocity: 220, true_track: 72, on_ground: false },
      { icao24: "39abce", callsign: "EZY456", latitude: 49.2, longitude: 2.8, baro_altitude: 1000, velocity: 80, true_track: 72, on_ground: false },
    ],
  } }));
  await page.reload();
  await expect(page.locator(".aircraft-marker")).toHaveCount(2);
  await page.getByRole("button", { name: /^Filters/ }).click();
  await page.getByRole("searchbox", { name: /Airline, type or registration/ }).fill("afr");
  await expect(page.locator(".aircraft-marker")).toHaveCount(1);
  await expect(page.locator(".map-status")).toContainText("1 hidden by filters");
  await page.getByRole("button", { name: "Reset filters" }).click();
  await expect(page.locator(".aircraft-marker")).toHaveCount(2);
});

test("switching units updates the readouts", async ({ page }) => {
  await page.locator(".leaflet-marker-icon").filter({ has: page.locator(".aircraft-marker") }).first().dispatchEvent("click");
  const readouts = page.getByLabel("Live readouts");
  await expect(readouts).toContainText("kt");
  await page.getByRole("button", { name: /^Display/ }).click();
  await page.getByRole("button", { name: "m · km/h" }).click();
  await expect(readouts).toContainText("km/h");
});

test("replaces the flight drawer cleanly when another aircraft is selected", async ({ page, isMobile }) => {
  test.skip(isMobile, "Desktop flight transitions are the focus of this change.");
  await page.route("**/api/live-flights**", (route) => route.fulfill({ json: {
    success: true, time: 1_752_000_000, count: 2,
    states: [
      { icao24: "39abcd", callsign: "AFR123", latitude: 49.1, longitude: 2.7, baro_altitude: 8400, velocity: 220, on_ground: false },
      { icao24: "39abce", callsign: "EZY456", latitude: 49.2, longitude: 2.8, baro_altitude: 10000, velocity: 240, on_ground: false },
    ],
  } }));
  await page.reload();
  await openTrafficPanel(page);
  const board = page.getByRole("region", { name: "Flight results", exact: true });
  await board.getByRole("button", { name: /AFR123/ }).click();
  const drawer = page.getByRole("complementary", { name: "Selected flight details" });
  await expect(drawer.getByRole("heading", { name: "AFR123" })).toBeVisible();
  await page.getByRole("button", { name: "Follow selected aircraft" }).click();
  await expect(page.getByRole("button", { name: "Stop following aircraft" })).toHaveAttribute("aria-pressed", "true");
  await board.getByRole("button", { name: /EZY456/ }).click();
  await expect(drawer).toHaveCount(1);
  await expect(drawer.getByRole("heading", { name: "EZY456" })).toBeVisible();
  await expect(page.getByRole("button", { name: "Follow selected aircraft" })).toHaveAttribute("aria-pressed", "false");
  await expect(page).toHaveURL(/icao24=39abce/);
});
