import { describe, expect, it } from "vitest";
import { ALTITUDE_UNKNOWN_COLOR, altitudeColor, boundsEqual, extent, formatAltitude, formatSpeed, quantizeBounds } from "./utils";

describe("altitude colour scale", () => {
  it("maps each flight level to a stable colour band", () => {
    expect(altitudeColor(0)).toBe("#38bdf8");
    expect(altitudeColor(3_000)).toBe("#2dd4bf");
    expect(altitudeColor(7_000)).toBe("#a3e635");
    expect(altitudeColor(10_000)).toBe("#fbbf24");
    expect(altitudeColor(12_000)).toBe("#fb7185");
  });

  it("keeps unknown altitude visually distinct", () => {
    expect(altitudeColor(null)).toBe(ALTITUDE_UNKNOWN_COLOR);
    expect(altitudeColor(Number.NaN)).toBe(ALTITUDE_UNKNOWN_COLOR);
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
