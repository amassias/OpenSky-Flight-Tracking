import type { Airport, BoardFlight, BoardPhase, Flight, FlightMode, MetarReport } from "./types";
import type { UnitSystem } from "./units";

const RAD = Math.PI / 180;
const DAY_MS = 86_400_000;
const J1970 = 2_440_588;
const J2000 = 2_451_545;
const OBLIQUITY = RAD * 23.4397;

function toDays(ms: number) { return ms / DAY_MS - 0.5 + J1970 - J2000; }
function fromJulian(julian: number) { return (julian + 0.5 - J1970) * DAY_MS; }

/**
 * Sunrise and sunset closest to `at` (the suncalc formulation of the NOAA
 * equations, accurate to about a minute). Null in polar day or night.
 */
export function sunTimes(latitude: number, longitude: number, at = Date.now()): { sunrise: number; sunset: number } | null {
  const lw = RAD * -longitude;
  const phi = RAD * latitude;
  const days = toDays(at);
  const cycle = Math.round(days - 0.0009 - lw / (2 * Math.PI));
  const transitDays = 0.0009 + lw / (2 * Math.PI) + cycle;
  const anomaly = RAD * (357.5291 + 0.98560028 * transitDays);
  const center = RAD * (1.9148 * Math.sin(anomaly) + 0.02 * Math.sin(2 * anomaly) + 0.0003 * Math.sin(3 * anomaly));
  const eclipticLongitude = anomaly + center + RAD * 102.9372 + Math.PI;
  const declination = Math.asin(Math.sin(eclipticLongitude) * Math.sin(OBLIQUITY));
  const noon = J2000 + transitDays + 0.0053 * Math.sin(anomaly) - 0.0069 * Math.sin(2 * eclipticLongitude);
  const cosHourAngle = (Math.sin(RAD * -0.833) - Math.sin(phi) * Math.sin(declination)) / (Math.cos(phi) * Math.cos(declination));
  if (cosHourAngle < -1 || cosHourAngle > 1) return null;
  const hourAngle = Math.acos(cosHourAngle);
  const setDays = 0.0009 + (hourAngle + lw) / (2 * Math.PI) + cycle;
  const set = J2000 + setDays + 0.0053 * Math.sin(anomaly) - 0.0069 * Math.sin(2 * eclipticLongitude);
  return { sunrise: fromJulian(noon - (set - noon)), sunset: fromJulian(set) };
}

const timeFormatters = new Map<string, Intl.DateTimeFormat>();
function timeFormatter(timeZone: string, offset = false) {
  const key = `${timeZone}|${offset}`;
  let formatter = timeFormatters.get(key);
  if (!formatter) {
    try {
      formatter = new Intl.DateTimeFormat("en-GB", { timeZone, hour: "2-digit", minute: "2-digit", hour12: false, ...(offset ? { timeZoneName: "shortOffset" } : {}) });
    } catch {
      formatter = new Intl.DateTimeFormat("en-GB", { timeZone: "UTC", hour: "2-digit", minute: "2-digit", hour12: false });
    }
    timeFormatters.set(key, formatter);
  }
  return formatter;
}

/** "23:52" in the airport's own time zone (UTC when it is unknown). */
export function localTime(ms: number, timeZone?: string | null): string {
  return timeFormatter(timeZone || "UTC").format(ms);
}

/** "UTC+2", "UTC−4:30" or "UTC" for the airport's current offset. */
export function utcOffsetLabel(ms: number, timeZone?: string | null): string {
  if (!timeZone) return "UTC";
  const part = timeFormatter(timeZone, true).formatToParts(ms).find((item) => item.type === "timeZoneName")?.value ?? "";
  const offset = part.replace(/^GMT/, "");
  return offset ? `UTC${offset.replace("-", "−")}` : "UTC";
}

export function minutesUntil(seconds: number, nowMs: number): number {
  return Math.max(0, Math.round((seconds * 1000 - nowMs) / 60_000));
}

export function relativeAge(seconds: number | null | undefined, nowMs: number): string | null {
  if (seconds == null) return null;
  const minutes = Math.round((nowMs - seconds * 1000) / 60_000);
  if (minutes < 1) return "just now";
  if (minutes < 60) return `${minutes} min ago`;
  return `${Math.floor(minutes / 60)} h ${String(minutes % 60).padStart(2, "0")} ago`;
}

export const PHASE_LABEL: Record<BoardPhase, string> = {
  parked: "At stand",
  taxiing: "Taxiing",
  departed: "Departed",
  inbound: "Inbound",
  approach: "Approach",
  final: "Final",
  landed: "Landed",
};

export function visibilityText(visibility: MetarReport["visibility"], units: UnitSystem): string {
  if (!visibility) return "—";
  const { meters, at_least: atLeast } = visibility;
  if (units === "aviation" && meters < 5000) return `${meters.toLocaleString("en-US")} m`;
  const km = meters / 1000;
  return `${atLeast ? "≥ " : ""}${km >= 10 ? Math.round(km) : km.toFixed(1)} km`;
}

export function runwayLength(feet: number | null, units: UnitSystem): string {
  if (feet == null) return "—";
  return units === "metric" ? `${Math.round(feet * 0.3048).toLocaleString("en-US")} m` : `${feet.toLocaleString("en-US")} ft`;
}

const SURFACES: [RegExp, string][] = [
  [/ASP|BIT|TAR|ASF|MAC/, "Asphalt"], [/CON|PEM|BET|COP/, "Concrete"], [/GRS|GRASS|TURF/, "Grass"],
  [/GRV|GRAVEL/, "Gravel"], [/DIRT|SAND|SOIL|CLAY/, "Unpaved"], [/WATER/, "Water"],
];
export function surfaceName(surface: string | null): string {
  if (!surface) return "—";
  return SURFACES.find(([pattern]) => pattern.test(surface.toUpperCase()))?.[1] ?? surface;
}

/** A board row as a selectable flight, with this airport filled in as one end of the route. */
export function boardRowToFlight(row: BoardFlight, airport: Airport, mode: FlightMode): Flight {
  const here = { icao: airport.icao, name: airport.name };
  const from = mode === "departure" ? here : row.origin;
  const to = mode === "departure" ? row.destination : here;
  return {
    ...row,
    status: row.on_ground ? "on_ground" : "airborne",
    primary_time: 0,
    data_source: "live-nearby",
    airline_name: row.airline_name || "",
    departure_airport: from?.icao ?? null,
    departure_airport_name: from?.name ?? null,
    arrival_airport: to?.icao ?? null,
    arrival_airport_name: to?.name ?? null,
    route_source: row.route_known ? "callsign" : undefined,
    route_provider: row.route_known ? "adsb.lol route database" : null,
  };
}
