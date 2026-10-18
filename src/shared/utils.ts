import { longitudeRange } from "./geoBounds";
import { aircraftModel } from "./aircraftIdentity";
import { AIRLINE_ICAO_BY_IATA } from "./airlineCodes";
import type { Bounds, Flight, FlightStatus, LiveAircraft, MapView, TrackPoint, TrackResponse } from "./types";
import { altitudeText, speedText } from "./units";

export const ALTITUDE_UNKNOWN_COLOR = "#8e8e93";

export const ALTITUDE_COLOR_BANDS = [
  { maxMeters: 1_500, label: "<5k ft", color: "#64d2ff" },
  { maxMeters: 4_500, label: "5–15k ft", color: "#0a84ff" },
  { maxMeters: 8_000, label: "15–26k ft", color: "#5e5ce6" },
  { maxMeters: 11_000, label: "26–36k ft", color: "#bf5af2" },
  { maxMeters: Number.POSITIVE_INFINITY, label: "36k+ ft", color: "#ff375f" },
] as const;

export type AircraftIconKind = "helicopter" | "glider" | "balloon" | "small" | "turboprop" | "regional" | "airliner" | "heavy" | "unknown";

type AircraftIconSource = Pick<Flight, "category" | "aircraft_category" | "aircraft_type" | "aircraft_description">;

/**
 * Resolve a lightweight map silhouette from the ADS-B emitter category and
 * the aircraft profile when it is available. ADS-B categories are numeric in
 * OpenSky and commonly encoded as A1…A7 by public fallback feeds.
 */
export function aircraftIconKind(aircraft: AircraftIconSource): AircraftIconKind {
  const type = aircraft.aircraft_type?.trim().toUpperCase() ?? "";
  const profile = `${type} ${aircraft.aircraft_description ?? aircraftModel(type) ?? ""}`.toLowerCase();
  // A known type is more specific than an emitter weight category.
  if (/helicopter|rotorcraft|gyrocopter|autogyro/.test(profile) || /^(H1[23456]5|EC[123][0-9]{2}|AS[35][0-9]{2}|R22|R44|R66|B06|B407|B429|S76|S92|A109|A139|A169|A189|UH60)$/.test(type)) return "helicopter";
  if (/glider|sailplane/.test(profile)) return "glider";
  if (/balloon|airship|blimp|dirigible/.test(profile)) return "balloon";
  if (/^(AT[47][0-9]|DH8[A-D]|DHC[67]|C208|PC12|TBM[789]|BE[123][0-9]|B350|SF34|SB20)$/.test(type) || /turboprop|dash 8|king air/.test(profile)) return "turboprop";
  if (/^(E1[789][0-9]|E29[05]|CRJ[1279X]|ERJ[134][0-9]|E[135]45|BCS[13])$/.test(type)) return "regional";
  if (/^(A3[345][0-9K]|A388|B74[478]|B76[234]|B77[237WL]|B78[89X])$/.test(type)) return "heavy";
  if (/^(A(19N|20N|21N|31[89]|32[01])|B73[0-9]|B3[789]M|B75[23]|C919)$/.test(type)) return "airliner";
  if (/^(PC24|C25M|C700|FA8X|GL7T)$/.test(type)) return "small";
  if (/cessna|piper|cirrus|diamond|beech|pilatus|ultralight|uav|drone/.test(profile)) return "small";
  const categoryText = String(aircraft.aircraft_category ?? aircraft.category ?? "").trim().toUpperCase();
  if (categoryText === "B1") return "glider";
  if (categoryText === "B2") return "balloon";
  const categoryNumber = Number(categoryText.replace(/^A/, ""));
  if (categoryNumber === 7) return "helicopter";
  if (categoryNumber === 8) return "glider";
  if (categoryNumber === 9) return "balloon";
  if ([1, 2, 11, 13, 14].includes(categoryNumber)) return "small";
  if (categoryNumber === 5) return "heavy";
  if ([3, 4, 6].includes(categoryNumber)) return "airliner";
  if (/airbus|boeing/.test(profile)) return "airliner";
  if (/embraer|bombardier/.test(profile)) return "regional";
  return "unknown";
}

export function altitudeColor(value?: number | null): string {
  if (value == null || !Number.isFinite(value)) return ALTITUDE_UNKNOWN_COLOR;
  return ALTITUDE_COLOR_BANDS.find((band) => value <= band.maxMeters)?.color ?? ALTITUDE_UNKNOWN_COLOR;
}

/** Label of the legend band an altitude falls in, or "Unknown" when it has none. */
export function altitudeBand(value?: number | null): string {
  if (value == null || !Number.isFinite(value)) return "Unknown";
  return ALTITUDE_COLOR_BANDS.find((band) => value <= band.maxMeters)?.label ?? "Unknown";
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
    ...longitudeRange(round(floor(bounds.lomin)), round(ceil(bounds.lomax))),
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
    ...longitudeRange(bounds.lomin - lonPadding, bounds.lomax + lonPadding),
  };
}

/**
 * Public ADS-B point feeds accept a circle up to 250 NM. Split a broad map
 * into safe cells and order them from the centre out so the first visible
 * aircraft arrive quickly. Extremely broad views are deliberately bounded;
 * the user can keep moving while the next viewport replaces the queue.
 */
export function splitBoundsIntoTiles(bounds: Bounds, maxTiles = 24): Bounds[] {
  // Providers require ordered boxes inside [-180, 180]. Split a crossing
  // before tiling, while the map and its cache keep the continuous interval.
  if (bounds.lomax > 180) {
    const first = splitBoundsIntoTiles({ ...bounds, lomax: 180 }, Math.ceil(maxTiles / 2));
    const second = splitBoundsIntoTiles({ ...bounds, lomin: -180, lomax: bounds.lomax - 360 }, Math.ceil(maxTiles / 2));
    return first.flatMap((tile, index) => [tile, ...(second[index] ? [second[index]] : [])])
      .concat(second.slice(first.length)).slice(0, maxTiles);
  }
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

/** Initial great-circle bearing from `a` to `b`, in degrees from north. */
export function bearingDeg(a: [number, number], b: [number, number]): number {
  const toRad = (value: number) => (value * Math.PI) / 180;
  const dLon = toRad(b[1] - a[1]);
  const y = Math.sin(dLon) * Math.cos(toRad(b[0]));
  const x = Math.cos(toRad(a[0])) * Math.sin(toRad(b[0])) - Math.sin(toRad(a[0])) * Math.cos(toRad(b[0])) * Math.cos(dLon);
  return ((Math.atan2(y, x) * 180) / Math.PI + 360) % 360;
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
  if (points.some((point) => point?.latitude == null || point?.longitude == null || !Number.isFinite(point.latitude) || !Number.isFinite(point.longitude) || Math.abs(point.latitude) > 90 || Math.abs(point.longitude) > 180)) return null;
  const flownKm = distanceKm([origin!.latitude!, origin!.longitude!], [position.latitude!, position.longitude!]);
  const remainingKm = distanceKm([position.latitude!, position.longitude!], [destination!.latitude!, destination!.longitude!]);
  const total = flownKm + remainingKm;
  const directKm = distanceKm([origin!.latitude!, origin!.longitude!], [destination!.latitude!, destination!.longitude!]);
  if (total < 1 || directKm < 1 || total / directKm > 1.6) return null;
  const speed = position.velocity;
  return {
    percent: (flownKm / total) * 100,
    flownKm,
    remainingKm,
    etaSeconds: speed != null && speed > 50 ? (remainingKm * 1000) / speed : null,
  };
}

/** `?at=lat,lon,zoom`, the shareable map position when no airport or flight is open. */
export function parseMapView(value: string | null): MapView | null {
  const parts = (value ?? "").split(",");
  if (parts.length !== 3 || parts.some(part => !part.trim())) return null;
  const [latitude, longitude, zoom] = parts.map(Number);
  if (![latitude, longitude, zoom].every(Number.isFinite)) return null;
  if (Math.abs(latitude) > 85.051129 || Math.abs(longitude) > 180 || zoom < 1 || zoom > 19) return null;
  return { latitude, longitude, zoom };
}


/**
 * Callsigns a ticket flight number is transmitted as: "AF1234" is flown as
 * AFR1234 and "LH400" as DLH400. Returns lowercase candidates, empty when
 * the term is not an IATA flight number.
 */
export function callsignsForFlightNumber(term: string): string[] {
  const match = /^([a-z0-9]{2})\s?0*(\d{1,4}[a-z]?)$/i.exec(term.trim());
  if (!match) return [];
  const icaoCodes = AIRLINE_ICAO_BY_IATA[match[1].toUpperCase()] ?? [];
  return icaoCodes.map((icao) => `${icao}${match[2]}`.toLowerCase());
}

let iataByIcao: Map<string, string> | null = null;

/**
 * The ticket flight number for a numeric airline callsign: AFR1234 → AF1234.
 * Alphanumeric callsigns (BAW33A, EZY82FH) are ATC codes chosen to avoid
 * confusion on frequency, not flight numbers, so they get none.
 */
export function flightNumberForCallsign(callsign?: string | null): string | null {
  const match = /^([A-Z]{3})(\d{1,4})$/.exec((callsign ?? "").trim().toUpperCase());
  if (!match) return null;
  if (!iataByIcao) {
    iataByIcao = new Map();
    for (const [iata, icaoCodes] of Object.entries(AIRLINE_ICAO_BY_IATA)) {
      // Keep the first designator when an ICAO code is listed under several.
      for (const icao of icaoCodes) if (!iataByIcao.has(icao)) iataByIcao.set(icao, iata);
    }
  }
  const iata = iataByIcao.get(match[1]);
  return iata ? `${iata}${match[2]}` : null;
}

/** Reject cached traces from another flight before they can reach the map. */
export function matchingFlightTrack(track: TrackResponse | undefined, flight: Flight | null, nowSeconds = Date.now() / 1000): TrackResponse | undefined {
  if (!track || !flight || flight.data_source === "scheduled") return undefined;
  const path = track.track.path;
  if (!path?.length) return track;
  const normalize = (value: string) => value.replace(/\s/g, "").toUpperCase();
  if (track.track.icao24 && normalize(track.track.icao24) !== normalize(flight.icao24)) return undefined;
  if (track.track.callsign && flight.callsign && normalize(track.track.callsign) !== normalize(flight.callsign)) return undefined;
  const first = path[0][0];
  const last = path[path.length - 1][0];
  if (!Number.isFinite(first) || !Number.isFinite(last)) return undefined;
  const requestedTime = flight.primary_time ?? flight.first_seen ?? 0;
  if (requestedTime === 0 || flight.data_source === "live-nearby") {
    if (nowSeconds - last > 15 * 60 || last > nowSeconds + 60) return undefined;
  } else if (requestedTime < first - 15 * 60 || requestedTime > last + 60) return undefined;
  return currentLegTrack(track, flight.on_ground);
}

/** Minutes on the ground after which a trace's earlier flight is a previous leg. */
const TURNAROUND_MINUTES = 20;

/**
 * The trace of the flight the aircraft is on now. An airframe's trace can
 * span its previous leg: an aircraft taxiing out showed the whole cruise
 * and descent of the flight that brought it in. When it is on the ground
 * and its last airborne point is older than a turnaround, only the ground
 * movement since then is kept. A recent landing keeps its full arrival.
 */
export function currentLegTrack(track: TrackResponse | undefined, onGround?: boolean | null): TrackResponse | undefined {
  const path = track?.track.path;
  if (!track || !path || path.length < 2 || onGround !== true) return track;
  const airborne = (point: TrackPoint) => point[5] === false && (point[3] ?? 0) > 0;
  let lastAirborne = -1;
  for (let index = path.length - 1; index >= 0; index -= 1) {
    if (airborne(path[index])) { lastAirborne = index; break; }
  }
  if (lastAirborne < 0) return track;
  const sinceLanding = path[path.length - 1][0] - path[lastAirborne][0];
  if (sinceLanding < TURNAROUND_MINUTES * 60) return track;
  return { ...track, track: { ...track.track, path: path.slice(lastAirborne + 1), trace_kind: "recent" } };
}
