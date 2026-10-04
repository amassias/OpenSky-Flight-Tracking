import type { Bounds, Flight, FlightStatus, LiveAircraft } from "./types";
import { altitudeText, speedText } from "./units";

export const ALTITUDE_UNKNOWN_COLOR = "#8e8e93";

export const ALTITUDE_COLOR_BANDS = [
  { maxMeters: 1_500, label: "<5k ft", color: "#64d2ff" },
  { maxMeters: 4_500, label: "5–15k ft", color: "#0a84ff" },
  { maxMeters: 8_000, label: "15–26k ft", color: "#5e5ce6" },
  { maxMeters: 11_000, label: "26–36k ft", color: "#bf5af2" },
  { maxMeters: Number.POSITIVE_INFINITY, label: "36k+ ft", color: "#ff375f" },
] as const;

export type AircraftIconKind = "helicopter" | "glider" | "balloon" | "small" | "airliner" | "heavy" | "unknown";

type AircraftIconSource = Pick<Flight, "category" | "aircraft_category" | "aircraft_type" | "aircraft_description">;

/**
 * Resolve a lightweight map silhouette from the ADS-B emitter category and
 * the aircraft profile when it is available. ADS-B categories are numeric in
 * OpenSky and commonly encoded as A1…A7 by public fallback feeds.
 */
export function aircraftIconKind(aircraft: AircraftIconSource): AircraftIconKind {
  const category = aircraft.aircraft_category ?? aircraft.category;
  const categoryText = String(category ?? "").trim().toUpperCase();
  const categoryMatch = categoryText.match(/(?:^|[A-Z])([0-9]{1,2})$/);
  const categoryNumber = categoryMatch ? Number(categoryMatch[1]) : Number(categoryText);

  if (categoryNumber === 7) return "helicopter";
  if (categoryNumber === 8) return "glider";
  if (categoryNumber === 9) return "balloon";
  if ([1, 2, 11, 13, 14].includes(categoryNumber)) return "small";
  if (categoryNumber === 5) return "heavy";
  if ([3, 4, 6].includes(categoryNumber)) return "airliner";

  const profile = `${aircraft.aircraft_type ?? ""} ${aircraft.aircraft_description ?? ""}`.toLowerCase();
  if (/helicopter|rotorcraft|gyrocopter|autogyro/.test(profile)) return "helicopter";
  if (/glider|sailplane/.test(profile)) return "glider";
  if (/balloon|airship|blimp|dirigible/.test(profile)) return "balloon";
  if (/^\s*(a[2345]\d|a380|b3\d|b7\d|e1(7|8|9)|e29|e95|crj|at4|at7|dh8)/.test(profile)) return "airliner";
  if (/airbus|boeing|embraer|bombardier|atr |dash 8/.test(profile)) return "airliner";
  if (/cessna|piper|cirrus|diamond|beech|king air|pilatus|tbm|pc-?12|pc-?24|ultralight|uav|drone/.test(profile)) return "small";
  return "unknown";
}

export function altitudeColor(value?: number | null): string {
  if (value == null || !Number.isFinite(value)) return ALTITUDE_UNKNOWN_COLOR;
  return ALTITUDE_COLOR_BANDS.find((band) => value <= band.maxMeters)?.color ?? ALTITUDE_UNKNOWN_COLOR;
}

export function todayUtc(): string {
  return new Date().toISOString().slice(0, 10);
}

// Intl formatters are expensive to construct, and these helpers run once per
// flight card on every list render, so the instances are shared.
const utcTimeFormatter = new Intl.DateTimeFormat("en-GB", {
  timeZone: "UTC",
  hour: "2-digit",
  minute: "2-digit",
  hour12: false,
});
export function formatTime(timestamp?: number | null): string {
  if (!timestamp) return "—";
  return utcTimeFormatter.format(new Date(timestamp * 1000));
}

export function formatAltitude(value?: number | null): string {
  if (value == null || !Number.isFinite(value)) return "—";
  return altitudeText(value);
}

export function formatSpeed(value?: number | null): string {
  if (value == null || !Number.isFinite(value)) return "—";
  return speedText(value);
}

/**
 * Range of a numeric series without spreading into Math.min/Math.max, which
 * overflows the call stack on the multi-thousand point tracks OpenSky returns.
 */
export function extent(values: readonly number[]): { min: number; max: number } {
  let min = Number.POSITIVE_INFINITY;
  let max = Number.NEGATIVE_INFINITY;
  for (const value of values) {
    if (value < min) min = value;
    if (value > max) max = value;
  }
  return { min, max };
}

export function statusLabel(status?: FlightStatus, onGround?: boolean | null): string {
  if (status === "airborne" || onGround === false) return "Airborne";
  if (status === "on_ground" || onGround === true) return "On ground";
  if (status === "completed") return "Completed";
  return "Unknown";
}

export function flightId(flight: Flight): string {
  return `${flight.icao24}-${flight.primary_time ?? flight.first_seen ?? flight.last_seen ?? 0}`;
}

export function routeLabel(flight: Flight): string {
  if (flight.data_source === "live-nearby") return "Live position";
  return `${flight.departure_airport || "---"} → ${flight.arrival_airport || "---"}`;
}

/**
 * Snaps a viewport to a coarse grid, expanding outward so the result always
 * covers the visible area. Small pans then reuse the same cache key instead of
 * issuing a fresh rate-limited request for a near-identical box.
 */
export function quantizeBounds(bounds: Bounds, step = 0.1): Bounds {
  const floor = (value: number) => Math.floor(value / step) * step;
  const ceil = (value: number) => Math.ceil(value / step) * step;
  const round = (value: number) => Number(value.toFixed(4));
  return {
    lamin: round(Math.max(-90, floor(bounds.lamin))),
    lamax: round(Math.min(90, ceil(bounds.lamax))),
    lomin: round(Math.max(-180, floor(bounds.lomin))),
    lomax: round(Math.min(180, ceil(bounds.lomax))),
  };
}

/**
 * Add a small guard band around the visible map. Aircraft just beyond an edge
 * are therefore already available when the user starts the next pan.
 */
export function expandBounds(bounds: Bounds, ratio = 0.18): Bounds {
  const latPadding = Math.max(0, bounds.lamax - bounds.lamin) * ratio;
  const lonPadding = Math.max(0, bounds.lomax - bounds.lomin) * ratio;
  return {
    lamin: Math.max(-90, bounds.lamin - latPadding),
    lamax: Math.min(90, bounds.lamax + latPadding),
    lomin: Math.max(-180, bounds.lomin - lonPadding),
    lomax: Math.min(180, bounds.lomax + lonPadding),
  };
}

/**
 * Public ADS-B point feeds accept a circle up to 250 NM. Split a broad map
 * into safe cells and order them from the centre out so the first visible
 * aircraft arrive quickly. Extremely broad views are deliberately bounded;
 * the user can keep moving while the next viewport replaces the queue.
 */
export function splitBoundsIntoTiles(bounds: Bounds, maxTiles = 24): Bounds[] {
  const centerLat = (bounds.lamin + bounds.lamax) / 2;
  const latitudeNm = Math.max(1, (bounds.lamax - bounds.lamin) * 60);
  const longitudeNm = Math.max(1, (bounds.lomax - bounds.lomin) * 60 * Math.max(0.15, Math.cos(centerLat * Math.PI / 180)));
  const safeCellNm = 285;
  const rows = Math.max(1, Math.ceil(latitudeNm / safeCellNm));
  const columns = Math.max(1, Math.ceil(longitudeNm / safeCellNm));
  const tiles: Array<Bounds & { priority: number }> = [];

  for (let row = 0; row < rows; row += 1) {
    const lamin = bounds.lamin + row * (bounds.lamax - bounds.lamin) / rows;
    const lamax = bounds.lamin + (row + 1) * (bounds.lamax - bounds.lamin) / rows;
    for (let column = 0; column < columns; column += 1) {
      const lomin = bounds.lomin + column * (bounds.lomax - bounds.lomin) / columns;
      const lomax = bounds.lomin + (column + 1) * (bounds.lomax - bounds.lomin) / columns;
      const rowOffset = row + 0.5 - rows / 2;
      const columnOffset = column + 0.5 - columns / 2;
      tiles.push({ lamin, lamax, lomin, lomax, priority: rowOffset * rowOffset + columnOffset * columnOffset });
    }
  }

  return tiles
    .sort((a, b) => a.priority - b.priority)
    .slice(0, Math.max(1, maxTiles))
    .map(({ lamin, lamax, lomin, lomax }) => quantizeBounds({ lamin, lamax, lomin, lomax }, 0.05));
}

export function viewportTileCount(bounds: Bounds): number {
  const centerLat = (bounds.lamin + bounds.lamax) / 2;
  const latitudeNm = Math.max(1, (bounds.lamax - bounds.lamin) * 60);
  const longitudeNm = Math.max(1, (bounds.lomax - bounds.lomin) * 60 * Math.max(0.15, Math.cos(centerLat * Math.PI / 180)));
  return Math.max(1, Math.ceil(latitudeNm / 285) * Math.ceil(longitudeNm / 285));
}

export function boundsEqual(a: Bounds | null, b: Bounds | null): boolean {
  if (!a || !b) return a === b;
  return a.lamin === b.lamin && a.lamax === b.lamax && a.lomin === b.lomin && a.lomax === b.lomax;
}

export interface EmergencyInfo {
  code: string;
  label: string;
}

const EMERGENCY_SQUAWKS: Record<string, string> = {
  "7500": "Unlawful interference",
  "7600": "Radio failure",
  "7700": "General emergency",
};

const EMERGENCY_STATES: Record<string, string> = {
  general: "General emergency",
  lifeguard: "Medical priority",
  minfuel: "Minimum fuel",
  nordo: "Radio failure",
  unlawful: "Unlawful interference",
  downed: "Aircraft down",
};

/** Emergency declared by squawk (7500/7600/7700) or the ADS-B emergency field. */
export function emergencyInfo(aircraft: { squawk?: string | null; emergency?: string | null }): EmergencyInfo | null {
  const squawk = String(aircraft.squawk ?? "").trim();
  if (EMERGENCY_SQUAWKS[squawk]) return { code: squawk, label: EMERGENCY_SQUAWKS[squawk] };
  const state = String(aircraft.emergency ?? "").trim().toLowerCase();
  if (EMERGENCY_STATES[state]) return { code: state.toUpperCase(), label: EMERGENCY_STATES[state] };
  return null;
}

/** Climb / descent trend from the vertical rate in m/s; ±1 m/s (~200 ft/min) counts as level. */
export function verticalTrend(verticalRate?: number | null): "climbing" | "descending" | "level" | null {
  if (verticalRate == null || !Number.isFinite(verticalRate)) return null;
  if (verticalRate > 1) return "climbing";
  if (verticalRate < -1) return "descending";
  return "level";
}

/** Great-circle distance in kilometres. */
export function distanceKm(a: [number, number], b: [number, number]): number {
  const toRad = (value: number) => (value * Math.PI) / 180;
  const dLat = toRad(b[0] - a[0]);
  const dLon = toRad(b[1] - a[1]);
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(toRad(a[0])) * Math.cos(toRad(b[0])) * Math.sin(dLon / 2) ** 2;
  return 2 * 6371 * Math.asin(Math.min(1, Math.sqrt(h)));
}

const COMPASS = ["N", "NNE", "NE", "ENE", "E", "ESE", "SE", "SSE", "S", "SSW", "SW", "WSW", "W", "WNW", "NW", "NNW"];

/** 16-point compass name for a heading in degrees. */
export function compassPoint(degrees: number): string {
  return COMPASS[Math.round((((degrees % 360) + 360) % 360) / 22.5) % 16];
}

/** "2h 05m" / "42 min" for a duration in seconds; null when it makes no sense. */
export function formatDuration(seconds?: number | null): string | null {
  if (seconds == null || !Number.isFinite(seconds) || seconds < 0) return null;
  const minutes = Math.round(seconds / 60);
  if (minutes < 60) return `${minutes} min`;
  return `${Math.floor(minutes / 60)}h ${String(minutes % 60).padStart(2, "0")}m`;
}

/** A map aircraft as a selectable flight: live rows carry no recorded time, so primary_time is 0. */
export function liveAircraftToFlight(aircraft: LiveAircraft): Flight {
  return {
    ...aircraft,
    status: aircraft.on_ground ? "on_ground" : "airborne",
    primary_time: 0,
    airline_name: aircraft.airline_name || "",
  };
}

export interface RouteProgress {
  percent: number;
  flownKm: number;
  remainingKm: number;
  /** Seconds to go at the current ground speed; null when the aircraft is too slow to estimate. */
  etaSeconds: number | null;
}

/**
 * How far along its route an aircraft is, from where it is rather than from
 * sighting times: distance flown over (flown + still to fly). Measuring both
 * legs from the aircraft keeps the ratio sensible when it is flying a detour
 * or the estimated destination is wrong, and needs no schedule at all.
 */
export function routeProgress(
  origin: { latitude?: number | null; longitude?: number | null } | null | undefined,
  destination: { latitude?: number | null; longitude?: number | null } | null | undefined,
  position: { latitude?: number | null; longitude?: number | null; velocity?: number | null },
): RouteProgress | null {
  const points = [origin, destination, position];
  if (points.some((point) => point?.latitude == null || point?.longitude == null)) return null;
  const flownKm = distanceKm([origin!.latitude!, origin!.longitude!], [position.latitude!, position.longitude!]);
  const remainingKm = distanceKm([position.latitude!, position.longitude!], [destination!.latitude!, destination!.longitude!]);
  const total = flownKm + remainingKm;
  if (total < 1) return null;
  const speed = position.velocity;
  return {
    percent: (flownKm / total) * 100,
    flownKm,
    remainingKm,
    etaSeconds: speed != null && speed > 50 ? (remainingKm * 1000) / speed : null,
  };
}
