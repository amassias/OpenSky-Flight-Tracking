import { describe, expect, it } from "vitest";
import { boardRowToFlight, localTime, mergeSchedule, minutesUntil, scheduleEntryToFlight, sunTimes, utcOffsetLabel, visibilityText } from "./airportLive";
import type { Airport, BoardFlight, LiveAircraft } from "./types";

const cdg: Airport = { icao: "LFPG", iata: "CDG", name: "Paris Charles de Gaulle", display_name: "CDG", country: "FR", region: "", latitude: 49.0097, longitude: 2.5478, timezone: "Europe/Paris" };

describe("airport live helpers", () => {
  it("computes Paris sunrise and sunset within a few minutes of the almanac", () => {
    // 21 June 2026: sunrise 05:46 and sunset 21:58 local (03:46 / 19:58 UTC) at Roissy.
    const sun = sunTimes(cdg.latitude!, cdg.longitude!, Date.UTC(2026, 5, 21, 12));
    expect(sun).not.toBeNull();
    expect(Math.abs(sun!.sunrise - Date.UTC(2026, 5, 21, 3, 46)) / 60_000).toBeLessThan(5);
    expect(Math.abs(sun!.sunset - Date.UTC(2026, 5, 21, 19, 58)) / 60_000).toBeLessThan(5);
  });

  it("returns null during the polar night", () => {
    expect(sunTimes(78.2, 15.6, Date.UTC(2026, 11, 21, 12))).toBeNull();
  });

  it("formats airport-local times and offsets", () => {
    const summer = Date.UTC(2026, 6, 1, 10, 5);
    expect(localTime(summer, "Europe/Paris")).toBe("12:05");
    expect(utcOffsetLabel(summer, "Europe/Paris")).toBe("UTC+2");
    expect(utcOffsetLabel(summer, "Asia/Kolkata")).toBe("UTC+5:30");
    expect(utcOffsetLabel(summer, null)).toBe("UTC");
    expect(minutesUntil(summer / 1000 + 330, summer)).toBe(6);
  });

  it("reads AWC visibility as metres", () => {
    expect(visibilityText({ meters: 10_000, at_least: true }, "metric")).toBe("≥ 10 km");
    expect(visibilityText({ meters: 3_219, at_least: false }, "aviation")).toBe("3,219 m");
  });

  it("puts the board airport at the right end of the selected flight's route", () => {
    const row = { icao24: "abc123", callsign: "EZY1", on_ground: false, phase: "final", origin: { icao: "LFMN", name: "Nice" }, destination: null, distance_km: 10, route_known: true } as BoardFlight;
    const arrival = boardRowToFlight(row, cdg, "arrival");
    expect(arrival.departure_airport).toBe("LFMN");
    expect(arrival.arrival_airport).toBe("LFPG");
    expect(arrival.status).toBe("airborne");
    expect(arrival.route_source).toBe("callsign");
    const departure = boardRowToFlight({ ...row, on_ground: true, origin: null, destination: { icao: "EGLL" } }, cdg, "departure");
    expect(departure.departure_airport).toBe("LFPG");
    expect(departure.arrival_airport).toBe("EGLL");
    expect(departure.status).toBe("on_ground");
  });
});

describe("schedule merge", () => {
  const now = Date.UTC(2026, 9, 9, 8, 0);
  const base = {
    provider: "FlightAware", ident: "AFR1234", ident_icao: "AFR1234", ident_iata: "AF1234", atc_ident: "AFR1234",
    origin: { code_icao: "EDDB", code_iata: "BER", city: "Berlin" }, destination: { code_icao: "LFPG", code_iata: "CDG", city: "Paris" },
    scheduled_in: "2026-10-09T08:30:00Z", estimated_in: "2026-10-09T08:50:00Z", actual_off: "2026-10-09T07:20:00Z",
    route_distance: 545, progress_percent: 40, gate_dest: "K45",
  };
  // About 100 km east of Roissy at 230 m/s.
  const live = { icao24: "3944ef", callsign: "AFR1234 ", latitude: 49.01, longitude: 3.92, on_ground: false, velocity: 230 } as LiveAircraft;

  it("joins a scheduled arrival to its live aircraft and recomputes progress and ETA", () => {
    const { entries, matchedIcao24 } = mergeSchedule([base], [live], "arrival", cdg, now);
    const [entry] = entries;
    expect(matchedIcao24.has("3944ef")).toBe(true);
    expect(entry.live?.icao24).toBe("3944ef");
    expect(entry.delayMinutes).toBe(20);
    // 545 statute miles is 877 km; ~100 km remain, so about 89% flown.
    expect(entry.progress!).toBeGreaterThan(0.86);
    expect(entry.progress!).toBeLessThan(0.92);
    expect(entry.status).toMatch(/^En route · 8\d%$/);
    expect(Math.round((entry.liveEtaMs! - now) / 60_000)).toBeGreaterThan(5);
    const flight = scheduleEntryToFlight(entry)!;
    expect(flight.departure_airport).toBe("EDDB");
    expect(flight.route_source).toBe("flightaware");
    expect(flight.flightaware?.gate_dest).toBe("K45");
  });

  it("labels cancelled, delayed and not-yet-airborne flights without a live match", () => {
    const { entries } = mergeSchedule([
      { ...base, ident: "A", atc_ident: "A", ident_icao: "A", cancelled: true },
      { ...base, ident: "B", atc_ident: "B", ident_icao: "B", actual_off: null, estimated_in: "2026-10-09T09:00:00Z" },
      { ...base, ident: "C", atc_ident: "C", ident_icao: "C", actual_off: null, estimated_in: null },
    ], [], "arrival", cdg, now);
    const byIdent = Object.fromEntries(entries.map((entry) => [entry.flight.ident, entry]));
    expect(byIdent.A.status).toBe("Cancelled");
    expect(byIdent.B.status).toBe("Delayed 30 min");
    expect(byIdent.C.status).toBe("On time");
    expect(scheduleEntryToFlight(byIdent.C)).toBeNull();
    // Ordered by the expected time.
    expect(entries.map((entry) => entry.flight.ident)).toEqual(["C", "A", "B"]);
  });
});
