import type {
  Airport,
  AirportBoardResponse,
  AirportConditionsResponse,
  AirportScheduleResponse,
  Bounds,
  FlightMode,
  FlightInfoResponse,
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

async function request<T>(path: string, params?: Record<string, string | number | undefined>, signal?: AbortSignal): Promise<T> {
  const url = new URL(path, window.location.origin);
  Object.entries(params ?? {}).forEach(([key, value]) => {
    if (value !== undefined && value !== "") url.searchParams.set(key, String(value));
  });

  const response = await fetch(url, { signal, headers: { Accept: "application/json" } });
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

const LIVE_REQUEST_MIN_INTERVAL_MS = window.location.hostname === "localhost" || window.location.hostname === "127.0.0.1" ? 25 : 1_200;
let nextLiveRequestAt = 0;
let liveRequestSlotQueue = Promise.resolve();

function waitWithAbort(delayMs: number, signal?: AbortSignal): Promise<void> {
  if (signal?.aborted) return Promise.reject(new DOMException("The request was aborted.", "AbortError"));
  if (delayMs <= 0) return Promise.resolve();
  return new Promise((resolve, reject) => {
    const cleanup = () => signal?.removeEventListener("abort", abort);
    const complete = () => {
      cleanup();
      resolve();
    };
    const abort = () => {
      window.clearTimeout(timer);
      cleanup();
      reject(new DOMException("The request was aborted.", "AbortError"));
    };
    const timer = window.setTimeout(complete, delayMs);
    signal?.addEventListener("abort", abort, { once: true });
  });
}

async function reserveLiveRequestSlot(signal?: AbortSignal): Promise<void> {
  const previous = liveRequestSlotQueue;
  let release: () => void = () => undefined;
  liveRequestSlotQueue = new Promise<void>((resolve) => { release = resolve; });
  await previous;
  try {
    await waitWithAbort(Math.max(0, nextLiveRequestAt - Date.now()), signal);
    nextLiveRequestAt = Date.now() + LIVE_REQUEST_MIN_INTERVAL_MS;
  } finally {
    release();
  }
}

export const api = {
  health: (signal?: AbortSignal) => request<HealthResponse>("/api/health", undefined, signal),
  mapAirports: (signal?: AbortSignal) => request<Airport[]>("/api/map-airports", undefined, signal),
  popularAirports: (signal?: AbortSignal) => request<Airport[]>("/api/airports", undefined, signal),
  searchAirports: (query: string, signal?: AbortSignal) => request<Airport[]>("/api/search-airports", { q: query, limit: 12 }, signal),
  flights: (airport: string, date: string, mode: FlightMode, signal?: AbortSignal) =>
    request<FlightsResponse>("/api/flights", { airport, date, mode }, signal),
  airportConditions: (airport: string, signal?: AbortSignal) => request<AirportConditionsResponse>("/api/airport-conditions", { airport }, signal),
  airportSchedule: (airport: string, direction: FlightMode, signal?: AbortSignal) =>
    request<AirportScheduleResponse>("/api/airport-schedule", { airport, direction }, signal),
  airportBoard: (airport: string, signal?: AbortSignal) => request<AirportBoardResponse>("/api/airport-board", { airport }, signal),
  liveFlights: async (bounds: Bounds, signal?: AbortSignal, fallbackOnly = false) => {
    // Zoom and pan can emit several different boxes in quick succession. A
    // small client-side spacing keeps those changes responsive while avoiding
    // a provider rate-limit burst; obsolete queries are still cancelled by
    // TanStack Query through the same signal.
    await reserveLiveRequestSlot(signal);
    return request<LiveFlightsResponse>("/api/live-flights", { ...bounds, fallback: fallbackOnly ? 1 : undefined }, signal);
  },
  flightInfo: (icao24: string, callsign?: string, signal?: AbortSignal) => request<FlightInfoResponse>("/api/flight-info", { icao24, callsign }, signal),
  track: (icao24: string, time = 0, signal?: AbortSignal) => request<TrackResponse>("/api/track", { icao24, time }, signal),
};

export interface AircraftPhoto {
  src: string;
  width: number;
  height: number;
  link: string;
  photographer: string;
}

// Planespotters.net public photo API. Its terms require the browser to call it
// directly (no proxy or re-exposure through our API), JSON cached for at most
// 24 hours, image URLs used unchanged, and a visible photographer credit plus
// a plain link back to the photo page wherever the image is shown.
const PHOTO_API = "https://api.planespotters.net/pub/photos";
const PHOTO_CACHE_MS = 24 * 60 * 60 * 1000;
const photoCache = new Map<string, { expiresAt: number; photo: AircraftPhoto | null }>();

interface PlanespottersResponse {
  photos?: Array<{
    thumbnail?: { src?: string; size?: { width?: number; height?: number } };
    thumbnail_large?: { src?: string; size?: { width?: number; height?: number } };
    link?: string;
    photographer?: string;
  }>;
  error?: string;
}

function isHttpsUrl(value: unknown): value is string {
  if (typeof value !== "string") return false;
  try {
    return new URL(value).protocol === "https:";
  } catch {
    return false;
  }
}

async function fetchAircraftPhoto(kind: "hex" | "reg", id: string, signal?: AbortSignal): Promise<AircraftPhoto | null> {
  const key = `${kind}:${id}`;
  const cached = photoCache.get(key);
  if (cached && cached.expiresAt > Date.now()) return cached.photo;

  const response = await fetch(`${PHOTO_API}/${kind}/${encodeURIComponent(id)}`, { signal, headers: { Accept: "application/json" } });
  const payload = await response.json().catch(() => ({})) as PlanespottersResponse;
  if (!response.ok || payload.error) throw new ApiError(payload.error || `Photo lookup failed (${response.status})`, response.status);

  const first = payload.photos?.[0];
  const image = first?.thumbnail_large ?? first?.thumbnail;
  // Only accept real https links: the image and its link are rendered as-is.
  const photo = first && image && isHttpsUrl(image.src) && isHttpsUrl(first.link)
    ? {
      src: image.src,
      width: image.size?.width ?? 420,
      height: image.size?.height ?? 280,
      link: first.link,
      photographer: first.photographer?.trim() || "Unknown photographer",
    }
    : null;
  photoCache.set(key, { expiresAt: Date.now() + PHOTO_CACHE_MS, photo });
  return photo;
}

/** Latest photo of this airframe: by Mode S hex first, then by registration. */
export async function aircraftPhoto(icao24: string, registration?: string | null, signal?: AbortSignal): Promise<AircraftPhoto | null> {
  const byHex = await fetchAircraftPhoto("hex", icao24.trim().toLowerCase(), signal);
  const reg = registration?.trim().toUpperCase();
  if (byHex || !reg) return byHex;
  return fetchAircraftPhoto("reg", reg, signal);
}

export function readableApiError(error: unknown): string {
  if (!(error instanceof ApiError)) return "The service could not be reached. Check that the Python server is running.";
  if (error.status === 401) return "OpenSky credentials are missing or invalid. Add them to your local .env file.";
  if (error.status === 429) return "OpenSky's rate limit has been reached. Live data will resume when the quota resets.";
  if (error.status >= 500) return "OpenSky is temporarily unavailable. Your search is preserved so you can retry.";
  return error.message;
}
