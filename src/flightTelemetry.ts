import type { Flight, LiveAircraft } from "./types";

const normalize = (value?: string | null) => (value ?? "").replace(/\s/g, "").toUpperCase();
export function sameLiveFlight(flight: Flight, live: LiveAircraft): boolean {
  if (flight.data_source === "scheduled" || flight.data_source === "opensky" || (flight.data_source !== "live-nearby" && (flight.primary_time ?? flight.first_seen ?? 0) > 0)) return false;
  if (flight.icao24.toLowerCase() !== live.icao24.toLowerCase()) return false;
  const identity = normalize(flight.callsign);
  const unspecified = !identity || identity === normalize(flight.icao24) || identity === normalize(flight.registration);
  return unspecified || !live.callsign || identity === normalize(live.callsign);
}

/** A delayed enrichment response must not replace a newer transponder signal. */
export function withLiveKinematics(flight: Flight, live: LiveAircraft): Flight {
  if (!sameLiveFlight(flight, live)) return flight;
  return {
    ...flight,
    latitude: live.latitude ?? flight.latitude, longitude: live.longitude ?? flight.longitude,
    baro_altitude: live.baro_altitude ?? flight.baro_altitude, geo_altitude: live.geo_altitude ?? flight.geo_altitude,
    velocity: live.velocity ?? flight.velocity, true_track: live.true_track ?? flight.true_track,
    vertical_rate: live.vertical_rate ?? flight.vertical_rate, on_ground: live.on_ground ?? flight.on_ground,
    squawk: live.squawk ?? flight.squawk, emergency: live.emergency ?? (live.squawk && live.squawk !== flight.squawk ? null : flight.emergency),
    time_position: live.time_position ?? flight.time_position, last_contact: live.last_contact ?? flight.last_contact,
    status: live.on_ground == null ? flight.status : live.on_ground ? "on_ground" : "airborne",
  };
}

export function positionObservation(flight: Flight, nowSeconds: number) {
  if (flight.data_source === "scheduled" || flight.data_source === "opensky" || flight.latitude == null || flight.longitude == null) return null;
  const time = flight.time_position ?? flight.last_contact;
  if (time == null || !Number.isFinite(time) || time <= 0 || time > nowSeconds + 60) return { state: "unknown" as const };
  const age = Math.max(0, nowSeconds - time);
  return { state: age > 90 ? "delayed" as const : "recent" as const, time, age };
}
