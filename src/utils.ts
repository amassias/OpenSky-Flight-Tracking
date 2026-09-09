import type { Flight, FlightStatus } from "./types";

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

export function formatTime(timestamp?: number | null): string {
  if (!timestamp) return "—";
  return new Intl.DateTimeFormat("en-GB", {
    timeZone: "UTC",
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  }).format(new Date(timestamp * 1000));
}

export function formatAltitude(value?: number | null): string {
  return value == null ? "—" : `${Math.round(value * 3.28084).toLocaleString("en-US")} ft`;
}

export function formatSpeed(value?: number | null): string {
  return value == null ? "—" : `${Math.round(value * 1.94384).toLocaleString("en-US")} kt`;
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
