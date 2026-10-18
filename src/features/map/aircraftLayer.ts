import type { LiveAircraft, MapTheme } from "../../shared/types";
import { aircraftIconKind, emergencyInfo } from "../../shared/utils";
import { positionAge } from "../flights/flightTelemetry";
import { aircraftGlyph } from "./aircraftGlyph";
import { catchUpPosition, isPositionEstimated, projectPosition } from "./aircraftMotion";

// Map canvases cannot read CSS custom properties, so the theme tokens they need
// are mirrored here (see --aircraft / --accent).
export const MAP_COLORS: Record<MapTheme, { aircraft: string; ground: string; accent: string; halo: string; danger: string }> = {
  dark: { aircraft: "#f5f5f7", ground: "#8e8e93", accent: "#2997ff", halo: "#0b0b0c", danger: "#ff453a" },
  light: { aircraft: "#1d1d1f", ground: "#86868b", accent: "#0066cc", halo: "#ffffff", danger: "#d70015" },
};

/** A fix older than this, or of unknown age, is drawn faded. */
const OLD_FIX_SECONDS = 60;

export interface AircraftFrameOptions {
  theme: MapTheme;
  /** Aircraft under the pointer or previewed from a list: drawn in the accent colour. */
  previewId: string | null;
  /** Aircraft drawn elsewhere (the selected one keeps its detailed marker). */
  excludeId: string | null;
}

/** One aircraft as the WebGL layer draws it at one instant. */
export interface DrawnAircraft {
  id: string;
  lat: number;
  lng: number;
  /** Degrees clockwise for a nose-east glyph. */
  rotation: number;
  color: string;
  /** Outlined: the position is an estimate, or the fix is old or of unknown age. */
  hollow: boolean;
  opacity: number;
  /** Rendered size in CSS pixels. */
  size: number;
  /** Silhouette identity: model or kind. */
  shape: string;
  glyph: string;
}

interface Pull { from: [number, number]; startedAt: number }

const fixKey = (a: LiveAircraft) => `${a.latitude}:${a.longitude}:${a.time_position}`;

/**
 * Turns the latest live aircraft into drawable frames. It keeps the position
 * each aircraft was last shown at so that a new fix eases in (about 1.5 s)
 * instead of jumping, and projects between fixes (ADR 0007).
 */
export class AircraftFrames {
  private aircraft: readonly LiveAircraft[] = [];
  private shown = new Map<string, [number, number]>();
  private pulls = new Map<string, Pull>();
  private changed = new Set<string>();
  private fixes = new Map<string, string>();
  private glyphs = new Map<string, { shape: string; glyph: string; size: number }>();

  setAircraft(aircraft: readonly LiveAircraft[]) {
    this.aircraft = aircraft;
    const fixes = new Map<string, string>();
    for (const item of aircraft) {
      const key = fixKey(item);
      fixes.set(item.icao24, key);
      if (this.fixes.has(item.icao24) && this.fixes.get(item.icao24) !== key) this.changed.add(item.icao24);
    }
    for (const id of this.shown.keys()) if (!fixes.has(id)) { this.shown.delete(id); this.pulls.delete(id); }
    this.fixes = fixes;
    // The silhouette only changes when a feed brings new identity, so it is resolved here, not per frame.
    this.glyphs = new Map(aircraft.map(item => [item.icao24, this.resolveGlyph(item)]));
  }

  private resolveGlyph(item: LiveAircraft) {
    const glyph = aircraftGlyph(aircraftIconKind(item), item.aircraft_type);
    const size = glyph.model ? (glyph.kind === "heavy" || glyph.kind === "glider" ? 27 : glyph.kind === "small" ? 21 : 25) : 20;
    return { shape: glyph.model?.id ?? glyph.kind, glyph: glyph.glyph, size };
  }

  frame(now: number, { theme, previewId, excludeId }: AircraftFrameOptions): DrawnAircraft[] {
    const colors = MAP_COLORS[theme];
    const drawn: DrawnAircraft[] = [];
    for (const item of this.aircraft) {
      if (item.latitude == null || item.longitude == null || item.icao24 === excludeId) continue;
      const projected = projectPosition(item, now) ?? [item.latitude, item.longitude];
      if (this.changed.has(item.icao24)) {
        const from = this.shown.get(item.icao24);
        if (from) this.pulls.set(item.icao24, { from, startedAt: now });
        this.changed.delete(item.icao24);
      }
      const pull = this.pulls.get(item.icao24);
      const position = pull ? catchUpPosition(pull.from, projected, now - pull.startedAt) : projected;
      if (pull && now - pull.startedAt >= 1.5) this.pulls.delete(item.icao24);
      this.shown.set(item.icao24, position);
      const age = positionAge(item, now);
      const old = age == null || age > OLD_FIX_SECONDS;
      const { shape, glyph, size } = this.glyphs.get(item.icao24)!;
      drawn.push({
        id: item.icao24, lat: position[0], lng: position[1], rotation: (item.true_track ?? 0) - 90,
        color: item.icao24 === previewId ? colors.accent : emergencyInfo(item) ? colors.danger : item.on_ground ? colors.ground : colors.aircraft,
        hollow: old || isPositionEstimated(item, now), opacity: old ? 0.55 : 1, size, shape, glyph,
      });
    }
    return drawn;
  }
}

/** Fastest ground speed an airliner reaches, in metres per second. */
const FASTEST_AIRCRAFT_MS = 300;
/** An update is worth drawing once the fastest aircraft would have moved this many pixels. */
const VISIBLE_STEP_PIXELS = 0.6;

/**
 * How long the WebGL source may wait between two updates. Replacing 10,000
 * features is the main cost of the layer, and at a world view an aircraft moves
 * well under a pixel a second, so waiting changes nothing the visitor can see.
 * Between 100 ms (10 Hz, ADR 0007) and 2 s.
 */
export function updateIntervalMs(leafletZoom: number, latitude: number): number {
  const metresPerPixel = 156_543 * Math.cos((latitude * Math.PI) / 180) / 2 ** leafletZoom;
  const wait = (VISIBLE_STEP_PIXELS * metresPerPixel / FASTEST_AIRCRAFT_MS) * 1000;
  return Math.min(2000, Math.max(100, Math.round(wait)));
}

export function webglAvailable(): boolean {
  try {
    const canvas = document.createElement("canvas");
    return Boolean(canvas.getContext("webgl2") || canvas.getContext("webgl"));
  } catch {
    return false;
  }
}
