import { memo, useMemo, useState, type KeyboardEvent } from "react";
import { ArrowDownUp, Filter, Plane, Search, TrendDown, TrendUp, TriangleAlert } from "./icons";
import { usePersistentState } from "../hooks/usePersistentState";
import type { Flight } from "../types";
import { distanceKm, emergencyInfo, flightId, formatAltitude, formatSpeed, formatTime, routeLabel, statusLabel, verticalTrend } from "../utils";

type StatusFilter = "all" | "airborne" | "on_ground" | "completed";
type SortOrder = "time_desc" | "time_asc" | "airline_asc" | "distance_asc";

interface FlightListProps {
  flights: Flight[];
  selectedFlight: Flight | null;
  loading: boolean;
  errorMessage?: string;
  notice?: string;
  hasSearched: boolean;
  onSelect: (flight: Flight) => void;
  onPreview?: (flight: Flight | null) => void;
  onRetry: () => void;
  /** Map centre for the "Nearest" sort; live positions are measured from it. */
  referencePoint?: [number, number] | null;
}

interface FlightCardProps {
  flight: Flight;
  selected: boolean;
  onSelect: (flight: Flight) => void;
  onPreview?: (flight: Flight | null) => void;
}

const FlightCard = memo(function FlightCard({ flight, selected, onSelect, onPreview }: FlightCardProps) {
  const status = statusLabel(flight.status, flight.on_ground);
  const time = flight.primary_time ?? flight.first_seen ?? flight.last_seen;
  const emergency = emergencyInfo(flight);
  const trend = flight.on_ground ? null : verticalTrend(flight.vertical_rate);
  const airframe = [flight.registration_source === "schedule" ? null : flight.registration, flight.aircraft_type].filter(Boolean).join(" · ");
  const operator = flight.airline_name || airframe || "Unidentified operator";
  const statusKey = flight.status || (flight.on_ground === true ? "on_ground" : flight.on_ground === false ? "airborne" : "unknown");
  return (
    <button
      type="button"
      className={`flight-card ${selected ? "selected" : ""} ${emergency ? "is-emergency" : ""}`}
      onClick={() => onSelect(flight)}
      onMouseEnter={() => onPreview?.(flight)}
      onMouseLeave={() => onPreview?.(null)}
      onFocus={() => onPreview?.(flight)}
      onBlur={() => onPreview?.(null)}
      aria-pressed={selected}
    >
      <span className="flight-card-main">
        <span className="flight-identity">
          <span className="callsign-row">
            <span className={`status-dot status-${statusKey}`} aria-hidden="true" />
            <span className="callsign mono">{flight.callsign || flight.icao24.toUpperCase()}</span>
          </span>
          <span className="airline">{operator}{flight.airline_name && airframe ? <span className="airframe"> · {airframe}</span> : null}</span>
        </span>
        <span className="route mono">{routeLabel(flight)}</span>
        <span className="flight-meta">
          {emergency
            ? <span className="flight-emergency"><TriangleAlert size={11} aria-hidden="true" /> {emergency.code} · {emergency.label}</span>
            : <span className={`flight-status-label status-text-${statusKey}`}>{status}</span>}
          {time != null && <>
            <span>·</span>
            <span>{formatTime(time)} UTC</span>
          </>}
          <span className="flight-meta-divider" aria-hidden="true" />
          <span className="flight-altitude">
            {formatAltitude(flight.baro_altitude ?? flight.geo_altitude)}
            {trend === "climbing" && <TrendUp size={11} className="trend trend-up" aria-label="Climbing" />}
            {trend === "descending" && <TrendDown size={11} className="trend trend-down" aria-label="Descending" />}
          </span>
          <span>·</span>
          <span>{formatSpeed(flight.velocity)}</span>
        </span>
      </span>
      <Plane className="flight-plane" size={17} aria-hidden="true" />
    </button>
  );
});

export function FlightList({
  flights,
  selectedFlight,
  loading,
  errorMessage,
  notice,
  hasSearched,
  onSelect,
  onPreview,
  onRetry,
  referencePoint = null,
}: FlightListProps) {
  const [query, setQuery] = useState("");
  const [status, setStatus] = usePersistentState<StatusFilter>("skytrace-list-status", "all");
  const [sort, setSort] = usePersistentState<SortOrder>("skytrace-list-sort", "time_desc");

  const visibleFlights = useMemo(() => {
    const normalized = query.trim().toLowerCase();
    const filtered = flights.filter((flight) => {
      const matchesText = !normalized || [
        flight.callsign,
        flight.icao24,
        flight.airline_name,
        flight.departure_airport,
        flight.arrival_airport,
      ].some((value) => value?.toLowerCase().includes(normalized));
      const actualStatus = flight.status || (flight.on_ground === true ? "on_ground" : flight.on_ground === false ? "airborne" : "unknown");
      return matchesText && (status === "all" || actualStatus === status);
    });

    const distance = (flight: Flight) => referencePoint && flight.latitude != null && flight.longitude != null
      ? distanceKm(referencePoint, [flight.latitude, flight.longitude])
      : Number.POSITIVE_INFINITY;
    return [...filtered].sort((a, b) => {
      // An aircraft declaring an emergency always leads the board.
      const urgency = Number(Boolean(emergencyInfo(b))) - Number(Boolean(emergencyInfo(a)));
      if (urgency) return urgency;
      if (sort === "distance_asc") return distance(a) - distance(b);
      if (sort === "airline_asc") return (a.airline_name || "").localeCompare(b.airline_name || "");
      const aTime = a.primary_time ?? a.first_seen ?? a.last_seen ?? 0;
      const bTime = b.primary_time ?? b.first_seen ?? b.last_seen ?? 0;
      return sort === "time_asc" ? aTime - bTime : bTime - aTime;
    });
  }, [flights, query, referencePoint, sort, status]);

  const filtersActive = query.trim() !== "" || status !== "all";

  // ↑/↓ (and Home/End) move between flight cards, like a native list.
  function moveFocus(event: KeyboardEvent<HTMLDivElement>) {
    if (!["ArrowDown", "ArrowUp", "Home", "End"].includes(event.key)) return;
    const cards = [...event.currentTarget.querySelectorAll<HTMLButtonElement>(".flight-card")];
    const index = cards.indexOf(document.activeElement as HTMLButtonElement);
    if (index < 0 || !cards.length) return;
    event.preventDefault();
    const next = event.key === "Home" ? 0
      : event.key === "End" ? cards.length - 1
      : Math.min(cards.length - 1, Math.max(0, index + (event.key === "ArrowDown" ? 1 : -1)));
    cards[next].focus();
  }
  function clearFilters() {
    setQuery("");
    setStatus("all");
  }

  return (
    <section className="flight-list-section" aria-label="Flight results">
      <div className="list-toolbar">
        <label className="compact-search">
          <Search size={15} aria-hidden="true" />
          <span className="sr-only">Filter flights</span>
          <input value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Callsign, airline, route…" />
        </label>
        <label className="select-control" title="Filter by status">
          <Filter size={14} aria-hidden="true" />
          <span className="sr-only">Flight status</span>
          <select value={status} onChange={(event) => setStatus(event.target.value as StatusFilter)}>
            <option value="all">All status</option>
            <option value="airborne">Airborne</option>
            <option value="on_ground">On ground</option>
            <option value="completed">Completed</option>
          </select>
        </label>
        <label className="select-control" title="Sort flights">
          <ArrowDownUp size={14} aria-hidden="true" />
          <span className="sr-only">Sort order</span>
          <select value={sort} onChange={(event) => setSort(event.target.value as SortOrder)}>
            <option value="time_desc">Latest</option>
            <option value="time_asc">Earliest</option>
            <option value="airline_asc">Airline A–Z</option>
            <option value="distance_asc">Nearest</option>
          </select>
        </label>
      </div>

      {notice && <div className="data-notice-inline" role="status">{notice}</div>}
      {filtersActive && flights.length > 0 && (
        <div className="list-filter-count" role="status">
          <span className="mono">{visibleFlights.length} of {flights.length} shown</span>
          <button type="button" onClick={clearFilters}>Clear</button>
        </div>
      )}

      <div className="flight-list" aria-live="polite" aria-busy={loading} onKeyDown={moveFocus}>
        {loading && flights.length === 0 && <div className="movement-loading" role="status">
          <span className="movement-loading-radar" aria-hidden="true"><span /></span>
          <div><strong>Loading airport movements</strong><span>Checking recorded flights and the latest available traffic…</span></div>
        </div>}
        {loading && flights.length > 0 && <div className="list-refreshing" role="status"><span /> Refreshing movements</div>}
        {!loading && errorMessage && (
          <div className="message-state error-state">
            <span className="message-icon">!</span>
            <h3>Flight data unavailable</h3>
            <p>{errorMessage}</p>
            <button type="button" className="secondary-button" onClick={onRetry}>Try again</button>
          </div>
        )}
        {!loading && !errorMessage && hasSearched && flights.length === 0 && (
          <div className="message-state">
            <Plane size={26} aria-hidden="true" />
            <h3>{notice ? "Historical data unavailable" : "No movements found"}</h3>
            <p>{notice || "OpenSky has no recorded flights for this airport and UTC date. Try the previous day."}</p>
            {notice && <button type="button" className="secondary-button" onClick={onRetry}>Try again</button>}
          </div>
        )}
        {!loading && !errorMessage && flights.length > 0 && visibleFlights.length === 0 && (
          <div className="message-state compact">
            <h3>No matching flights</h3>
            <p>Nothing in this list matches the current filter.</p>
            <button type="button" className="secondary-button" onClick={clearFilters}>Clear filters</button>
          </div>
        )}
        {!loading && !errorMessage && !hasSearched && (
          <div className="message-state">
            <span className="radar-illustration"><span /></span>
            <h3>Choose your airfield</h3>
            <p>Search an airport to explore arrivals, departures and live aircraft.</p>
          </div>
        )}
        {!errorMessage && visibleFlights.map((flight) => (
          <FlightCard
            key={flightId(flight)}
            flight={flight}
            selected={selectedFlight ? flightId(selectedFlight) === flightId(flight) : false}
            onSelect={onSelect}
            onPreview={onPreview}
          />
        ))}
      </div>
    </section>
  );
}
