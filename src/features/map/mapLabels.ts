export type LabelLevel = 0 | 1 | 2 | 3;
export const labelLevelForZoom = (zoom: number): LabelLevel => zoom >= 12 ? 3 : zoom >= 10 ? 2 : zoom >= 8 ? 1 : 0;

import { emergencyInfo } from "../../shared/utils";

/** Nearest-to-centre labels need at least this zoom (the level at which callsigns start to show). */
export const NEAREST_LABEL_MIN_ZOOM = 8;
/** How many aircraft nearest the map centre are labelled. */
export const NEAREST_LABEL_COUNT = 15;

export type FocusReason = "selected" | "followed" | "emergency" | "nearest";
export interface FocusLabel { id: string; reason: FocusReason }
interface FocusAircraft { icao24: string; latitude?: number | null; longitude?: number | null; squawk?: string | null; emergency?: string | null }

/**
 * Focus labels: the aircraft that carry an on-map label. The selected and followed aircraft and
 * emergencies are labelled at any zoom; the NEAREST_LABEL_COUNT aircraft nearest the centre join
 * them from NEAREST_LABEL_MIN_ZOOM. Result is ordered by importance.
 */
export function focusLabels<T extends FocusAircraft>({ aircraft, selectedId, followedId, center, zoom, inView }: {
  aircraft: readonly T[]; selectedId: string | null; followedId: string | null; center: { lat: number; lng: number }; zoom: number; inView: (item: T) => boolean;
}): FocusLabel[] {
  const picked: FocusLabel[] = [];
  const taken = new Set<string>();
  const add = (id: string, reason: FocusReason) => { if (!taken.has(id)) { taken.add(id); picked.push({ id, reason }); } };
  const present = aircraft.filter(item => item.latitude != null && item.longitude != null);
  if (selectedId && present.some(item => item.icao24 === selectedId)) add(selectedId, "selected");
  if (followedId && present.some(item => item.icao24 === followedId)) add(followedId, "followed");
  present.filter(item => emergencyInfo(item)).map(item => item.icao24).sort().forEach(id => add(id, "emergency"));
  if (zoom >= NEAREST_LABEL_MIN_ZOOM) {
    const scale = Math.cos(center.lat * Math.PI / 180);
    const distance = (item: T) => (item.latitude! - center.lat) ** 2 + ((item.longitude! - center.lng) * scale) ** 2;
    present.filter(item => !taken.has(item.icao24) && inView(item))
      .map(item => ({ id: item.icao24, d: distance(item) }))
      .sort((a, b) => a.d - b.d || a.id.localeCompare(b.id))
      .slice(0, NEAREST_LABEL_COUNT)
      .forEach(item => add(item.id, "nearest"));
  }
  return picked;
}

export interface LabelCandidate { id: string; x: number; y: number; width: number; height: number; priority?: number }
/** Screen-space placement with a spatial grid. Selected aircraft wins collisions, then higher priority. */
export function placeLabels(candidates: LabelCandidate[], selectedId: string | null): Set<string> {
  const cells = new Map<string, LabelCandidate[]>();
  const kept = new Set<string>();
  const sorted = [...candidates].sort((a, b) => a.id === selectedId ? -1 : b.id === selectedId ? 1 : (b.priority ?? 0) - (a.priority ?? 0) || a.id.localeCompare(b.id));
  for (const candidate of sorted) {
    const keys: string[] = [];
    for (let x = Math.floor(candidate.x / 160); x <= Math.floor((candidate.x + candidate.width) / 160); x++) {
      for (let y = Math.floor(candidate.y / 48); y <= Math.floor((candidate.y + candidate.height) / 48); y++) keys.push(`${x}:${y}`);
    }
    if (keys.some(key => cells.get(key)?.some(other => candidate.x < other.x + other.width && candidate.x + candidate.width > other.x && candidate.y < other.y + other.height && candidate.y + candidate.height > other.y))) continue;
    kept.add(candidate.id);
    for (const key of keys) { const bucket = cells.get(key) ?? []; bucket.push(candidate); cells.set(key, bucket); }
  }
  return kept;
}
