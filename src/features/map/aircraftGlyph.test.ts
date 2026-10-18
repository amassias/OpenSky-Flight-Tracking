import { describe, expect, it } from "vitest";
import { aircraftGlyph } from "./aircraftGlyph";
import { AircraftFrames } from "./aircraftLayer";
import type { LiveAircraft } from "../../shared/types";

describe("unidentified aircraft silhouettes", () => {
  it("uses the standard plane geometry without claiming a known aircraft type", () => {
    const unknown = aircraftGlyph("unknown");
    expect(unknown.kind).toBe("unknown");
    expect(unknown.model).toBeNull();
    expect(unknown.glyph).toBe(aircraftGlyph("airliner").glyph);
  });

  it("keeps the standard plane in the dense renderer when the wide feed lacks type metadata", () => {
    const frames = new AircraftFrames();
    frames.setAircraft([{ icao24: "aa0001", latitude: 48, longitude: 2, true_track: 90,
      time_position: 1000, last_contact: 1000, on_ground: false } as LiveAircraft]);
    const [plane] = frames.frame(1000, { theme: "light", previewId: null, excludeId: null });
    expect(plane.glyph).toBe(aircraftGlyph("airliner").glyph);
    expect(plane.shape).toBe("unknown");
  });
});
