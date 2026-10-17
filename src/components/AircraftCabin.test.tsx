import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { act, render, screen, waitFor } from "@testing-library/react";
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
  it("shows nothing while loading and nothing when no configuration is published", async () => {
    let resolve!: (value: AircraftEnrichment) => void;
    vi.spyOn(api, "aircraftEnrichment").mockImplementation(() => new Promise(done => { resolve = done; }));
    setup();
    expect(screen.queryByRole("region", { name: "Cabin configurations" })).not.toBeInTheDocument();
    await act(async () => resolve({ ...data, configurations: [] }));
    await waitFor(() => expect(api.aircraftEnrichment).toHaveBeenCalled());
    expect(screen.queryByRole("region", { name: "Cabin configurations" })).not.toBeInTheDocument();
    expect(screen.queryByText(/No published configuration/)).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Retry cabin" })).not.toBeInTheDocument();
  });

  it("hides failed optional enrichment", async () => {
    vi.spyOn(api, "aircraftEnrichment").mockRejectedValue(new Error("offline"));
    setup();
    await waitFor(() => expect(api.aircraftEnrichment).toHaveBeenCalled());
    expect(screen.queryByRole("region", { name: "Cabin configurations" })).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Retry cabin" })).not.toBeInTheDocument();
  });

  it("keeps sourced capacities and the optional inventory without explanatory paragraphs", async () => {
    vi.spyOn(api, "aircraftEnrichment").mockResolvedValue(data);
    setup();
    const user = userEvent.setup();
    expect(await screen.findByRole("heading", { name: "Business" })).toBeVisible();
    expect(screen.getByText("Typical layout")).toBeVisible();
    expect(screen.queryByText(/This aircraft’s layout is not confirmed/)).not.toBeInTheDocument();
    const disclosure = screen.getByText("Show seat inventory").closest("details")!;
    expect(disclosure.open).toBe(false);
    await user.click(screen.getByText("Show seat inventory"));
    expect(disclosure.querySelectorAll(".cabin-seat")).toHaveLength(6);
    expect(screen.getByRole("link", { name: /Seat map/ })).toHaveAttribute("href", "https://example.com/map");
  });

  it("does not accept a late response from the previously selected aircraft", async () => {
    let resolve!: (value: AircraftEnrichment) => void;
    vi.spyOn(api, "aircraftEnrichment").mockImplementation(operator => operator === "AFR" ? new Promise(done => { resolve = done; }) : Promise.resolve({ ...data, operator_code: "EZY", aircraft_type: "A320", configurations: [] }));
    const { rerender, view } = setup();
    rerender(view({ ...flight, icao24: "abc124", callsign: "EZY456", aircraft_type: "A320" }));
    await waitFor(() => expect(vi.mocked(api.aircraftEnrichment).mock.calls.some(call => call[0] === "EZY")).toBe(true));
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
