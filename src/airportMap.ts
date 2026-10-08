import type { Airport } from "./types";
import { distanceKm } from "./utils";

/** Group nearby screen positions on a fixed grid without changing catalogue coverage. */
export function groupAirports(airports: Airport[], project: (airport: Airport) => { x: number; y: number }, cellSize = 64): Airport[][] {
  const cells = new Map<string, Airport[]>();
  for (const airport of airports) {
    if (airport.latitude == null || airport.longitude == null) continue;
    const point = project(airport);
    const key = `${Math.floor(point.x / cellSize)}:${Math.floor(point.y / cellSize)}`;
    const cell = cells.get(key);
    if (cell) cell.push(airport);
    else cells.set(key, [airport]);
  }
  return [...cells.values()];
}

export function nearestAirports(airports: Airport[], position: [number, number], limit = 5) {
  return airports.filter((airport) => airport.latitude != null && airport.longitude != null)
    .map((airport) => ({ airport, distance: distanceKm(position, [airport.latitude!, airport.longitude!]) }))
    .sort((a, b) => a.distance - b.distance || a.airport.icao.localeCompare(b.airport.icao))
    .slice(0, limit);
}
