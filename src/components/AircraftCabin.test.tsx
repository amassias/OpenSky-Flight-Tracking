import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { act, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import { api } from "../api";
import type { AircraftEnrichment, Flight } from "../types";
import { AircraftCabin } from "./AircraftCabin";

const flight = { icao24: "abc123", callsign: "AFR123", aircraft_type: "A359" } as Flight;
const data: AircraftEnrichment = { success: true, operator_code: "AFR", aircraft_type: "A359", match_level: "operator_type", configurations: [{ id: "af-test", aircraft_type: "A359", total_seats: 6, classes: [{ name: "Business", seats: 2 }, { name: "Economy", seats: 4 }], source: { name: "Air France", url: "https://example.com/source", checked_at: "2026-10-14" }, seat_map_url: "https://example.com/map" }] };
function setup() {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false, gcTime: 0 } } });
  const view = (selected: Flight) => <QueryClientProvider client={client}><AircraftCabin flight={selected} /></QueryClientProvider>;
  return { ...render(view(flight)), view };
}

describe("published cabin states", () => {
  it("shows a loading state, then an honest empty result", async () => {
    let resolve!: (value: AircraftEnrichment) => void;
    vi.spyOn(api, "aircraftEnrichment").mockImplementation(() => new Promise(done => { resolve = done; }));
    setup();
    expect(screen.getByRole("status")).toHaveTextContent("Loading published");
    await act(async () => resolve({ ...data, configurations: [] }));
    expect(await screen.findByText(/No published configuration/)).toBeVisible();
    expect(screen.queryByRole("button", { name: "Retry cabin" })).not.toBeInTheDocument();
  });

  it("recovers from an error through retry and keeps counts visible with the inventory folded", async () => {
    const fetch = vi.spyOn(api, "aircraftEnrichment").mockRejectedValueOnce(new Error("offline")).mockResolvedValue(data);
    setup();
    const user = userEvent.setup();
    await user.click(await screen.findByRole("button", { name: "Retry cabin" }));
    expect(await screen.findByRole("heading", { name: "Business" })).toBeVisible();
    const disclosure = screen.getByText("Show seat inventory").closest("details")!;
    expect(disclosure.open).toBe(false);
    await user.click(screen.getByText("Show seat inventory"));
    expect(disclosure.open).toBe(true);
    expect(disclosure.querySelectorAll(".cabin-seat")).toHaveLength(6);
    expect(screen.getByRole("link", { name: /View published seat map/ })).toHaveAttribute("href", "https://example.com/map");
    expect(fetch).toHaveBeenCalledTimes(2);
  });

  it("does not accept a late response from the previously selected aircraft", async () => {
    let resolve!: (value: AircraftEnrichment) => void;
    vi.spyOn(api, "aircraftEnrichment").mockImplementation(operator => operator === "AFR" ? new Promise(done => { resolve = done; }) : Promise.resolve({ ...data, operator_code: "EZY", aircraft_type: "A320", configurations: [] }));
    const { rerender, view } = setup();
    rerender(view({ ...flight, icao24: "abc124", callsign: "EZY456", aircraft_type: "A320" }));
    await screen.findByText(/No published configuration/);
    await act(async () => resolve(data));
    expect(screen.queryByRole("heading", { name: "Business" })).not.toBeInTheDocument();
  });

  it("resets inventory disclosure when another airframe uses the same cached layout", async () => {
    vi.spyOn(api, "aircraftEnrichment").mockResolvedValue(data);
    const { rerender, view } = setup();
    await screen.findByRole("heading", { name: "Business" });
    await userEvent.click(screen.getByText("Show seat inventory"));
    rerender(view({ ...flight, registration_source: "adsb" }));
    expect(screen.getByText("Show seat inventory").closest("details")!.open).toBe(true);
    rerender(view({ ...flight, icao24: "abc124" }));
    await screen.findByRole("heading", { name: "Business" });
    expect(screen.getByText("Show seat inventory").closest("details")!.open).toBe(false);
  });
});
