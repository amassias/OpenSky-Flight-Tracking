import { describe, expect, it } from "vitest";
import { boundsAround, circlePolygon, fromGlZoom, insetOffset, mercatorLatLng, mercatorPixel, placementCenter, toGlZoom, visibleBoundsFromEdges } from "./mapCamera";
import { distanceKm } from "../../shared/utils";

describe("map camera", () => {
  it("keeps the zoom numbers of shared links: one view zoom is one MapLibre zoom more", () => {
    expect(toGlZoom(10)).toBe(9);
    expect(fromGlZoom(toGlZoom(6.5))).toBe(6.5);
  });

  it("projects to the 256 px world of the shared zoom scale", () => {
    expect(mercatorPixel(0, 0, 0)).toEqual({ x: 128, y: 128 });
    expect(mercatorPixel(0, 180, 0).x).toBeCloseTo(256);
    expect(mercatorPixel(0, 0, 3).x).toBeCloseTo(1024);
    expect(mercatorPixel(60, 0, 0).y).toBeLessThan(128);
  });

  it("shifts the camera towards the part of the map that no panel covers", () => {
    expect(insetOffset({ left: 416, top: 16, right: 16, bottom: 16 })).toEqual([200, 0]);
    expect(insetOffset({ left: 16, top: 16, right: 16, bottom: 316 })).toEqual([0, -150]);
  });

  it("keeps visible bounds on the globe even when world copies are shown", () => {
    expect(visibleBoundsFromEdges({ south: -95, north: 91, west: -200, east: 250 })).toEqual({ lamin: -90, lamax: 90, lomin: -180, lomax: 180 });
  });

  it("draws an accuracy circle of the requested radius", () => {
    const ring = circlePolygon([49.2, 2.6], 35_000);
    expect(ring[0]).toEqual(ring[ring.length - 1]);
    for (const [lng, lat] of ring) expect(distanceKm([49.2, 2.6], [lat, lng])).toBeCloseTo(35, 0);
  });

  it("goes back from pixels to the position it came from", () => {
    const { x, y } = mercatorPixel(48.5, 2.2, 7);
    const [latitude, longitude] = mercatorLatLng(x, y, 7);
    expect(latitude).toBeCloseTo(48.5, 6);
    expect(longitude).toBeCloseTo(2.2, 6);
  });

  it("centres the camera so a point lands in the uncovered area", () => {
    // A 400 px dock on the left: the point sits 200 px right of the map centre, so the centre moves 200 px west of it.
    const [latitude, longitude] = placementCenter([0, 10], 4, { left: 416, top: 16, right: 16, bottom: 16 });
    expect(latitude).toBeCloseTo(0, 6);
    expect(longitude).toBeCloseTo(10 - (200 / (256 * 2 ** 4)) * 360, 6);
  });

  it("wraps a centre that would leave the date line", () => {
    const [, longitude] = placementCenter([0, 179.9], 2, { left: 16, top: 16, right: 416, bottom: 16 });
    expect(longitude).toBeGreaterThanOrEqual(-180);
    expect(longitude).toBeLessThanOrEqual(180);
  });

  it("tells which part of the globe a camera shows once it arrives", () => {
    const bounds = boundsAround([0, 0], 1, { width: 512, height: 512 });
    expect(bounds.lomin).toBeCloseTo(-180, 6);
    expect(bounds.lomax).toBeCloseTo(180, 6);
    expect(bounds.lamax).toBeCloseTo(-bounds.lamin, 6);
  });
});
