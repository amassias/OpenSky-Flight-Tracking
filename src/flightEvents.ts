import type { Airport, Flight, TrackResponse } from "./types";
import { distanceKm } from "./utils";

/** Operational details must refer to this flight instance. */
export function operationsMatchFlight(flight: Flight, nowMs = Date.now()): boolean {
  const operations = flight.flightaware;
  if (!operations || operations.matches_current_flight === false || flight.data_source === "scheduled") return false;
  const normalize = (value?: string | null) => (value ?? "").replace(/[^A-Z0-9]/gi, "").toUpperCase();
  const identifier = operations.atc_ident || operations.queried_ident || operations.ident;
  if (!identifier || normalize(identifier) !== normalize(flight.callsign)) return false;
  if (operations.registration && flight.registration && flight.registration_source !== "schedule"
      && normalize(operations.registration) !== normalize(flight.registration)) return false;
  const timestamp = (value?: string | null) => value ? Date.parse(value) : NaN;
  const start = timestamp(operations.actual_out ?? operations.actual_off ?? operations.scheduled_out);
  const landed = timestamp(operations.actual_in ?? operations.actual_on);
  if (!Number.isFinite(start)) return false;
  if (flight.primary_time && flight.data_source !== "live-nearby") {
    const requested = flight.primary_time * 1000;
    return requested >= start - 15 * 60_000 && requested <= (Number.isFinite(landed) ? landed : start + 36 * 3600_000);
  }
  if (flight.on_ground === false && Number.isFinite(landed)) return false;
  return start <= nowMs && nowMs - start < 36 * 3600_000
    && (!Number.isFinite(landed) || (nowMs >= landed && nowMs - landed < 2 * 3600_000));
}

/** The diversion flag alone is insufficient without a matching episode. */
export function confirmedDiversion(flight: Flight, nowMs = Date.now()): boolean {
  return Boolean(flight.flightaware?.diverted) && operationsMatchFlight(flight, nowMs);
}

/** A conservative geographic observation, never a confirmed diversion. */
export function possibleDiversion(flight: Flight, track: TrackResponse | undefined, airports?: ReadonlyMap<string, Airport>) {
  if (flight.data_source !== "live-nearby" || !flight.on_ground || confirmedDiversion(flight) || !airports) return null;
  const destination = airports.get(flight.arrival_airport ?? "");
  const path = track?.track.path;
  if (!destination || destination.latitude == null || destination.longitude == null || !path?.length) return null;
  const last = path[path.length - 1];
  if (last[5] !== true || Date.now() / 1000 - last[0] > 120) return null;
  let firstGround = path.length - 1;
  while (firstGround > 0 && path[firstGround - 1][5] === true) firstGround -= 1;
  // Exclude an aircraft still taxiing before its first takeoff.
  if (firstGround === 0 || !path.slice(0, firstGround).some(point => point[5] === false && (point[3] ?? 0) > 300)
      || last[0] - path[firstGround][0] < 120) return null;
  const position: [number, number] = [last[1], last[2]];
  if (distanceKm(position, [destination.latitude, destination.longitude]) < 30) return null;
  let nearest: Airport | null = null;
  let distance = 3;
  for (const airport of airports.values()) {
    if (airport.latitude == null || airport.longitude == null) continue;
    const candidate = distanceKm(position, [airport.latitude, airport.longitude]);
    if (candidate < distance) { nearest = airport; distance = candidate; }
  }
  return nearest ? { airport: nearest, returned: nearest.icao === flight.departure_airport } : null;
}
