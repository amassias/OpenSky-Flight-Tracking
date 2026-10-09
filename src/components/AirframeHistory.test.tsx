import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";
import { AirframeHistory } from "./AirframeHistory";
import type { Flight } from "../types";

afterEach(() => vi.unstubAllGlobals());

const flight = { icao24: "3986e0", callsign: "AFR23SR", registration: "F-HBXA" } as Flight;
const history = {
  success: true, icao24: "3986e0", found: true, registration: "F-HBXA", linked_icao24: [], sources: ["OpenSky aircraft database snapshots", "ADSBDB registry"],
  snapshots: { first: "2020-11", last: "2025-08", count: 11 },
  airframe: { manufacturer: "Embraer", model: "EMB-170 STD", serial: "17000237", built: "2012", country: "France" },
  registry: { owner: "Air France HOP", owner_country: "France", operator_code: "HOP" },
  history: [
    { source: "opensky", icao24: "3986e0", registration: "F-HBXA", from: "2021-06", to: null, precision: "month", owner: "Hop", operator: "Hop!", private: false, current: true },
    { source: "opensky", icao24: "3986e0", registration: "F-GXXX", from: "2020-11", to: "2020-11", precision: "month", owner: "Brit Air", operator: null, private: false, current: false },
    { source: "faa", icao24: "a00001", registration: "N1", from: "2010-01-02", to: "2012-05-06", precision: "day", owner: null, operator: null, private: true, location: "Wichita, KS", event: "Exported to Canada", current: false },
  ],
};

function renderHistory(handlers: Record<string, () => unknown> = {}) {
  vi.stubGlobal("fetch", vi.fn(async (input: RequestInfo | URL) => {
    const path = new URL(String(input)).pathname;
    const body = handlers[path]?.() ?? (path === "/api/aircraft-history" ? history : null);
    if (body === null) throw new Error(`Unexpected request ${path}`);
    return new Response(JSON.stringify(body), { headers: { "Content-Type": "application/json" } });
  }));
  render(<QueryClientProvider client={new QueryClient()}><AirframeHistory flight={flight} /></QueryClientProvider>);
}

describe("AirframeHistory", () => {
  it("shows the airframe facts, the owner today and the timeline with dates and sources", async () => {
    renderHistory();
    expect(await screen.findByText("F-HBXA", { selector: ".airframe-registration" })).toBeInTheDocument();
    expect(screen.getByText("Embraer EMB-170 STD")).toBeInTheDocument();
    expect(screen.getByText("17000237")).toBeInTheDocument();
    expect(screen.getByText("14 years old")).toBeInTheDocument();
    const facts = screen.getByText("Owner today").closest("div")!;
    expect(within(facts).getByText("Air France HOP")).toBeInTheDocument();

    expect(screen.getByText("Seen Jun 2021 – Aug 2025")).toBeInTheDocument();
    expect(screen.getByText("Operated by Hop!")).toBeInTheDocument();
    expect(screen.getByText("Brit Air")).toBeInTheDocument();
    expect(screen.getByText("Seen in Nov 2020")).toBeInTheDocument();
    // An individual's registration is described without a name.
    expect(screen.getByText("Private owner")).toBeInTheDocument();
    expect(screen.getByText("Wichita, KS · Exported to Canada")).toBeInTheDocument();
    expect(screen.getByText(/3 registrations · 3 owners and operators/)).toBeInTheDocument();
    expect(screen.getByText(/Individuals' names are not shown/)).toBeInTheDocument();
  });

  it("loads recent flights only when asked", async () => {
    const flights = vi.fn(() => ({
      success: true, registration: "FHBXA", provider: "FlightAware AeroAPI", available: true,
      flights: [{ fa_flight_id: "1", ident: "AFR23SR", ident_iata: "AF7745", origin: { code_iata: "CDG" }, destination: { code_iata: "NCE" }, actual_out: "2026-10-08T10:00:00Z", status: "Arrived / Gate Arrival" }],
    }));
    renderHistory({ "/api/aircraft-flights": flights });
    await screen.findByText("F-HBXA", { selector: ".airframe-registration" });
    expect(flights).not.toHaveBeenCalled();
    await userEvent.click(screen.getByRole("button", { name: "Show recent flights of F-HBXA" }));
    expect(await screen.findByText("CDG → NCE")).toBeInTheDocument();
    expect(screen.getByText("AF7745")).toBeInTheDocument();
    expect(screen.getByText("Arrived")).toBeInTheDocument();
  });

  it("explains a paused flights lookup and an unknown airframe", async () => {
    renderHistory({ "/api/aircraft-flights": () => ({ success: true, registration: "FHBXA", provider: "x", available: false, reason: "budget", flights: [] }) });
    await userEvent.click(await screen.findByRole("button", { name: /Show recent flights/ }));
    expect(await screen.findByText(/free FlightAware allowance is used/)).toBeInTheDocument();
  });

  it("says so when no registry lists the transponder code", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => new Response(JSON.stringify({ success: true, icao24: "000001", found: false, registration: null, airframe: {}, history: [], linked_icao24: [], snapshots: null, registry: null, sources: [] }), { headers: { "Content-Type": "application/json" } })));
    render(<QueryClientProvider client={new QueryClient()}><AirframeHistory flight={{ icao24: "000001", callsign: "X" } as Flight} /></QueryClientProvider>);
    expect(await screen.findByText(/No registry record for the transponder code 000001/)).toBeInTheDocument();
  });
});
