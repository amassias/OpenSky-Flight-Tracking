import { afterEach, describe, expect, it, vi } from "vitest";
import { api } from "./api";

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
