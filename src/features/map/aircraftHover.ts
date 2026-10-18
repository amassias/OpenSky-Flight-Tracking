import type { LiveAircraft } from "../../shared/types";

export interface HoveredAircraft {
  aircraft: LiveAircraft;
  x: number;
  y: number;
  width: number;
  height: number;
  insetLeft: number;
  insetRight: number;
}

/** One hover subscription for the whole map, independent of its marker count. */
export class AircraftHoverStore {
  private current: HoveredAircraft | null = null;
  private listeners = new Set<() => void>();
  private hideTimer: ReturnType<typeof setTimeout> | null = null;
  private waitingForPointerMove = false;

  getSnapshot = () => this.current;
  subscribe = (listener: () => void) => {
    this.listeners.add(listener);
    return () => { this.listeners.delete(listener); };
  };

  show = (next: HoveredAircraft) => {
    if (this.waitingForPointerMove) return;
    this.cancelHide();
    this.current = next;
    this.listeners.forEach((listener) => listener());
  };

  cancelHide = () => {
    if (this.hideTimer) clearTimeout(this.hideTimer);
    this.hideTimer = null;
  };

  hideLater = (icao24: string) => {
    if (this.current?.aircraft.icao24 !== icao24) return;
    this.cancelHide();
    this.hideTimer = setTimeout(() => {
      if (this.current?.aircraft.icao24 === icao24) this.clear();
    }, 160);
  };

  clear = () => {
    this.cancelHide();
    if (!this.current) return;
    this.current = null;
    this.listeners.forEach((listener) => listener());
  };

  resume = () => { this.waitingForPointerMove = false; };

  suspend = () => {
    this.waitingForPointerMove = true;
    this.clear();
  };
}
