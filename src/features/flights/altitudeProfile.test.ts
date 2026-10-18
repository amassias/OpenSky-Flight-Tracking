import { describe, expect, it } from "vitest";
import { altitudeProfile, nearestProfileTime, PROFILE_PAD, PROFILE_WIDTH } from "./altitudeProfile";
import type { TrackPoint } from "../../shared/types";
const point = (time: number, altitude: number | null): TrackPoint => [time,49,2,altitude,90,false];
describe("time-scaled altitude profile", () => {
  it("keeps cruise variations proportional to altitude and handles constant tracks", () => {
    const profile = altitudeProfile([point(100,11000),point(110,11100)])!;
    expect(profile.scaleMin).toBe(0);
    expect(profile.scaleMax).toBeGreaterThan(profile.max);
    expect(Math.abs(profile.coordinates[0].y-profile.coordinates[1].y)).toBeLessThan(5);
    expect(altitudeProfile([point(100,0),point(110,0)])!.coordinates.every(p => Number.isFinite(p.y))).toBe(true);
  });
  it("spaces irregular observations by time rather than index", () => {
    const profile = altitudeProfile([point(100,1000),point(110,2000),point(200,3000)])!;
    expect((profile.coordinates[1].x-PROFILE_PAD)/(PROFILE_WIDTH-2*PROFILE_PAD)).toBeCloseTo(.1);
    expect(nearestProfileTime([100,110,200],115)).toBe(1);
  });
  it("preserves extrema while bounding dense rendering and keeping every inspectable point", () => {
    const points = Array.from({length:10000},(_,i)=>point(i,1000));
    points[1234]=point(1234,12000);
    points[7654]=point(7654,10);
    const profile=altitudeProfile(points)!;
    expect(profile.min).toBe(10); expect(profile.max).toBe(12000);
    expect(profile.sampleCount).toBeLessThanOrEqual(320);
    expect(profile.points).toHaveLength(10000);
    expect(profile.paths.length).toBeLessThanOrEqual(6);
    expect(profile.area).toContain(`${profile.coordinates[1234].x},${profile.coordinates[1234].y}`);
  });
  it("does not draw a line across unknown altitude", () => {
    const profile=altitudeProfile([point(100,1000),point(110,null),point(120,2000)])!;
    expect(profile.paths).toEqual([]);
    expect(profile.area.match(/Z/g)).toHaveLength(2);
  });
  it("sorts observations and leaves invalid altitude without inventing a ground fix", () => {
    const profile=altitudeProfile([point(120,2000),point(100,1000),point(110,NaN),point(NaN,50)])!;
    expect(profile.start).toBe(100);expect(profile.end).toBe(120);
    expect(profile.coordinates[1].altitude).toBeNull();
  });
  it("blends colour stops across the samples and marks the min, middle and max", () => {
    const profile=altitudeProfile([point(0,100),point(10,3000),point(20,9000)])!;
    expect(profile.stops.map(stop=>stop.offset)).toEqual([0,.5,1]);
    expect(profile.stops[0].color).not.toBe(profile.stops[2].color);
    expect(profile.ticks.map(tick=>tick.altitude)).toEqual([100,4550,9000]);
    expect(profile.ticks[0].y).toBeGreaterThan(profile.ticks[2].y);
    expect([...profile.bands].sort()).toEqual(["26–36k ft","5–15k ft","<5k ft"].sort());
  });
  it("lists a single tick and the unknown band for a flat trace with a gap", () => {
    const profile=altitudeProfile([point(0,500),point(10,null),point(20,500)])!;
    expect(profile.ticks).toHaveLength(1);
    expect(profile.bands.has("Unknown")).toBe(true);
  });
});
