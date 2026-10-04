import { describe, expect, it } from "vitest";
import { projectPosition } from "./aircraftMotion";

const cruising = { latitude: 49, longitude: 2, velocity: 250, true_track: 90, on_ground: false, time_position: 1_000, last_contact: 1_000 };

describe("projectPosition", () => {
  it("advances an aircraft along its track at its ground speed", () => {
    const [latitude, longitude] = projectPosition(cruising, 1_010)!;
    const eastKm = (longitude - 2) * 111.32 * Math.cos((49 * Math.PI) / 180);
    expect(eastKm).toBeCloseTo(2.5, 1);
    expect(latitude).toBeCloseTo(49, 3);
  });

  it("follows the heading, not just the longitude", () => {
    const [latitude, longitude] = projectPosition({ ...cruising, true_track: 0 }, 1_010)!;
    expect((latitude - 49) * 111.2).toBeCloseTo(2.5, 1);
    expect(longitude).toBeCloseTo(2, 3);
  });

  it("leaves parked aircraft and aircraft without speed or heading where they were reported", () => {
    expect(projectPosition({ ...cruising, on_ground: true }, 1_030)).toEqual([49, 2]);
    expect(projectPosition({ ...cruising, velocity: null }, 1_030)).toEqual([49, 2]);
    expect(projectPosition({ ...cruising, true_track: null }, 1_030)).toEqual([49, 2]);
    expect(projectPosition({ ...cruising, velocity: 2 }, 1_030)).toEqual([49, 2]);
  });

  it("never projects a fix older than the cap, so a stalled feed cannot fling an aircraft away", () => {
    expect(projectPosition(cruising, 1_090)).toEqual(projectPosition(cruising, 5_000));
  });

  it("has nothing to say without a position", () => {
    expect(projectPosition({ ...cruising, latitude: null }, 1_010)).toBeNull();
  });
});
