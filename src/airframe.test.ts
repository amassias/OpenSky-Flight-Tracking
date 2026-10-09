import { describe, expect, it } from "vitest";
import { airframeAge, describePeriod, distinctOwners, entryTitle, formatHistoryDate, registrationsOf } from "./airframe";
import type { AirframeEntry } from "./types";

const entry = (overrides: Partial<AirframeEntry>): AirframeEntry => ({
  source: "opensky", icao24: "3986e0", registration: "F-HBXA", from: "2020-11", to: "2021-06", precision: "month",
  owner: null, operator: null, private: false, current: false, ...overrides,
});

describe("airframe history helpers", () => {
  it("formats month and day dates", () => {
    expect(formatHistoryDate("2021-06")).toBe("Jun 2021");
    expect(formatHistoryDate("2022-08-09")).toBe("9 Aug 2022");
    expect(formatHistoryDate(null)).toBeNull();
    expect(formatHistoryDate("garbage")).toBeNull();
  });

  it("words periods by how precisely they are known", () => {
    expect(describePeriod(entry({}))).toBe("Seen Nov 2020 – Jun 2021");
    expect(describePeriod(entry({ to: "2020-11" }))).toBe("Seen in Nov 2020");
    expect(describePeriod(entry({ to: null }), "2025-08")).toBe("Seen Nov 2020 – Aug 2025");
    expect(describePeriod(entry({ source: "faa", from: "2022-08-09", to: null, precision: "day" }))).toBe("Since 9 Aug 2022");
    expect(describePeriod(entry({ source: "faa", from: "2019-12-10", to: "2021-03-02", precision: "day" }))).toBe("10 Dec 2019 – 2 Mar 2021");
    expect(describePeriod(entry({ source: "faa", from: null, to: null }))).toBe("Dates not published");
  });

  it("titles an entry with the owner, the operator or an honest fallback", () => {
    expect(entryTitle(entry({ owner: "Air France HOP", operator: "Hop!" }))).toBe("Air France HOP");
    expect(entryTitle(entry({ operator: "Hop!" }))).toBe("Hop!");
    expect(entryTitle(entry({ private: true }))).toBe("Private owner");
    expect(entryTitle(entry({}))).toBe("Owner not listed");
  });

  it("summarises registrations, owners and age", () => {
    const entries = [entry({ registration: "N192NV", owner: "Allegiant Air LLC", operator: "Allegiant Air" }), entry({ owner: "Virgin America" }), entry({ owner: "virgin america" })];
    expect(registrationsOf(entries)).toEqual(["N192NV", "F-HBXA"]);
    expect(distinctOwners(entries)).toEqual(["Allegiant Air LLC", "Allegiant Air", "Virgin America"]);
    expect(airframeAge("2015", new Date(Date.UTC(2026, 9, 9)))).toBe(11);
    expect(airframeAge("1800")).toBeNull();
    expect(airframeAge(undefined)).toBeNull();
  });
});
