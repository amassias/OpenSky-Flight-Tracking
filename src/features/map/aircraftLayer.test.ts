import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { LiveAircraft, MapTheme } from "../../shared/types";
import type { AircraftFrameOptions } from "./aircraftLayer";
import { AircraftFrames, updateIntervalMs } from "./aircraftLayer";
import { resetMapColors } from "./mapColors";

const THEME_CSS = `
  :root { --aircraft: #f5f5f7; --aircraft-ground: #8e8e93; --accent: #2997ff; --halo: #0b0b0c; --danger: #ff453a; }
  .theme-light { --aircraft: #1d1d1f; --aircraft-ground: #86868b; --accent: #0066cc; --halo: #ffffff; --danger: #d70015; }
`;
let themeStyle: HTMLStyleElement;
beforeAll(() => {
  resetMapColors();
  themeStyle = document.createElement("style");
  themeStyle.textContent = THEME_CSS;
  document.head.append(themeStyle);
});
afterAll(() => { themeStyle.remove(); resetMapColors(); });

const NOW = 10_000;
const plane = (over: Partial<LiveAircraft> = {}): LiveAircraft => ({
  icao24: "aa0001", callsign: "TEST1", latitude: 49, longitude: 2, velocity: 250, true_track: 90,
  on_ground: false, time_position: NOW, last_contact: NOW, baro_altitude: 10_000, ...over,
} as LiveAircraft);
const options: AircraftFrameOptions = { theme: "dark" as MapTheme, previewId: null, excludeId: null };

function draw(aircraft: LiveAircraft[], now = NOW, extra: Partial<AircraftFrameOptions> = {}) {
  const frames = new AircraftFrames();
  frames.setAircraft(aircraft);
  return frames.frame(now, { ...options, ...extra });
}

describe("AircraftFrames", () => {
  it("draws a fresh reported fix solid, where it was reported, pointing along its track", () => {
    const [drawn] = draw([plane()]);
    expect([drawn.lat, drawn.lng]).toEqual([49, 2]);
    expect(drawn.hollow).toBe(false);
    expect(drawn.rotation).toBe(0); // nose-east glyph, track 90
  });

  it("outlines a projected position and moves it along its track", () => {
    const [drawn] = draw([plane({ time_position: NOW - 30 })]);
    expect(drawn.lng).toBeGreaterThan(2);
    expect(drawn.hollow).toBe(true);
  });

  it("outlines and fades a fix of unknown age without moving it", () => {
    const [drawn] = draw([plane({ time_position: null })]);
    expect([drawn.lat, drawn.lng]).toEqual([49, 2]);
    expect(drawn.hollow).toBe(true);
    expect(drawn.opacity).toBeLessThan(1);
  });

  it("stops moving an aircraft 150 s after its fix", () => {
    const [at150] = draw([plane({ time_position: NOW - 150 })]);
    const [at500] = draw([plane({ time_position: NOW - 500 })]);
    expect(at500.lng).toBe(at150.lng);
  });

  it("colours emergencies, parked aircraft and the previewed aircraft by state, and leaves the selected one to the detailed marker", () => {
    const drawn = draw([
      plane({ icao24: "aa0001" }),
      plane({ icao24: "aa0002", squawk: "7700" }),
      plane({ icao24: "aa0003", on_ground: true }),
      plane({ icao24: "aa0004" }),
      plane({ icao24: "aa0005" }),
    ], NOW, { previewId: "aa0004", excludeId: "aa0005" });
    const color = (id: string) => drawn.find(item => item.id === id)?.color;
    expect(color("aa0001")).toBe("#f5f5f7");
    expect(color("aa0002")).toBe("#ff453a");
    expect(color("aa0003")).toBe("#8e8e93");
    expect(color("aa0004")).toBe("#2997ff");
    expect(color("aa0005")).toBeUndefined();
  });

  it("keeps a distinct silhouette per aircraft model", () => {
    const shapes = draw([
      plane({ icao24: "aa0001", aircraft_type: "A320" }),
      plane({ icao24: "aa0002", aircraft_type: "B738" }),
      plane({ icao24: "aa0003", aircraft_type: "A388" }),
      plane({ icao24: "aa0004", aircraft_type: "EC35" }),
    ]).map(item => item.shape);
    expect(new Set(shapes).size).toBe(4);
  });

  it("follows the theme", () => {
    expect(draw([plane()], NOW, { theme: "light" })[0].color).toBe("#1d1d1f");
  });

  it("skips aircraft without a position", () => {
    expect(draw([plane({ latitude: null })])).toEqual([]);
  });

  it("eases to a new fix instead of jumping", () => {
    const frames = new AircraftFrames();
    frames.setAircraft([plane()]);
    frames.frame(NOW, options);
    frames.setAircraft([plane({ longitude: 2.1, time_position: NOW + 1, last_contact: NOW + 1 })]);
    const early = frames.frame(NOW + 1.05, options)[0];
    const later = frames.frame(NOW + 3, options)[0];
    expect(early.lng).toBeLessThan(2.02);
    expect(later.lng).toBeGreaterThan(2.1);
  });
});

describe("updateIntervalMs", () => {
  it("updates at 10 Hz when zoomed in, where a jet crosses several pixels a second", () => {
    expect(updateIntervalMs(12, 48)).toBe(100);
  });

  it("waits longer as the view widens, because motion drops below a pixel", () => {
    expect(updateIntervalMs(9, 48)).toBeGreaterThan(300);
    expect(updateIntervalMs(9, 48)).toBeLessThan(updateIntervalMs(7, 48));
  });

  it("never waits more than 2 s, so a new fix still shows promptly on a world view", () => {
    expect(updateIntervalMs(2, 0)).toBe(2000);
  });
});
