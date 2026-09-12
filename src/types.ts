export type FlightMode = "departure" | "arrival";
export type FlightStatus = "airborne" | "on_ground" | "completed" | "unknown";
export type MapTheme = "dark" | "light";
export type RouteSource = "opensky" | "callsign" | "flightaware" | "mixed" | "unknown";

export interface FlightAwareAirport {
  code_icao?: string | null;
  code_iata?: string | null;
  code?: string | null;
  name?: string | null;
  city?: string | null;
  latitude?: number | null;
  longitude?: number | null;
  timezone?: string | null;
}

export interface FlightAwareDetails {
  provider: "FlightAware" | string;
  queried_ident?: string | null;
  fa_flight_id?: string | null;
  ident?: string | null;
  atc_ident?: string | null;
  status?: string | null;
  airline_code?: string | null;
  airline_name?: string | null;
  origin?: FlightAwareAirport | null;
  destination?: FlightAwareAirport | null;
  route?: string | null;
  aircraft_type?: string | null;
  registration?: string | null;
  progress_percent?: number | null;
  departure_delay?: number | null;
  arrival_delay?: number | null;
  cancelled?: boolean | null;
  diverted?: boolean | null;
  position_only?: boolean | null;
  foresight_predictions_available?: boolean | null;
  scheduled_out?: string | null;
  estimated_out?: string | null;
  actual_out?: string | null;
  scheduled_off?: string | null;
  estimated_off?: string | null;
  actual_off?: string | null;
  scheduled_on?: string | null;
  estimated_on?: string | null;
  actual_on?: string | null;
  scheduled_in?: string | null;
  estimated_in?: string | null;
  actual_in?: string | null;
  gate_orig?: string | null;
  gate_dest?: string | null;
  terminal_orig?: string | null;
  terminal_dest?: string | null;
  filed_ete?: number | null;
  filed_airspeed?: number | null;
  filed_altitude?: number | null;
}

export interface Airport {
  icao: string;
  iata: string;
  name: string;
  display_name: string;
  country: string;
  region: string;
  latitude: number | null;
  longitude: number | null;
}

export interface HealthResponse {
  success: boolean;
  airports_loaded: number;
  credentials_configured: boolean;
  flightaware_configured?: boolean;
  live_available?: boolean;
  server_time_utc: string;
}

export interface Flight {
  icao24: string;
  callsign: string;
  airline_code?: string;
  airline_name?: string;
  departure_airport?: string | null;
  departure_airport_name?: string | null;
  arrival_airport?: string | null;
  arrival_airport_name?: string | null;
  first_seen?: number | null;
  last_seen?: number | null;
  primary_time?: number | null;
  latitude?: number | null;
  longitude?: number | null;
  baro_altitude?: number | null;
  geo_altitude?: number | null;
  velocity?: number | null;
  true_track?: number | null;
  vertical_rate?: number | null;
  on_ground?: boolean | null;
  squawk?: string | null;
  category?: number | null;
  last_contact?: number | null;
  time_position?: number | null;
  status?: FlightStatus;
  origin_country?: string | null;
  data_source?: "opensky" | "live-nearby";
  route_source?: RouteSource;
  route_provider?: string | null;
  registration?: string | null;
  aircraft_type?: string | null;
  aircraft_description?: string | null;
  aircraft_owner?: string | null;
  aircraft_year?: string | number | null;
  aircraft_category?: string | number | null;
  emergency?: string | null;
  nav_qnh?: number | null;
  nav_altitude_mcp?: number | null;
  nav_heading?: number | null;
  nav_modes?: string[] | null;
  messages?: number | null;
  rssi?: number | null;
  seen_seconds?: number | null;
  seen_position_seconds?: number | null;
  nic?: number | null;
  rc?: number | null;
  nac_p?: number | null;
  nac_v?: number | null;
  sil?: number | null;
  sil_type?: string | null;
  source?: string | null;
  flightaware?: FlightAwareDetails | null;
}

export interface FlightsResponse {
  success: boolean;
  airport: string;
  airport_meta: Airport;
  airport_name: string;
  mode: FlightMode;
  date: string;
  date_basis: "UTC";
  count: number;
  summary: {
    total: number;
    live_airborne: number;
    live_on_ground: number;
    unique_airlines: number;
  };
  flights: Flight[];
  generated_at: string;
  source?: "opensky" | "live-nearby" | "unavailable";
  notice?: string;
}

export interface LiveAircraft extends Flight {
  origin_country?: string;
}

export interface LiveFlightsResponse {
  success: boolean;
  time: number | null;
  time_iso: string | null;
  count: number;
  states: LiveAircraft[];
  degraded?: boolean;
  notice?: string;
  provider?: "opensky" | "adsb.lol" | "airplanes.live" | string;
  credit_cost?: number;
  refresh_after_seconds?: number;
  coverage_tiles?: number;
  coverage_complete?: boolean;
}

export interface FlightInfoResponse {
  success: boolean;
  icao24: string;
  callsign: string;
  airline_code?: string;
  airline_name?: string;
  departure_airport?: string | null;
  departure_airport_name?: string | null;
  arrival_airport?: string | null;
  arrival_airport_name?: string | null;
  first_seen?: number | null;
  last_seen?: number | null;
  first_seen_iso?: string | null;
  last_seen_iso?: string | null;
  route_source?: RouteSource;
  route_provider?: string | null;
  live_state?: LiveAircraft | null;
  latitude?: number | null;
  longitude?: number | null;
  baro_altitude?: number | null;
  geo_altitude?: number | null;
  velocity?: number | null;
  true_track?: number | null;
  vertical_rate?: number | null;
  on_ground?: boolean | null;
  status?: FlightStatus;
  squawk?: string | null;
  category?: number | null;
  last_contact?: number | null;
  time_position?: number | null;
  registration?: string | null;
  aircraft_type?: string | null;
  aircraft_description?: string | null;
  aircraft_owner?: string | null;
  aircraft_year?: string | number | null;
  aircraft_category?: string | number | null;
  emergency?: string | null;
  nav_qnh?: number | null;
  nav_altitude_mcp?: number | null;
  nav_heading?: number | null;
  nav_modes?: string[] | null;
  messages?: number | null;
  rssi?: number | null;
  seen_seconds?: number | null;
  seen_position_seconds?: number | null;
  nic?: number | null;
  rc?: number | null;
  nac_p?: number | null;
  nac_v?: number | null;
  sil?: number | null;
  sil_type?: string | null;
  source?: string | null;
  flightaware?: FlightAwareDetails | null;
}

export type TrackPoint = [number, number, number, number | null, number | null, boolean | null];

export interface TrackResponse {
  success: boolean;
  track: {
    icao24?: string;
    callsign?: string;
    startTime?: number;
    endTime?: number;
    path?: TrackPoint[];
    trace_kind?: "full" | "recent" | string;
  };
  path_count: number;
  message?: string;
  resolved_time?: number;
  summary?: {
    path_count: number;
    start_time?: number;
    end_time?: number;
    duration_seconds?: number | null;
    max_altitude_m?: number | null;
    min_altitude_m?: number | null;
  };
}

export interface Bounds {
  lamin: number;
  lomin: number;
  lamax: number;
  lomax: number;
}
