import type {
  Airport,
  Bounds,
  FlightMode,
  FlightsResponse,
  HealthResponse,
  LiveFlightsResponse,
  TrackResponse,
} from "./types";

export class ApiError extends Error {
  constructor(
    message: string,
    public readonly status: number,
    public readonly details?: Record<string, unknown>,
  ) {
    super(message);
    this.name = "ApiError";
  }
}

async function request<T>(path: string, params?: Record<string, string | number | undefined>): Promise<T> {
  const url = new URL(path, window.location.origin);
  Object.entries(params ?? {}).forEach(([key, value]) => {
    if (value !== undefined && value !== "") url.searchParams.set(key, String(value));
  });

  const response = await fetch(url, { headers: { Accept: "application/json" } });
  let payload: unknown;
  try {
    payload = await response.json();
  } catch {
    throw new ApiError("The server returned an unreadable response.", response.status);
  }

  if (!response.ok) {
    const body = payload as { error?: string; details?: Record<string, unknown> };
    throw new ApiError(body.error || `Request failed (${response.status})`, response.status, body.details);
  }
  return payload as T;
}

export const api = {
  health: () => request<HealthResponse>("/api/health"),
  popularAirports: () => request<Airport[]>("/api/airports"),
  searchAirports: (query: string) => request<Airport[]>("/api/search-airports", { q: query, limit: 12 }),
  flights: (airport: string, date: string, mode: FlightMode) =>
    request<FlightsResponse>("/api/flights", { airport, date, mode }),
  liveFlights: (bounds: Bounds) => request<LiveFlightsResponse>("/api/live-flights", { ...bounds }),
  track: (icao24: string, time = 0) => request<TrackResponse>("/api/track", { icao24, time }),
};

export function readableApiError(error: unknown): string {
  if (!(error instanceof ApiError)) return "The service could not be reached. Check that the Python server is running.";
  if (error.status === 401) return "OpenSky credentials are missing or invalid. Add them to your local .env file.";
  if (error.status === 429) return "OpenSky's rate limit has been reached. Live data will resume when the quota resets.";
  if (error.status >= 500) return "OpenSky is temporarily unavailable. Your search is preserved so you can retry.";
  return error.message;
}
