import type { Flight, LiveAircraft } from "../../shared/types";

export const WATCHLIST_LIMIT = 20;

/** An airframe the visitor chose to keep an eye on. Stored in the browser only. */
export interface WatchEntry {
  icao24: string;
  /** What the visitor knew it by when saving it: callsign or registration. */
  label: string;
  registration?: string | null;
}

export interface WatchStatus {
  entry: WatchEntry;
  /** The aircraft in the current live snapshot, when it is in view. */
  live: LiveAircraft | null;
}

export function watchEntryFor(flight: Pick<Flight, "icao24" | "callsign" | "registration">): WatchEntry {
  return {
    icao24: flight.icao24.toLowerCase(),
    label: flight.callsign || flight.registration || flight.icao24.toUpperCase(),
    registration: flight.registration ?? null,
  };
}

export function isWatched(list: readonly WatchEntry[], icao24: string) {
  const hex = icao24.toLowerCase();
  return list.some(entry => entry.icao24 === hex);
}

/** Adds or removes an airframe. A full list refuses the newcomer instead of dropping an older entry silently. */
export function toggleWatch(list: readonly WatchEntry[], entry: WatchEntry): { list: WatchEntry[]; refused: boolean } {
  if (isWatched(list, entry.icao24)) return { list: list.filter(item => item.icao24 !== entry.icao24), refused: false };
  if (list.length >= WATCHLIST_LIMIT) return { list: [...list], refused: true };
  return { list: [...list, entry], refused: false };
}

/** Pairs each watched airframe with its live position, in-view aircraft first. */
export function watchStatuses(list: readonly WatchEntry[], live: readonly LiveAircraft[]): WatchStatus[] {
  const byHex = new Map(live.map(aircraft => [aircraft.icao24.toLowerCase(), aircraft]));
  return list
    .map(entry => ({ entry, live: byHex.get(entry.icao24) ?? null }))
    .sort((a, b) => Number(Boolean(b.live)) - Number(Boolean(a.live)));
}
