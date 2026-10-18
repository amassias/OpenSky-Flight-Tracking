import { afterEach, describe, expect, it, vi } from "vitest";
import { MAX_PROJECTION_SECONDS, catchUpPosition, projectPosition, subscribeToFrame } from "./aircraftMotion";

const cruising = { latitude: 49, longitude: 2, velocity: 250, true_track: 90, on_ground: false, time_position: 1_000, last_contact: 1_000 };

describe("projectPosition", () => {
  it("advances an aircraft along its track at its ground speed", () => {
    const [latitude, longitude] = projectPosition(cruising, 1_010)!;
    const eastKm = (longitude - 2) * 111.32 * Math.cos((49 * Math.PI) / 180);
    expect(eastKm).toBeCloseTo(2.5, 1);
    expect(latitude).toBeCloseTo(49, 3);
  });

  it("follows the heading, not just the longitude", () => {
    const [latitude, longitude] = projectPosition({ ...cruising, true_track: 0 }, 1_010)!;
    expect((latitude - 49) * 111.2).toBeCloseTo(2.5, 1);
    expect(longitude).toBeCloseTo(2, 3);
  });

  it("leaves parked aircraft and aircraft without speed or heading where they were reported", () => {
    expect(projectPosition({ ...cruising, on_ground: true }, 1_030)).toEqual([49, 2]);
    expect(projectPosition({ ...cruising, velocity: null }, 1_030)).toEqual([49, 2]);
    expect(projectPosition({ ...cruising, true_track: null }, 1_030)).toEqual([49, 2]);
    expect(projectPosition({ ...cruising, velocity: 2 }, 1_030)).toEqual([49, 2]);
  });

  it("never projects a fix older than the cap, so a stalled feed cannot fling an aircraft away", () => {
    expect(MAX_PROJECTION_SECONDS).toBe(150);
    expect(projectPosition(cruising, 1_150)).toEqual(projectPosition(cruising, 5_000));
  });

  it("keeps moving past the former 90 s cap, up to 150 s", () => {
    const at90 = projectPosition(cruising, 1_090)!;
    const at150 = projectPosition(cruising, 1_150)!;
    expect(at150[1]).toBeGreaterThan(at90[1]);
    const eastKm = (at150[1] - 2) * 111.32 * Math.cos((49 * Math.PI) / 180);
    expect(eastKm).toBeCloseTo(37.5, 0);
  });

  it("never projects a fix of unknown age", () => {
    expect(projectPosition({ ...cruising, time_position: null }, 1_100)).toEqual([49, 2]);
  });

  it("has nothing to say without a position", () => {
    expect(projectPosition({ ...cruising, latitude: null }, 1_010)).toBeNull();
  });
});

it("does not invent a position age from a newer contact-only packet", () => {
  expect(projectPosition({ ...cruising, time_position: null, last_contact: 1010 }, 1012)).toEqual([49, 2]);
});

it("keeps non-finite speed and heading at the reported coordinates", () => {
  expect(projectPosition({ ...cruising, velocity: NaN }, 1012)).toEqual([49, 2]);
  expect(projectPosition({ ...cruising, true_track: Infinity }, 1012)).toEqual([49, 2]);
});

describe("catchUpPosition", () => {
  const shown: [number, number] = [49, 2];
  const observed: [number, number] = [49.01, 2.02];

  it("starts at the previously shown position, so a new fix does not jump", () => {
    expect(catchUpPosition(shown, observed, 0)).toEqual(shown);
  });

  it("is part-way after half the catch-up time, moving monotonically toward the observed position", () => {
    const early = catchUpPosition(shown, observed, 0.4);
    const later = catchUpPosition(shown, observed, 0.9);
    expect(early[0]).toBeGreaterThan(49);
    expect(later[0]).toBeGreaterThan(early[0]);
    expect(later[0]).toBeLessThan(49.01);
  });

  it("has fully reached the observed position within 2 s and stays there", () => {
    expect(catchUpPosition(shown, observed, 1.5)).toEqual(observed);
    expect(catchUpPosition(shown, observed, 10)).toEqual(observed);
  });
});

describe("subscribeToFrame", () => {
  afterEach(() => { vi.useRealTimers(); vi.restoreAllMocks(); });

  it("ticks between 10 and 30 times per second", () => {
    vi.useFakeTimers({ toFake: ["requestAnimationFrame", "cancelAnimationFrame", "Date", "performance"] });
    const listener = vi.fn();
    const stop = subscribeToFrame(listener);
    vi.advanceTimersByTime(1_000);
    stop();
    expect(listener.mock.calls.length).toBeGreaterThanOrEqual(10);
    expect(listener.mock.calls.length).toBeLessThanOrEqual(30);
  });

  it("pauses while the page is hidden and stops after unsubscribe", () => {
    vi.useFakeTimers({ toFake: ["requestAnimationFrame", "cancelAnimationFrame", "Date", "performance"] });
    const hidden = vi.spyOn(document, "hidden", "get").mockReturnValue(true);
    const listener = vi.fn();
    const stop = subscribeToFrame(listener);
    vi.advanceTimersByTime(1_000);
    expect(listener).not.toHaveBeenCalled();
    hidden.mockReturnValue(false);
    vi.advanceTimersByTime(1_000);
    expect(listener).toHaveBeenCalled();
    stop();
    listener.mockClear();
    vi.advanceTimersByTime(1_000);
    expect(listener).not.toHaveBeenCalled();
  });
});
