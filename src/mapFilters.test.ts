import { describe, expect, it } from "vitest";
import { NO_FILTERS, activeFilterCount, filterAircraft, matchesFilters } from "./mapFilters";
import type { Flight } from "./types";

const flights = [
  { icao24: "a", callsign: "AFR1", airline_name: "Air France", aircraft_type: "A320", baro_altitude: 11_000, on_ground: false },
  { icao24: "b", callsign: "EZY2", airline_name: "easyJet", aircraft_type: "A319", baro_altitude: 1_500, on_ground: false },
  { icao24: "c", callsign: "RYR3", airline_name: "Ryanair", aircraft_type: "B738", baro_altitude: 0, on_ground: true },
  { icao24: "d", callsign: "NOALT", on_ground: false },
] as Flight[];

describe("map filters", () => {
  it("returns the same array when nothing is filtered", () => {
    expect(filterAircraft(flights, NO_FILTERS)).toBe(flights);
    expect(activeFilterCount(NO_FILTERS)).toBe(0);
  });

  it("hides aircraft on the ground", () => {
    expect(filterAircraft(flights, { ...NO_FILTERS, hideGround: true }).map((f) => f.icao24)).toEqual(["a", "b", "d"]);
  });

  it("keeps an altitude window in feet and drops aircraft that report no altitude", () => {
    const high = filterAircraft(flights, { ...NO_FILTERS, minAltitudeFt: 30_000 });
    expect(high.map((f) => f.icao24)).toEqual(["a"]);
    const low = filterAircraft(flights, { ...NO_FILTERS, maxAltitudeFt: 10_000 });
    expect(low.map((f) => f.icao24)).toEqual(["b", "c"]);
  });

  it("matches every word against callsign, airline, registration and type", () => {
    expect(matchesFilters(flights[0], { ...NO_FILTERS, query: "air france a320" })).toBe(true);
    expect(matchesFilters(flights[0], { ...NO_FILTERS, query: "air france a319" })).toBe(false);
    expect(matchesFilters(flights[1], { ...NO_FILTERS, query: "easy" })).toBe(true);
  });

  it("never hides an aircraft that has declared an emergency", () => {
    const sos = { icao24: "e", callsign: "SOS1", squawk: "7700", on_ground: true } as Flight;
    expect(matchesFilters(sos, { ...NO_FILTERS, hideGround: true, minAltitudeFt: 30_000, query: "nothing" })).toBe(true);
  });

  it("counts each active control once", () => {
    expect(activeFilterCount({ hideGround: true, minAltitudeFt: 5_000, maxAltitudeFt: 20_000, query: " x " })).toBe(3);
  });
});
