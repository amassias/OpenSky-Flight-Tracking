import type { Airport, BoardFlight, BoardPhase, Flight, FlightAwareDetails, FlightMode, LiveAircraft, MetarReport } from "./types";
import { distanceKm } from "./utils";
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

/** Callsigns as ADS-B and AeroAPI both write them: "AFR1234". */
export function normalizeIdent(value?: string | null): string {
  return (value ?? "").toUpperCase().replace(/[^A-Z0-9]/g, "");
}

function isoMs(value?: string | null): number | null {
  if (!value) return null;
  const parsed = Date.parse(value);
  return Number.isNaN(parsed) ? null : parsed;
}

export type ScheduleTone = "neutral" | "ok" | "warn" | "alert" | "live";

export interface ScheduleEntry {
  flight: FlightAwareDetails;
  /** The same flight seen live by ADS-B, when its callsign is in view. */
  live: LiveAircraft | null;
  scheduledMs: number | null;
  /** Best current time: actual, then estimated, then scheduled. */
  expectedMs: number | null;
  delayMinutes: number;
  /** Share of the route flown, from the live position when available. */
  progress: number | null;
  /** Arrival estimate from the live position and ground speed. */
  liveEtaMs: number | null;
  status: string;
  tone: ScheduleTone;
}

/**
 * Lines up FlightAware's scheduled flights with the aircraft seen live, so a
 * board row carries the gate and times from the schedule and the position,
 * progress and arrival estimate from the aircraft itself.
 */
export function mergeSchedule(
  flights: readonly FlightAwareDetails[],
  liveAircraft: readonly LiveAircraft[],
  mode: FlightMode,
  airport: Airport,
  nowMs = Date.now(),
): { entries: ScheduleEntry[]; matchedIcao24: Set<string> } {
  const byIdent = new Map<string, LiveAircraft>();
  for (const aircraft of liveAircraft) {
    const ident = normalizeIdent(aircraft.callsign);
    if (ident && !byIdent.has(ident)) byIdent.set(ident, aircraft);
  }
  const matchedIcao24 = new Set<string>();
  const entries = flights.map((flight) => {
    const live = [flight.atc_ident, flight.ident_icao, flight.ident].map(normalizeIdent).find((ident) => ident && byIdent.has(ident));
    const aircraft = live ? byIdent.get(live)! : null;
    if (aircraft) matchedIcao24.add(aircraft.icao24);
    const departure = mode === "departure";
    const scheduledMs = isoMs(departure ? flight.scheduled_out ?? flight.scheduled_off : flight.scheduled_in ?? flight.scheduled_on);
    const expectedMs = departure
      ? isoMs(flight.actual_out) ?? isoMs(flight.estimated_out) ?? isoMs(flight.estimated_off) ?? scheduledMs
      : isoMs(flight.actual_in) ?? isoMs(flight.estimated_in) ?? isoMs(flight.estimated_on) ?? scheduledMs;
    const delayMinutes = scheduledMs != null && expectedMs != null ? Math.round((expectedMs - scheduledMs) / 60_000) : 0;

    let progress = flight.progress_percent != null ? flight.progress_percent / 100 : null;
    let liveEtaMs: number | null = null;
    const airborne = aircraft && aircraft.on_ground === false && aircraft.latitude != null && aircraft.longitude != null;
    if (!departure && airborne && airport.latitude != null && airport.longitude != null) {
      const remainingKm = distanceKm([aircraft.latitude!, aircraft.longitude!], [airport.latitude, airport.longitude]);
      const totalKm = flight.route_distance ? flight.route_distance * 1.609344 : null;
      if (totalKm && totalKm > remainingKm * 0.5) progress = Math.min(1, Math.max(0, 1 - remainingKm / totalKm));
      if (aircraft.velocity && aircraft.velocity > 40) liveEtaMs = nowMs + (remainingKm * 1000 / aircraft.velocity) * 1000;
    }

    const status = scheduleStatus(flight, aircraft, mode, delayMinutes, progress);
    return { flight, live: aircraft, scheduledMs, expectedMs, delayMinutes, progress, liveEtaMs, ...status };
  });
  entries.sort((a, b) => (a.expectedMs ?? a.scheduledMs ?? Infinity) - (b.expectedMs ?? b.scheduledMs ?? Infinity));
  return { entries, matchedIcao24 };
}

function scheduleStatus(flight: FlightAwareDetails, live: LiveAircraft | null, mode: FlightMode, delay: number, progress: number | null): { status: string; tone: ScheduleTone } {
  if (flight.cancelled) return { status: "Cancelled", tone: "alert" };
  if (flight.diverted) return { status: "Diverted", tone: "alert" };
  if (mode === "departure") {
    if (live?.on_ground && (live.velocity ?? 0) >= 2.5) return { status: "Taxiing", tone: "live" };
    if (flight.actual_out) return { status: "Left gate", tone: "live" };
  } else {
    if (flight.actual_in) return { status: "At gate", tone: "ok" };
    if (flight.actual_on || live?.on_ground) return { status: "Landed", tone: "ok" };
    if (flight.actual_off || (live && live.on_ground === false)) {
      return { status: progress != null ? `En route · ${Math.round(progress * 100)}%` : "En route", tone: "live" };
    }
  }
  if (delay >= 15) return { status: `Delayed ${delay} min`, tone: "warn" };
  if (delay <= -5) return { status: "Early", tone: "ok" };
  return { status: "On time", tone: "neutral" };
}

/** A scheduled flight seen live, as a selectable flight with FlightAware's route and operations. */
export function scheduleEntryToFlight(entry: ScheduleEntry): Flight | null {
  const { flight, live } = entry;
  if (!live) return null;
  return {
    ...live,
    status: live.on_ground ? "on_ground" : "airborne",
    primary_time: 0,
    data_source: "live-nearby",
    airline_name: live.airline_name || flight.airline_name || "",
    departure_airport: flight.origin?.code_icao ?? live.departure_airport ?? null,
    departure_airport_name: flight.origin?.name ?? live.departure_airport_name ?? null,
    arrival_airport: flight.destination?.code_icao ?? live.arrival_airport ?? null,
    arrival_airport_name: flight.destination?.name ?? live.arrival_airport_name ?? null,
    route_source: "flightaware",
    route_provider: "FlightAware",
    flightaware: flight,
  };
}
