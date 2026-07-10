import { memo, useMemo, useState } from "react";
import { ArrowDownUp, Filter, Plane, Search } from "lucide-react";
import type { Flight } from "../types";
import { flightId, formatTime, routeLabel, statusLabel } from "../utils";

type StatusFilter = "all" | "airborne" | "on_ground" | "completed";
type SortOrder = "time_desc" | "time_asc" | "airline_asc";

interface FlightListProps {
  flights: Flight[];
  selectedFlight: Flight | null;
  loading: boolean;
  errorMessage?: string;
  hasSearched: boolean;
  onSelect: (flight: Flight) => void;
  onRetry: () => void;
}

interface FlightCardProps {
  flight: Flight;
  selected: boolean;
  onSelect: (flight: Flight) => void;
}

const FlightCard = memo(function FlightCard({ flight, selected, onSelect }: FlightCardProps) {
  const status = statusLabel(flight.status, flight.on_ground);
  return (
    <button
      type="button"
      className={`flight-card ${selected ? "selected" : ""}`}
      onClick={() => onSelect(flight)}
      aria-pressed={selected}
    >
      <span className={`flight-status-line status-${flight.status || "unknown"}`} />
      <span className="flight-card-main">
        <span className="flight-identity">
          <span className="callsign mono">{flight.callsign || flight.icao24.toUpperCase()}</span>
          <span className="airline">{flight.airline_name || "Unidentified operator"}</span>
        </span>
        <span className="route mono">{routeLabel(flight)}</span>
        <span className="flight-meta">
          <span>{status}</span>
          <span>·</span>
          <span>{formatTime(flight.primary_time ?? flight.first_seen ?? flight.last_seen)} UTC</span>
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
  hasSearched,
  onSelect,
  onRetry,
}: FlightListProps) {
  const [query, setQuery] = useState("");
  const [status, setStatus] = useState<StatusFilter>("all");
  const [sort, setSort] = useState<SortOrder>("time_desc");

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

    return [...filtered].sort((a, b) => {
      if (sort === "airline_asc") return (a.airline_name || "").localeCompare(b.airline_name || "");
      const aTime = a.primary_time ?? a.first_seen ?? a.last_seen ?? 0;
      const bTime = b.primary_time ?? b.first_seen ?? b.last_seen ?? 0;
      return sort === "time_asc" ? aTime - bTime : bTime - aTime;
    });
  }, [flights, query, sort, status]);

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
          </select>
        </label>
      </div>

      <div className="flight-list" aria-live="polite" aria-busy={loading}>
        {loading && Array.from({ length: 5 }, (_, index) => <div className="flight-card skeleton" key={index} />)}
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
            <h3>No movements found</h3>
            <p>OpenSky has no recorded flights for this airport and UTC date. Try the previous day.</p>
          </div>
        )}
        {!loading && !errorMessage && flights.length > 0 && visibleFlights.length === 0 && (
          <div className="message-state compact"><h3>No matching flights</h3><p>Clear or adjust the active filters.</p></div>
        )}
        {!loading && !errorMessage && !hasSearched && (
          <div className="message-state">
            <span className="radar-illustration"><span /></span>
            <h3>Choose your airfield</h3>
            <p>Search an airport to explore arrivals, departures and live aircraft.</p>
          </div>
        )}
        {!loading && !errorMessage && visibleFlights.map((flight) => (
          <FlightCard
            key={flightId(flight)}
            flight={flight}
            selected={selectedFlight ? flightId(selectedFlight) === flightId(flight) : false}
            onSelect={onSelect}
          />
        ))}
      </div>
    </section>
  );
}
