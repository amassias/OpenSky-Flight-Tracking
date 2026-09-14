import type { Bounds, LiveAircraft } from "./types";

/**
 * Keep the map responsive while a viewport request is in flight. The cache is
 * intentionally short lived because an ADS-B position can become stale
 * quickly, and it is bounded so repeated pans cannot grow memory without
 * limit.
 */
export const LIVE_AIRCRAFT_CACHE_TTL_MS = 5 * 60 * 1_000;
export const MAX_VIEWPORT_CACHE_ENTRIES = 24;

export interface ViewportCacheEntry {
  states: LiveAircraft[];
  cachedAt: number;
  time: number | null;
  provider?: string;
}

export function viewportCacheKey(bounds: Bounds): string {
  return [bounds.lamin, bounds.lomin, bounds.lamax, bounds.lomax].join(":");
}

export function isAircraftInBounds(aircraft: LiveAircraft, bounds: Bounds): boolean {
  return aircraft.latitude != null
    && aircraft.longitude != null
    && bounds.lamin <= aircraft.latitude
    && aircraft.latitude <= bounds.lamax
    && bounds.lomin <= aircraft.longitude
    && aircraft.longitude <= bounds.lomax;
}

export function pruneExpiredViewportCache(cache: Map<string, ViewportCacheEntry>, staleBefore: number): void {
  for (const [key, entry] of cache) {
    if (entry.cachedAt < staleBefore) cache.delete(key);
  }
}

export function writeViewportCache(cache: Map<string, ViewportCacheEntry>, key: string, entry: ViewportCacheEntry): void {
  cache.set(key, entry);
  while (cache.size > MAX_VIEWPORT_CACHE_ENTRIES) {
    let oldestKey: string | null = null;
    let oldestAt = Number.POSITIVE_INFINITY;
    for (const [candidateKey, candidate] of cache) {
      if (candidate.cachedAt < oldestAt) {
        oldestKey = candidateKey;
        oldestAt = candidate.cachedAt;
      }
    }
    if (oldestKey == null) break;
    cache.delete(oldestKey);
  }
}
