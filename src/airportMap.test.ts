import { describe, expect, it } from "vitest";
import { groupAirports, nearestAirports } from "./airportMap";
import type { Airport } from "./types";

const airport = (icao: string, latitude: number | null, longitude: number | null): Airport => ({ icao, iata: icao, name: icao, display_name: icao, country: "", region: "", latitude, longitude });
describe("airport exploration", () => {
  it("preserves every geolocated airport while grouping only the same screen cells", () => {
    const airports = [airport("A", 0, 0), airport("B", 0, 0.1), airport("C", 0, 2), airport("D", null, null)];
    const groups = groupAirports(airports, (item) => ({ x: item.longitude! * 100, y: 0 }));
    expect(groups.map((group) => group.map((item) => item.icao))).toEqual([["A", "B"], ["C"]]);
  });
  it("sorts nearest airports by great-circle distance across the date line", () => {
    const airports = [airport("FAR", 0, 170), airport("NEAR", 0, -179.9), airport("MISSING", null, null)];
    const closest = nearestAirports(airports, [0, 179.9], 1);
    expect(closest[0].airport.icao).toBe("NEAR");
    expect(closest[0].distance).toBeCloseTo(22.24, 1);
  });
});
