import { describe, expect, it } from "vitest";
import { aircraftIconKind, callsignsForFlightNumber, flightNumberForCallsign } from "./utils";
import { aircraftManufacturer, aircraftModel, airlineBadge, airlineLogo } from "./aircraftIdentity";

describe("sourced airline and aircraft catalogue", () => {
  it("resolves reassigned codes to the current operator, in both directions", () => {
    for (const [iata, operator] of [["AZ", "ITY"], ["VF", "TKJ"], ["VJ", "VJC"], ["V7", "VOE"], ["QP", "AKJ"], ["JA", "JAT"], ["SN", "BEL"], ["VL", "LHX"]]) {
      expect(callsignsForFlightNumber(`${iata}123`)).toContain(`${operator.toLowerCase()}123`);
      expect(flightNumberForCallsign(`${operator}123`)).toBe(`${iata}123`);
      expect(airlineLogo({ callsign: `${operator}123` })).toContain(`${iata}.png`);
    }
    expect(airlineLogo({ callsign: "AZA123" })).toBeNull();
    expect(airlineLogo({ callsign: "VLU123" })).toBeNull();
  });
  it("replaces known wrong logos and keeps badges for placeholders or mismatches", () => {
    expect(airlineLogo({ callsign: "SWA123" })).toBe("/airline-logos/WN.png");
    expect(airlineLogo({ callsign: "CLX123" })).toBe("/airline-logos/CV.svg");
    expect(airlineLogo({ callsign: "TVS123" })).toBe("/airline-logos/QS.svg");
    for (const operator of ["UPS", "FDX", "ABR", "JDL"]) {
      expect(airlineLogo({ callsign: `${operator}123` })).toBeNull();
      expect(airlineBadge({ callsign: `${operator}123` })?.text).toBe(operator);
    }
    expect(airlineLogo({ callsign: "EJU123" })).toContain("U2.png");
  });
  it("resolves bundled ICAO logos without requiring an IATA code", () => {
    expect(airlineLogo({ callsign: "ADB123" })).toBe("/airline-logos/operators/ADB.png");
    expect(airlineLogo({ callsign: "", airline_code: "RCH" })).toBe("/airline-logos/operators/RCH.png");
    expect(airlineLogo({ callsign: "ZZZ123" })).toBeNull();
    expect(airlineLogo({ callsign: "AFR123" })).toContain("AF.png");
  });
  it("identifies sourced type families without confusing business jets with regional airliners", () => {
    expect(aircraftModel("pc24")).toBe("Pilatus PC-24");
    expect(aircraftModel("GL7T")).toBe("Bombardier Global 7500 / 8000");
    expect(aircraftManufacturer(aircraftModel("FA8X"))).toBe("Dassault");
    expect(aircraftManufacturer(aircraftModel("C919"))).toBe("COMAC");
    for (const type of ["PC24", "C25M", "C700", "FA8X", "GL7T"]) expect(aircraftIconKind({ aircraft_type: type })).toBe("small");
    for (const type of ["H160", "EC45", "B429"]) expect(aircraftIconKind({ aircraft_type: type })).toBe("helicopter");
    expect(aircraftIconKind({ aircraft_type: "TBM9" })).toBe("turboprop");
    expect(aircraftIconKind({ aircraft_type: "C919" })).toBe("airliner");
    expect(aircraftModel("ZZZZ")).toBeNull();
  });
});
