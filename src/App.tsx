import { useEffect, useMemo, useRef, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { CalendarDays, ChevronDown, Heart, PlaneLanding, PlaneTakeoff, Search, X } from "lucide-react";
import { api, readableApiError } from "./api";
import { AirportSearch } from "./components/AirportSearch";
import { FlightDetails } from "./components/FlightDetails";
import { FlightList } from "./components/FlightList";
import { FlightMap } from "./components/FlightMap";
import { Topbar } from "./components/Topbar";
import { usePersistentState } from "./hooks/usePersistentState";
import type { Airport, Flight, FlightMode, MapTheme } from "./types";
import { todayUtc } from "./utils";

interface FlightRequest {
  airport: Airport;
  date: string;
  mode: FlightMode;
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
  const restoredAirport = useRef(false);
  const restoredFlight = useRef(false);

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

  const summary = flights.data?.summary;
  const requestTitle = request
    ? `${request.mode === "departure" ? "Departures from" : "Arrivals at"} ${request.airport.iata || request.airport.icao}`
    : "Flight movements";
  const favoriteCodes = useMemo(() => new Set(favorites.map((airport) => airport.icao)), [favorites]);

  function submitSearch() {
    if (!selectedAirport) {
      setToast("Select an airport before loading flights.");
      return;
    }
    const nextRequest = { airport: selectedAirport, date, mode };
    setRequest(nextRequest);
    setSelectedFlight(null);
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
      />

      <main className="workspace">
        {mobileControlsOpen && <button type="button" className="mobile-scrim" aria-label="Dismiss search panel" onClick={() => setMobileControlsOpen(false)} />}
        <FlightMap
          airport={request?.airport ?? selectedAirport}
          selectedFlight={selectedFlight}
          track={track.data}
          theme={theme}
          liveEnabled={liveEnabled && liveAvailable}
          liveAvailable={liveAvailable}
          expanded={mapExpanded}
          onToggleLive={() => liveAvailable ? setLiveEnabled(!liveEnabled) : setToast("Add OpenSky credentials to enable live traffic.")}
          onToggleExpanded={() => setMapExpanded(!mapExpanded)}
          onSelectFlight={setSelectedFlight}
        />

        <aside className={`query-panel glass-panel ${mobileControlsOpen ? "mobile-open" : ""}`} aria-label="Flight search controls">
          <div className="mobile-panel-heading">
            <div><span className="eyebrow">Explore traffic</span><strong>Flight search</strong></div>
            <button className="icon-button" type="button" onClick={() => setMobileControlsOpen(false)} aria-label="Close search"><X size={19} /></button>
          </div>
          <div className="panel-intro">
            <span className="eyebrow">Explore traffic</span>
            <h1>Find a flight.<br /><em>Follow its story.</em></h1>
            <p>Live and historical movement data from the OpenSky network.</p>
          </div>
          <AirportSearch
            selected={selectedAirport}
            popular={popular.data ?? []}
            recent={recent}
            favorites={favorites}
            onSelect={setSelectedAirport}
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
          </div>
        </aside>

        <section className={`results-panel glass-panel ${mobileResultsExpanded ? "mobile-expanded" : ""}`} id="flight-results">
          <header className="results-heading">
            <div>
              <span className="eyebrow">{request ? `${request.date} · UTC` : "OpenSky movement data"}</span>
              <h2>{requestTitle}</h2>
            </div>
            <button
              type="button"
              className="mobile-results-toggle"
              aria-label={mobileResultsExpanded ? "Collapse flight results" : "Expand flight results"}
              aria-expanded={mobileResultsExpanded}
              onClick={() => setMobileResultsExpanded(!mobileResultsExpanded)}
            >
              <ChevronDown size={18} />
            </button>
          </header>
          <div className="stats-row">
            <div><strong className="mono">{summary?.total ?? 0}</strong><span>Total flights</span></div>
            <div><strong className="mono accent">{summary?.live_airborne ?? 0}</strong><span>Airborne</span></div>
            <div><strong className="mono">{summary?.unique_airlines ?? 0}</strong><span>Airlines</span></div>
          </div>
          <FlightList
            flights={flights.data?.flights ?? []}
            selectedFlight={selectedFlight}
            loading={flights.isFetching}
            errorMessage={flights.error ? readableApiError(flights.error) : undefined}
            notice={flights.data?.notice}
            hasSearched={Boolean(request)}
            onSelect={setSelectedFlight}
            onRetry={() => flights.refetch()}
          />
        </section>

        {selectedFlight && (
          <FlightDetails
            flight={selectedFlight}
            track={track.data}
            trackLoading={track.isFetching}
            trackError={track.error ? readableApiError(track.error) : undefined}
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
