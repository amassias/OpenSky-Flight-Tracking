import { useEffect, useState } from "react";
import { positionAge } from "../flights/flightTelemetry";
import type { Flight } from "../../shared/types";

const EARTH_RADIUS_M = 6_371_000;
/** Beyond this age a fix is too stale to project without inventing a position. */
export const MAX_PROJECTION_SECONDS = 150;

type Projectable = Pick<Flight, "latitude" | "longitude" | "velocity" | "true_track" | "on_ground" | "time_position" | "last_contact">;

/**
 * Dead-reckons an aircraft along its last reported track and ground speed, so
 * markers keep gliding between two feed refreshes instead of jumping when the
 * next fix arrives. Aircraft on the ground, or without speed and heading, stay
 * where they were reported.
 */
export function projectPosition(aircraft: Projectable, nowSeconds: number): [number, number] | null {
  const { latitude, longitude } = aircraft;
  if (latitude == null || longitude == null) return null;
  const observedAge = positionAge(aircraft, nowSeconds);
  const speed = aircraft.velocity;
  const track = aircraft.true_track;
  if (aircraft.on_ground || observedAge == null || speed == null || !Number.isFinite(speed) || track == null || !Number.isFinite(track) || !(speed > 5)) return [latitude, longitude];

  const age = Math.min(observedAge ?? 0, MAX_PROJECTION_SECONDS);
  if (age === 0) return [latitude, longitude];
  const angular = (speed * age) / EARTH_RADIUS_M;
  const bearing = (track * Math.PI) / 180;
  const lat1 = (latitude * Math.PI) / 180;
  const lon1 = (longitude * Math.PI) / 180;
  const lat2 = Math.asin(Math.sin(lat1) * Math.cos(angular) + Math.cos(lat1) * Math.sin(angular) * Math.cos(bearing));
  const lon2 = lon1 + Math.atan2(Math.sin(bearing) * Math.sin(angular) * Math.cos(lat1), Math.cos(angular) - Math.sin(lat1) * Math.sin(lat2));
  return [(lat2 * 180) / Math.PI, ((((lon2 * 180) / Math.PI) + 540) % 360) - 180];
}

type TickListener = (nowSeconds: number) => void;
const tickListeners = new Set<TickListener>();
let tickTimer: number | undefined;

/**
 * One shared one-second clock for every moving marker. Each marker updates its
 * own position imperatively, so a refresh never re-renders the React tree.
 */
export function subscribeToTick(listener: TickListener): () => void {
  tickListeners.add(listener);
  if (tickTimer === undefined) {
    tickTimer = window.setInterval(() => {
      // Nothing is visible to glide while the tab is hidden; the next visible
      // tick projects every marker straight to its current position.
      if (document.hidden) return;
      const now = Date.now() / 1000;
      tickListeners.forEach((callback) => callback(now));
    }, 1000);
  }
  return () => {
    tickListeners.delete(listener);
    if (tickListeners.size === 0 && tickTimer !== undefined) {
      window.clearInterval(tickTimer);
      tickTimer = undefined;
    }
  };
}

/** Seconds over which a marker eases from its shown position to a new fix. */
export const CATCH_UP_SECONDS = 1.5;
const FRAME_INTERVAL_MS = 50; // 20 frames per second, inside the 10 to 30 budget

/**
 * Where a marker is drawn `elapsedSeconds` after a new fix arrived: it eases
 * (smoothstep) from the position it was showing to the new estimate instead of
 * jumping.
 */
export function catchUpPosition(from: [number, number], to: [number, number], elapsedSeconds: number): [number, number] {
  const t = Math.min(Math.max(elapsedSeconds / CATCH_UP_SECONDS, 0), 1);
  if (t >= 1) return to;
  const eased = t * t * (3 - 2 * t);
  const dLon = ((((to[1] - from[1]) % 360) + 540) % 360) - 180;
  return [from[0] + (to[0] - from[0]) * eased, from[1] + dLon * eased];
}

const frameListeners = new Set<TickListener>();
let frameHandle: number | undefined;
let lastFrameAt = -Infinity;

function runFrame(timestamp: number) {
  frameHandle = undefined;
  if (frameListeners.size === 0) return;
  frameHandle = window.requestAnimationFrame(runFrame);
  // Nothing is visible to animate while the tab is hidden.
  if (document.hidden || timestamp - lastFrameAt < FRAME_INTERVAL_MS) return;
  lastFrameAt = timestamp;
  const now = Date.now() / 1000;
  frameListeners.forEach((callback) => callback(now));
}

/** Shared 10 to 30 fps animation clock for marker movement; paused while the page is hidden. */
export function subscribeToFrame(listener: TickListener): () => void {
  frameListeners.add(listener);
  if (frameHandle === undefined) frameHandle = window.requestAnimationFrame(runFrame);
  return () => {
    frameListeners.delete(listener);
    if (frameListeners.size === 0 && frameHandle !== undefined) {
      window.cancelAnimationFrame(frameHandle);
      frameHandle = undefined;
    }
  };
}

/** Seconds since the epoch, refreshed every second while `active`. */
export function useNowSeconds(active = true): number {
  const [now, setNow] = useState(() => Date.now() / 1000);
  useEffect(() => {
    if (!active) return;
    setNow(Date.now() / 1000);
    return subscribeToTick(setNow);
  }, [active]);
  return now;
}

export function isPositionEstimated(aircraft: Projectable, nowSeconds: number): boolean {
  const projected = projectPosition(aircraft, nowSeconds);
  return projected != null && (projected[0] !== aircraft.latitude || projected[1] !== aircraft.longitude);
}
