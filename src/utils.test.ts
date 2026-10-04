import { describe, expect, it } from "vitest";
import { ALTITUDE_UNKNOWN_COLOR, aircraftIconKind, altitudeColor, boundsEqual, distanceKm, emergencyInfo, expandBounds, extent, formatAltitude, formatSpeed, quantizeBounds, splitBoundsIntoTiles, verticalTrend, viewportTileCount } from "./utils";

describe("altitude colour scale", () => {
  it("maps each flight level to a stable colour band", () => {
    expect(altitudeColor(0)).toBe("#64d2ff");
    expect(altitudeColor(3_000)).toBe("#0a84ff");
    expect(altitudeColor(7_000)).toBe("#5e5ce6");
    expect(altitudeColor(10_000)).toBe("#bf5af2");
    expect(altitudeColor(12_000)).toBe("#ff375f");
  });

  it("keeps unknown altitude visually distinct", () => {
    expect(altitudeColor(null)).toBe(ALTITUDE_UNKNOWN_COLOR);
    expect(altitudeColor(Number.NaN)).toBe(ALTITUDE_UNKNOWN_COLOR);
  });
});

describe("aircraft map silhouettes", () => {
  it("uses ADS-B emitter categories when available", () => {
    expect(aircraftIconKind({ category: 7 })).toBe("helicopter");
    expect(aircraftIconKind({ aircraft_category: "A5" })).toBe("heavy");
    expect(aircraftIconKind({ category: 8 })).toBe("glider");
  });

  it("falls back to a known type code or description", () => {
    expect(aircraftIconKind({ aircraft_type: "B738" })).toBe("airliner");
    expect(aircraftIconKind({ aircraft_description: "Cessna 172 Skyhawk" })).toBe("small");
    expect(aircraftIconKind({ aircraft_description: "Airbus H125 helicopter" })).toBe("helicopter");
  });
});

describe("extent", () => {
  it("reports the range of a series", () => {
    expect(extent([3, -1, 7, 0])).toEqual({ min: -1, max: 7 });
  });

  it("handles series far larger than the argument limit of Math.min", () => {
    const values = Array.from({ length: 200_000 }, (_, index) => index);
    expect(() => extent(values)).not.toThrow();
    expect(extent(values)).toEqual({ min: 0, max: 199_999 });
  });
});

describe("unit formatting", () => {
  it("converts metric readings to aviation units", () => {
    expect(formatAltitude(1_000)).toBe("3,281 ft");
    expect(formatSpeed(100)).toBe("194 kt");
  });

  it("renders missing and non-finite readings as a dash", () => {
    expect(formatAltitude(null)).toBe("—");
    expect(formatSpeed(Number.NaN)).toBe("—");
  });
});

describe("quantizeBounds", () => {
  it("expands the viewport outward onto the grid", () => {
    const result = quantizeBounds({ lamin: 48.53, lamax: 49.02, lomin: 2.21, lomax: 2.64 });
    expect(result).toEqual({ lamin: 48.5, lamax: 49.1, lomin: 2.2, lomax: 2.7 });
  });

  it("keeps nearby viewports on the same key so the cache is reused", () => {
    const a = quantizeBounds({ lamin: 48.53, lamax: 49.02, lomin: 2.21, lomax: 2.64 });
    const b = quantizeBounds({ lamin: 48.55, lamax: 49.04, lomin: 2.23, lomax: 2.66 });
    expect(boundsEqual(a, b)).toBe(true);
  });

  it("clamps to valid geographic limits", () => {
    const result = quantizeBounds({ lamin: -95, lamax: 95, lomin: -185, lomax: 185 });
    expect(result).toEqual({ lamin: -90, lamax: 90, lomin: -180, lomax: 180 });
  });
});

describe("progressive live viewport", () => {
  it("prefetches a guard band around the visible bounds", () => {
    expect(expandBounds({ lamin: 48, lamax: 50, lomin: 1, lomax: 3 }, 0.25)).toEqual({
      lamin: 47.5, lamax: 50.5, lomin: 0.5, lomax: 3.5,
    });
  });

  it("splits a wide viewport into centre-first provider-safe cells", () => {
    const tiles = splitBoundsIntoTiles({ lamin: 40, lamax: 55, lomin: -5, lomax: 10 });
    expect(tiles.length).toBeGreaterThan(1);
    expect(tiles.length).toBeLessThanOrEqual(24);
    expect(tiles[0].lamin).toBeLessThan(48);
    expect(tiles[0].lamax).toBeGreaterThan(47);
    expect(tiles.every((tile) => tile.lamax - tile.lamin <= 5.1)).toBe(true);
    expect(viewportTileCount({ lamin: 40, lamax: 55, lomin: -5, lomax: 10 })).toBe(tiles.length);
  });
});

describe("live flight helpers", () => {
  it("recognises emergency squawks and ADS-B emergency states", () => {
    expect(emergencyInfo({ squawk: "7700" })).toEqual({ code: "7700", label: "General emergency" });
    expect(emergencyInfo({ squawk: "7600" })?.label).toBe("Radio failure");
    expect(emergencyInfo({ squawk: "1000", emergency: "minfuel" })).toEqual({ code: "MINFUEL", label: "Minimum fuel" });
    expect(emergencyInfo({ squawk: "7000", emergency: "none" })).toBeNull();
    expect(emergencyInfo({})).toBeNull();
  });

  it("classifies the vertical trend with a level band", () => {
    expect(verticalTrend(6)).toBe("climbing");
    expect(verticalTrend(-4)).toBe("descending");
    expect(verticalTrend(0.4)).toBe("level");
    expect(verticalTrend(null)).toBeNull();
  });

  it("measures great-circle distance", () => {
    expect(distanceKm([49.0097, 2.5479], [51.47, -0.4543])).toBeCloseTo(348, -1);
  });
});

describe("compassPoint and formatDuration", () => {
  it("names 16 compass points around the circle", async () => {
    const { compassPoint } = await import("./utils");
    expect(compassPoint(0)).toBe("N");
    expect(compassPoint(22)).toBe("NNE");
    expect(compassPoint(90)).toBe("E");
    expect(compassPoint(359)).toBe("N");
    expect(compassPoint(-90)).toBe("W");
  });

  it("writes durations the way a board would", async () => {
    const { formatDuration } = await import("./utils");
    expect(formatDuration(42 * 60)).toBe("42 min");
    expect(formatDuration(2 * 3600 + 5 * 60)).toBe("2h 05m");
    expect(formatDuration(-5)).toBeNull();
    expect(formatDuration(null)).toBeNull();
  });
});
