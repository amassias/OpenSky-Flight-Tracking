import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { render, screen } from "@testing-library/react";
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

function json(body: unknown, status = 200) {
  return Promise.resolve(new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json" } }));
}

function renderApp() {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(<QueryClientProvider client={client}><App /></QueryClientProvider>);
}

describe("App", () => {
  it("loads an airport and renders returned flights", async () => {
    vi.stubGlobal("fetch", vi.fn((input: RequestInfo | URL) => {
      const url = new URL(String(input));
      if (url.pathname === "/api/health") return json({ success: true, airports_loaded: 7895, credentials_configured: true, server_time_utc: new Date().toISOString() });
      if (url.pathname === "/api/airports" || url.pathname === "/api/search-airports") return json([airport]);
      if (url.pathname === "/api/flights") return json({ success: true, airport: "LFPG", airport_meta: airport, airport_name: airport.name, mode: "departure", date: "2026-07-10", date_basis: "UTC", count: 1, summary: { total: 1, live_airborne: 0, live_on_ground: 0, unique_airlines: 1 }, flights: [flight], generated_at: new Date().toISOString() });
      if (url.pathname === "/api/track") return json({ success: true, track: { path: [] }, path_count: 0 });
      throw new Error(`Unexpected request ${url.pathname}`);
    }));

    renderApp();
    expect(await screen.findByDisplayValue(/LFPG/)).toBeInTheDocument();
    await userEvent.click(screen.getByRole("button", { name: /explore flights/i }));
    expect(await screen.findByText("AFR123")).toBeInTheDocument();
    expect(screen.getByText("Air France")).toBeInTheDocument();
  });

  it("turns an authentication error into an actionable message", async () => {
    vi.stubGlobal("fetch", vi.fn((input: RequestInfo | URL) => {
      const url = new URL(String(input));
      if (url.pathname === "/api/health") return json({ success: true, airports_loaded: 7895, credentials_configured: false, server_time_utc: new Date().toISOString() });
      if (url.pathname === "/api/airports" || url.pathname === "/api/search-airports") return json([airport]);
      if (url.pathname === "/api/flights") return json({ success: false, error: "Missing credentials" }, 401);
      throw new Error(`Unexpected request ${url.pathname}`);
    }));

    renderApp();
    expect(await screen.findByDisplayValue(/LFPG/)).toBeInTheDocument();
    await userEvent.click(screen.getByRole("button", { name: /explore flights/i }));
    expect(await screen.findByText(/add them to your local .env file/i)).toBeInTheDocument();
  });
});
