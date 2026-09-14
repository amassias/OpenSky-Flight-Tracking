import { describe, expect, it } from "vitest";
import type { LiveAircraft } from "./types";
import { isAircraftInBounds, LIVE_AIRCRAFT_CACHE_TTL_MS, MAX_VIEWPORT_CACHE_ENTRIES, pruneExpiredViewportCache, viewportCacheKey, writeViewportCache, type ViewportCacheEntry } from "./liveCache";

const bounds = { lamin: 48, lamax: 50, lomin: 1, lomax: 4 };
const aircraft = (icao24: string, latitude = 49, longitude = 2): LiveAircraft => ({
  icao24,
  callsign: icao24.toUpperCase(),
  latitude,
  longitude,
});

function entry(icao24: string, cachedAt: number): ViewportCacheEntry {
  return { states: [aircraft(icao24)], cachedAt, time: cachedAt };
}

describe("live viewport cache", () => {
  it("uses a stable key for a quantized viewport", () => {
    expect(viewportCacheKey(bounds)).toBe("48:1:50:4");
    expect(viewportCacheKey({ ...bounds })).toBe(viewportCacheKey(bounds));
  });

  it("restores only aircraft that still fall inside the viewport", () => {
    expect(isAircraftInBounds(aircraft("inside"), bounds)).toBe(true);
    expect(isAircraftInBounds(aircraft("outside", 52), bounds)).toBe(false);
    expect(isAircraftInBounds(aircraft("unknown", 49, Number.NaN), bounds)).toBe(false);
  });

  it("expires old snapshots without extending failed refreshes", () => {
    const now = LIVE_AIRCRAFT_CACHE_TTL_MS + 10_000;
    const cache = new Map<string, ViewportCacheEntry>([
      ["old", entry("old", 10)],
      ["fresh", entry("fresh", now)],
    ]);
    pruneExpiredViewportCache(cache, now - LIVE_AIRCRAFT_CACHE_TTL_MS);
    expect(cache.has("old")).toBe(false);
    expect(cache.has("fresh")).toBe(true);
  });

  it("keeps the most recently written viewport entries bounded", () => {
    const cache = new Map<string, ViewportCacheEntry>();
    for (let index = 0; index <= MAX_VIEWPORT_CACHE_ENTRIES; index += 1) {
      writeViewportCache(cache, `viewport-${index}`, entry(String(index), index));
    }
    expect(cache.size).toBe(MAX_VIEWPORT_CACHE_ENTRIES);
    expect(cache.has("viewport-0")).toBe(false);
    expect(cache.has(`viewport-${MAX_VIEWPORT_CACHE_ENTRIES}`)).toBe(true);
  });
});
