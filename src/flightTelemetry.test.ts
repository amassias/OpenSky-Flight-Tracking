import { expect, it } from "vitest";
import { positionObservation, sameLiveFlight, withLiveKinematics } from "./flightTelemetry";
import type { Flight, LiveAircraft } from "./types";
const flight: Flight = {icao24:"abc123",callsign:"BAW52T",data_source:"live-nearby",latitude:49,longitude:2,time_position:1000,emergency:"general",squawk:"7700"};
it("recognizes a new callsign as another flight of the same airframe",()=>{
  const live={icao24:"abc123",callsign:"BAW999",latitude:50,longitude:3} as LiveAircraft;
  expect(sameLiveFlight(flight,live)).toBe(false);
  expect(withLiveKinematics(flight,live)).toBe(flight);
});
it("replaces a previous emergency with the latest normal signal",()=>{
  const live={icao24:"abc123",callsign:"BAW52T",emergency:"none",squawk:"2021",time_position:1010} as LiveAircraft;
  expect(withLiveKinematics(flight,live)).toMatchObject({emergency:"none",squawk:"2021",time_position:1010});
});
it("shows when a position expires and never calls a future timestamp recent",()=>{
  expect(positionObservation(flight,1050)).toMatchObject({state:"recent",age:50});
  expect(positionObservation(flight,1091)).toMatchObject({state:"delayed",age:91});
  expect(positionObservation({...flight,time_position:2000},1000)).toEqual({state:"unknown"});
});
it("does not describe scheduled or recorded positions as current",()=>{
  expect(positionObservation({...flight,data_source:"scheduled"},2000)).toBeNull();
  expect(positionObservation({...flight,data_source:"opensky"},2000)).toBeNull();
});

it("does not reuse today's aircraft position for a recorded or scheduled episode",()=>{
  const live={icao24:"abc123",callsign:"BAW52T",latitude:50,longitude:3} as LiveAircraft;
  expect(sameLiveFlight({...flight,data_source:"opensky",primary_time:1000},live)).toBe(false);
  expect(withLiveKinematics({...flight,data_source:"scheduled"},live).latitude).toBe(49);
});
it("does not carry a previous priority state across a new squawk observation",()=>{
  const live={icao24:"abc123",callsign:"BAW52T",squawk:"2021",time_position:1010} as LiveAircraft;
  expect(withLiveKinematics(flight,live).emergency).toBeNull();
});
