import type { Flight } from "../../shared/types";
import { headingProjection } from "./headingProjection";

/** A direct great-circle guide, not a filed route or predicted trajectory. */
export function destinationGuide(flight: Flight, now: number, head?: [number, number] | null): [number, number][] | null {
  if (!headingProjection(flight, now, head)) return null;
  const { arrival_latitude: lat, arrival_longitude: lon } = flight;
  if (lat == null || lon == null || !Number.isFinite(lat) || !Number.isFinite(lon) || Math.abs(lat) > 85 || Math.abs(lon) > 180) return null;
  const start = head ?? [flight.latitude!, flight.longitude!];
  const radians = Math.PI / 180;
  const a = start[0] * radians, b = start[1] * radians, c = lat * radians, d = lon * radians;
  const angle = Math.acos(Math.min(1, Math.max(-1, Math.sin(a) * Math.sin(c) + Math.cos(a) * Math.cos(c) * Math.cos(d - b))));
  if (angle < 0.001) return null;
  const count = Math.min(48, Math.max(2, Math.ceil(angle / 0.04)));
  const points: [number, number][] = [];
  for (let i = 0; i <= count; i++) {
    const t = i / count;
    const left = Math.sin((1 - t) * angle) / Math.sin(angle);
    const right = Math.sin(t * angle) / Math.sin(angle);
    const x = left * Math.cos(a) * Math.cos(b) + right * Math.cos(c) * Math.cos(d);
    const y = left * Math.cos(a) * Math.sin(b) + right * Math.cos(c) * Math.sin(d);
    const z = left * Math.sin(a) + right * Math.sin(c);
    const longitude = Math.atan2(y, x) / radians;
    const previous = points.at(-1)?.[1] ?? start[1];
    points.push([Math.atan2(z, Math.hypot(x, y)) / radians, longitude + 360 * Math.round((previous - longitude) / 360)]);
  }
  return points;
}
