import type { Bounds } from "../../shared/types";

/**
 * The app speaks the zoom scale of shared links (256 px tiles, world = 256 px at
 * zoom 0). MapLibre counts 512 px tiles, so its zoom is one lower for the same
 * picture. Everything outside the map component keeps the shared scale.
 */
export const toGlZoom = (viewZoom: number) => viewZoom - 1;
export const fromGlZoom = (glZoom: number) => glZoom + 1;

/** Position in the 256 px world of `viewZoom`, origin at the top-left of the world. */
export function mercatorPixel(latitude: number, longitude: number, viewZoom: number): { x: number; y: number } {
  const scale = 256 * 2 ** viewZoom;
  const sine = Math.sin((Math.max(-85.0511, Math.min(85.0511, latitude)) * Math.PI) / 180);
  return {
    x: ((longitude + 180) / 360) * scale,
    y: (0.5 - Math.log((1 + sine) / (1 - sine)) / (4 * Math.PI)) * scale,
  };
}

export interface Insets { left: number; top: number; right: number; bottom: number }

/**
 * Camera `offset` (pixels from the map centre) that makes a target land in the
 * middle of the part of the map no docked panel covers.
 */
export function insetOffset(insets: Insets): [number, number] {
  return [(insets.left - insets.right) / 2, (insets.top - insets.bottom) / 2];
}

/** With world copies drawn, the camera can show longitudes past +-180: queries stay on the globe. */
export function visibleBoundsFromEdges(edges: { south: number; north: number; west: number; east: number }): Bounds {
  return {
    lamin: Math.max(-90, edges.south),
    lomin: Math.max(-180, edges.west),
    lamax: Math.min(90, edges.north),
    lomax: Math.min(180, edges.east),
  };
}

const EARTH_RADIUS_M = 6_371_000;

/** Closed ring of [longitude, latitude] around a point, `radiusMetres` away. */
export function circlePolygon(center: [number, number], radiusMetres: number, steps = 48): [number, number][] {
  const [latitude, longitude] = center;
  const angular = radiusMetres / EARTH_RADIUS_M;
  const lat1 = (latitude * Math.PI) / 180;
  const lon1 = (longitude * Math.PI) / 180;
  const ring: [number, number][] = [];
  for (let step = 0; step < steps; step += 1) {
    const bearing = (step / steps) * 2 * Math.PI;
    const lat2 = Math.asin(Math.sin(lat1) * Math.cos(angular) + Math.cos(lat1) * Math.sin(angular) * Math.cos(bearing));
    const lon2 = lon1 + Math.atan2(Math.sin(bearing) * Math.sin(angular) * Math.cos(lat1), Math.cos(angular) - Math.sin(lat1) * Math.sin(lat2));
    ring.push([(lon2 * 180) / Math.PI, (lat2 * 180) / Math.PI]);
  }
  ring.push(ring[0]);
  return ring;
}

/** Inverse of {@link mercatorPixel}: [latitude, longitude] of a position in the 256 px world of `viewZoom`. */
export function mercatorLatLng(x: number, y: number, viewZoom: number): [number, number] {
  const scale = 256 * 2 ** viewZoom;
  const longitude = (x / scale) * 360 - 180;
  const latitude = (Math.atan(Math.sinh(Math.PI * (1 - (2 * y) / scale))) * 180) / Math.PI;
  return [latitude, longitude];
}

const wrapLongitude = (longitude: number) => ((((longitude + 180) % 360) + 360) % 360) - 180;

/** Map centre that makes `point` land in the middle of the area no docked panel covers. */
export function placementCenter(point: [number, number], viewZoom: number, insets: Insets): [number, number] {
  const [dx, dy] = insetOffset(insets);
  const pixel = mercatorPixel(point[0], point[1], viewZoom);
  const [latitude, longitude] = mercatorLatLng(pixel.x - dx, pixel.y - dy, viewZoom);
  return [latitude, wrapLongitude(longitude)];
}

/** The part of the globe a camera at `center` and `viewZoom` shows in a map of `size` pixels. */
export function boundsAround(center: [number, number], viewZoom: number, size: { width: number; height: number }): Bounds {
  const middle = mercatorPixel(center[0], center[1], viewZoom);
  const [north, west] = mercatorLatLng(middle.x - size.width / 2, middle.y - size.height / 2, viewZoom);
  const [south, east] = mercatorLatLng(middle.x + size.width / 2, middle.y + size.height / 2, viewZoom);
  return visibleBoundsFromEdges({ south, north, west, east });
}
