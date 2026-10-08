import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { flushSync } from "react-dom";
import { useQuery } from "@tanstack/react-query";
import { AnimatePresence, motion } from "motion/react";
import { TriangleAlert } from "./components/icons";
import { List } from "./components/customIcons";
import { aircraftPhoto, api, readableApiError } from "./api";
import { AirportTab } from "./components/AirportTab";
import { FlightDetails } from "./components/FlightDetails";
import { FlightList } from "./components/FlightList";
import { FlightMap } from "./components/FlightMap";
import { MapToolbar } from "./components/MapToolbar";
import { OmniSearch } from "./components/OmniSearch";
import { Topbar } from "./components/Topbar";
import { TrafficPanel, type TrafficTab } from "./components/TrafficPanel";
import { usePersistentState } from "./hooks/usePersistentState";
import { NO_FILTERS, activeFilterCount, filterAircraft, type MapFilters } from "./mapFilters";
import type { Airport, Flight, FlightMode, LiveAircraft, LiveFlightsResponse, MapTheme } from "./types";
import { emergencyInfo, liveAircraftToFlight, todayUtc } from "./utils";

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

export function App() {
  const [initialParams] = useState(() => new URLSearchParams(window.location.search));
  const [theme, setTheme] = usePersistentState<MapTheme>("skytrace-theme", "dark");
  const [favorites, setFavorites] = usePersistentState<Airport[]>("skytrace-favorites", []);
  const [recent, setRecent] = usePersistentState<Airport[]>("skytrace-recent", []);
  const [liveEnabled, setLiveEnabled] = usePersistentState("skytrace-live", true);
  const [labelsEnabled, setLabelsEnabled] = usePersistentState("skytrace-labels", true);
  const [favoriteAirportsOnly, setFavoriteAirportsOnly] = usePersistentState("skytrace-favorite-airports-only", false);
  const [airportPinsEnabled, setAirportPinsEnabled] = usePersistentState("skytrace-airport-pins", true);
  const [trafficOpen, setTrafficOpen] = usePersistentState("skytrace-traffic-open", window.innerWidth > 900);
  const [filters, setFilters] = useState<MapFilters>(NO_FILTERS);
  const [tab, setTab] = useState<TrafficTab>(initialParams.get("airport") ? "airport" : "live");
  const [homeAirport, setHomeAirport] = useState<Airport | null>(null);
  const [date, setDate] = useState(initialParams.get("date") || todayUtc());
  const [mode, setMode] = useState<FlightMode>(initialParams.get("mode") === "arrival" ? "arrival" : "departure");
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
    enabled: Boolean(request),
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

  // A shared link to a live aircraft carries no airport: look the aircraft up
  // directly instead of waiting for it to scroll into the default map view.
  const sharedIcao24 = !initialCode ? initialParams.get("icao24") : null;
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
      params.set("date", request.date);
      params.set("mode", request.mode);
    }
    if (selectedFlight) {
      params.set("icao24", selectedFlight.icao24);
      const time = selectedFlight.primary_time ?? selectedFlight.first_seen;
      if (time) params.set("time", String(time));
    }
    const next = params.toString() ? `${window.location.pathname}?${params}` : window.location.pathname;
    window.history.replaceState(null, "", next);
  }, [request, selectedFlight]);

  useEffect(() => {
    document.title = detailsFlight ? `${detailsFlight.callsign || detailsFlight.icao24.toUpperCase()} · SkyTrace` : "SkyTrace · Live flight tracker";
  }, [detailsFlight?.callsign, detailsFlight?.icao24]); // eslint-disable-line react-hooks/exhaustive-deps

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
      const typing = event.target instanceof Element
        && event.target.closest("input, textarea, select, [contenteditable='true']");
      const shortcut = event.key.toLowerCase() === "k" && (event.metaKey || event.ctrlKey);
      if (!shortcut && (event.key !== "/" || typing)) return;
      event.preventDefault();
      setSearchFocusRequest((current) => current + 1);
    }
    window.addEventListener("keydown", focusSearch);
    return () => window.removeEventListener("keydown", focusSearch);
  }, []);

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
    ? `Loading recorded ${request?.mode}s · showing current live traffic around ${request?.airport.icao} meanwhile.`
    : clientLiveFallback
    ? `OpenSky history is unavailable for ${request?.date}. Showing the live map snapshot around ${request?.airport.icao}; these are not recorded ${request?.mode}s.`
    : flights.data?.source === "live-nearby"
    ? `${flights.data.notice || "History unavailable."} Aircraft observed near this airport may be passing overhead; they are not confirmed arrivals or departures.`
    : flights.data?.notice;
  const airportCode = request ? request.airport.iata || request.airport.icao : null;
  const boardHeading = request ? {
    title: showingLiveFallback
      ? `Live traffic around ${airportCode}`
      : `${request.mode === "departure" ? "Departures from" : "Arrivals at"} ${airportCode}`,
    subtitle: showingLiveFallback ? `Current observations · ${request.airport.name}` : `${request.date} · UTC · ${request.airport.name}`,
    source: showingLiveFallback ? "Nearby traffic" : flights.isFetching ? "Loading history" : flights.data?.source === "unavailable" || flights.isError ? "History unavailable" : "Recorded",
    tone: showingLiveFallback ? "live" as const : "history" as const,
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
    const reduced = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
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

  function toggleFavorite(airport: Airport) {
    setFavorites(favoriteCodes.has(airport.icao)
      ? favorites.filter((item) => item.icao !== airport.icao)
      : [airport, ...favorites].slice(0, 8));
  }

  async function shareFlight() {
    try {
      await navigator.clipboard.writeText(window.location.href);
      setToast("Share link copied to clipboard.");
    } catch {
      setToast("Copy this page URL to share the selected flight.");
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
        search={(
          <OmniSearch
            focusRequest={searchFocusRequest}
            aircraft={liveStates}
            recent={recent}
            popular={popular.data ?? []}
            onSelectAircraft={(aircraft) => selectFlight(liveAircraftToFlight(aircraft))}
            onSelectAirport={openAirport}
          />
        )}
      />

      <main className={`workspace ${dockOpen ? "has-dock" : ""} ${trafficOpen ? "traffic-open" : ""}`}>
        <FlightMap
          airport={request?.airport ?? homeAirport}
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
          onToggleLive={() => liveAvailable ? setLiveEnabled(!liveEnabled) : setToast("Add OpenSky credentials to enable live traffic.")}
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
              routeLoading={flightInfo.isFetching && !flightInfo.data}
              routeError={flightInfo.error ? readableApiError(flightInfo.error) : undefined}
              photo={photo.data}
              photoLoading={photo.isPending && photo.fetchStatus !== "idle"}
              photoError={photo.isError}
              airports={knownAirports}
              onRetryTrack={() => track.refetch()}
              onClose={() => setSelectedFlight(null)}
              onShare={shareFlight}
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
                    onDateChange={changeDate}
                    onModeChange={changeMode}
                    onSelect={openAirport}
                    onClear={() => undefined}
                    onToggleFavorite={toggleFavorite}
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
