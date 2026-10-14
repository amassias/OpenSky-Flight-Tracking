import { describe, expect, it } from "vitest";
import { WATCHLIST_LIMIT, isWatched, toggleWatch, watchEntryFor, watchStatuses, type WatchEntry } from "./watchlist";
import type { LiveAircraft } from "./types";

const entry = (hex: string): WatchEntry => ({ icao24: hex, label: hex.toUpperCase() });

describe("watchlist", () => {
  it("builds an entry from a flight, preferring the callsign", () => {
    expect(watchEntryFor({ icao24: "39ABCD", callsign: "AFR123", registration: "F-HBQE" })).toEqual({ icao24: "39abcd", label: "AFR123", registration: "F-HBQE" });
    expect(watchEntryFor({ icao24: "39ABCD", callsign: "", registration: "F-HBQE" }).label).toBe("F-HBQE");
  });

  it("toggles an airframe on and off, ignoring hex case", () => {
    const added = toggleWatch([], entry("39abcd"));
    expect(added.list).toHaveLength(1);
    expect(isWatched(added.list, "39ABCD")).toBe(true);
    expect(toggleWatch(added.list, entry("39abcd")).list).toEqual([]);
  });

  it("refuses a new entry at the limit and keeps the existing ones", () => {
    const full = Array.from({ length: WATCHLIST_LIMIT }, (_, index) => entry(index.toString(16).padStart(6, "0")));
    const result = toggleWatch(full, entry("ffffff"));
    expect(result.refused).toBe(true);
    expect(result.list).toEqual(full);
  });

  it("lists aircraft that are in view first and leaves the others unmatched", () => {
    const live = [{ icao24: "BBBBBB", callsign: "X" }] as LiveAircraft[];
    const statuses = watchStatuses([entry("aaaaaa"), entry("bbbbbb")], live);
    expect(statuses.map(item => item.entry.icao24)).toEqual(["bbbbbb", "aaaaaa"]);
    expect(statuses[0].live?.callsign).toBe("X");
    expect(statuses[1].live).toBeNull();
  });
});
