import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { Activity, CalendarDays, ChevronDown, Heart, PlaneLanding, PlaneTakeoff, Search, X } from "lucide-react";
import { api, readableApiError } from "./api";
import { AirportSearch } from "./components/AirportSearch";
import { FlightDetails } from "./components/FlightDetails";
import { FlightList } from "./components/FlightList";
import { FlightMap } from "./components/FlightMap";
import { Topbar } from "./components/Topbar";
import { usePersistentState } from "./hooks/usePersistentState";
import type { Airport, Flight, FlightMode, LiveFlightsResponse, MapTheme } from "./types";
import { todayUtc } from "./utils";

interface FlightRequest {
  airport: Airport;
  date: string;
  mode: FlightMode;
}

interface LiveFallbackSnapshot {
  airportIcao: string | null;
  data: LiveFlightsResponse;
}

function liveSnapshotSummary(flights: Flight[]) {
  return {
    total: flights.length,
    live_airborne: flights.filter((flight) => flight.status === "airborne" || flight.on_ground === false).length,
    live_on_ground: flights.filter((flight) => flight.status === "on_ground" || flight.on_ground === true).length,
    unique_airlines: new Set(flights.map((flight) => flight.airline_code).filter(Boolean)).size,
  };
}

export function App() {
  const [initialParams] = useState(() => new URLSearchParams(window.location.search));
  const [theme, setTheme] = usePersistentState<MapTheme>("skytrace-theme", "dark");
  const [favorites, setFavorites] = usePersistentState<Airport[]>("skytrace-favorites", []);
  const [recent, setRecent] = usePersistentState<Airport[]>("skytrace-recent", []);
  const [liveEnabled, setLiveEnabled] = usePersistentState("skytrace-live", true);
  const [selectedAirport, setSelectedAirport] = useState<Airport | null>(null);
  const [date, setDate] = useState(initialParams.get("date") || todayUtc());
  const [mode, setMode] = useState<FlightMode>(initialParams.get("mode") === "arrival" ? "arrival" : "departure");
  const [request, setRequest] = useState<FlightRequest | null>(null);
  const [selectedFlight, setSelectedFlight] = useState<Flight | null>(null);
  const [mobileControlsOpen, setMobileControlsOpen] = useState(false);
  const [mobileResultsExpanded, setMobileResultsExpanded] = useState(false);
  const [mapExpanded, setMapExpanded] = useState(false);
  const [toast, setToast] = useState<string | null>(null);
  const [commandQuery, setCommandQuery] = useState("");
  const [commandPending, setCommandPending] = useState(false);
  const [previewFlight, setPreviewFlight] = useState<Flight | null>(null);
  const [liveFallbackSnapshot, setLiveFallbackSnapshot] = useState<LiveFallbackSnapshot | null>(null);
  const restoredAirport = useRef(false);
  const restoredFlight = useRef(false);

  const handleLiveSnapshot = useCallback((data: LiveFlightsResponse, airportIcao: string | null) => {
    setLiveFallbackSnapshot({ data, airportIcao });
  }, []);

  const health = useQuery({ queryKey: ["health"], queryFn: api.health, retry: false });
  const liveAvailable = health.data?.live_available ?? health.data?.credentials_configured ?? false;
  const popular = useQuery({ queryKey: ["popular-airports"], queryFn: api.popularAirports });
  const initialCode = initialParams.get("airport");
  const initialAirport = useQuery({
    queryKey: ["initial-airport", initialCode],
    queryFn: () => api.searchAirports(initialCode!),
    enabled: Boolean(initialCode),
    staleTime: Infinity,
  });

  useEffect(() => {
    if (restoredAirport.current) return;

    if (initialCode) {
      const fromUrl = initialAirport.data?.find((airport) => airport.icao === initialCode.toUpperCase());
      if (!fromUrl) return;
      restoredAirport.current = true;
      if (selectedAirport?.icao !== fromUrl.icao) setSelectedAirport(fromUrl);
      if (!request) setRequest({ airport: fromUrl, date, mode });
      return;
    }

    if (!selectedAirport && popular.data?.length) {
      restoredAirport.current = true;
      const fallback = recent[0] || popular.data.find((airport) => airport.icao === "LFPG") || popular.data[0];
      setSelectedAirport(fallback);
    }
  }, [date, initialAirport.data, initialCode, mode, popular.data, recent, request, selectedAirport]);

  const flights = useQuery({
    queryKey: ["flights", request?.airport.icao, request?.date, request?.mode],
    queryFn: () => api.flights(request!.airport.icao, request!.date, request!.mode),
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

  const track = useQuery({
    queryKey: ["track", selectedFlight?.icao24, selectedFlight?.primary_time ?? selectedFlight?.first_seen ?? 0],
    queryFn: () => api.track(selectedFlight!.icao24, selectedFlight!.primary_time ?? selectedFlight!.first_seen ?? 0),
    enabled: Boolean(selectedFlight),
    retry: false,
  });

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

  const detailsFlight = useMemo(() => {
    if (!selectedFlight || !flightInfo.data || flightInfo.data.icao24 !== selectedFlight.icao24) return selectedFlight;
    const info = flightInfo.data;
    return {
      ...selectedFlight,
      callsign: info.callsign || selectedFlight.callsign,
      airline_code: info.airline_code || selectedFlight.airline_code,
      airline_name: info.airline_name || selectedFlight.airline_name,
      departure_airport: info.departure_airport ?? selectedFlight.departure_airport,
      departure_airport_name: info.departure_airport_name ?? selectedFlight.departure_airport_name,
      arrival_airport: info.arrival_airport ?? selectedFlight.arrival_airport,
      arrival_airport_name: info.arrival_airport_name ?? selectedFlight.arrival_airport_name,
      first_seen: info.first_seen ?? selectedFlight.first_seen,
      last_seen: info.last_seen ?? selectedFlight.last_seen,
      route_source: info.route_source ?? selectedFlight.route_source,
      route_provider: info.route_provider ?? selectedFlight.route_provider,
      registration: info.registration ?? selectedFlight.registration,
      aircraft_type: info.aircraft_type ?? selectedFlight.aircraft_type,
      aircraft_description: info.aircraft_description ?? selectedFlight.aircraft_description,
      aircraft_owner: info.aircraft_owner ?? selectedFlight.aircraft_owner,
      aircraft_year: info.aircraft_year ?? selectedFlight.aircraft_year,
      aircraft_category: info.aircraft_category ?? selectedFlight.aircraft_category,
      emergency: info.emergency ?? selectedFlight.emergency,
      nav_qnh: info.nav_qnh ?? selectedFlight.nav_qnh,
      nav_altitude_mcp: info.nav_altitude_mcp ?? selectedFlight.nav_altitude_mcp,
      nav_heading: info.nav_heading ?? selectedFlight.nav_heading,
      nav_modes: info.nav_modes ?? selectedFlight.nav_modes,
      messages: info.messages ?? selectedFlight.messages,
      rssi: info.rssi ?? selectedFlight.rssi,
      seen_seconds: info.seen_seconds ?? selectedFlight.seen_seconds,
      seen_position_seconds: info.seen_position_seconds ?? selectedFlight.seen_position_seconds,
      nic: info.nic ?? selectedFlight.nic,
      rc: info.rc ?? selectedFlight.rc,
      nac_p: info.nac_p ?? selectedFlight.nac_p,
      nac_v: info.nac_v ?? selectedFlight.nac_v,
      sil: info.sil ?? selectedFlight.sil,
      sil_type: info.sil_type ?? selectedFlight.sil_type,
      source: info.source ?? selectedFlight.source,
      squawk: info.squawk ?? selectedFlight.squawk,
      category: info.category ?? selectedFlight.category,
      last_contact: info.last_contact ?? selectedFlight.last_contact,
      time_position: info.time_position ?? selectedFlight.time_position,
      flightaware: info.flightaware ?? selectedFlight.flightaware,
    };
  }, [flightInfo.data, selectedFlight]);

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
    if (!toast) return;
    const timer = window.setTimeout(() => setToast(null), 2800);
    return () => window.clearTimeout(timer);
  }, [toast]);

  useEffect(() => {
    function handleEscape(event: KeyboardEvent) {
      if (event.key !== "Escape") return;
      if (mapExpanded) setMapExpanded(false);
      else if (mobileControlsOpen) setMobileControlsOpen(false);
      else if (selectedFlight) setSelectedFlight(null);
    }
    window.addEventListener("keydown", handleEscape);
    return () => window.removeEventListener("keydown", handleEscape);
  }, [mapExpanded, mobileControlsOpen, selectedFlight]);

  const matchingLiveSnapshot = Boolean(
    request
      && liveFallbackSnapshot?.airportIcao === request.airport.icao
      && liveFallbackSnapshot.data.states.length,
  );
  const livePreviewDuringLoad = Boolean(flights.isFetching && matchingLiveSnapshot);
  const clientLiveFallback = Boolean(flights.data?.source === "unavailable" && matchingLiveSnapshot);
  const displayedFlights = clientLiveFallback || livePreviewDuringLoad ? liveFallbackSnapshot?.data.states ?? [] : flights.data?.flights ?? [];
  const showingLiveFallback = flights.data?.source === "live-nearby" || clientLiveFallback;
  const summary = clientLiveFallback || livePreviewDuringLoad
    ? liveSnapshotSummary(displayedFlights)
    : flights.data?.summary;
  const displayNotice = livePreviewDuringLoad
    ? `Loading recorded ${request?.mode}s · showing current live traffic around ${request?.airport.icao} meanwhile.`
    : clientLiveFallback
    ? `OpenSky history is unavailable for ${request?.date}. Showing the live map snapshot around ${request?.airport.icao}; these are not recorded ${request?.mode}s.`
    : flights.data?.notice;
  const requestTitle = request
    ? showingLiveFallback
      ? `Live traffic around ${request.airport.iata || request.airport.icao}`
      : `${request.mode === "departure" ? "Departures from" : "Arrivals at"} ${request.airport.iata || request.airport.icao}`
    : "Flight movements";
  const favoriteCodes = useMemo(() => new Set(favorites.map((airport) => airport.icao)), [favorites]);
  const activeAirport = request?.airport ?? selectedAirport;
  const sourceLabel = showingLiveFallback ? "Live snapshot" : request ? "Recorded history" : "Ready to scan";

  async function handleCommandSubmit() {
    const query = commandQuery.trim();
    if (!query) {
      setMobileControlsOpen(true);
      return;
    }
    const normalized = query.toLowerCase();
    const flightMatch = displayedFlights.find((flight) => [
      flight.callsign,
      flight.icao24,
      flight.airline_name,
      flight.departure_airport,
      flight.arrival_airport,
    ].some((value) => value?.toLowerCase().includes(normalized)));
    if (flightMatch) {
      setPreviewFlight(null);
      setSelectedFlight(flightMatch);
      setCommandQuery("");
      return;
    }

    setCommandPending(true);
    try {
      const matches = await api.searchAirports(query);
      const airportMatch = matches[0];
      if (!airportMatch) {
        setToast("No airport, flight or callsign found.");
        return;
      }
      setSelectedAirport(airportMatch);
      setRequest({ airport: airportMatch, date, mode });
      setSelectedFlight(null);
      setPreviewFlight(null);
      setLiveFallbackSnapshot(null);
      setRecent([airportMatch, ...recent.filter((item) => item.icao !== airportMatch.icao)].slice(0, 6));
      setCommandQuery("");
      setMobileControlsOpen(false);
    } catch (error) {
      setToast(readableApiError(error));
    } finally {
      setCommandPending(false);
    }
  }

  function submitSearch() {
    if (!selectedAirport) {
      setToast("Select an airport before loading flights.");
      return;
    }
    const nextRequest = { airport: selectedAirport, date, mode };
    setRequest(nextRequest);
    setSelectedFlight(null);
    if (liveFallbackSnapshot?.airportIcao !== selectedAirport.icao) setLiveFallbackSnapshot(null);
    setRecent([selectedAirport, ...recent.filter((item) => item.icao !== selectedAirport.icao)].slice(0, 6));
    setMobileControlsOpen(false);
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

  return (
    <div className={`app theme-${theme} ${mapExpanded ? "map-expanded" : ""}`}>
      <a className="skip-link" href="#flight-results">Skip to flight results</a>
      <Topbar
        health={health.data}
        healthPending={health.isPending}
        theme={theme}
        onToggleTheme={() => setTheme(theme === "dark" ? "light" : "dark")}
        onToggleControls={() => setMobileControlsOpen(true)}
        commandValue={commandQuery}
        commandPending={commandPending}
        onCommandChange={setCommandQuery}
        onCommandSubmit={handleCommandSubmit}
      />

      <main className="workspace">
        {mobileControlsOpen && <button type="button" className="mobile-scrim" aria-label="Dismiss search panel" onClick={() => setMobileControlsOpen(false)} />}
        <FlightMap
          airport={request?.airport ?? selectedAirport}
          selectedFlight={selectedFlight}
          previewFlight={previewFlight}
          track={track.data}
          theme={theme}
          liveEnabled={liveEnabled && liveAvailable}
          liveAvailable={liveAvailable}
          expanded={mapExpanded}
          onToggleLive={() => liveAvailable ? setLiveEnabled(!liveEnabled) : setToast("Add OpenSky credentials to enable live traffic.")}
          onToggleExpanded={() => setMapExpanded(!mapExpanded)}
          onSelectFlight={setSelectedFlight}
          onLiveSnapshot={handleLiveSnapshot}
        />

        <aside className={`query-panel glass-panel ${mobileControlsOpen ? "mobile-open" : ""}`} aria-label="Flight search controls">
          <div className="sheet-handle query-sheet-handle" aria-hidden="true" />
          <div className="mobile-panel-heading">
            <div><strong>Flight search</strong></div>
            <button className="icon-button" type="button" onClick={() => setMobileControlsOpen(false)} aria-label="Close search"><X size={19} /></button>
          </div>
          <div className="panel-rail-head">
            <div className="panel-rail-mark"><Activity size={18} aria-hidden="true" /></div>
            <div>
              <strong>Scan a region</strong>
            </div>
          </div>
          <div className="panel-intro">
            <h1>Find a flight.<br /><em>Follow its story.</em></h1>
            <p>Search a field, open the live airspace, then follow every movement with its source and altitude.</p>
          </div>
          <div className="panel-context" role="status">
            <span className="panel-context-icon"><Activity size={15} aria-hidden="true" /></span>
            <span className="panel-context-copy">
              <strong>{activeAirport ? `${activeAirport.iata || activeAirport.icao} airspace` : "European airspace"}</strong>
              <small>{liveAvailable ? "ADS-B network connected" : "Historical search available"}</small>
            </span>
            <span className={`panel-context-state ${liveAvailable ? "online" : "offline"}`}>{liveAvailable ? "LIVE" : "OFFLINE"}</span>
          </div>
          <div className="panel-signal-row" aria-label="Current data sources">
            <span><i className="signal-bar signal-bar-live" />ADS-B</span>
            <span><i className="signal-bar signal-bar-history" />History</span>
            <span><i className="signal-bar signal-bar-route" />Routes</span>
          </div>
          <AirportSearch
            selected={selectedAirport}
            popular={popular.data ?? []}
            recent={recent}
            favorites={favorites}
            onSelect={setSelectedAirport}
            onClear={() => setSelectedAirport(null)}
            onToggleFavorite={toggleFavorite}
          />
          <div className="query-grid">
            <label className="date-control">
              <span className="field-label">UTC date</span>
              <span className="control-shell"><CalendarDays size={16} /><input type="date" value={date} onChange={(event) => setDate(event.target.value)} /></span>
            </label>
            <div>
              <span className="field-label">Movement</span>
              <div className="mode-switch" role="group" aria-label="Movement type">
                <button type="button" className={mode === "departure" ? "active" : ""} aria-pressed={mode === "departure"} onClick={() => setMode("departure")}><PlaneTakeoff size={15} /> Departures</button>
                <button type="button" className={mode === "arrival" ? "active" : ""} aria-pressed={mode === "arrival"} onClick={() => setMode("arrival")}><PlaneLanding size={15} /> Arrivals</button>
              </div>
            </div>
          </div>
          <button type="button" className="primary-button" onClick={submitSearch} disabled={!selectedAirport || flights.isFetching}>
            <Search size={17} /> {flights.isFetching ? "Loading traffic…" : "Explore flights"}
          </button>

          {favorites.length > 0 && (
            <div className="favorite-strip">
              <span><Heart size={12} /> Favorites</span>
              <div>{favorites.slice(0, 5).map((airport) => <button type="button" key={airport.icao} onClick={() => setSelectedAirport(airport)} className="mono">{airport.iata || airport.icao}</button>)}</div>
            </div>
          )}
          <div className="data-note">
            <span className={`system-dot ${liveAvailable ? "online" : "warning"}`} />
            <span>{liveAvailable ? "Live ADS-B enabled · select an aircraft" : "OpenSky credentials required for live data"}</span>
            <span className="data-note-code mono">ST-01</span>
          </div>
        </aside>

        <section className={`results-panel glass-panel ${mobileResultsExpanded ? "mobile-expanded" : ""}`} id="flight-results">
          <div className="sheet-handle results-sheet-handle" aria-hidden="true" />
          <header className="results-heading">
            <div className="results-heading-copy">
              <h2>{requestTitle}</h2>
              <p>{request ? `${request.date} · UTC · ${request.airport.display_name}` : "Traffic board · select an airport to begin"}</p>
            </div>
            <div className="results-heading-actions">
              <span className={`source-pill ${showingLiveFallback ? "live" : request ? "history" : "ready"}`} role="status">
                <span className="source-pill-dot" />
                <span>{sourceLabel}</span>
              </span>
              <button
                type="button"
                className="mobile-results-toggle"
                aria-label={mobileResultsExpanded ? "Collapse flight results" : "Expand flight results"}
                aria-expanded={mobileResultsExpanded}
                onClick={() => setMobileResultsExpanded(!mobileResultsExpanded)}
              >
                <ChevronDown size={18} />
              </button>
            </div>
          </header>
          <div className="stats-row">
            <div><strong className="mono">{summary?.total ?? 0}</strong><span>{showingLiveFallback ? "Live aircraft" : "Total flights"}</span></div>
            <div><strong className="mono accent">{summary?.live_airborne ?? 0}</strong><span>Airborne</span></div>
            <div><strong className="mono">{summary?.unique_airlines ?? 0}</strong><span>Airlines</span></div>
          </div>
          <FlightList
            flights={displayedFlights}
            selectedFlight={selectedFlight}
            loading={flights.isFetching}
            errorMessage={flights.error ? readableApiError(flights.error) : undefined}
            notice={displayNotice}
            hasSearched={Boolean(request)}
            onSelect={(flight) => { setPreviewFlight(null); setSelectedFlight(flight); }}
            onPreview={setPreviewFlight}
            onRetry={() => flights.refetch()}
          />
        </section>

        {detailsFlight && (
          <FlightDetails
            flight={detailsFlight}
            track={track.data}
            trackLoading={track.isFetching}
            trackError={track.error ? readableApiError(track.error) : undefined}
            routeLoading={flightInfo.isFetching && !flightInfo.data}
            routeError={flightInfo.error ? readableApiError(flightInfo.error) : undefined}
            onRetryTrack={() => track.refetch()}
            onClose={() => setSelectedFlight(null)}
            onShare={shareFlight}
          />
        )}
      </main>

      {toast && <div className="toast" role="status">{toast}</div>}
    </div>
  );
}
