import type { LiveAircraft, MapTheme } from "../../shared/types";
import { aircraftIconKind, emergencyInfo, type AircraftIconKind } from "../../shared/utils";
import { positionAge } from "../flights/flightTelemetry";
import { aircraftGlyph } from "./aircraftGlyph";
import { mapColors } from "./mapColors";
import { CATCH_UP_SECONDS, catchUpPosition, isPositionEstimated, projectPosition } from "./aircraftMotion";

/**
 * Above this many aircraft in view the map stops giving each one a detailed DOM marker
 * (label, focus, keyboard) and draws them all in the WebGL layer (ADR 0009).
 */
export const DENSE_AIRCRAFT_THRESHOLD = 750;

/** Rendered size in CSS pixels of a silhouette with a known model, by kind; other models use 25. */
const MODEL_SIZE: Partial<Record<AircraftIconKind, number>> = { heavy: 27, glider: 27, small: 21 };
const DEFAULT_MODEL_SIZE = 25;
/** The generic category symbol of an unmapped type. */
const CATEGORY_SIZE = 20;

/** A fix older than this, or of unknown age, is drawn faded. */
const OLD_FIX_SECONDS = 60;

export interface AircraftFrameOptions {
  theme: MapTheme;
  /** Aircraft under the pointer or previewed from a list: drawn in the accent colour. */
  previewId: string | null;
  /** Aircraft drawn elsewhere (the selected one keeps its detailed marker). */
  excludeId: string | null;
  /** More aircraft drawn elsewhere (the Focus labels keep detailed markers). */
  excludeIds?: ReadonlySet<string>;
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
 * each aircraft was last shown at so that a new fix eases in (`CATCH_UP_SECONDS`)
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
    const size = glyph.model ? MODEL_SIZE[glyph.kind] ?? DEFAULT_MODEL_SIZE : CATEGORY_SIZE;
    return { shape: glyph.model?.id ?? glyph.kind, glyph: glyph.glyph, size };
  }

  frame(now: number, { theme, previewId, excludeId, excludeIds }: AircraftFrameOptions): DrawnAircraft[] {
    const colors = mapColors(theme);
    const drawn: DrawnAircraft[] = [];
    for (const item of this.aircraft) {
      if (item.latitude == null || item.longitude == null || item.icao24 === excludeId || excludeIds?.has(item.icao24)) continue;
      const projected = projectPosition(item, now) ?? [item.latitude, item.longitude];
      if (this.changed.has(item.icao24)) {
        const from = this.shown.get(item.icao24);
        if (from) this.pulls.set(item.icao24, { from, startedAt: now });
        this.changed.delete(item.icao24);
      }
      const pull = this.pulls.get(item.icao24);
      const position = pull ? catchUpPosition(pull.from, projected, now - pull.startedAt) : projected;
      if (pull && now - pull.startedAt >= CATCH_UP_SECONDS) this.pulls.delete(item.icao24);
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
export function updateIntervalMs(viewZoom: number, latitude: number): number {
  const metresPerPixel = 156_543 * Math.cos((latitude * Math.PI) / 180) / 2 ** viewZoom;
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
