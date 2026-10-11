import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import { FlightDetails } from "./FlightDetails";
import type { Flight } from "../types";

const flight = {
  icao24: "39abcd", callsign: "AFR123", airline_name: "Air France", registration: "F-HBXA", registration_source: "adsb",
  status: "airborne", on_ground: false, primary_time: 0, data_source: "live-nearby",
} as Flight;

function renderDetails(overrides: Partial<Flight> = {}, observer: [number, number] | null = null) {
  vi.stubGlobal("fetch", vi.fn(() => Promise.resolve(new Response(JSON.stringify({ success: false }), { status: 404 }))));
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  render(
    <QueryClientProvider client={client}>
      <FlightDetails flight={{ ...flight, ...overrides }} trackLoading={false} onRetryTrack={vi.fn()} onClose={vi.fn()} onShare={vi.fn()} observer={observer} />
    </QueryClientProvider>,
  );
}

describe("FlightDetails", () => {
  it("links the aircraft to other trackers by hex, callsign and registration", () => {
    renderDetails();
    const links = screen.getByRole("navigation", { name: /other trackers/ });
    expect(links.querySelector('a[href="https://globe.adsbexchange.com/?icao=39abcd"]')).not.toBeNull();
    expect(links.querySelector('a[href="https://www.flightaware.com/live/flight/AFR123"]')).not.toBeNull();
    expect(links.querySelector('a[href="https://www.flightradar24.com/data/aircraft/f-hbxa"]')).not.toBeNull();
  });

  it("does not send a scheduled tail to a registration lookup", () => {
    renderDetails({ registration_source: "schedule" });
    expect(screen.queryByRole("link", { name: "Flightradar24" })).not.toBeInTheDocument();
  });

  it("copies the ICAO24 hex code", async () => {
    const user = userEvent.setup();
    const writeText = vi.spyOn(navigator.clipboard, "writeText").mockResolvedValue();
    renderDetails();
    await user.click(screen.getByRole("button", { name: "Copy ICAO24 39ABCD" }));
    expect(writeText).toHaveBeenCalledWith("39ABCD");
    expect(await screen.findByText("Copied")).toBeInTheDocument();
  });

  it("says how far and which way the aircraft is from the visitor", () => {
    renderDetails({ latitude: 49, longitude: 2.5 }, [48, 2.5]);
    expect(screen.getByText(/N of you$/)).toBeInTheDocument();
  });
});
