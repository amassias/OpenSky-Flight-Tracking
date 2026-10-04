import { useSyncExternalStore } from "react";

export type UnitSystem = "aviation" | "metric";

const STORAGE_KEY = "skytrace-units";
const listeners = new Set<() => void>();

function readStored(): UnitSystem {
  try {
    return window.localStorage.getItem(STORAGE_KEY) === "metric" ? "metric" : "aviation";
  } catch {
    return "aviation";
  }
}

let current: UnitSystem = readStored();

export function getUnits(): UnitSystem {
  return current;
}

export function setUnits(next: UnitSystem) {
  if (next === current) return;
  current = next;
  try {
    window.localStorage.setItem(STORAGE_KEY, next);
  } catch {
    // Units simply reset on the next visit when storage is unavailable.
  }
  listeners.forEach((listener) => listener());
}

function subscribe(listener: () => void) {
  listeners.add(listener);
  return () => { listeners.delete(listener); };
}

/** Subscribes a component to the unit system so it re-renders when it changes. */
export function useUnits(): UnitSystem {
  return useSyncExternalStore(subscribe, getUnits, () => "aviation");
}

const integer = new Intl.NumberFormat("en-US", { maximumFractionDigits: 0 });

export function altitudeText(meters: number, units: UnitSystem = current): string {
  return units === "metric" ? `${integer.format(Math.round(meters))} m` : `${integer.format(Math.round(meters * 3.28084))} ft`;
}

export function speedText(metersPerSecond: number, units: UnitSystem = current): string {
  return units === "metric" ? `${integer.format(Math.round(metersPerSecond * 3.6))} km/h` : `${integer.format(Math.round(metersPerSecond * 1.94384))} kt`;
}

export function verticalRateText(metersPerSecond: number, units: UnitSystem = current): string {
  if (units === "metric") return `${metersPerSecond > 0 ? "+" : metersPerSecond < 0 ? "−" : ""}${integer.format(Math.abs(Math.round(metersPerSecond)))} m/s`;
  const feetPerMinute = Math.round(metersPerSecond * 196.85 / 50) * 50;
  return `${feetPerMinute > 0 ? "+" : feetPerMinute < 0 ? "−" : ""}${integer.format(Math.abs(feetPerMinute))} ft/min`;
}

export function distanceText(kilometers: number, units: UnitSystem = current): string {
  if (units === "metric") return kilometers < 10 ? `${kilometers.toFixed(1)} km` : `${integer.format(Math.round(kilometers))} km`;
  const nauticalMiles = kilometers / 1.852;
  return nauticalMiles < 10 ? `${nauticalMiles.toFixed(1)} NM` : `${integer.format(Math.round(nauticalMiles))} NM`;
}

/** Compact label form: "FL371" in aviation units, "11,300 m" in metric. */
export function flightLevelText(meters: number, units: UnitSystem = current): string {
  if (units === "metric") return altitudeText(meters, units);
  const feet = meters * 3.28084;
  return feet >= 6_000 ? `FL${String(Math.round(feet / 100)).padStart(3, "0")}` : `${integer.format(Math.round(feet / 50) * 50)} ft`;
}
