import type { Bounds } from "./types";

/** Canonical west in [-180, 180), with east allowed past 180 for a date-line crossing. */
export function longitudeRange(west: number, east: number): Pick<Bounds, "lomin" | "lomax"> {
  const span = east - west;
  if (span >= 360) return { lomin: -180, lomax: 180 };
  if (west >= -180 && west < 180) return { lomin: west, lomax: east };
  const lomin = ((west + 180) % 360 + 360) % 360 - 180;
  return { lomin, lomax: lomin + span };
}

/** Membership works in any displayed world copy, including views across the date line. */
export function longitudeInRange(longitude: number, west: number, east: number): boolean {
  const offset = ((longitude - west) % 360 + 360) % 360;
  return east - west >= 360 || offset <= east - west + 1e-9;
}
