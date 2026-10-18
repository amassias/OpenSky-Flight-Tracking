import { sameLiveFlight, withLiveKinematics } from "./flightTelemetry";
import type { Flight, FlightInfoResponse, LiveAircraft, FlightRouteResponse } from "../../shared/types";

interface FlightDetailsSources {
  selectedFlight: Flight | null;
  liveSelected: LiveAircraft | null;
  route: FlightRouteResponse | undefined;
  flightInfo: FlightInfoResponse | undefined;
}

/**
 * Merges what we know about the selected flight, most to least reliable: the live
 * feed, the transponder profile from flight-info, then the callsign route.
 * Pure on purpose: every source-ranking rule (see CONTEXT.md "Scheduled tail") is testable here.
 */
export function mergeFlightDetails({ selectedFlight, liveSelected, route, flightInfo }: FlightDetailsSources): Flight | null {
  if (!selectedFlight) return null;
  const base = liveSelected ? withLiveKinematics(selectedFlight, liveSelected) : selectedFlight;
  const fastRoute = route?.callsign?.toUpperCase() === selectedFlight.callsign.toUpperCase() && route.route_source === "callsign" ? route : null;
  const current = fastRoute && !selectedFlight.primary_time && (!base.route_source || base.route_source === "unknown" || base.route_source === "callsign")
    ? { ...base, ...fastRoute, icao24: base.icao24, callsign: base.callsign } as Flight : base;
  if (selectedFlight.data_source === "scheduled" || !flightInfo || flightInfo.icao24 !== selectedFlight.icao24) return current;
  const info = flightInfo;
  const historical = selectedFlight.data_source !== "live-nearby" && (selectedFlight.primary_time ?? selectedFlight.first_seen ?? 0) > 0;
  const routeInfo = historical ? current : info;
  const profileMatches = sameLiveFlight(current, info.live_state ?? info);
  const telemetry = historical ? current : liveSelected ?? (!profileMatches ? current : ((current.last_contact ?? -Infinity) > (info.last_contact ?? -Infinity) ? current : info));
  const enriched = !historical && profileMatches && !liveSelected && info.live_state && (info.time_position ?? 0) > (current.time_position ?? 0) ? withLiveKinematics(current, info.live_state) : current;
  // Airframe identity, most to least reliable: the transponder profile from
  // flight-info, then the transponder registration the live feed already
  // gave us, and only then FlightAware's tail, which is the aircraft
  // *scheduled* on this flight number and differs after an aircraft swap.
  const scheduledOnly = info.registration_source === "schedule";
  const liveAirframe = scheduledOnly && Boolean(current.registration);
  return {
    ...enriched,
    callsign: current.callsign && current.callsign !== current.registration && current.callsign.toLowerCase() !== current.icao24 ? current.callsign : info.callsign || current.callsign,
    airline_code: info.airline_code || current.airline_code,
    airline_name: info.airline_name || current.airline_name,
    departure_airport: routeInfo.departure_airport ?? current.departure_airport,
    departure_airport_name: routeInfo.departure_airport_name ?? current.departure_airport_name,
    arrival_airport: routeInfo.arrival_airport ?? current.arrival_airport,
    arrival_airport_name: routeInfo.arrival_airport_name ?? current.arrival_airport_name,
    first_seen: routeInfo.first_seen ?? current.first_seen,
    last_seen: routeInfo.last_seen ?? current.last_seen,
    departure_latitude: routeInfo.departure_latitude ?? (routeInfo.departure_airport && routeInfo.departure_airport !== current.departure_airport ? null : current.departure_latitude),
    departure_longitude: routeInfo.departure_longitude ?? (routeInfo.departure_airport && routeInfo.departure_airport !== current.departure_airport ? null : current.departure_longitude),
    arrival_latitude: routeInfo.arrival_latitude ?? (routeInfo.arrival_airport && routeInfo.arrival_airport !== current.arrival_airport ? null : current.arrival_latitude),
    arrival_longitude: routeInfo.arrival_longitude ?? (routeInfo.arrival_airport && routeInfo.arrival_airport !== current.arrival_airport ? null : current.arrival_longitude),
    route_source: routeInfo.route_source && routeInfo.route_source !== "unknown" ? routeInfo.route_source : current.route_source,
    route_provider: routeInfo.route_provider ?? current.route_provider,
    registration: liveAirframe ? current.registration : info.registration ?? current.registration,
    registration_source: liveAirframe ? "adsb" : info.registration ? info.registration_source : current.registration_source,
    aircraft_type: (scheduledOnly ? current.aircraft_type : null) ?? info.aircraft_type ?? current.aircraft_type,
    aircraft_description: info.aircraft_description ?? current.aircraft_description,
    aircraft_owner: info.aircraft_owner ?? current.aircraft_owner,
    aircraft_year: info.aircraft_year ?? current.aircraft_year,
    aircraft_category: info.aircraft_category ?? current.aircraft_category,
    emergency: telemetry.emergency ?? (telemetry.squawk && telemetry.squawk !== current.squawk ? null : current.emergency),
    nav_qnh: telemetry.nav_qnh ?? current.nav_qnh,
    nav_altitude_mcp: telemetry.nav_altitude_mcp ?? current.nav_altitude_mcp,
    nav_heading: telemetry.nav_heading ?? current.nav_heading,
    nav_modes: telemetry.nav_modes ?? current.nav_modes,
    messages: telemetry.messages ?? current.messages,
    rssi: telemetry.rssi ?? current.rssi,
    seen_seconds: telemetry.seen_seconds ?? current.seen_seconds,
    seen_position_seconds: telemetry.seen_position_seconds ?? current.seen_position_seconds,
    nic: telemetry.nic ?? current.nic,
    rc: telemetry.rc ?? current.rc,
    nac_p: telemetry.nac_p ?? current.nac_p,
    nac_v: telemetry.nac_v ?? current.nac_v,
    sil: telemetry.sil ?? current.sil,
    sil_type: telemetry.sil_type ?? current.sil_type,
    source: telemetry.source ?? current.source,
    squawk: telemetry.squawk ?? current.squawk,
    category: info.category ?? current.category,
    last_contact: telemetry.last_contact ?? current.last_contact,
    time_position: telemetry.time_position ?? current.time_position,
    flightaware: routeInfo.flightaware ?? current.flightaware,
  };

}
