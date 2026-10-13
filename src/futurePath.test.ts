import { describe, expect, it } from "vitest";
import { destinationGuide } from "./futurePath";
import type { Flight } from "./types";

const flight: Flight = { icao24: "abc123", callsign: "UAL1671", latitude: 39.86, longitude: -104.67, arrival_latitude: 33.64, arrival_longitude: -84.43, velocity: 220, true_track: 125, on_ground: false, time_position: 1000 };

describe("destination guide", () => {
  it("draws a direct dashed-guide geometry to a known destination", () => {
    const points = destinationGuide(flight, 1010)!;
    expect(points.length).toBeGreaterThan(2);
    expect(points[0][0]).toBeCloseTo(39.86);
    expect(points[0][1]).toBeCloseTo(-104.67);
    expect(points.at(-1)![0]).toBeCloseTo(33.64);
    expect(points.at(-1)![1]).toBeCloseTo(-84.43);
  });
  it("requires a recent airborne position, reliable heading, and valid destination", () => {
    for (const change of [{ time_position: 900 }, { on_ground: true }, { true_track: null }, { arrival_latitude: null }, { arrival_longitude: 200 }]) {
      expect(destinationGuide({ ...flight, ...change }, 1010)).toBeNull();
    }
  });
  it("keeps longitude continuous across the antimeridian", () => {
    const points = destinationGuide({ ...flight, latitude: 0, longitude: 179, arrival_latitude: 0, arrival_longitude: -179 }, 1010)!;
    expect(points.at(-1)![1]).toBeCloseTo(181);
  });
});
