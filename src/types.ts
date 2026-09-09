export type FlightMode = "departure" | "arrival";
export type FlightStatus = "airborne" | "on_ground" | "completed" | "unknown";
export type MapTheme = "dark" | "light";

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
  status?: FlightStatus;
  origin_country?: string | null;
  data_source?: "opensky" | "live-nearby";
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
  last_contact?: number;
  time_position?: number;
  squawk?: string;
  category?: number;
}

export interface LiveFlightsResponse {
  success: boolean;
  time: number | null;
  time_iso: string | null;
  count: number;
  states: LiveAircraft[];
  degraded?: boolean;
  notice?: string;
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
