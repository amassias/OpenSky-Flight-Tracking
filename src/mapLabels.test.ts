import { describe, expect, it } from "vitest";
import { labelLevelForZoom, placeLabels } from "./mapLabels";
import { aircraftIconKind } from "./utils";
import { airlineBadge, airlineLogo, operatorCode } from "./aircraftIdentity";

describe("map detail levels", () => {
  it("reveals callsign, operator and telemetry at the agreed zoom levels", () => {
    expect([6, 7, 8, 9, 10, 11, 12, 18].map(labelLevelForZoom)).toEqual([0, 0, 1, 1, 2, 2, 3, 3]);
  });
  it("keeps the selection and rejects overlapping labels across grid boundaries", () => {
    const candidates = [
      { id: "a", x: 155, y: 40, width: 100, height: 30 },
      { id: "b", x: 165, y: 48, width: 100, height: 30 },
      { id: "c", x: 300, y: 40, width: 100, height: 30 },
    ];
    expect([...placeLabels(candidates, "b")]).toEqual(["b", "c"]);
    expect([...placeLabels(candidates.reverse(), "b")]).toEqual(["b", "c"]);
  });
  it("uses specific aircraft types ahead of broad weight categories", () => {
    expect(aircraftIconKind({ aircraft_type: "AT76", category: 3 })).toBe("turboprop");
    expect(aircraftIconKind({ aircraft_type: "E190", category: 3 })).toBe("regional");
    expect(aircraftIconKind({ aircraft_type: "A359", category: 3 })).toBe("heavy");
    expect(aircraftIconKind({ aircraft_type: "A320" })).toBe("airliner");
    expect(aircraftIconKind({ aircraft_type: "C172" })).toBe("small");
    expect(aircraftIconKind({ aircraft_type: "H125" })).toBe("helicopter");
    expect(aircraftIconKind({ aircraft_category: "B1" })).toBe("glider");
    expect(aircraftIconKind({ aircraft_type: "ZZZZ" })).toBe("unknown");
  });
  it("prefers the operating callsign and omits unknown logos", () => {
    expect(operatorCode({ callsign: "EJU123", airline_code: "AFR" })).toBe("EJU");
    expect(airlineLogo({ callsign: "EJU123" })).toContain("U2.png");
    expect(airlineLogo({ callsign: "WZZ123" })).toContain("W6.png");
    expect(airlineLogo({ callsign: "TRA123" })).toContain("HV.png");
    expect(airlineLogo({ callsign: "AXM123" })).toContain("AK.png");
    expect(airlineLogo({ callsign: "IGO123" })).toContain("6E.png");
    expect(airlineLogo({ callsign: "ASL123" })).toContain("JU.png");
    expect(airlineLogo({ callsign: "APG123" })).toContain("Z2.png");
    expect(airlineLogo({ callsign: "CQH123" })).toContain("9C.png");
    expect(airlineLogo({ callsign: "JAT123" })).toContain("JA.png");
    expect(airlineLogo({ callsign: "EZD123" })).toBeNull();
    expect(airlineLogo({ callsign: "N12345" })).toBeNull();
  });
  it("falls back to a stable operator badge when there is no logo", () => {
    expect(airlineBadge({ callsign: "GEC123" })?.text).toBe("GEC");
    expect(airlineBadge({ callsign: "GEC123" })).toEqual(airlineBadge({ callsign: "GEC999" }));
    expect(airlineBadge({ callsign: "GEC123" })?.color).not.toBe(airlineBadge({ callsign: "WZZ123" })?.color);
    expect(airlineBadge({ callsign: "N12345" })).toBeNull();
  });
});
