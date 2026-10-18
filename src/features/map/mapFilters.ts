import type { Flight } from "../../shared/types";
import { callsignsForFlightNumber, emergencyInfo } from "../../shared/utils";

export interface MapFilters {
  /** Hide aircraft reported on the ground. */
  hideGround: boolean;
  /** Altitude window in feet; null bounds are open. */
  minAltitudeFt: number | null;
  maxAltitudeFt: number | null;
  /** Free text matched against callsign, airline, registration and type. */
  query: string;
}

export const NO_FILTERS: MapFilters = { hideGround: false, minAltitudeFt: null, maxAltitudeFt: null, query: "" };

export const ALTITUDE_FILTER_MAX_FT = 45_000;

export function activeFilterCount(filters: MapFilters): number {
  return Number(filters.hideGround)
    + Number(filters.minAltitudeFt != null || filters.maxAltitudeFt != null)
    + Number(filters.query.trim() !== "");
}

interface CompiledQuery {
  terms: string[];
  /** Callsign forms of each term when it is a ticket flight number. */
  flightNumbers: string[][];
}

function compileQuery(query: string): CompiledQuery {
  const terms = query.trim().toLowerCase().split(/\s+/).filter(Boolean);
  return { terms, flightNumbers: terms.map(callsignsForFlightNumber) };
}

export function matchesFilters(aircraft: Flight, filters: MapFilters, query: CompiledQuery = compileQuery(filters.query)): boolean {
  // A declared emergency is never filtered out of sight.
  if (emergencyInfo(aircraft)) return true;
  if (filters.hideGround && aircraft.on_ground) return false;
  if (filters.minAltitudeFt != null || filters.maxAltitudeFt != null) {
    const meters = aircraft.baro_altitude ?? aircraft.geo_altitude;
    // Without a reported altitude the aircraft cannot be placed in a band.
    if (meters == null) return false;
    const feet = meters * 3.28084;
    if (filters.minAltitudeFt != null && feet < filters.minAltitudeFt) return false;
    if (filters.maxAltitudeFt != null && feet > filters.maxAltitudeFt) return false;
  }
  const { terms, flightNumbers } = query;
  if (terms.length) {
    const haystack = [aircraft.callsign, aircraft.airline_name, aircraft.airline_code, aircraft.registration, aircraft.aircraft_type, aircraft.aircraft_description, aircraft.icao24]
      .filter(Boolean).join(" ").toLowerCase();
    const callsign = (aircraft.callsign || "").toLowerCase();
    if (!terms.every((term, index) => haystack.includes(term) || flightNumbers[index].some((form) => callsign.startsWith(form)))) return false;
  }
  return true;
}

export function filterAircraft<T extends Flight>(aircraft: readonly T[], filters: MapFilters): readonly T[] {
  if (activeFilterCount(filters) === 0) return aircraft;
  // Parsed once per pass, not once per aircraft: a wide view holds thousands.
  const query = compileQuery(filters.query);
  return aircraft.filter((item) => matchesFilters(item, filters, query));
}
