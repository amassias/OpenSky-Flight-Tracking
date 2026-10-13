import { describe, expect, it } from "vitest";
import { confirmedDiversion, possibleDiversion } from "./flightEvents";
import type { Airport, Flight, TrackResponse } from "./types";

const now = Date.now();
const airports = new Map<string, Airport>([
  ["EGLL", { icao: "EGLL", name: "Heathrow", iata: "LHR", display_name: "Heathrow", country: "GB", region: "England", latitude: 51.47, longitude: -0.45 }],
  ["LPPT", { icao: "LPPT", name: "Lisbon", iata: "LIS", display_name: "Lisbon", country: "PT", region: "Lisbon", latitude: 38.77, longitude: -9.13 }],
]);
const flight: Flight = { icao24: "406a02", callsign: "BAW52T", data_source: "live-nearby", primary_time: 0, on_ground: true, departure_airport: "EGLL", arrival_airport: "LPPT" };
const trace: TrackResponse = { success: true, path_count: 3, track: { path: [
  [now / 1000 - 300, 51.5, -0.4, 2000, 90, false],
  [now / 1000 - 150, 51.47, -0.45, 0, 90, true],
  [now / 1000 - 10, 51.47, -0.45, 0, 90, true],
] } };

describe("diversion evidence", () => {
  it("labels a landing near the origin as possible, not confirmed", () => {
    expect(possibleDiversion(flight, trace, airports)).toMatchObject({ airport: { icao: "EGLL" }, returned: true });
    expect(confirmedDiversion(flight)).toBe(false);
  });
  it("does not infer a diversion from taxiing, a missing destination or an airborne position", () => {
    expect(possibleDiversion(flight, { ...trace, track: { path: trace.track.path!.slice(1) } }, airports)).toBeNull();
    expect(possibleDiversion({ ...flight, on_ground: false }, trace, airports)).toBeNull();
    expect(possibleDiversion({ ...flight, arrival_airport: null }, trace, airports)).toBeNull();
  });
  it("does not call a scheduled or historical flight a new diversion", () => {
    expect(possibleDiversion({ ...flight, data_source: "scheduled" }, trace, airports)).toBeNull();
    expect(possibleDiversion({ ...flight, data_source: "opensky" }, trace, airports)).toBeNull();
  });
  it("matches a provider diversion to the current flight instance", () => {
    const reported: Flight = { ...flight, on_ground: false, flightaware: { provider: "FlightAware", diverted: true, atc_ident: "BAW52T", actual_out: new Date(now - 3600_000).toISOString() } };
    expect(confirmedDiversion(reported, now)).toBe(true);
    expect(confirmedDiversion({ ...reported, flightaware: { ...reported.flightaware!, actual_out: new Date(now - 86400_000 * 2).toISOString() } }, now)).toBe(false);
    expect(confirmedDiversion({ ...reported, flightaware: { ...reported.flightaware!, atc_ident: "BAW999" } }, now)).toBe(false);
    expect(confirmedDiversion({ ...reported, flightaware: { ...reported.flightaware!, actual_in: new Date(now - 1800_000).toISOString() } }, now)).toBe(false);
  });
});
