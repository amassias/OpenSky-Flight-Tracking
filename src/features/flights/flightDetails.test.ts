import { describe, expect, it } from "vitest";
import { mergeFlightDetails } from "./flightDetails";
import type { Flight, FlightInfoResponse } from "../../shared/types";

const live = { icao24: "398604", callsign: "AFR28VV", registration: "F-HBQE", aircraft_type: "E190", primary_time: 0, data_source: "live-nearby", status: "airborne" } as Flight;
const info = (extra: Partial<FlightInfoResponse>) => ({ success: true, icao24: "398604", ...extra }) as FlightInfoResponse;

describe("mergeFlightDetails", () => {
  it("returns null without a selection", () => {
    expect(mergeFlightDetails({ selectedFlight: null, liveSelected: null, route: undefined, flightInfo: undefined })).toBeNull();
  });

  it("returns a scheduled flight untouched", () => {
    const scheduled = { ...live, data_source: "scheduled" } as Flight;
    expect(mergeFlightDetails({ selectedFlight: scheduled, liveSelected: null, route: undefined, flightInfo: info({ registration: "F-XXXX" }) })).toEqual(scheduled);
  });

  it("keeps the transponder registration over FlightAware's scheduled tail", () => {
    const merged = mergeFlightDetails({ selectedFlight: live, liveSelected: null, route: undefined, flightInfo: info({ registration: "F-HBQD", registration_source: "schedule" }) });
    expect(merged?.registration).toBe("F-HBQE");
    expect(merged?.registration_source).toBe("adsb");
  });

  it("takes the profile registration when it comes from the transponder", () => {
    const merged = mergeFlightDetails({ selectedFlight: { ...live, registration: null }, liveSelected: null, route: undefined, flightInfo: info({ registration: "F-HBQE", registration_source: "adsb" }) });
    expect(merged?.registration).toBe("F-HBQE");
  });

  it("ignores flight-info that belongs to another aircraft", () => {
    const merged = mergeFlightDetails({ selectedFlight: live, liveSelected: null, route: undefined, flightInfo: info({ icao24: "aaaaaa", registration: "N1" }) });
    expect(merged?.registration).toBe("F-HBQE");
  });
});
