import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import { FlightDetails } from "./FlightDetails";
import type { Flight, TrackResponse } from "../../../shared/types";

const flight = {
  icao24: "39abcd", callsign: "AFR123", airline_name: "Air France", registration: "F-HBXA", registration_source: "adsb",
  status: "airborne", on_ground: false, primary_time: 0, data_source: "live-nearby",
} as Flight;

function renderDetails(overrides: Partial<Flight> = {}, observer: [number, number] | null = null, track?: TrackResponse) {
  vi.stubGlobal("fetch", vi.fn(() => Promise.resolve(new Response(JSON.stringify({ success: false }), { status: 404 }))));
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  render(
    <QueryClientProvider client={client}>
      <FlightDetails flight={{ ...flight, ...overrides }} track={track} trackLoading={false} onRetryTrack={vi.fn()} onClose={vi.fn()} onShare={vi.fn()} observer={observer} />
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

  it("credits the actual trace provider beside the altitude graph", () => {
    const now = Math.floor(Date.now() / 1000);
    renderDetails({}, null, { success: true, path_count: 2, track: {
      icao24: "39abcd", callsign: "AFR123", source: "theairtraffic.com",
      path: [[now - 60, 49, 2, 1000, 90, false], [now, 49.1, 2.1, 2000, 90, false]],
    } });
    expect(screen.getByRole("link", { name: "TheAirTraffic" })).toHaveAttribute("href", "https://theairtraffic.com/");
    expect(screen.queryByText(/Latest recorded point/)).not.toBeInTheDocument();
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

  it("ignores an arrived FlightAware record while the aircraft is flying", () => {
    renderDetails({ on_ground: false, flightaware: { provider: "FlightAware", status: "Arrived / Gate Arrival", progress_percent: 100, actual_in: "2026-10-11T09:11:00Z" } as Flight["flightaware"] });
    expect(screen.queryByText("100% flown")).not.toBeInTheDocument();
    expect(screen.queryByText(/Arrived/)).not.toBeInTheDocument();
  });
  it("does not infer distance or arrival time from a usual callsign route", () => {
    renderDetails({ route_source: "callsign", latitude: 49, longitude: 2.5,
      departure_airport: "LFPG", arrival_airport: "EGLL", velocity: 220,
      flightaware: { provider: "FlightAware", progress_percent: 50, ident: "AFR123", actual_out: new Date(Date.now()-3600_000).toISOString(),
        origin: { latitude: 49, longitude: 2.5 }, destination: { latitude: 51.47, longitude: -0.45 } },
    });
    expect(screen.getByText("Usual route · unconfirmed")).toBeInTheDocument();
    expect(screen.getByText("50% reported progress")).toBeInTheDocument();
    expect(screen.queryByText(/NM flown|to go$/)).not.toBeInTheDocument();
  });

});

describe("route availability", () => {
  it("hides the optional altitude profile when no recorded altitude exists", () => {
    renderDetails({ data_source: "scheduled" });
    expect(screen.queryByText("Altitude profile")).not.toBeInTheDocument();
  });
  it("hides unknown progression rather than displaying an empty bar", () => {
    renderDetails();
    expect(screen.queryByText("Progress unavailable")).toBeNull();
    expect(document.querySelector('.route-progress')).toBeNull();
  });
  it("uses route coordinates immediately and labels callsign progress as estimated", () => {
    renderDetails({ route_source: "callsign", departure_airport: "LFPG", arrival_airport: "EGLL",
      departure_latitude: 49, departure_longitude: 2.5, arrival_latitude: 51.47, arrival_longitude: -0.45,
      latitude: 50, longitude: 1, velocity: 200 });
    expect(screen.getByText("Usual route · unconfirmed")).toBeInTheDocument();
    expect(screen.getByRole('img', { name: /Flight progress/ })).toBeInTheDocument();
    expect(screen.queryByText(/to go/)).toBeNull();
  });
});
