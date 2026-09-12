import type { Bounds, Flight, FlightStatus } from "./types";

export const ALTITUDE_UNKNOWN_COLOR = "#94a3b8";

export const ALTITUDE_COLOR_BANDS = [
  { maxMeters: 1_500, label: "<5k ft", color: "#38bdf8" },
  { maxMeters: 4_500, label: "5–15k ft", color: "#2dd4bf" },
  { maxMeters: 8_000, label: "15–26k ft", color: "#a3e635" },
  { maxMeters: 11_000, label: "26–36k ft", color: "#fbbf24" },
  { maxMeters: Number.POSITIVE_INFINITY, label: "36k+ ft", color: "#fb7185" },
] as const;

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
const integerFormatter = new Intl.NumberFormat("en-US", { maximumFractionDigits: 0 });

export function formatTime(timestamp?: number | null): string {
  if (!timestamp) return "—";
  return utcTimeFormatter.format(new Date(timestamp * 1000));
}

export function formatAltitude(value?: number | null): string {
  if (value == null || !Number.isFinite(value)) return "—";
  return `${integerFormatter.format(Math.round(value * 3.28084))} ft`;
}

export function formatSpeed(value?: number | null): string {
  if (value == null || !Number.isFinite(value)) return "—";
  return `${integerFormatter.format(Math.round(value * 1.94384))} kt`;
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
  if (flight.data_source === "live-nearby") return "Live near airport";
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
