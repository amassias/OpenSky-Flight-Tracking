import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import { App } from "./App";
import { getUnits } from "./units";

vi.mock("./components/FlightMap", () => ({
  FlightMap: () => <div aria-label="Live flight map">Map</div>,
}));

const airport = {
  icao: "LFPG", iata: "CDG", name: "Charles de Gaulle", display_name: "Charles de Gaulle (CDG)",
  country: "FR", region: "Paris", latitude: 49.0, longitude: 2.5,
};

const flight = {
  icao24: "39abcd", callsign: "AFR123", airline_name: "Air France", airline_code: "AFR",
  departure_airport: "LFPG", departure_airport_name: "Charles de Gaulle",
  arrival_airport: "EGLL", arrival_airport_name: "Heathrow",
  first_seen: 1_750_000_000, last_seen: 1_750_005_000, primary_time: 1_750_000_000,
  status: "completed",
};

const conditions = {
  success: true, airport: { ...airport, elevation_ft: 392, wikipedia: null },
  weather: { station: "LFPG", observed_at: 1_750_000_000, raw: "METAR LFPG 082100Z 25006KT CAVOK 09/03 Q1025", flight_category: "VFR", wind_dir: 250, wind_variable: false, wind_kt: 6, gust_kt: null, visibility: { meters: 10000, at_least: true }, cover: "CAVOK", clouds: [], ceiling_ft: null, temperature_c: 9, dewpoint_c: 3, qnh_hpa: 1025, taf: null },
  runways: [{ ends: [{ ident: "09R", heading: 86, headwind_kt: -5.8, crosswind_kt: 1.4 }, { ident: "27L", heading: 266, headwind_kt: 5.8, crosswind_kt: 1.4 }], length_ft: 13780, width_ft: 148, surface: "ASP", lighted: true }],
  favoured_runways: ["27L"], runway_basis: "wind", frequencies: [], delays: null, unavailable: [], generated_at: new Date().toISOString(),
};

const board = {
  success: true, airport: "LFPG", time: Math.floor(Date.now() / 1000), provider: "adsb.lol", radius_nm: 150, aircraft_scanned: 2, routes_pending: 0, generated_at: new Date().toISOString(),
  departures: [{ icao24: "3944ef", callsign: "AFR1234", airline_name: "Air France", aircraft_type: "A320", on_ground: true, velocity: 6, latitude: 49.0, longitude: 2.55, phase: "taxiing", origin: null, destination: { icao: "EDDB", iata: "BER", city: "Berlin" }, distance_km: 1.2, route_known: true }],
  arrivals: [{ icao24: "4ca123", callsign: "EZY37UJ", airline_name: "easyJet", aircraft_type: "A20N", on_ground: false, velocity: 120, baro_altitude: 1200, latitude: 49.1, longitude: 2.3, phase: "final", origin: { icao: "LFMN", iata: "NCE", city: "Nice" }, destination: null, distance_km: 18, route_known: true, eta: Math.floor(Date.now() / 1000) + 300 }],
};

/** Shared API answers; a test passes the endpoints it wants to change. */
function mockApi(overrides: Record<string, (url: URL) => Promise<Response>> = {}) {
  vi.stubGlobal("fetch", vi.fn((input: RequestInfo | URL) => {
    const url = new URL(String(input));
    if (overrides[url.pathname]) return overrides[url.pathname](url);
    if (url.hostname === "api.planespotters.net") return json({ photos: [] });
    if (url.pathname === "/api/health") return json({ success: true, airports_loaded: 7895, credentials_configured: true, server_time_utc: new Date().toISOString() });
    if (url.pathname === "/api/airports" || url.pathname === "/api/search-airports" || url.pathname === "/api/map-airports") return json([airport]);
    if (url.pathname === "/api/airport-conditions") return json(conditions);
    if (url.pathname === "/api/airport-board") return json(board);
    if (url.pathname === "/api/airport-schedule") return json({ success: true, airport: "LFPG", direction: url.searchParams.get("direction"), provider: "FlightAware AeroAPI", available: false, reason: "unconfigured", flights: [] });
    if (url.pathname === "/api/flights") return json({ success: true, airport: "LFPG", airport_meta: airport, airport_name: airport.name, mode: "departure", date: "2026-07-10", date_basis: "UTC", count: 1, summary: { total: 1, live_airborne: 0, live_on_ground: 0, unique_airlines: 1 }, flights: [flight], generated_at: new Date().toISOString() });
    if (url.pathname === "/api/track") return json({ success: true, track: { path: [] }, path_count: 0 });
    if (url.pathname === "/api/flight-info") return json({ success: true, icao24: url.searchParams.get("icao24"), callsign: url.searchParams.get("callsign") });
    throw new Error(`Unexpected request ${url.pathname}`);
  }));
}

async function openHistory() {
  await userEvent.click(await screen.findByRole("button", { name: "History" }));
}

function json(body: unknown, status = 200) {
  return Promise.resolve(new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json" } }));
}

async function openAirportFromSearch() {
  const search = await screen.findByRole("combobox", { name: /search flights and airports/i });
  await userEvent.type(search, "Charles");
  await userEvent.click(await screen.findByRole("option", { name: /Charles de Gaulle/ }));
}

function renderApp() {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(<QueryClientProvider client={client}><App /></QueryClientProvider>);
}

describe("App", () => {
  it("opens an airport on its live board with current conditions", async () => {
    window.history.replaceState(null, "", "/");
    mockApi();
    renderApp();
    await openAirportFromSearch();
    expect(await screen.findByText("AFR1234")).toBeInTheDocument();
    expect(screen.getByText("Berlin")).toBeInTheDocument();
    expect(screen.getByText("Taxiing")).toBeInTheDocument();
    expect(await screen.findByText("VFR")).toBeInTheDocument();
    expect(screen.getByText("27L")).toBeInTheDocument();

    await userEvent.click(screen.getByRole("button", { name: /Arrivals/ }));
    expect(await screen.findByText("EZY37UJ")).toBeInTheDocument();
    expect(screen.getByText("Nice")).toBeInTheDocument();
    expect(screen.getByText(/in 5 min/)).toBeInTheDocument();
  });

  it("shows FlightAware's scheduled flights joined to the aircraft seen live", async () => {
    window.history.replaceState(null, "", "/");
    const soon = new Date(Date.now() + 20 * 60_000).toISOString();
    const late = new Date(Date.now() + 45 * 60_000).toISOString();
    mockApi({
      "/api/airport-schedule": () => json({
        success: true, airport: "LFPG", direction: "departure", provider: "FlightAware AeroAPI", available: true, fetched_at: Math.floor(Date.now() / 1000),
        flights: [
          { provider: "FlightAware", ident: "AFR1234", ident_icao: "AFR1234", ident_iata: "AF1234", atc_ident: "AFR1234", airline_name: "Air France", destination: { code_icao: "EDDB", code_iata: "BER", city: "Berlin" }, scheduled_out: soon, estimated_out: soon, gate_orig: "K45", terminal_orig: "2F" },
          { provider: "FlightAware", ident: "AFR990", ident_icao: "AFR990", ident_iata: "AF990", atc_ident: "AFR990", destination: { code_icao: "FAOR", code_iata: "JNB", city: "Johannesburg" }, scheduled_out: soon, estimated_out: late, gate_orig: "M30" },
        ],
      }),
    });
    renderApp();
    await openAirportFromSearch();
    expect(await screen.findByText("Scheduled departures")).toBeInTheDocument();
    expect(screen.getByText("Gate K45 · T2F")).toBeInTheDocument();
    expect(screen.getByText("Delayed 25 min")).toBeInTheDocument();
    // AFR1234 is also taxiing in the live board: one row, not two.
    expect(screen.getAllByText("AF1234")).toHaveLength(1);
    expect(screen.queryByText("AFR1234")).not.toBeInTheDocument();
    await userEvent.click(screen.getByRole("button", { name: /AF1234/ }));
    expect(await screen.findByRole("heading", { name: "AFR1234" })).toBeInTheDocument();
  });

  it("opens a scheduled flight that is not on the map yet by looking its aircraft up", async () => {
    window.history.replaceState(null, "", "/");
    const soon = new Date(Date.now() + 20 * 60_000).toISOString();
    mockApi({
      "/api/airport-schedule": () => json({
        success: true, airport: "LFPG", direction: "departure", available: true, fetched_at: Math.floor(Date.now() / 1000),
        flights: [{ provider: "FlightAware", ident: "AFR990", ident_icao: "AFR990", ident_iata: "AF990", atc_ident: "AFR990", destination: { code_icao: "FAOR", code_iata: "JNB", city: "Johannesburg" }, scheduled_out: soon, estimated_out: soon }],
      }),
      "/api/callsign-lookup": () => json({ success: true, found: true, aircraft: { icao24: "3944aa", callsign: "AFR990", latitude: 49.1, longitude: 2.6, baro_altitude: 3000, velocity: 140, true_track: 90, on_ground: false } }),
    });
    renderApp();
    await openAirportFromSearch();
    const row = await screen.findByRole("button", { name: /AF990/ });
    expect(row).toBeEnabled();
    await userEvent.click(row);
    expect(await screen.findByRole("heading", { name: "AFR990" })).toBeInTheDocument();
    await waitFor(() => expect(window.location.search).toContain("icao24=3944aa"));
  });

  it("keeps a scheduled flight without a detected position separate from the airframe's old trace", async () => {
    window.history.replaceState(null, "", "/");
    const soon = new Date(Date.now() + 20 * 60_000).toISOString();
    mockApi({
      "/api/airport-schedule": () => json({ success: true, airport: "LFPG", direction: "departure", available: true,
        flights: [{ provider: "FlightAware", ident: "AFR990", ident_iata: "AF990", atc_ident: "AFR990", registration: "F-HABC", origin: { code_icao: "LFPG" }, destination: { code_icao: "FAOR", city: "Johannesburg" }, scheduled_out: soon }],
      }),
      "/api/callsign-lookup": () => json({ success: true, found: false, aircraft: null }),
      "/api/aircraft-lookup": () => json({ success: true, icao24: "39abcd", registration: "F-HABC" }),
      "/api/track": () => json({ success: true, path_count: 2, track: { icao24: "39abcd", callsign: "AFR990", path: [[1, 49, 2, 9000, 90, false], [2, 50, 3, 8000, 90, false]] } }),
      "/api/flight-info": () => json({ success: true, icao24: "39abcd", callsign: "AFROLD", arrival_airport: "EGLL" }),
    });
    renderApp();
    await openAirportFromSearch();
    await userEvent.click(await screen.findByRole("button", { name: /AF990/ }));
    expect(await screen.findByRole("heading", { name: "AFR990" })).toBeInTheDocument();
    expect(await screen.findByText(/Live position not detected for this flight/)).toBeInTheDocument();
    expect(window.location.search).toContain("scheduled=1");
    const paths = vi.mocked(fetch).mock.calls.map(([input]) => new URL(String(input)).pathname);
    expect(paths).not.toContain("/api/track");
    expect(paths).not.toContain("/api/flight-info");
  });

  it("does not restore an old aircraft position when sharing an undetected scheduled flight", async () => {
    window.history.replaceState(null, "", "/?icao24=39abcd&scheduled=1&callsign=AFR990");
    mockApi();
    renderApp();
    expect(await screen.findByRole("heading", { name: "AFR990" })).toBeInTheDocument();
    expect(await screen.findByText(/Live position not detected/)).toBeInTheDocument();
    expect(vi.mocked(fetch).mock.calls.map(([input]) => new URL(String(input)).pathname)).not.toContain("/api/track");
  });

  it("selects a live board flight with this airport as one end of its route", async () => {
    window.history.replaceState(null, "", "/");
    mockApi();
    renderApp();
    await openAirportFromSearch();
    await userEvent.click(await screen.findByRole("button", { name: /AFR1234/ }));
    await waitFor(() => expect(window.location.search).toContain("icao24=3944ef"));
    expect(await screen.findByRole("heading", { name: "AFR1234" })).toBeInTheDocument();
  });

  it("shows scheduled flights straight away while the live scan is still running", async () => {
    window.history.replaceState(null, "", "/");
    const soon = new Date(Date.now() + 20 * 60_000).toISOString();
    mockApi({
      "/api/airport-board": () => new Promise<Response>(() => undefined),
      "/api/airport-schedule": () => json({
        success: true, airport: "LFPG", direction: "departure", provider: "FlightAware AeroAPI", available: true, fetched_at: Math.floor(Date.now() / 1000),
        flights: [{ provider: "FlightAware", ident: "AFR990", ident_icao: "AFR990", ident_iata: "AF990", atc_ident: "AFR990", destination: { code_icao: "FAOR", code_iata: "JNB", city: "Johannesburg" }, scheduled_out: soon, estimated_out: soon, gate_orig: "M30" }],
      }),
    });
    const { container } = renderApp();
    await openAirportFromSearch();
    expect(await screen.findByText("Scheduled departures")).toBeInTheDocument();
    expect(screen.getByText("Scanning the airport area…")).toBeInTheDocument();
    expect(container.querySelectorAll(".board-row.skeleton")).toHaveLength(0);
  });

  it("loads recorded flights in the history view", async () => {
    window.history.replaceState(null, "", "/");
    mockApi();
    renderApp();
    await openAirportFromSearch();
    await openHistory();
    expect(await screen.findByText("AFR123")).toBeInTheDocument();
    expect(screen.getByText("Air France")).toBeInTheDocument();
    expect(screen.getByRole("heading", { name: "Departures from CDG" })).toBeInTheDocument();
    expect(window.location.search).toContain("view=history");
  });

  it("steps the history back one UTC day and not past today", async () => {
    window.history.replaceState(null, "", "/");
    mockApi();
    renderApp();
    await openAirportFromSearch();
    await openHistory();
    expect(screen.getByRole("button", { name: "Next day" })).toBeDisabled();
    const today = (screen.getByLabelText("UTC date") as HTMLInputElement).value;
    await userEvent.click(screen.getByRole("button", { name: "Previous day" }));
    const yesterday = new Date(`${today}T00:00:00Z`);
    yesterday.setUTCDate(yesterday.getUTCDate() - 1);
    await waitFor(() => expect(window.location.search).toContain(`date=${yesterday.toISOString().slice(0, 10)}`));
    expect(screen.getByRole("button", { name: "Next day" })).toBeEnabled();
  });

  it("shows unloaded history as unknown and states the notice once", async () => {
    window.history.replaceState(null, "", "/");
    const notice = "OpenSky history is temporarily unavailable for 2026-07-10.";
    mockApi({ "/api/flights": () => json({ success: true, airport: "LFPG", mode: "departure", date: "2026-07-10", source: "unavailable", notice, count: 0, summary: { total: 0, live_airborne: 0, live_on_ground: 0, unique_airlines: 0 }, flights: [], generated_at: new Date().toISOString() }) });
    renderApp();
    await openAirportFromSearch();
    await openHistory();
    expect(await screen.findByText("Historical data unavailable")).toBeInTheDocument();
    expect(screen.getAllByText(notice)).toHaveLength(1);
    expect(screen.getByText("Flights").previousElementSibling).toHaveTextContent("—");
  });

  it("turns an authentication error into an actionable message", async () => {
    window.history.replaceState(null, "", "/");
    mockApi({ "/api/flights": () => json({ success: false, error: "Missing credentials" }, 401) });
    renderApp();
    await openAirportFromSearch();
    await openHistory();
    expect(await screen.findByText(/add them to your local .env file/i)).toBeInTheDocument();
  });

  it("restores a shared airport URL even when airport search resolves after popular airports", async () => {
    window.history.replaceState(null, "", "/?airport=LFPG&date=2026-07-09&mode=departure&view=history");
    mockApi({
      "/api/search-airports": async () => {
        await new Promise((resolve) => setTimeout(resolve, 30));
        return json([airport]);
      },
    });

    renderApp();
    expect(await screen.findByText("AFR123")).toBeInTheDocument();
  });

  it("keeps the transponder registration when flight-info only has the scheduled tail", async () => {
    window.history.replaceState(null, "", "/");
    const live = { ...flight, icao24: "398604", callsign: "AFR28VV", registration: "F-HBQE", aircraft_type: "E190", status: "airborne" };
    mockApi({
      "/api/flights": () => json({ success: true, airport: "LFPG", airport_meta: airport, airport_name: airport.name, mode: "departure", date: "2026-07-10", date_basis: "UTC", count: 1, summary: { total: 1, live_airborne: 1, live_on_ground: 0, unique_airlines: 1 }, flights: [live], generated_at: new Date().toISOString() }),
      "/api/flight-info": () => json({ success: true, icao24: "398604", callsign: "AFR28VV", registration: "F-HBQD", registration_source: "schedule", aircraft_type: "E190" }),
    });

    renderApp();
    await openAirportFromSearch();
    await openHistory();
    await userEvent.click(await screen.findByRole("button", { name: /AFR28VV/ }));
    expect(await screen.findByText("No photo of F-HBQE yet")).toBeInTheDocument();
    await waitFor(() => expect(screen.getAllByText("F-HBQE").length).toBeGreaterThan(0));
    expect(screen.queryByText(/F-HBQD/)).not.toBeInTheDocument();
  });

  it("opens the keyboard shortcuts with ? and switches the map theme with T", async () => {
    mockApi();
    const { container } = renderApp();
    await screen.findByRole("combobox", { name: /search flights and airports/i });
    await userEvent.keyboard("?");
    expect(await screen.findByRole("dialog", { name: "Keyboard shortcuts" })).toBeInTheDocument();
    await userEvent.keyboard("{Escape}");
    await waitFor(() => expect(screen.queryByRole("dialog", { name: "Keyboard shortcuts" })).not.toBeInTheDocument());

    const before = container.querySelector(".app")!.className.includes("theme-light");
    await userEvent.keyboard("t");
    expect(container.querySelector(".app")!.className.includes("theme-light")).toBe(!before);

    const unitsBefore = getUnits();
    await userEvent.keyboard("u");
    expect(getUnits()).not.toBe(unitsBefore);
    await userEvent.keyboard("u");
    expect(getUnits()).toBe(unitsBefore);
  });

  it("keeps map filters for the next visit", async () => {
    window.localStorage.setItem("skytrace-filters", JSON.stringify({ hideGround: true, query: "stale text" }));
    mockApi();
    renderApp();
    // The ground filter returns; free text from an earlier visit does not.
    expect(await screen.findByRole("button", { name: /Filters/ })).toHaveTextContent("1");
  });

  it("refuses a ninth favourite instead of silently dropping the oldest", async () => {
    const saved = Array.from({ length: 8 }, (_, index) => ({ ...airport, icao: `KZZ${index}`, iata: `Z${index}A` }));
    window.localStorage.setItem("skytrace-favorites", JSON.stringify(saved));
    mockApi();
    renderApp();
    await openAirportFromSearch();
    await userEvent.click(await screen.findByRole("button", { name: "Add airport to favourites" }));
    expect(await screen.findByText(/You can keep 8 favourites/)).toBeInTheDocument();
    expect(JSON.parse(window.localStorage.getItem("skytrace-favorites")!)).toHaveLength(8);
  });
  it("preserves a recorded route when today's aircraft metadata returns another flight", async () => {
    mockApi({ "/api/flight-info": () => json({ success: true, icao24: "39abcd", callsign: "AFR123",
      departure_airport: "SCEL", departure_airport_name: "Santiago", arrival_airport: "LFPG", arrival_airport_name: "Paris",
      route_source: "flightaware", aircraft_description: "Verified selected identity", first_seen: Math.floor(Date.now()/1000),
    }) });
    renderApp();
    await openAirportFromSearch();
    await openHistory();
    await userEvent.click(await screen.findByRole("button", { name: /AFR123/ }));
    expect(await screen.findByText("Verified selected identity")).toBeInTheDocument();
    const route = screen.getByRole("region", { name: "Route" });
    expect(route).toHaveTextContent("Heathrow");
    expect(route).not.toHaveTextContent("Santiago");
  });

  it("does not mark an old position fresh using another flight's profile packet", async () => {
    window.history.replaceState(null, "", "/?icao24=39abcd");
    const now = Math.floor(Date.now()/1000);
    let lookups = 0;
    mockApi({ "/api/flight-info": () => json(++lookups === 1
      ? { success: true, icao24: "39abcd", callsign: "AFR123", latitude: 49, longitude: 2, time_position: now-180, last_contact: now-180, squawk: "2021", emergency: "none" }
      : { success: true, icao24: "39abcd", callsign: "AFR123", aircraft_description: "Other episode packet", time_position: now, last_contact: now, squawk: "7700", emergency: "general",
          live_state: { icao24: "39abcd", callsign: "AFR999", latitude: 50, longitude: 3, time_position: now, last_contact: now, squawk: "7700", emergency: "general" } }) });
    renderApp();
    expect(await screen.findByText("Other episode packet")).toBeInTheDocument();
    expect(screen.getByText(/Position updates delayed/)).toBeInTheDocument();
    expect(screen.queryByRole("region", { name: "Flight alerts and events" })).not.toBeInTheDocument();
  });

});
