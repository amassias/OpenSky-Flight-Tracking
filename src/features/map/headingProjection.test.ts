import { describe, expect, it } from "vitest";
import { headingProjection } from "./headingProjection";
import type { Flight } from "../../shared/types";
const aircraft: Flight = { icao24: "abc123", callsign: "AFR123", latitude: 49, longitude: 2, velocity: 200, true_track: 90, on_ground: false, time_position: 1000 };
describe("heading projection", () => {
  it("projects in the reported direction", () => {
    const result = headingProjection(aircraft, 1010)!;
    expect(result[1][1]).toBeGreaterThan(2);
    expect(result[1][0]).toBeCloseTo(49, 2);
  });
  it("hides unreliable and historical projections", () => {
    for (const values of [{ on_ground: true }, { true_track: null }, { true_track: NaN }, { time_position: 900 }, { velocity: 0 }, { data_source: "opensky" as const }, { time_position: 1200 }]) {
      expect(headingProjection({ ...aircraft, ...values }, 1010)).toBeNull();
    }
  });
  it("does not draw across the globe when crossing the antimeridian", () => {
    const result = headingProjection({ ...aircraft, longitude: 179.99 }, 1010)!;
    expect(result[1][1] - result[0][1]).toBeLessThan(1);
  });
});
