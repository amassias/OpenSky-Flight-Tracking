import { describe, expect, it } from "vitest";
import { ALTITUDE_UNKNOWN_COLOR, altitudeColor } from "./utils";

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
