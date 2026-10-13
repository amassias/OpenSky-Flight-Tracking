import { describe, expect, it } from "vitest";
import { altitudeProfile, nearestProfileTime, PROFILE_PAD, PROFILE_WIDTH } from "./altitudeProfile";
import type { TrackPoint } from "./types";
const point = (time: number, altitude: number | null): TrackPoint => [time,49,2,altitude,90,false];
describe("time-scaled altitude profile", () => {
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
});
