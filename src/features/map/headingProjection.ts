import type { Flight } from "../../shared/types";

/** A short two-minute heading vector, never a filed route or destination. */
export function headingProjection(flight: Flight, now: number, head?: [number, number] | null): [number, number][] | null {
  const { latitude, longitude, velocity, true_track: heading } = flight;
  const time = flight.time_position;
  if (flight.data_source === "scheduled" || flight.data_source === "opensky" || (flight.primary_time ?? 0) > 0 || flight.on_ground !== false ||
      latitude == null || longitude == null || !Number.isFinite(latitude) || !Number.isFinite(longitude) || Math.abs(latitude) > 85 || Math.abs(longitude) > 180 ||
      velocity == null || !Number.isFinite(velocity) || velocity < 5 || heading == null || !Number.isFinite(heading) || heading < 0 || heading > 360 ||
      time == null || !Number.isFinite(time) || now - time > 60 || time > now + 5) return null;
  const start = head ?? [latitude, longitude];
  const radians = Math.PI / 180;
  const angular = Math.min(velocity * 120, 40_000) / 6_371_000;
  const lat = start[0] * radians;
  const lon = start[1] * radians;
  const bearing = heading * radians;
  const endLat = Math.asin(Math.sin(lat) * Math.cos(angular) + Math.cos(lat) * Math.sin(angular) * Math.cos(bearing));
  const endLon = lon + Math.atan2(Math.sin(bearing) * Math.sin(angular) * Math.cos(lat), Math.cos(angular) - Math.sin(lat) * Math.sin(endLat));
  // Keep the unwrapped longitude next to the start at the antimeridian.
  return [start, [endLat / radians, endLon / radians]];
}
