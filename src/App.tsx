import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { flushSync } from "react-dom";
import { useQuery } from "@tanstack/react-query";
import { AnimatePresence, motion } from "motion/react";
import { TriangleAlert } from "./components/icons";
import { List } from "./components/customIcons";
import { aircraftPhoto, api, readableApiError } from "./api";
import { AirportTab, type AirportView } from "./components/AirportTab";
import { FlightDetails } from "./components/FlightDetails";
import { FlightList } from "./components/FlightList";
import { FlightMap } from "./components/FlightMap";
import { MapToolbar } from "./components/MapToolbar";
import { Onboarding } from "./components/Onboarding";
import { OmniSearch } from "./components/OmniSearch";
import { ShortcutsDialog } from "./components/ShortcutsDialog";
import { Topbar } from "./components/Topbar";
import { TrafficPanel, type TrafficTab } from "./components/TrafficPanel";
import { usePersistentState } from "./hooks/usePersistentState";
import { NO_FILTERS, activeFilterCount, filterAircraft, type MapFilters } from "./mapFilters";
import type { Airport, Flight, FlightMode, LiveAircraft, LiveFlightsResponse, MapTheme, MapView } from "./types";
import { emergencyInfo, liveAircraftToFlight, parseMapView, todayUtc } from "./utils";

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

/** Kinematics that keep moving after a flight is selected; identity fields do not. */
function withLiveKinematics(flight: Flight, live: LiveAircraft): Flight {
  return {
    ...flight,
    latitude: live.latitude ?? flight.latitude,
    longitude: live.longitude ?? flight.longitude,
    baro_altitude: live.baro_altitude ?? flight.baro_altitude,
    geo_altitude: live.geo_altitude ?? flight.geo_altitude,
    velocity: live.velocity ?? flight.velocity,
    true_track: live.true_track ?? flight.true_track,
    vertical_rate: live.vertical_rate ?? flight.vertical_rate,
    on_ground: live.on_ground ?? flight.on_ground,
    squawk: live.squawk ?? flight.squawk,
    time_position: live.time_position ?? flight.time_position,
    last_contact: live.last_contact ?? flight.last_contact,
    status: live.on_ground == null ? flight.status : live.on_ground ? "on_ground" : "airborne",
  };
}

const FAVORITE_LIMIT = 8;
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
  const [liveEnabled, setLiveEnabled] = usePersistentState("skytrace-live", true);
  const [labelsEnabled, setLabelsEnabled] = usePersistentState("skytrace-labels", true);
  const [favoriteAirportsOnly, setFavoriteAirportsOnly] = usePersistentState("skytrace-favorite-airports-only", false);
  const [airportPinsEnabled, setAirportPinsEnabled] = usePersistentState("skytrace-airport-pins", true);
  const [trafficOpen, setTrafficOpen] = usePersistentState("skytrace-traffic-open", window.innerWidth > 900);
  const [tourSeen, setTourSeen] = usePersistentState("skytrace-onboarded", false);
  // A shared link opens straight onto its flight or airport; the tour waits.
  const [tourOpen, setTourOpen] = useState(() => !tourSeen && !new URLSearchParams(window.location.search).has("icao24") && !new URLSearchParams(window.location.search).has("airport"));
  const closeTour = useCallback(() => { setTourOpen(false); setTourSeen(true); }, [setTourSeen]);
  const [storedFilters, setFilters] = usePersistentState<MapFilters>("skytrace-filters", NO_FILTERS);
  // Stored filters from an older release may lack newer fields.
  const filters = useMemo(() => ({ ...NO_FILTERS, ...storedFilters }), [storedFilters]);
  const [shortcutsOpen, setShortcutsOpen] = useState(false);
  const closeShortcuts = useCallback(() => setShortcutsOpen(false), []);
  const [tab, setTab] = useState<TrafficTab>(initialParams.get("airport") ? "airport" : "live");
  const [homeAirport, setHomeAirport] = useState<Airport | null>(null);
  const [date, setDate] = useState(initialParams.get("date") || todayUtc());
  const [mode, setMode] = useState<FlightMode>(initialParams.get("mode") === "arrival" ? "arrival" : "departure");
  // The live board needs no history access, so it is the default airport view.
  const [airportView, setAirportView] = useState<AirportView>(initialParams.get("view") === "history" ? "history" : "live");
  const [request, setRequest] = useState<FlightRequest | null>(null);
  const [selectedFlight, setSelectedFlight] = useState<Flight | null>(null);
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
  const [sharedView] = useState(() => initialParams.get("airport") || initialParams.get("icao24") ? null : parseMapView(initialParams.get("at")));
  const [mapView, setMapView] = useState<MapView | null>(sharedView);
  const restoredAirport = useRef(false);
  const restoredFlight = useRef(false);

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
    enabled: Boolean(sharedIcao24),
    staleTime: Infinity,
    retry: false,
  });
  useEffect(() => {
    if (restoredFlight.current || !sharedFlight.data) return;
    restoredFlight.current = true;
    const { success: _success, ...info } = sharedFlight.data;
    void _success;
    setSelectedFlight({ ...info, callsign: info.callsign || sharedIcao24!.toUpperCase(), primary_time: 0, data_source: "live-nearby" } as Flight);
  }, [sharedFlight.data, sharedIcao24]);

  const flightInfo = useQuery({
    queryKey: ["flight-info", selectedFlight?.icao24],
    queryFn: ({ signal }) => api.flightInfo(selectedFlight!.icao24, selectedFlight!.callsign, signal),
    // A selected historical card can still have a current operational record
    // (and a useful aircraft profile), so use the same on-demand enrichment
    // path for every selected aircraft. The server keeps the provider calls
    // outside the map polling loop and caches them per identifier.
    enabled: Boolean(selectedFlight),
    staleTime: 5 * 60_000,
    gcTime: 10 * 60_000,
    retry: false,
  });

  // The selected aircraft keeps reporting after the click. Only a flight picked
  // from the live map or board is the current one; a recorded flight from an
  // earlier date must not borrow today's position for the same airframe.
  const liveSelected = useMemo(() => {
    if (!selectedFlight || !(selectedFlight.primary_time === 0 || selectedFlight.data_source === "live-nearby")) return null;
    return liveFallbackSnapshot?.data.states.find((aircraft) => aircraft.icao24 === selectedFlight.icao24) ?? null;
  }, [liveFallbackSnapshot, selectedFlight]);

  const detailsFlight = useMemo(() => {
    if (!selectedFlight) return null;
    const current = liveSelected ? withLiveKinematics(selectedFlight, liveSelected) : selectedFlight;
    if (!flightInfo.data || flightInfo.data.icao24 !== selectedFlight.icao24) return current;
    const info = flightInfo.data;
    // Airframe identity, most to least reliable: the transponder profile from
    // flight-info, then the transponder registration the live feed already
    // gave us, and only then FlightAware's tail, which is the aircraft
    // *scheduled* on this flight number and differs after an aircraft swap.
    const scheduledOnly = info.registration_source === "schedule";
    const liveAirframe = scheduledOnly && Boolean(current.registration);
    return {
      ...current,
      callsign: info.callsign || current.callsign,
      airline_code: info.airline_code || current.airline_code,
      airline_name: info.airline_name || current.airline_name,
      departure_airport: info.departure_airport ?? current.departure_airport,
      departure_airport_name: info.departure_airport_name ?? current.departure_airport_name,
      arrival_airport: info.arrival_airport ?? current.arrival_airport,
      arrival_airport_name: info.arrival_airport_name ?? current.arrival_airport_name,
      first_seen: info.first_seen ?? current.first_seen,
      last_seen: info.last_seen ?? current.last_seen,
      route_source: info.route_source ?? current.route_source,
      route_provider: info.route_provider ?? current.route_provider,
      registration: liveAirframe ? current.registration : info.registration ?? current.registration,
      registration_source: liveAirframe ? "adsb" : info.registration ? info.registration_source : current.registration_source,
      aircraft_type: (scheduledOnly ? current.aircraft_type : null) ?? info.aircraft_type ?? current.aircraft_type,
      aircraft_description: info.aircraft_description ?? current.aircraft_description,
      aircraft_owner: info.aircraft_owner ?? current.aircraft_owner,
      aircraft_year: info.aircraft_year ?? current.aircraft_year,
      aircraft_category: info.aircraft_category ?? current.aircraft_category,
      emergency: info.emergency ?? current.emergency,
      nav_qnh: info.nav_qnh ?? current.nav_qnh,
      nav_altitude_mcp: info.nav_altitude_mcp ?? current.nav_altitude_mcp,
      nav_heading: info.nav_heading ?? current.nav_heading,
      nav_modes: info.nav_modes ?? current.nav_modes,
      messages: info.messages ?? current.messages,
      rssi: info.rssi ?? current.rssi,
      seen_seconds: info.seen_seconds ?? current.seen_seconds,
      seen_position_seconds: info.seen_position_seconds ?? current.seen_position_seconds,
      nic: info.nic ?? current.nic,
      rc: info.rc ?? current.rc,
      nac_p: info.nac_p ?? current.nac_p,
      nac_v: info.nac_v ?? current.nac_v,
      sil: info.sil ?? current.sil,
      sil_type: info.sil_type ?? current.sil_type,
      source: info.source ?? current.source,
      squawk: liveSelected?.squawk ?? info.squawk ?? current.squawk,
      category: info.category ?? current.category,
      last_contact: liveSelected?.last_contact ?? info.last_contact ?? current.last_contact,
      time_position: liveSelected?.time_position ?? info.time_position ?? current.time_position,
      flightaware: info.flightaware ?? current.flightaware,
    };
  }, [flightInfo.data, liveSelected, selectedFlight]);

  const track = useQuery({
    queryKey: ["track", detailsFlight?.icao24, detailsFlight?.primary_time ?? detailsFlight?.first_seen ?? 0],
    queryFn: ({ signal }) => api.track(detailsFlight!.icao24, detailsFlight!.primary_time ?? detailsFlight!.first_seen ?? 0, signal),
    enabled: Boolean(detailsFlight),
    retry: false,
  });

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
    if (!request && !selectedFlight && mapView) {
      params.set("at", `${mapView.latitude.toFixed(3)},${mapView.longitude.toFixed(3)},${mapView.zoom}`);
    }
    if (selectedFlight) {
      params.set("icao24", selectedFlight.icao24);
      const time = selectedFlight.primary_time ?? selectedFlight.first_seen;
      if (time) params.set("time", String(time));
    }
    const next = params.toString() ? `${window.location.pathname}?${params}` : window.location.pathname;
    window.history.replaceState(null, "", next);
  }, [airportView, mapView, request, selectedFlight]);

  const titleAirport = request ? request.airport.iata || request.airport.icao : null;
  useEffect(() => {
    document.title = detailsFlight ? `${detailsFlight.callsign || detailsFlight.icao24.toUpperCase()} · SkyTrace`
      : titleAirport ? `${titleAirport} · SkyTrace` : "SkyTrace · Live flight tracker";
  }, [detailsFlight?.callsign, detailsFlight?.icao24, titleAirport]); // eslint-disable-line react-hooks/exhaustive-deps

  // Keeps the mobile browser chrome in step with the map theme.
  useEffect(() => {
    document.querySelector('meta[name="theme-color"]')?.setAttribute("content", THEME_COLORS[theme] ?? THEME_COLORS.dark);
  }, [theme]);

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
    }
    window.addEventListener("keydown", handleGlobalKeys);
    return () => window.removeEventListener("keydown", handleGlobalKeys);
  }, [tourOpen]);

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

  const selectFlight = useCallback((flight: Flight) => {
    setPreviewFlight(null);
    setSelectedFlight(flight);
  }, []);

  const openAirport = useCallback((airport: Airport, options: { date?: string; mode?: FlightMode } = {}) => {
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
      <a className="skip-link" href="#flight-results">Skip to flight results</a>
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

      <main className={`workspace ${dockOpen ? "has-dock" : ""} ${trafficOpen ? "traffic-open" : ""}`}>
        <FlightMap
          // A shared map position wins over the home airport until one is opened.
          airport={request?.airport ?? (sharedView ? null : homeAirport)}
          initialView={sharedView}
          onViewChange={setMapView}
          airports={airportPinsEnabled ? favoriteAirportsOnly ? favorites : mapAirports : []}
          nearbyAirports={mapAirports}
          airportCatalogLoading={airportCatalog.isPending}
          airportCatalogError={airportCatalog.isError}
          onRetryAirportCatalog={() => { void airportCatalog.refetch(); }}
          selectedFlight={selectedFlight}
          previewFlight={previewFlight}
          track={track.data}
          theme={theme}
          filters={filters}
          labelsEnabled={labelsEnabled}
          liveEnabled={liveEnabled && liveAvailable}
          liveAvailable={liveAvailable}
          liveProbePending={health.isPending}
          expanded={mapExpanded}
          onToggleLive={() => liveAvailable ? setLiveEnabled(!liveEnabled) : setToast("Live traffic is not available right now.")}
          onToggleExpanded={() => setMapExpanded(!mapExpanded)}
          onSelectFlight={selectFlight}
          onSelectAirport={openAirport}
          onLiveSnapshot={handleLiveSnapshot}
          onViewportCenter={setMapCenter}
        />

        <MapToolbar
          filters={filters}
          onFiltersChange={setFilters}
          labelsEnabled={labelsEnabled}
          onLabelsChange={setLabelsEnabled}
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
            </motion.div>
          )}
        </AnimatePresence>

        <AnimatePresence>
          {detailsFlight && !mapExpanded && (
            <FlightDetails
              flight={detailsFlight}
              track={track.data}
              trackLoading={track.isFetching}
              trackError={track.error ? readableApiError(track.error) : undefined}
              routeLoading={(flightInfo.isFetching && !flightInfo.data) || endAirports.isFetching}
              photo={photo.data}
              photoLoading={photo.isPending && photo.fetchStatus !== "idle"}
              photoError={photo.isError}
              airports={knownAirports}
              onRetryTrack={() => track.refetch()}
              onClose={() => setSelectedFlight(null)}
              onShare={shareView}
            />
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
              transition={{ type: "spring", stiffness: 420, damping: 40, mass: 0.9 }}
            >
              <TrafficPanel
                tab={tab}
                onTabChange={setTab}
                onClose={() => setTrafficOpen(false)}
                liveCount={liveSummary.total}
                airportLabel={airportCode}
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
                    heading={boardHeading}
                  >
                    <div className="stats-row">
                      <div><strong className="mono">{airportSummary?.total ?? 0}</strong><span>{showingLiveFallback ? "Live aircraft" : "Flights"}</span></div>
                      <div><strong className="mono">{airportSummary?.live_airborne ?? 0}</strong><span>Airborne</span></div>
                      <div><strong className="mono">{airportSummary?.unique_airlines ?? 0}</strong><span>Airlines</span></div>
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
                )}
              />
            </motion.div>
          )}
        </AnimatePresence>
        {!trafficOpen && !mapExpanded && (
          <button type="button" className="traffic-reopen" onClick={() => setTrafficOpen(true)} aria-label="Open traffic panel">
            <List size={15} aria-hidden="true" />
            <span>Traffic</span>
            <b className="mono">{liveSummary.total}</b>
          </button>
        )}
      </main>

      {tourOpen && <Onboarding onClose={closeTour} />}
      <AnimatePresence>{shortcutsOpen && <ShortcutsDialog onClose={closeShortcuts} />}</AnimatePresence>

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
