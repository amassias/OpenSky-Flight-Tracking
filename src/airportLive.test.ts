import { describe, expect, it } from "vitest";
import { boardRowToFlight, localTime, minutesUntil, sunTimes, utcOffsetLabel, visibilityText } from "./airportLive";
import type { Airport, BoardFlight } from "./types";

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
