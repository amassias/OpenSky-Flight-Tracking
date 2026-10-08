import { expect, test } from "@playwright/test";

const airport = { icao: "ENGM", iata: "OSL", name: "Oslo Gardermoen", display_name: "Oslo (OSL)", country: "NO", city: "Oslo", region: "Norway", latitude: 60.2, longitude: 11.1, timezone: "Europe/Oslo", timetable_provider: "Avinor" };
test("operator timetable supports delays, cancellations, local times and observed traffic", async ({ page }, testInfo) => {
  let requests = 0;
  await page.route("**/api/**", async (route) => {
    const url = new URL(route.request().url());
    const mode = url.searchParams.get("mode") || "departure";
    const flight = { id: "1", flight_number: "SK100", airline_name: "SAS", direction: "D", other_airport: "TRD", other_airport_name: "Trondheim", scheduled: "2026-10-08T13:00:00Z", estimated: "2026-10-08T13:40:00Z", actual: null, actual_event: null, status: "estimated", delay_minutes: 40, delayed: true, gate: "A20", terminal: null, check_in: null, baggage_belt: null, next_information: null };
    const body = url.pathname === "/api/health" ? { live_available: true }
      : url.pathname === "/api/live-flights" ? { count: 0, states: [] }
      : ["/api/map-airports", "/api/airports", "/api/search-airports"].includes(url.pathname) ? [airport]
      : url.pathname === "/api/timetable" ? (++requests, { success: true, airport: "ENGM", date: "2026-10-08", mode, provider: "Avinor", coverage: "available", flights: mode === "departure" ? [flight, { ...flight, id: "2", flight_number: "SK200", status: "cancelled", estimated: null, delay_minutes: null, delayed: false }] : [{ ...flight, direction: "A", flight_number: "SK300" }], updated_at: "2026-10-08T12:00:00Z", stale: false })
      : url.pathname === "/api/flights" ? { success: true, flights: [], summary: { total: 0 }, source: "opensky" } : [];
    await route.fulfill({ json: body });
  });
  await page.goto("/?airport=ENGM&date=2026-10-08&view=schedule");
  await expect(page.getByRole("heading", { name: "Flight timetable" })).toBeVisible();
  await expect(page.getByRole("link", { name: "Flydata fra Avinor" })).toBeVisible();
  await expect(page.getByText("Delayed · +40 min", { exact: true })).toBeVisible();
  await expect(page.getByText("Cancelled", { exact: true })).toBeVisible();
  await expect(page.locator(".timetable-flight").first()).toContainText("13:40");
  await page.getByRole("checkbox", { name: "Local times" }).check();
  await expect(page.locator(".timetable-flight").first()).toContainText("15:40");
  await page.screenshot({ path: testInfo.outputPath("operator-timetable.png") });
  await page.getByRole("button", { name: "Arrivals", exact: true }).click();
  await expect(page.locator(".timetable-flight")).toHaveCount(1);
  await expect(page.locator(".timetable-flight")).toContainText("SK300");
  await page.getByRole("button", { name: "Departures", exact: true }).click();
  await expect(page.locator(".timetable-flight")).toHaveCount(2);
  expect(requests).toBe(2);
  await page.getByRole("button", { name: "Observed traffic", exact: true }).click();
  await expect(page.locator(".timetable-board")).toHaveCount(0);
  await expect(page.getByRole("button", { name: "Timetable", exact: true })).toHaveAttribute("aria-pressed", "false");
});

test("unsupported airport explains coverage and links to Oslo", async ({ page }) => {
  await page.route("**/api/**", async (route) => {
    const path = new URL(route.request().url()).pathname;
    const body = path === "/api/search-airports" ? [{ ...airport, icao: "LFPG", iata: "CDG", timetable_provider: null }]
      : path === "/api/timetable" ? { provider: null, coverage: "unsupported", flights: [], notice: "No free timetable source is connected for this airport." }
      : path === "/api/live-flights" ? { states: [] } : [];
    await route.fulfill({ json: body });
  });
  await page.goto("/?airport=LFPG&view=schedule");
  await expect(page.getByText("No free timetable source is connected for this airport.")).toBeVisible();
  await expect(page.getByRole("link", { name: "Open Oslo timetable" })).toHaveAttribute("href", "?airport=ENGM&view=schedule");
});
