import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import { App } from "./App";

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

  it("selects a live board flight with this airport as one end of its route", async () => {
    window.history.replaceState(null, "", "/");
    mockApi();
    renderApp();
    await openAirportFromSearch();
    await userEvent.click(await screen.findByRole("button", { name: /AFR1234/ }));
    await waitFor(() => expect(window.location.search).toContain("icao24=3944ef"));
    expect(await screen.findByRole("heading", { name: "AFR1234" })).toBeInTheDocument();
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
});
