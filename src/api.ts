import type {
  EmergencyFeedResponse,
  AircraftEnrichment,
  FlightRouteResponse,
  AircraftFlightsResponse,
  AircraftLookupResponse,
  CallsignLookupResponse,
  Airport,
  AirframeHistoryResponse,
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

const LIVE_REQUEST_MIN_INTERVAL_MS = window.location.hostname === "localhost" || window.location.hostname === "127.0.0.1" ? 25 : 600;
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

/** An array from a body that should be one; anything else reads as empty. */
function listOf<T>(value: T[] | null | undefined): T[] {
  return Array.isArray(value) ? value : [];
}

export const api = {
  emergencies: async (signal?: AbortSignal) => {
    const response = await request<EmergencyFeedResponse>("/api/emergencies", undefined, signal);
    if (!response || !Array.isArray(response.states) || !Number.isFinite(response.time)) throw new ApiError("Global emergency feed returned an unreadable snapshot.", 502);
    return { ...response, status: response.status === "delayed" ? "delayed" : "fresh",
      observed_at: response.time,
      last_success_at: Number.isFinite(response.last_success_at) ? response.last_success_at : response.time,
      retry_after_seconds: Number.isFinite(response.retry_after_seconds) ? Math.max(30, Math.min(300, response.retry_after_seconds)) : 60,
    } satisfies EmergencyFeedResponse;
  },
  health: (signal?: AbortSignal) => request<HealthResponse>("/api/health", undefined, signal),
  mapAirports: async (signal?: AbortSignal) => listOf(await request<Airport[]>("/api/map-airports", undefined, signal)),
  popularAirports: async (signal?: AbortSignal) => listOf(await request<Airport[]>("/api/airports", undefined, signal)),
  searchAirports: async (query: string, signal?: AbortSignal) => listOf(await request<Airport[]>("/api/search-airports", { q: query, limit: 12 }, signal)),
  flights: async (airport: string, date: string, mode: FlightMode, signal?: AbortSignal) => {
    const response = await request<FlightsResponse>("/api/flights", { airport, date, mode }, signal);
    return { ...response, flights: listOf(response.flights) };
  },
  airportConditions: async (airport: string, signal?: AbortSignal) => {
    const response = await request<AirportConditionsResponse>("/api/airport-conditions", { airport }, signal);
    return {
      ...response,
      runways: response.runways ?? [],
      favoured_runways: response.favoured_runways ?? [],
      frequencies: response.frequencies ?? [],
      unavailable: response.unavailable ?? [],
    };
  },
  airframeHistory: async (icao24: string, signal?: AbortSignal) => {
    const response = await request<AirframeHistoryResponse>("/api/aircraft-history", { icao24 }, signal);
    // The drawer reads these unguarded; a partial body must not blank the page.
    return {
      ...response,
      airframe: response.airframe ?? {},
      history: response.history ?? [],
      linked_icao24: response.linked_icao24 ?? [],
      sources: response.sources ?? [],
      registry: response.registry ?? null,
    };
  },
  aircraftFlights: async (registration: string, signal?: AbortSignal) => {
    const response = await request<AircraftFlightsResponse>("/api/aircraft-flights", { registration }, signal);
    return { ...response, flights: listOf(response.flights) };
  },
  aircraftLookup: (query: string, signal?: AbortSignal) => request<AircraftLookupResponse>("/api/aircraft-lookup", { q: query }, signal),
  airportSchedule: async (airport: string, direction: FlightMode, signal?: AbortSignal) => {
    const response = await request<AirportScheduleResponse>("/api/airport-schedule", { airport, direction }, signal);
    return { ...response, flights: response.flights ?? [] };
  },
  airportBoard: async (airport: string, signal?: AbortSignal) => {
    const response = await request<AirportBoardResponse>("/api/airport-board", { airport }, signal);
    return { ...response, departures: response.departures ?? [], arrivals: response.arrivals ?? [] };
  },
  liveFlights: async (bounds: Bounds, signal?: AbortSignal, fallbackOnly = false) => {
    // Zoom and pan can emit several different boxes in quick succession. A
    // small client-side spacing keeps those changes responsive while avoiding
    // a provider rate-limit burst; obsolete queries are still cancelled by
    // TanStack Query through the same signal.
    // The public-feed tile answers from another provider and is never the
    // one being rate limited, so it skips the queue.
    if (!fallbackOnly) await reserveLiveRequestSlot(signal);
    const response = await request<LiveFlightsResponse>("/api/live-flights", { ...bounds, fallback: fallbackOnly ? 1 : undefined }, signal);
    // The map iterates `states` outside any error boundary.
    return { ...response, states: listOf(response.states) };
  },
  callsignLookup: (callsign: string, signal?: AbortSignal) => request<CallsignLookupResponse>("/api/callsign-lookup", { callsign }, signal),
  flightRoute: (callsign: string, signal?: AbortSignal) => request<FlightRouteResponse>("/api/flight-route", { callsign }, signal),
  aircraftEnrichment: (operator: string, type: string, registration?: string | null, signal?: AbortSignal) => request<AircraftEnrichment>("/api/aircraft-enrichment", { operator, type, registration: registration ?? undefined }, signal),
  flightInfo: (icao24: string, callsign?: string, signal?: AbortSignal) => request<FlightInfoResponse>("/api/flight-info", { icao24, callsign }, signal),
  // Every reader dereferences `track.track`; a body without it (a proxy or
  // edge error answered with 200) would otherwise blank the whole page.
  track: async (icao24: string, time = 0, signal?: AbortSignal, callsign?: string) => {
    const response = await request<TrackResponse>("/api/track", { icao24, time, callsign }, signal);
    return { ...response, track: response.track ?? {} };
  },
};

export interface AircraftPhoto {
  src: string;
  width: number;
  height: number;
  link: string;
  photographer: string;
  attribution?: string;
  source?: string;
  licenseName?: string;
  licenseUrl?: string;
  matchLevel?: "icao24" | "registration";
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
      attribution: `© ${first.photographer?.trim() || "Unknown photographer"}`,
      source: "Planespotters.net",
      matchLevel: kind === "hex" ? "icao24" as const : "registration" as const,
    }
    : null;
  photoCache.set(key, { expiresAt: Date.now() + PHOTO_CACHE_MS, photo });
  return photo;
}

interface CommonsFile {
  index?: number;
  title?: string;
  imageinfo?: Array<{
    thumburl?: string;
    thumbwidth?: number;
    thumbheight?: number;
    descriptionurl?: string;
    extmetadata?: Record<string, { value?: string }>;
  }>;
}

function plainMetadata(value?: string): string {
  if (!value) return "";
  return new DOMParser().parseFromString(value, "text/html").body.textContent?.replace(/\s+/g, " ").trim() ?? "";
}

/** Commons is a registration-level fallback, never presented as a hex-confirmed airframe. */
async function commonsAircraftPhoto(registration: string, signal?: AbortSignal): Promise<AircraftPhoto | null> {
  if (!/^[A-Z0-9-]{3,10}$/.test(registration)) return null;
  const url = new URL("https://commons.wikimedia.org/w/api.php");
  Object.entries({
    action: "query", generator: "search", gsrsearch: `"${registration}"`, gsrnamespace: "6", gsrlimit: "10",
    prop: "imageinfo", iiprop: "url|size|extmetadata", iiurlwidth: "420", format: "json", origin: "*",
  }).forEach(([key, value]) => url.searchParams.set(key, value));
  const response = await fetch(url, { signal });
  if (!response.ok) return null;
  const payload = await response.json() as { query?: { pages?: Record<string, CommonsFile> } };
  const escaped = registration.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const exactRegistration = new RegExp(`(?:^|[^A-Z0-9])${escaped}(?:$|[^A-Z0-9])`, "i");
  const files = Object.values(payload.query?.pages ?? {}).sort((a, b) => (a.index ?? 99) - (b.index ?? 99));
  for (const file of files) {
    if (!file.title || !/\.jpe?g$/i.test(file.title) || !exactRegistration.test(file.title)) continue;
    const image = file.imageinfo?.[0];
    const meta = image?.extmetadata;
    const photographer = plainMetadata(meta?.Artist?.value || meta?.Credit?.value);
    const licenseName = plainMetadata(meta?.LicenseShortName?.value);
    const publicDomain = /^public domain$/i.test(licenseName);
    const creativeCommons = /^(?:CC BY(?:-SA)?|CC0) \d(?:\.\d)?$/i.test(licenseName);
    if (!image || !isHttpsUrl(image.thumburl) || !isHttpsUrl(image.descriptionurl) || !photographer
      || (!publicDomain && !creativeCommons) || (creativeCommons && !isHttpsUrl(meta?.LicenseUrl?.value))) continue;
    return {
      src: image.thumburl,
      width: image.thumbwidth ?? 420,
      height: image.thumbheight ?? 280,
      link: image.descriptionurl,
      photographer,
      attribution: publicDomain ? photographer : `© ${photographer}`,
      source: "Wikimedia Commons",
      licenseName,
      licenseUrl: isHttpsUrl(meta?.LicenseUrl?.value) ? meta?.LicenseUrl?.value : undefined,
      matchLevel: "registration",
    };
  }
  return null;
}

/** Latest photo of this airframe: by Mode S hex first, then by registration. */
export async function aircraftPhoto(icao24: string, registration?: string | null, signal?: AbortSignal): Promise<AircraftPhoto | null> {
  let byHex: AircraftPhoto | null = null;
  let providerUnavailable = false;
  try { byHex = await fetchAircraftPhoto("hex", icao24.trim().toLowerCase(), signal); }
  catch (error) {
    if (signal?.aborted) throw error;
    providerUnavailable = !(error instanceof ApiError) || error.status === 401 || error.status === 403 || error.status === 429 || error.status >= 500;
  }
  const reg = registration?.trim().toUpperCase();
  if (byHex || !reg) return byHex;
  if (!providerUnavailable) {
    try {
      const byRegistration = await fetchAircraftPhoto("reg", reg, signal);
      if (byRegistration) return byRegistration;
    } catch (error) { if (signal?.aborted) throw error; }
  }
  try { return await commonsAircraftPhoto(reg, signal); }
  catch (error) { if (signal?.aborted) throw error; return null; }
}

export function readableApiError(error: unknown): string {
  if (!(error instanceof ApiError)) return "The service could not be reached. Check that the Python server is running.";
  if (error.status === 401) return "OpenSky credentials are missing or invalid. Add them to your local .env file.";
  if (error.status === 429) return "OpenSky's rate limit has been reached. Live data will resume when the quota resets.";
  if (error.status >= 500) return "OpenSky is temporarily unavailable. Your search is preserved so you can retry.";
  return error.message;
}
