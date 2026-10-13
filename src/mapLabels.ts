export type LabelLevel = 0 | 1 | 2 | 3;
export const labelLevelForZoom = (zoom: number): LabelLevel => zoom >= 12 ? 3 : zoom >= 10 ? 2 : zoom >= 8 ? 1 : 0;

export interface LabelCandidate { id: string; x: number; y: number; width: number; height: number }
/** Screen-space placement with a spatial grid. Selected aircraft wins collisions. */
export function placeLabels(candidates: LabelCandidate[], selectedId: string | null): Set<string> {
  const cells = new Map<string, LabelCandidate[]>();
  const kept = new Set<string>();
  const sorted = [...candidates].sort((a, b) => a.id === selectedId ? -1 : b.id === selectedId ? 1 : a.id.localeCompare(b.id));
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
