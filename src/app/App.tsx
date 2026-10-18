import { Suspense, lazy, useCallback, useEffect, useMemo, useRef, useState } from "react";
import { listEmptyMessage, type LiveCause } from "../features/map/liveStatus";
import { flushSync } from "react-dom";
import { useQuery } from "@tanstack/react-query";
import { AnimatePresence, motion } from "motion/react";
import { TriangleAlert } from "../shared/components/icons";
import { List } from "../shared/components/customIcons";
import { sameLiveFlight } from "../features/flights/flightTelemetry";
import { mergeFlightDetails } from "../features/flights/flightDetails";
import { aircraftPhoto, api, readableApiError } from "../shared/api";
import type { AirportView } from "../features/airports/components/AirportTab";
import { FlightDetails } from "../features/flights/components/FlightDetails";
import { FlightList } from "../features/flights/components/FlightList";
import { GlobalAlerts } from "../features/alerts/components/GlobalAlerts";
import { WatchList } from "../features/alerts/components/WatchList";
import { WATCHLIST_LIMIT, isWatched, toggleWatch, watchEntryFor, type WatchEntry } from "../features/alerts/watchlist";
import { FlightMap } from "../features/map/components/FlightMap";
import { MapToolbar } from "../features/map/components/MapToolbar";
import { OmniSearch } from "./components/OmniSearch";
import { PanelBoundary } from "../shared/components/PanelBoundary";
import { Topbar } from "./components/Topbar";
import { TrafficPanel, type TrafficTab } from "./components/TrafficPanel";
import { usePersistentState } from "../shared/hooks/usePersistentState";
import { getUnits, setUnits } from "../shared/units";
import { NO_FILTERS, activeFilterCount, filterAircraft, type MapFilters } from "../features/map/mapFilters";
import type { Airport, Flight, FlightMode, LiveAircraft, LiveFlightsResponse, MapTheme, MapView } from "../shared/types";
import { matchingFlightTrack, emergencyInfo, liveAircraftToFlight, parseMapView, todayUtc } from "../shared/utils";
import { MapHint } from "./components/MapHint";

// Panels that only appear after an interaction load on demand, keeping them out of the entry chunk.
const AirportTab = lazy(() => import("../features/airports/components/AirportTab").then(module => ({ default: module.AirportTab })));
// Fetch the likely next panels once the map is up, so opening them does not wait on the network.
if (typeof window !== "undefined") {
  const prefetch = () => { void import("../features/airports/components/AirportTab"); };
  if ("requestIdleCallback" in window) window.requestIdleCallback(prefetch, { timeout: 4000 });
  else setTimeout(prefetch, 2000);
}
const Onboarding = lazy(() => import("./components/Onboarding").then(module => ({ default: module.Onboarding })));
const ShortcutsDialog = lazy(() => import("./components/ShortcutsDialog").then(module => ({ default: module.ShortcutsDialog })));

interface FlightRequest {
  airport: Airport;
  date: string;
  mode: FlightMode;
}

interface LiveFallbackSnapshot {
  airportIcao: string | null;
  data: LiveFlightsResponse;
}

function liveSnapshotSummary(flights: readonly Flight[]) {
  return {
    total: flights.length,
    live_airborne: flights.filter((flight) => flight.status === "airborne" || flight.on_ground === false).length,
    live_on_ground: flights.filter((flight) => flight.status === "on_ground" || flight.on_ground === true).length,
    unique_airlines: new Set(flights.map((flight) => flight.airline_code).filter(Boolean)).size,
  };
}

const FAVORITE_LIMIT = 8;
/** Above this many aircraft in view the map cannot be explored by keyboard: offer the list directly. */
const DENSE_MAP_AIRCRAFT = 50;
const THEME_COLORS: Record<MapTheme, string> = { dark: "#0b0b0c", light: "#f5f5f7" };

/** First visit follows the operating system; a choice made in the app wins afterwards. */
function systemTheme(): MapTheme {
  return typeof window !== "undefined" && window.matchMedia?.("(prefers-color-scheme: light)").matches ? "light" : "dark";
}

function isTyping(target: EventTarget | null) {
  return target instanceof Element && Boolean(target.closest("input, textarea, select, [contenteditable='true']"));
}

export function App() {
  const [initialTheme] = useState(systemTheme);
  const [initialParams] = useState(() => new URLSearchParams(window.location.search));
  const [theme, setTheme] = usePersistentState<MapTheme>("skytrace-theme", initialTheme);
  const [favorites, setFavorites] = usePersistentState<Airport[]>("skytrace-favorites", []);
  const [recent, setRecent] = usePersistentState<Airport[]>("skytrace-recent", []);
  const [watchlist, setWatchlist] = usePersistentState<WatchEntry[]>("skytrace-watchlist", []);
  const [liveEnabled, setLiveEnabled] = usePersistentState("skytrace-live", true);
  const [labelsEnabled, setLabelsEnabled] = usePersistentState("skytrace-labels", true);
  const [trailsEnabled, setTrailsEnabled] = usePersistentState("skytrace-trails", false);
  const [favoriteAirportsOnly, setFavoriteAirportsOnly] = usePersistentState("skytrace-favorite-airports-only", false);
  const [airportPinsEnabled, setAirportPinsEnabled] = usePersistentState("skytrace-airport-pins", true);
  const [trafficOpen, setTrafficOpen] = usePersistentState("skytrace-traffic-open", window.innerWidth > 900);
  const [tourSeen, setTourSeen] = usePersistentState("skytrace-onboarded", false);
  // First visits get a non-blocking hint instead of an automatic modal tour; the tour stays behind the help icon.
  const [tourOpen, setTourOpen] = useState(false);
  const closeTour = useCallback(() => { setTourOpen(false); setTourSeen(true); }, [setTourSeen]);
  // Altitude and ground filters are kept between visits; the free-text filter
  // stays per session so the map never opens mysteriously narrowed (B12).
  const [storedFilters, setStoredFilters] = usePersistentState<MapFilters>("skytrace-filters", NO_FILTERS);
  const [filterQuery, setFilterQuery] = useState("");
  const filters = useMemo(() => ({ ...NO_FILTERS, ...storedFilters, query: filterQuery }), [filterQuery, storedFilters]);
  const setFilters = useCallback((next: MapFilters) => {
    setStoredFilters({ ...next, query: "" });
    setFilterQuery(next.query);
  }, [setStoredFilters]);
  const [shortcutsOpen, setShortcutsOpen] = useState(false);
  const closeShortcuts = useCallback(() => setShortcutsOpen(false), []);
  const [tab, setTab] = useState<TrafficTab>(initialParams.get("airport") ? "airport" : "live");
  const [homeAirport, setHomeAirport] = useState<Airport | null>(null);
  const [date, setDate] = useState(initialParams.get("date") || todayUtc());
  const [mode, setMode] = useState<FlightMode>(initialParams.get("mode") === "arrival" ? "arrival" : "departure");
  // The live board needs no history access, so it is the default airport view.
  const [airportView, setAirportView] = useState<AirportView>(initialParams.get("view") === "history" ? "history" : "live");
  const [request, setRequest] = useState<FlightRequest | null>(null);
  const [airportFocusRequest, setAirportFocusRequest] = useState(0);
  const [selectedFlight, setSelectedFlight] = useState<Flight | null>(null);
  const [sheetExpanded, setSheetExpanded] = useState(false);
  const [mapExpanded, setMapExpanded] = useState(false);
  // Each notice gets its own id so repeating a message replays it and restarts
  // the dismiss timer instead of being swallowed as an identical state update.
  const [toast, setToastState] = useState<{ id: number; message: string } | null>(null);
  const setToast = useCallback((message: string | null) => {
    setToastState(message ? { id: Date.now(), message } : null);
  }, []);
  const [searchFocusRequest, setSearchFocusRequest] = useState(0);
  const [previewFlight, setPreviewFlight] = useState<Flight | null>(null);
  const [liveFallbackSnapshot, setLiveFallbackSnapshot] = useState<LiveFallbackSnapshot | null>(null);
  const [mapCenter, setMapCenter] = useState<[number, number] | null>(null);
  const [userPosition, setUserPosition] = useState<[number, number] | null>(null);
  const [sharedView] = useState(() => initialParams.get("airport") || initialParams.get("icao24") ? null : parseMapView(initialParams.get("at")));
  const [mapView, setMapView] = useState<MapView | null>(sharedView);
  // The position only reaches the URL while no airport or flight is open, so
  // other moves (follow mode settles every second) skip the app re-render.
  const urlTracksMapRef = useRef(true);
  // Always current, so closing a flight writes where the map is now.
  const latestViewRef = useRef<MapView | null>(sharedView);
  const handleViewChange = useCallback((view: MapView) => {
    const next = { latitude: Number(view.latitude.toFixed(3)), longitude: Number(view.longitude.toFixed(3)), zoom: view.zoom };
    latestViewRef.current = next;
    if (!urlTracksMapRef.current) return;
    setMapView((current) => current && current.latitude === next.latitude && current.longitude === next.longitude && current.zoom === next.zoom ? current : next);
  }, []);
  const restoredAirport = useRef(false);
  const restoredFlight = useRef(false);

  const [liveCause, setLiveCause] = useState<LiveCause | null>(null);
  const handleLiveSnapshot = useCallback((data: LiveFlightsResponse, airportIcao: string | null) => {
    setLiveFallbackSnapshot({ data, airportIcao });
  }, []);

  const health = useQuery({ queryKey: ["health"], queryFn: ({ signal }) => api.health(signal), retry: false });
  const initialCode = initialParams.get("airport");
  const initialAirport = useQuery({
    queryKey: ["initial-airport", initialCode],
    queryFn: ({ signal }) => api.searchAirports(initialCode!, signal),
    enabled: Boolean(initialCode),
    staleTime: Infinity,
  });
  // An URL deep-link already has a precise airport request in flight. Defer
  // the optional popular-airports payload until that first screen is resolved
  // so a cold Vercel function is not asked to load the same CSV twice at once.
  const popular = useQuery({
    queryKey: ["popular-airports"],
    queryFn: ({ signal }) => api.popularAirports(signal),
    enabled: !initialCode || !initialAirport.isPending,
  });
  // Start the map feed while the health probe is still in flight. Production
  // can serve a live fallback even when the probe itself is cold; if the
  // probe later confirms that live data is disabled, the map effect aborts.
  const liveAvailable = health.data?.live_available ?? health.data?.credentials_configured ?? health.isPending;

  useEffect(() => {
    if (restoredAirport.current) return;

    if (initialCode) {
      if (initialAirport.isLoading) return;
      const fromUrl = initialAirport.data?.find((airport) => airport.icao === initialCode.toUpperCase());
      if (fromUrl) {
        restoredAirport.current = true;
        setHomeAirport(fromUrl);
        setRequest({ airport: fromUrl, date, mode });
        setTrafficOpen(true);
        return;
      }
    }

    // Nothing to restore: open the map on the last airport used, or a busy hub.
    if (popular.data?.length) {
      restoredAirport.current = true;
      setHomeAirport(recent[0] || popular.data.find((airport) => airport.icao === "LFPG") || popular.data[0]);
    }
  }, [date, initialAirport.data, initialAirport.isLoading, initialCode, mode, popular.data, recent, setTrafficOpen]);

  const flights = useQuery({
    queryKey: ["flights", request?.airport.icao, request?.date, request?.mode],
    queryFn: ({ signal }) => api.flights(request!.airport.icao, request!.date, request!.mode, signal),
    enabled: Boolean(request) && airportView === "history",
    staleTime: 5 * 60_000,
    gcTime: 30 * 60_000,
    retry: false,
  });

  useEffect(() => {
    const requestedIcao24 = initialParams.get("icao24");
    if (restoredFlight.current || !requestedIcao24 || selectedFlight || !flights.data?.flights.length) return;
    const match = flights.data.flights.find((flight) => flight.icao24 === requestedIcao24.toLowerCase());
    if (match) { restoredFlight.current = true; setSelectedFlight(match); }
  }, [flights.data, initialParams, selectedFlight]);

  // A shared link to a live aircraft (no airport, or the live airport board)
  // looks the aircraft up directly instead of waiting for it to scroll into
  // the map view; only recorded-history links resolve through the flight list.
  const sharedIcao24 = !initialCode || initialParams.get("view") !== "history" ? initialParams.get("icao24") : null;
  const sharedFlight = useQuery({
    queryKey: ["shared-flight", sharedIcao24],
    queryFn: ({ signal }) => api.flightInfo(sharedIcao24!.toLowerCase(), undefined, signal),
    enabled: Boolean(sharedIcao24) && !restoredFlight.current && initialParams.get("scheduled") !== "1",
    staleTime: Infinity,
    retry: false,
  });
  useEffect(() => {
    if (restoredFlight.current || !sharedIcao24 || initialParams.get("scheduled") !== "1") return;
    restoredFlight.current = true;
    setSelectedFlight({ icao24: sharedIcao24.toLowerCase(), callsign: initialParams.get("callsign") || sharedIcao24.toUpperCase(), registration: initialParams.get("registration"), primary_time: 0, data_source: "scheduled", status: "unknown" });
  }, [initialParams, sharedIcao24]);
  useEffect(() => {
    if (restoredFlight.current || !sharedFlight.data) return;
    restoredFlight.current = true;
    const { success: _success, ...info } = sharedFlight.data;
    void _success;
    setSelectedFlight({ ...info, callsign: info.callsign || sharedIcao24!.toUpperCase(), primary_time: 0, data_source: "live-nearby" } as Flight);
  }, [initialParams, sharedFlight.data, sharedIcao24]);

  const route = useQuery({
    queryKey: ["flight-route", selectedFlight?.callsign],
    queryFn: ({ signal }) => api.flightRoute(selectedFlight!.callsign, signal),
    enabled: Boolean(selectedFlight?.callsign && /^[A-Z]{3}[A-Z0-9]{1,5}$/i.test(selectedFlight.callsign)) && selectedFlight?.data_source !== "scheduled" && selectedFlight?.data_source !== "opensky" && !selectedFlight?.primary_time,
    staleTime: 15 * 60_000, gcTime: 30 * 60_000, retry: false,
  });

  const flightInfo = useQuery({
    queryKey: ["flight-info", selectedFlight?.icao24, selectedFlight?.callsign],
    queryFn: ({ signal }) => api.flightInfo(selectedFlight!.icao24, selectedFlight!.callsign, signal),
    // A selected historical card can still have a current operational record
    // (and a useful aircraft profile), so use the same on-demand enrichment
    // path for every selected aircraft. The server keeps the provider calls
    // outside the map polling loop and caches them per identifier.
    enabled: Boolean(selectedFlight) && selectedFlight?.data_source !== "scheduled",
    staleTime: 5 * 60_000,
    gcTime: 10 * 60_000,
    retry: false,
  });

  // The selected aircraft keeps reporting after the click. Only a flight picked
  // from the live map or board is the current one; a recorded flight from an
  // earlier date must not borrow today's position for the same airframe.
  const liveSelected = useMemo(() => {
    if (!selectedFlight || selectedFlight.data_source === "scheduled" || !(selectedFlight.primary_time === 0 || selectedFlight.data_source === "live-nearby")) return null;
    return liveFallbackSnapshot?.data.states.find((aircraft) => sameLiveFlight(selectedFlight, aircraft)) ?? null;
  }, [liveFallbackSnapshot, selectedFlight]);

  const detailsFlight = useMemo(
    () => mergeFlightDetails({ selectedFlight, liveSelected, route: route.data, flightInfo: flightInfo.data }),
    [flightInfo.data, liveSelected, selectedFlight, route.data],
  );

  const track = useQuery({
    queryKey: ["track", detailsFlight?.icao24, detailsFlight?.primary_time ?? detailsFlight?.first_seen ?? 0, detailsFlight?.callsign, detailsFlight?.data_source],
    queryFn: ({ signal }) => api.track(detailsFlight!.icao24, detailsFlight!.primary_time ?? detailsFlight!.first_seen ?? 0, signal, detailsFlight!.callsign),
    enabled: Boolean(detailsFlight) && detailsFlight?.data_source !== "scheduled",
    staleTime: 30_000,
    refetchInterval: detailsFlight?.data_source === "live-nearby" ? 90_000 : false,
    // Provider rate limits are transient: retry twice, and keep the drawn trace
    // while the same aircraft's key changes (callsign or route arriving late).
    retry: 2,
    retryDelay: (attempt) => 1_000 * (attempt + 1),
    placeholderData: (previous) => (previous?.track?.icao24 && previous.track.icao24.toLowerCase() === detailsFlight?.icao24.toLowerCase() ? previous : undefined),
  });

  const currentTrack = useMemo(() => matchingFlightTrack(track.data, detailsFlight), [detailsFlight, track.data]);

  // Only the selected aircraft is looked up, never every marker, to keep the
  // photo provider's traffic reasonable. The registration usually arrives a
  // moment later from flight-info; keep showing the hex result meanwhile.
  // A scheduled tail may belong to another airframe; only the transponder's
  // registration can fall back to a registration photo lookup.
  const airframeRegistration = detailsFlight?.registration_source === "schedule" ? null : detailsFlight?.registration ?? null;
  const photo = useQuery({
    queryKey: ["aircraft-photo", detailsFlight?.icao24, airframeRegistration],
    queryFn: ({ signal }) => aircraftPhoto(detailsFlight!.icao24, airframeRegistration, signal),
    enabled: Boolean(detailsFlight),
    staleTime: 24 * 60 * 60_000,
    gcTime: 60 * 60_000,
    retry: false,
    placeholderData: (previous, previousQuery) => previousQuery?.queryKey[1] === detailsFlight?.icao24 ? previous : undefined,
  });

  useEffect(() => {
    const params = new URLSearchParams();
    if (request) {
      params.set("airport", request.airport.icao);
      params.set("mode", request.mode);
      if (airportView === "history") {
        params.set("view", "history");
        params.set("date", request.date);
      }
    }
    const openingSharedFlight = Boolean(sharedIcao24 && !restoredFlight.current);
    urlTracksMapRef.current = !request && !selectedFlight && !openingSharedFlight;
    const view = latestViewRef.current ?? mapView;
    if (!request && !selectedFlight && view && !openingSharedFlight) {
      params.set("at", `${view.latitude.toFixed(3)},${view.longitude.toFixed(3)},${view.zoom}`);
    }
    if (openingSharedFlight) params.set("icao24", sharedIcao24!);
    if (selectedFlight) {
      params.set("icao24", selectedFlight.icao24);
      if (selectedFlight.data_source === "scheduled") {
        params.set("scheduled", "1");
        params.set("callsign", selectedFlight.callsign);
        if (selectedFlight.registration) params.set("registration", selectedFlight.registration);
      }
      const time = selectedFlight.primary_time ?? selectedFlight.first_seen;
      if (time) params.set("time", String(time));
    }
    // Commas are legal in a query string; keep ?at=51.470,-0.454,10 readable.
    const query = params.toString().replace(/%2C/g, ",");
    const next = query ? `${window.location.pathname}?${query}` : window.location.pathname;
    // Follow mode settles the map every second; Safari throttles (and throws
    // on) frequent replaceState calls, so skip the ones that change nothing.
    if (next !== `${window.location.pathname}${window.location.search}`) window.history.replaceState(null, "", next);
  }, [airportView, mapView, request, selectedFlight, sharedIcao24]);

  const titleAirport = request ? request.airport.iata || request.airport.icao : null;
  useEffect(() => {
    document.title = detailsFlight ? `${detailsFlight.callsign || detailsFlight.icao24.toUpperCase()} · SkyTrace`
      : titleAirport ? `${titleAirport} · SkyTrace` : "SkyTrace · Live flight tracker";
  }, [detailsFlight?.callsign, detailsFlight?.icao24, titleAirport]); // eslint-disable-line react-hooks/exhaustive-deps

  // Keeps the mobile browser chrome in step with the map theme.
  useEffect(() => {
    document.querySelector('meta[name="theme-color"]')?.setAttribute("content", THEME_COLORS[theme] ?? THEME_COLORS.dark);
  }, [theme]);

  useEffect(() => {
    const update = () => document.documentElement.classList.toggle("page-hidden", document.hidden);
    update();
    document.addEventListener("visibilitychange", update);
    return () => { document.removeEventListener("visibilitychange", update); document.documentElement.classList.remove("page-hidden"); };
  }, []);

  // A lost connection would otherwise look like an empty sky.
  useEffect(() => {
    const offline = () => setToast("You are offline. The map keeps the last positions until the connection returns.");
    const online = () => setToast("Back online. Live traffic is refreshing.");
    window.addEventListener("offline", offline);
    window.addEventListener("online", online);
    return () => {
      window.removeEventListener("offline", offline);
      window.removeEventListener("online", online);
    };
  }, [setToast]);

  useEffect(() => {
    if (!toast) return;
    const timer = window.setTimeout(() => setToast(null), 2800);
    return () => window.clearTimeout(timer);
  }, [setToast, toast]);

  useEffect(() => {
    function handleEscape(event: KeyboardEvent) {
      if (event.key !== "Escape") return;
      if (mapExpanded) setMapExpanded(false);
      else if (selectedFlight) setSelectedFlight(null);
    }
    window.addEventListener("keydown", handleEscape);
    return () => window.removeEventListener("keydown", handleEscape);
  }, [mapExpanded, selectedFlight]);

  useEffect(() => {
    function focusSearch(event: KeyboardEvent) {
      const typing = isTyping(event.target);
      const shortcut = event.key.toLowerCase() === "k" && (event.metaKey || event.ctrlKey);
      if (!shortcut && (event.key !== "/" || typing)) return;
      event.preventDefault();
      setSearchFocusRequest((current) => current + 1);
    }
    window.addEventListener("keydown", focusSearch);
    return () => window.removeEventListener("keydown", focusSearch);
  }, []);

  const toggleThemeRef = useRef<() => void>(() => undefined);
  useEffect(() => {
    function handleGlobalKeys(event: KeyboardEvent) {
      if (event.metaKey || event.ctrlKey || event.altKey || isTyping(event.target) || tourOpen) return;
      if (event.key === "?") { event.preventDefault(); setShortcutsOpen(true); }
      else if (event.key.toLowerCase() === "t" && !event.shiftKey) toggleThemeRef.current();
      else if (event.key.toLowerCase() === "l" && !event.shiftKey) setLabelsEnabled((current) => !current);
      else if (event.key.toLowerCase() === "p" && !event.shiftKey) setTrailsEnabled((current) => !current);
      else if (event.key.toLowerCase() === "u" && !event.shiftKey) setUnits(getUnits() === "metric" ? "aviation" : "metric");
    }
    window.addEventListener("keydown", handleGlobalKeys);
    return () => window.removeEventListener("keydown", handleGlobalKeys);
  }, [setLabelsEnabled, setTrailsEnabled, tourOpen]);

  const liveStates = useMemo(() => liveFallbackSnapshot?.data.states ?? [], [liveFallbackSnapshot]);
  const filteredLive = useMemo(
    () => filterAircraft(liveStates, filters).map((flight) => ({ ...flight, data_source: "live-nearby" as const })),
    [filters, liveStates],
  );
  const filtersActive = activeFilterCount(filters) > 0;

  // Airport board: recorded movements, falling back to the live map around
  // the airport when OpenSky history cannot be reached.
  const nearbyLiveStates = useMemo(() => {
    const latitude = request?.airport.latitude;
    const longitude = request?.airport.longitude;
    if (latitude == null || longitude == null) return [];
    return liveStates.filter((flight) => flight.latitude != null && flight.longitude != null
      && Math.abs(flight.latitude - latitude) <= 0.3 && Math.abs(flight.longitude - longitude) <= 0.45);
  }, [liveStates, request?.airport.latitude, request?.airport.longitude]);
  const matchingLiveSnapshot = Boolean(
    request
      && liveFallbackSnapshot?.airportIcao === request.airport.icao
      && nearbyLiveStates.length,
  );
  const livePreviewDuringLoad = Boolean(flights.isFetching && matchingLiveSnapshot);
  const clientLiveFallback = Boolean(flights.data?.source === "unavailable" && matchingLiveSnapshot);
  const useLiveSnapshot = clientLiveFallback || livePreviewDuringLoad;
  const airportFlights = useMemo(() => useLiveSnapshot
    ? nearbyLiveStates.map((flight) => ({ ...flight, data_source: "live-nearby" as const }))
    : flights.data?.flights ?? [], [flights.data, nearbyLiveStates, useLiveSnapshot]);
  const showingLiveFallback = flights.data?.source === "live-nearby" || useLiveSnapshot;
  const airportSummary = useLiveSnapshot ? liveSnapshotSummary(airportFlights) : flights.data?.summary;
  // History that could not be loaded is unknown, not zero flights.
  const summaryUnknown = flights.data?.source === "unavailable" && !useLiveSnapshot;
  const summaryValue = (value?: number) => summaryUnknown ? "—" : value ?? 0;
  const liveSummary = useMemo(() => liveSnapshotSummary(filteredLive), [filteredLive]);
  const airportNotice = livePreviewDuringLoad
    ? `Loading ${request?.mode}s · showing live traffic around ${request?.airport.icao} meanwhile.`
    : clientLiveFallback
    ? `History is unavailable for ${request?.date}. Showing live traffic around ${request?.airport.icao} instead.`
    : flights.data?.source === "live-nearby"
    ? "History is unavailable. Showing aircraft currently near this airport."
    : flights.data?.notice;
  const airportCode = request ? request.airport.iata || request.airport.icao : null;
  const boardHeading = request ? {
    title: showingLiveFallback
      ? `Live traffic around ${airportCode}`
      : `${request.mode === "departure" ? "Departures from" : "Arrivals at"} ${airportCode}`,
    subtitle: showingLiveFallback ? request.airport.name : `${request.date} · ${request.airport.name}`,
  } : null;

  // Emergencies in the visible airspace are flagged on the map whatever panel
  // is open, the way FR24 surfaces 7500/7600/7700 squawks.
  const emergencies = useMemo(
    () => liveStates.flatMap((aircraft) => {
      const info = emergencyInfo(aircraft);
      return info ? [{ aircraft, info }] : [];
    }),
    [liveStates],
  );
  const favoriteCodes = useMemo(() => new Set(favorites.map((airport) => airport.icao)), [favorites]);
  // The route ends of the selected flight need coordinates for the progress
  // bar; resolve any that are not already known (the lookup is cached).
  const routeEnds = [detailsFlight?.departure_airport, detailsFlight?.arrival_airport];
  const endAirports = useQuery({
    queryKey: ["route-airports", ...routeEnds],
    queryFn: async ({ signal }) => (await Promise.all(routeEnds.map(async (icao) => {
      if (!icao) return null;
      return (await api.searchAirports(icao, signal)).find((airport) => airport.icao === icao) ?? null;
    }))).filter((airport): airport is Airport => airport !== null),
    enabled: routeEnds.some(Boolean),
    staleTime: Infinity,
    retry: false,
  });
  const knownAirports = useMemo(() => {
    const byIcao = new Map<string, Airport>();
    for (const airport of [...(popular.data ?? []), ...recent, ...favorites, ...(homeAirport ? [homeAirport] : []), ...(request ? [request.airport] : []), ...(endAirports.data ?? [])]) byIcao.set(airport.icao, airport);
    return byIcao;
  }, [endAirports.data, favorites, homeAirport, popular.data, recent, request]);
  const airportCatalog = useQuery({
    queryKey: ["map-airports"],
    queryFn: ({ signal }) => api.mapAirports(signal),
    enabled: !initialCode || !initialAirport.isPending,
    staleTime: Infinity,
  });
  const mapAirports = useMemo(() => {
    const byIcao = new Map((airportCatalog.data ?? []).map((airport) => [airport.icao, airport]));
    for (const [icao, airport] of knownAirports) byIcao.set(icao, airport);
    return [...byIcao.values()];
  }, [airportCatalog.data, knownAirports]);

  const detailAirports = useMemo(() => new Map(mapAirports.map(airport => [airport.icao, airport])), [mapAirports]);
  const mapSelectedFlight = useMemo(() => {
    if (!detailsFlight || detailsFlight.arrival_latitude != null && detailsFlight.arrival_longitude != null) return detailsFlight;
    const destination = detailAirports.get(detailsFlight.arrival_airport ?? "");
    return destination?.latitude != null && destination.longitude != null
      ? { ...detailsFlight, arrival_latitude: destination.latitude, arrival_longitude: destination.longitude }
      : detailsFlight;
  }, [detailAirports, detailsFlight]);

  const selectFlight = useCallback((flight: Flight) => {
    restoredFlight.current = true;
    setSheetExpanded(false);
    setPreviewFlight(null);
    setSelectedFlight(flight);
  }, []);

  const toggleWatched = useCallback((flight: Flight) => {
    const result = toggleWatch(watchlist, watchEntryFor(flight));
    if (result.refused) { setToast(`The watchlist holds ${WATCHLIST_LIMIT} aircraft. Remove one first.`); return; }
    setWatchlist(result.list);
    setToast(result.list.length > watchlist.length ? "Added to your watchlist." : "Removed from your watchlist.");
  }, [setToast, setWatchlist, watchlist]);

  // An aircraft that is not in view opens as an airframe, like a registration typed in search.
  const openWatched = useCallback((entry: WatchEntry, live: LiveAircraft | null) => {
    if (live) { selectFlight(liveAircraftToFlight(live)); return; }
    selectFlight({
      icao24: entry.icao24, callsign: entry.registration || entry.label, registration: entry.registration ?? null, primary_time: 0,
      data_source: "live-nearby", status: "unknown", airline_name: "",
    } as Flight);
  }, [selectFlight]);

  const openAirport = useCallback((airport: Airport, options: { date?: string; mode?: FlightMode } = {}) => {
    restoredFlight.current = true;
    setPreviewFlight(null);
    setSheetExpanded(false);
    setAirportFocusRequest(value => value + 1);
    setRequest({ airport, date: options.date ?? date, mode: options.mode ?? mode });
    setSelectedFlight(null);
    setTab("airport");
    setTrafficOpen(true);
    setRecent((current) => [airport, ...current.filter((item) => item.icao !== airport.icao)].slice(0, 6));
  }, [date, mode, setRecent, setTrafficOpen]);

  function changeDate(next: string) {
    setDate(next);
    setRequest((current) => current ? { ...current, date: next } : current);
  }

  function changeMode(next: FlightMode) {
    setMode(next);
    setRequest((current) => current ? { ...current, mode: next } : current);
  }

  // A circular reveal from the theme button, using the View Transitions API
  // where the browser has it; elsewhere the theme simply swaps.
  function toggleTheme(origin?: { x: number; y: number }) {
    const next = theme === "dark" ? "light" : "dark";
    const reduced = window.matchMedia?.("(prefers-reduced-motion: reduce)").matches;
    if (!document.startViewTransition || reduced || !origin) {
      setTheme(next);
      return;
    }
    const radius = Math.hypot(Math.max(origin.x, window.innerWidth - origin.x), Math.max(origin.y, window.innerHeight - origin.y));
    const transition = document.startViewTransition(() => flushSync(() => setTheme(next)));
    transition.ready.then(() => {
      document.documentElement.animate(
        { clipPath: [`circle(0px at ${origin.x}px ${origin.y}px)`, `circle(${radius}px at ${origin.x}px ${origin.y}px)`] },
        { duration: 560, easing: "cubic-bezier(0.22, 1, 0.36, 1)", pseudoElement: "::view-transition-new(root)" },
      );
    }).catch(() => undefined);
  }

  toggleThemeRef.current = () => toggleTheme();

  function toggleFavorite(airport: Airport) {
    const code = airport.iata || airport.icao;
    if (favoriteCodes.has(airport.icao)) {
      setFavorites(favorites.filter((item) => item.icao !== airport.icao));
      setToast(`${code} removed from favourites.`);
    } else if (favorites.length >= FAVORITE_LIMIT) {
      // Dropping the oldest favourite without a word would lose a saved airport.
      setToast(`You can keep ${FAVORITE_LIMIT} favourites. Remove one to add ${code}.`);
    } else {
      setFavorites([airport, ...favorites]);
      setToast(`${code} added to favourites.`);
    }
  }

  async function shareView() {
    const url = window.location.href;
    // Phones get the native share sheet; desktops keep the quick copy.
    const coarse = window.matchMedia?.("(pointer: coarse)").matches;
    if (coarse && typeof navigator.share === "function") {
      try {
        await navigator.share({ title: document.title, url });
        return;
      } catch (error) {
        if (error instanceof DOMException && error.name === "AbortError") return;
      }
    }
    try {
      await navigator.clipboard.writeText(url);
      setToast("Share link copied to clipboard.");
    } catch {
      setToast("Copy this page URL to share this view.");
    }
  }

  const dockOpen = Boolean(detailsFlight) && !mapExpanded;

  return (
    <div className={`app theme-${theme} ${mapExpanded ? "map-expanded" : ""}`}>
      <a
        className="skip-link"
        href="#workspace"
        onClick={event => {
          // The results panel can be collapsed: open it, then land on it.
          event.preventDefault();
          setTrafficOpen(true);
          requestAnimationFrame(() => (document.getElementById("flight-results") ?? document.getElementById("workspace"))?.focus());
        }}
      >
        Skip to flight results
      </a>
      {liveSummary.total > DENSE_MAP_AIRCRAFT && (
        <a
          className="skip-link"
          href="#flight-results"
          onClick={event => {
            // Land on the first aircraft of the In view list, ready for the arrow keys.
            event.preventDefault();
            setTrafficOpen(true);
            setTab("live");
            const focusFirst = (attempt: number) => {
              const first = document.querySelector<HTMLElement>(".flight-list .flight-card");
              if (first) first.focus();
              else if (attempt < 10) requestAnimationFrame(() => focusFirst(attempt + 1));
            };
            requestAnimationFrame(() => focusFirst(0));
          }}
        >
          Skip to the list of {liveSummary.total} aircraft in view
        </a>
      )}
      <Topbar
        health={health.data}
        healthPending={health.isPending}
        theme={theme}
        onToggleTheme={toggleTheme}
        onShowTour={() => setTourOpen(true)}
        onShowShortcuts={() => setShortcutsOpen(true)}
        search={(
          <OmniSearch
            focusRequest={searchFocusRequest}
            aircraft={liveStates}
            recent={recent}
            popular={popular.data ?? []}
            onSelectAircraft={(aircraft) => selectFlight(liveAircraftToFlight(aircraft))}
            onSelectAirframe={(icao24, registration, registry) => selectFlight({
              icao24, callsign: registration || icao24.toUpperCase(), registration, primary_time: 0,
              data_source: "live-nearby", status: "unknown", airline_name: "",
              aircraft_owner: registry?.owner ?? null, aircraft_type: registry?.type_code ?? null, aircraft_description: registry?.type ?? null,
            })}
            onSelectAirport={openAirport}
          />
        )}
      />

      <main id="workspace" tabIndex={-1} className={`workspace ${dockOpen ? "has-dock" : ""} ${dockOpen && sheetExpanded ? "sheet-expanded" : ""} ${trafficOpen ? "traffic-open" : ""}`}>
        <FlightMap
          // A shared map position wins over the home airport until one is opened.
          airport={request?.airport ?? (sharedView ? null : homeAirport)}
          airportFocusRequest={airportFocusRequest}
          readingDetails={dockOpen && sheetExpanded}
          initialView={sharedView}
          onViewChange={handleViewChange}
          onUserLocation={setUserPosition}
          airports={airportPinsEnabled ? favoriteAirportsOnly ? favorites : mapAirports : []}
          nearbyAirports={mapAirports}
          airportCatalogLoading={airportCatalog.isPending}
          airportCatalogError={airportCatalog.isError}
          onRetryAirportCatalog={() => { void airportCatalog.refetch(); }}
          selectedFlight={mapSelectedFlight}
          previewFlight={previewFlight}
          track={currentTrack}
          theme={theme}
          filters={filters}
          labelsEnabled={labelsEnabled}
          trailsEnabled={trailsEnabled}
          liveEnabled={liveEnabled && liveAvailable}
          liveAvailable={liveAvailable}
          liveProbePending={health.isPending}
          expanded={mapExpanded}
          onToggleLive={() => liveAvailable ? setLiveEnabled(!liveEnabled) : setToast("Live traffic is not available right now.")}
          onToggleExpanded={() => setMapExpanded(!mapExpanded)}
          onSelectFlight={selectFlight}
          onSelectAirport={openAirport}
          onLiveSnapshot={handleLiveSnapshot}
          onLiveCause={setLiveCause}
          onViewportCenter={setMapCenter}
        />

        {sharedIcao24 && !restoredFlight.current && initialParams.get("scheduled") !== "1" && <div className="shared-flight-notice" role="status">
          <strong>{sharedFlight.isError ? "Shared aircraft unavailable" : "Opening shared aircraft…"}</strong>
          {sharedFlight.isError && <><p>{readableApiError(sharedFlight.error)}</p><button type="button" className="text-button" onClick={() => sharedFlight.refetch()}>Retry aircraft</button></>}
        </div>}
        <MapToolbar
          filters={filters}
          onFiltersChange={setFilters}
          labelsEnabled={labelsEnabled}
          onLabelsChange={setLabelsEnabled}
          trailsEnabled={trailsEnabled}
          onTrailsChange={setTrailsEnabled}
          airportsEnabled={airportPinsEnabled}
          onAirportsChange={setAirportPinsEnabled}
          favoritesOnly={favoriteAirportsOnly}
          favoriteCount={favorites.length}
          onFavoritesOnlyChange={setFavoriteAirportsOnly}
        />

        <AnimatePresence>
          {emergencies.length > 0 && (
            <motion.div
              className="emergency-banner"
              role="alert"
              initial={{ opacity: 0, y: -10 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, y: -10 }}
              transition={{ duration: 0.2 }}
            >
              {emergencies.slice(0, 2).map(({ aircraft, info }) => (
                <button key={aircraft.icao24} type="button" onClick={() => selectFlight(liveAircraftToFlight(aircraft))}>
                  <TriangleAlert size={14} aria-hidden="true" />
                  <strong>{/^[0-9]+$/.test(info.code) ? `Squawk ${info.code}` : "Emergency"}</strong>
                  <span>{aircraft.callsign || aircraft.icao24.toUpperCase()} · {info.label}</span>
                </button>
              ))}
              {emergencies.length > 2 && <span className="emergency-more">+{emergencies.length - 2} more</span>}
            </motion.div>
          )}
        </AnimatePresence>

        <AnimatePresence>
          {detailsFlight && !mapExpanded && (
            <PanelBoundary key="details" label="flight details" resetKey={detailsFlight.icao24} frameClassName="details-drawer dock-panel">
            <FlightDetails
              flight={detailsFlight}
              track={currentTrack}
              trackLoading={track.isFetching}
              trackError={track.error ? readableApiError(track.error) : undefined}
              routeLoading={!detailsFlight.departure_airport && !detailsFlight.arrival_airport && (route.isFetching || flightInfo.isFetching)}
              photo={photo.data}
              photoLoading={photo.isPending && photo.fetchStatus !== "idle"}
              photoError={photo.isError}
              airports={detailAirports}
              onRetryTrack={() => track.refetch()}
              expanded={sheetExpanded}
              onToggleExpanded={() => setSheetExpanded(value => !value)}
              onBack={() => { setTrafficOpen(true); setSelectedFlight(null); requestAnimationFrame(() => document.getElementById(`traffic-tab-${tab}`)?.focus()); }}
              backLabel={`Back to ${tab === "alerts" ? "alerts" : tab === "airport" ? "airport" : "traffic"}`}
              onClose={() => { setSelectedFlight(null); requestAnimationFrame(() => (document.getElementById(`traffic-tab-${tab}`) ?? document.getElementById("omni-search"))?.focus()); }}
              onShare={shareView}
              watched={isWatched(watchlist, detailsFlight.icao24)}
              onToggleWatch={() => toggleWatched(detailsFlight)}
              observer={userPosition}
            />
            </PanelBoundary>
          )}
        </AnimatePresence>

        <AnimatePresence initial={false}>
          {trafficOpen && !mapExpanded && (
            <motion.div
              key="traffic"
              className="traffic-slot"
              initial={{ opacity: 0, x: 24 }}
              animate={{ opacity: 1, x: 0 }}
              exit={{ opacity: 0, x: 18, transition: { duration: 0.16, ease: "easeIn" } }}
              transition={{ duration: 0.22, ease: [0.16, 1, 0.3, 1] }}
            >
              <TrafficPanel
                tab={tab}
                onTabChange={setTab}
                onClose={() => setTrafficOpen(false)}
                liveCount={liveSummary.total}
                airportLabel={airportCode}
                alerts={(
                  <>
                    <WatchList entries={watchlist} live={liveStates} onOpen={openWatched} onRemove={entry => setWatchlist(current => current.filter(item => item.icao24 !== entry.icao24))} />
                    <GlobalAlerts onSelect={selectFlight} />
                  </>
                )}
                live={(
                  <>
                    <div className="stats-row">
                      <div><strong className="mono">{liveSummary.total}</strong><span>In view</span></div>
                      <div><strong className="mono">{liveSummary.live_airborne}</strong><span>Airborne</span></div>
                      <div><strong className="mono">{liveSummary.live_on_ground}</strong><span>On ground</span></div>
                    </div>
                    {filtersActive && (
                      <div className="data-notice-inline" role="status">
                        Map filters are on · {filteredLive.length} of {liveStates.length} aircraft shown.
                        <button type="button" onClick={() => setFilters(NO_FILTERS)}>Reset</button>
                      </div>
                    )}
                    <FlightList
                      variant="live"
                      emptyMessage={liveCause ? listEmptyMessage(liveCause) : undefined}
                      flights={filteredLive}
                      selectedFlight={selectedFlight}
                      loading={false}
                      hasSearched
                      onSelect={selectFlight}
                      onPreview={setPreviewFlight}
                      onRetry={() => undefined}
                      referencePoint={mapCenter}
                    />
                  </>
                )}
                airport={(
                  <PanelBoundary label="airport board" resetKey={request?.airport.icao ?? null}>
                  <Suspense fallback={null}>
                  <AirportTab
                    selected={request?.airport ?? null}
                    popular={popular.data ?? []}
                    recent={recent}
                    favorites={favorites}
                    date={date}
                    mode={mode}
                    view={airportView}
                    onDateChange={changeDate}
                    onModeChange={changeMode}
                    onViewChange={setAirportView}
                    selectedIcao24={selectedFlight?.icao24 ?? null}
                    liveAircraft={liveStates}
                    onSelectFlight={selectFlight}
                    onPreviewFlight={setPreviewFlight}
                    onSelect={openAirport}
                    onClear={() => undefined}
                    onToggleFavorite={toggleFavorite}
                    onShare={shareView}
                    onClearRecent={() => setRecent([])}
                    heading={boardHeading}
                  >
                    <div className="stats-row">
                      <div><strong className="mono">{summaryValue(airportSummary?.total)}</strong><span>{showingLiveFallback ? "Live aircraft" : "Flights"}</span></div>
                      <div><strong className="mono">{summaryValue(airportSummary?.live_airborne)}</strong><span>Airborne</span></div>
                      <div><strong className="mono">{summaryValue(airportSummary?.unique_airlines)}</strong><span>Airlines</span></div>
                    </div>
                    <FlightList
                      flights={airportFlights}
                      selectedFlight={selectedFlight}
                      loading={flights.isFetching}
                      errorMessage={flights.error ? readableApiError(flights.error) : undefined}
                      notice={airportNotice}
                      hasSearched={Boolean(request)}
                      onSelect={selectFlight}
                      onPreview={setPreviewFlight}
                      onRetry={() => flights.refetch()}
                      referencePoint={mapCenter}
                    />
                  </AirportTab>
                  </Suspense>
                  </PanelBoundary>
                )}
              />
            </motion.div>
          )}
        </AnimatePresence>
        {!trafficOpen && !mapExpanded && (
          <button type="button" className="traffic-reopen" onClick={() => setTrafficOpen(true)} aria-label={`Traffic ${liveSummary.total} Open traffic panel`}>
            <List size={15} aria-hidden="true" />
            <span>Traffic</span>
            <b className="mono">{liveSummary.total}</b>
          </button>
        )}
      </main>

      {!tourSeen && !tourOpen && !selectedFlight && <MapHint onDismiss={() => setTourSeen(true)} />}
      {tourOpen && <Suspense fallback={null}><Onboarding onClose={closeTour} /></Suspense>}
      <Suspense fallback={null}><AnimatePresence>{shortcutsOpen && <ShortcutsDialog onClose={closeShortcuts} />}</AnimatePresence></Suspense>

      <AnimatePresence>
        {toast && (
          <motion.div
            key={toast.id}
            className="toast"
            role="status"
            initial={{ opacity: 0, y: 12, x: "-50%", scale: 0.96 }}
            animate={{ opacity: 1, y: 0, x: "-50%", scale: 1 }}
            exit={{ opacity: 0, y: 8, x: "-50%", scale: 0.98 }}
            transition={{ type: "spring", stiffness: 420, damping: 32 }}
          >
            {toast.message}
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}
