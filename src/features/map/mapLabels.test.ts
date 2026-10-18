import { describe, expect, it } from "vitest";
import { focusLabels, labelLevelForZoom, placeLabels } from "./mapLabels";
import { aircraftIconKind } from "../../shared/utils";
import { airlineBadge, airlineLogo, operatorCode } from "../../shared/aircraftIdentity";

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

describe("focus labels", () => {
  const at = (id: string, latitude: number, longitude: number, squawk: string | null = null) => ({ icao24: id, latitude, longitude, squawk });
  const base = { center: { lat: 48, lng: 5 }, zoom: 10, selectedId: null as string | null, followedId: null as string | null, inView: () => true };
  const crowd = Array.from({ length: 100 }, (_, i) => at(`c${String(i).padStart(3, "0")}`, 48 + i * 0.01, 5));

  it("labels only the 15 aircraft nearest the centre once zoomed in enough", () => {
    const ids = focusLabels({ ...base, aircraft: crowd }).map(item => item.id);
    expect(ids).toEqual(crowd.slice(0, 15).map(item => item.icao24));
  });
  it("labels no nearby aircraft below the zoom threshold", () => {
    expect(focusLabels({ ...base, aircraft: crowd, zoom: 5 })).toEqual([]);
  });
  it("always labels the selected aircraft, the followed one and emergency squawks, at any zoom", () => {
    const aircraft = [...crowd, at("sel", 60, 20), at("fol", -30, 100), at("sos", 10, 10, "7700"), at("hij", 11, 11, "7500"), at("com", 12, 12, "7600"), at("ok", 13, 13, "1200")];
    const result = focusLabels({ ...base, aircraft, zoom: 3, selectedId: "sel", followedId: "fol" });
    expect(result.map(item => [item.id, item.reason])).toEqual([["sel", "selected"], ["fol", "followed"], ["com", "emergency"], ["hij", "emergency"], ["sos", "emergency"]]);
  });
  it("does not count the selected or emergency aircraft against the 15 nearest", () => {
    const aircraft = [...crowd, at("sos", 48, 5.001, "7700")];
    const ids = focusLabels({ ...base, aircraft, selectedId: "c000" }).map(item => item.id);
    expect(ids).toHaveLength(15 + 2);
    expect(ids.slice(0, 2)).toEqual(["c000", "sos"]);
  });
  it("skips nearby aircraft that are outside the view", () => {
    const ids = focusLabels({ ...base, aircraft: crowd, inView: item => item.icao24 !== "c000" }).map(item => item.id);
    expect(ids).not.toContain("c000");
    expect(ids).toHaveLength(15);
  });
  it("lets the selected label win a collision, then the higher priority", () => {
    const box = { x: 100, y: 100, width: 100, height: 30 };
    expect([...placeLabels([{ id: "aaa", ...box, priority: 1 }, { id: "sel", ...box, priority: 0 }, { id: "bbb", ...box, priority: 2 }], "sel")]).toEqual(["sel"]);
    expect([...placeLabels([{ id: "aaa", ...box, priority: 1 }, { id: "bbb", ...box, priority: 2 }], null)]).toEqual(["bbb"]);
  });
});
