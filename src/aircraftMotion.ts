import { useEffect, useState } from "react";
import type { Flight } from "./types";

const EARTH_RADIUS_M = 6_371_000;
/** Beyond this age a fix is too stale to project without inventing a position. */
export const MAX_PROJECTION_SECONDS = 90;

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
  const fixTime = aircraft.time_position ?? aircraft.last_contact;
  const speed = aircraft.velocity;
  const track = aircraft.true_track;
  if (aircraft.on_ground || fixTime == null || speed == null || track == null || !(speed > 5)) return [latitude, longitude];

  const age = Math.min(Math.max(0, nowSeconds - fixTime), MAX_PROJECTION_SECONDS);
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
