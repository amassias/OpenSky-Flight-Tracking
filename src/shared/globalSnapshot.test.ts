import { afterEach, describe, expect, it, vi } from "vitest";
import { api } from "./api";
import { sampleByDensity } from "./utils";

afterEach(() => vi.unstubAllGlobals());

describe("api.globalSnapshot", () => {
  const fields = ["icao24", "callsign", "latitude", "longitude", "baro_altitude", "geo_altitude", "velocity", "true_track", "vertical_rate", "on_ground", "squawk", "category", "source", "fix_age"];
  const body = (aircraft: unknown[][]) => new Response(JSON.stringify({ success: true, provider: "opensky", time: 1_000, count: aircraft.length, fields, aircraft, refresh_after_seconds: 86 }), { headers: { "Content-Type": "application/json" } });

  it("turns compact rows into live aircraft with their fix time", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => body([
      ["abc123", "AFR1", 48.5, 2.5, 10000, 10100, 230, 90, 0, 0, "7700", 3, "adsb", 12],
      ["def456", "", 10, 20, null, null, null, null, null, 1, null, null, "mlat", null],
    ])));
    const response = await api.globalSnapshot();
    expect(response.refresh_after_seconds).toBe(86);
    expect(response.states).toHaveLength(2);
    expect(response.states[0]).toMatchObject({ icao24: "abc123", callsign: "AFR1", latitude: 48.5, longitude: 2.5, true_track: 90, on_ground: false, squawk: "7700", time_position: 988 });
    // An unknown fix age stays unknown so the aircraft is never projected.
    expect(response.states[1].time_position).toBeNull();
    expect(response.states[1].on_ground).toBe(true);
  });

  it("rejects a body that is not a snapshot", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => new Response(JSON.stringify({ success: true }), { headers: { "Content-Type": "application/json" } })));
    await expect(api.globalSnapshot()).rejects.toThrow();
  });
});

describe("sampleByDensity", () => {
  const make = (n: number) => Array.from({ length: n }, (_, i) => ({ icao24: i.toString(16).padStart(6, "0") }));

  it("keeps everything at or below the limit", () => {
    expect(sampleByDensity(make(3_000), 3_000, () => false)).toHaveLength(3_000);
  });

  it("thins a larger set to about the limit, the same way on every call", () => {
    const all = make(10_000);
    const first = sampleByDensity(all, 3_000, () => false);
    expect(first.length).toBeGreaterThan(2_700);
    expect(first.length).toBeLessThan(3_300);
    expect(sampleByDensity(all, 3_000, () => false).map((a) => a.icao24)).toEqual(first.map((a) => a.icao24));
  });

  it("never drops an aircraft that must stay", () => {
    const sampled = sampleByDensity(make(10_000), 3_000, (a) => a.icao24 === "000007");
    expect(sampled.some((a) => a.icao24 === "000007")).toBe(true);
  });
});
