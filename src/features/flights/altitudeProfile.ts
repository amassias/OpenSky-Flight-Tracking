import type { TrackPoint } from "../../shared/types";
import { altitudeBand, altitudeColor } from "../../shared/utils";
export const PROFILE_WIDTH = 620;
export const PROFILE_HEIGHT = 280;
export const PROFILE_PAD = 54;

/** Time-scaled geometry with bounded drawing complexity; inspection keeps every fix. */
export function altitudeProfile(input: TrackPoint[]) {
  const points = input.filter(point => Number.isFinite(point[0]) && Math.abs(point[0]) <= 8.64e12).slice().sort((a, b) => a[0] - b[0]);
  const altitudes = points.map(point => point[3]).filter((value): value is number => value != null && Number.isFinite(value));
  if (altitudes.length < 2 || points.length < 2) return null;
  let min = Infinity, max = -Infinity;
  for (const value of altitudes) { min = Math.min(min, value); max = Math.max(max, value); }
  const start = points[0][0], end = points[points.length - 1][0];
  const step = Math.pow(10, Math.floor(Math.log10(Math.max(Math.abs(max), max - min, 1000)))) / 10;
  const scaleMin = Math.floor(Math.min(0, min) / step) * step;
  const scaleMax = Math.ceil((max + step) / step) * step;
  const span = end - start || 1, range = scaleMax - scaleMin;
  const coordinates = points.map((point, index) => {
    const altitude = point[3] != null && Number.isFinite(point[3]) ? point[3] : null;
    return { index, time: point[0], altitude,
      x: PROFILE_PAD + (point[0] - start) / span * (PROFILE_WIDTH - 2 * PROFILE_PAD),
      y: PROFILE_HEIGHT - PROFILE_PAD - ((altitude ?? scaleMin) - scaleMin) / range * (PROFILE_HEIGHT - 2 * PROFILE_PAD),
    };
  });
  const indices = new Set<number>();
  const chunk = Math.max(1, Math.ceil(coordinates.length / 80));
  for (let first = 0; first < coordinates.length; first += chunk) {
    const last = Math.min(coordinates.length - 1, first + chunk - 1);
    let low = first, high = first;
    for (let i = first; i <= last; i++) {
      if (coordinates[i].altitude == null) continue;
      if (coordinates[low].altitude == null || coordinates[i].altitude! < coordinates[low].altitude!) low = i;
      if (coordinates[high].altitude == null || coordinates[i].altitude! > coordinates[high].altitude!) high = i;
    }
    [first, low, high, last].forEach(index => indices.add(index));
  }
  const samples = [...indices].sort((a, b) => a - b);
  const missing = [0];
  for (const point of coordinates) missing.push(missing[missing.length - 1] + (point.altitude == null ? 1 : 0));
  const paths = new Map<string, string[]>();
  const areas: string[] = [];
  let area = "", areaStart = 0, areaLast = 0;
  const closeArea = () => {
    if (area) areas.push(`${area} L${areaLast},${PROFILE_HEIGHT - PROFILE_PAD} L${areaStart},${PROFILE_HEIGHT - PROFILE_PAD} Z`);
    area = "";
  };
  samples.forEach((index, offset) => {
    const point = coordinates[index], previous = offset ? coordinates[samples[offset - 1]] : null;
    const connected = previous && previous.altitude != null && point.altitude != null && missing[index + 1] === missing[previous.index];
    if (!connected) closeArea();
    if (point.altitude != null) {
      if (!area) { area = `M${point.x},${point.y}`; areaStart = point.x; }
      else area += ` L${point.x},${point.y}`;
      areaLast = point.x;
    }
    if (connected && previous) {
      const color = altitudeColor((previous.altitude! + point.altitude!) / 2);
      const commands = paths.get(color) ?? [];
      commands.push(`M${previous.x},${previous.y} L${point.x},${point.y}`);
      paths.set(color, commands);
    }
  });
  closeArea();
  // Colour stops follow the plotted samples, so the line blends between bands instead of stepping.
  const stops = samples.filter(index => coordinates[index].altitude != null).map(index => ({
    offset: (coordinates[index].x - PROFILE_PAD) / (PROFILE_WIDTH - 2 * PROFILE_PAD), color: altitudeColor(coordinates[index].altitude),
  }));
  const yAt = (altitude: number) => PROFILE_HEIGHT - PROFILE_PAD - (altitude - scaleMin) / range * (PROFILE_HEIGHT - 2 * PROFILE_PAD);
  const ticks = (max === min ? [min] : [min, (min + max) / 2, max]).map(altitude => ({ altitude, y: yAt(altitude) }));
  const bands = new Set(coordinates.map(point => altitudeBand(point.altitude)));
  return { min, max, scaleMin, scaleMax, start, end, points, coordinates, sampleCount: samples.length, stops, ticks, bands,
    paths: [...paths].map(([color, commands]) => ({ color, d: commands.join(" ") })), area: areas.join(" ") };
}

export function nearestProfileTime(times: number[], target: number): number {
  let low = 0, high = times.length - 1;
  while (low < high) { const mid = Math.floor((low + high) / 2); if (times[mid] < target) low = mid + 1; else high = mid; }
  return low > 0 && Math.abs(times[low - 1] - target) <= Math.abs(times[low] - target) ? low - 1 : low;
}
