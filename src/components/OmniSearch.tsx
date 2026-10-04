import { useEffect, useId, useMemo, useRef, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { MapPin, Plane, Search, X } from "./icons";
import { api } from "../api";
import type { Airport, LiveAircraft } from "../types";

interface OmniSearchProps {
  /** Aircraft currently on the map; the live feed has no global lookup. */
  aircraft: readonly LiveAircraft[];
  recent: Airport[];
  popular: Airport[];
  focusRequest?: number;
  onSelectAircraft: (aircraft: LiveAircraft) => void;
  onSelectAirport: (airport: Airport) => void;
}

type Option =
  | { kind: "aircraft"; id: string; flight: LiveAircraft }
  | { kind: "airport"; id: string; airport: Airport };

function matchAircraft(aircraft: readonly LiveAircraft[], query: string): LiveAircraft[] {
  const terms = query.toLowerCase().split(/\s+/).filter(Boolean);
  if (!terms.length) return [];
  const scored: Array<{ flight: LiveAircraft; score: number }> = [];
  for (const flight of aircraft) {
    const callsign = (flight.callsign || "").toLowerCase();
    const registration = (flight.registration || "").toLowerCase();
    const haystack = [callsign, registration, flight.icao24, flight.airline_name, flight.aircraft_type, flight.aircraft_description].filter(Boolean).join(" ").toLowerCase();
    if (!terms.every((term) => haystack.includes(term))) continue;
    const first = terms[0];
    scored.push({ flight, score: callsign.startsWith(first) || registration.startsWith(first) ? 0 : callsign.includes(first) || registration.includes(first) ? 1 : 2 });
  }
  return scored.sort((a, b) => a.score - b.score || (a.flight.callsign || "").localeCompare(b.flight.callsign || "")).slice(0, 6).map((entry) => entry.flight);
}

export function OmniSearch({ aircraft, recent, popular, focusRequest = 0, onSelectAircraft, onSelectAirport }: OmniSearchProps) {
  const listboxId = useId();
  const [shortcut] = useState(() => /Mac|iPhone|iPad/.test(navigator.platform || navigator.userAgent) ? "⌘K" : "Ctrl K");
  const input = useRef<HTMLInputElement>(null);
  const container = useRef<HTMLDivElement>(null);
  const [query, setQuery] = useState("");
  const [debounced, setDebounced] = useState("");
  const [open, setOpen] = useState(false);
  const [active, setActive] = useState(0);
  const lastFocusRequest = useRef(focusRequest);

  useEffect(() => {
    if (lastFocusRequest.current === focusRequest) return;
    lastFocusRequest.current = focusRequest;
    input.current?.focus();
    input.current?.select();
    setOpen(true);
  }, [focusRequest]);

  useEffect(() => {
    const timer = window.setTimeout(() => setDebounced(query.trim()), 200);
    return () => window.clearTimeout(timer);
  }, [query]);

  const trimmed = query.trim();
  const airportSearch = useQuery({
    queryKey: ["airport-search", debounced],
    queryFn: ({ signal }) => api.searchAirports(debounced, signal),
    enabled: open && debounced.length >= 2,
  });

  const aircraftMatches = useMemo(() => matchAircraft(aircraft, trimmed), [aircraft, trimmed]);
  const airportData = airportSearch.data;
  const options = useMemo<Option[]>(() => {
    const airports = trimmed.length >= 2
      ? (trimmed === debounced ? (airportData ?? []).slice(0, 6) : [])
      : (recent.length ? recent : popular).slice(0, 5);
    return [
      ...aircraftMatches.map((flight) => ({ kind: "aircraft" as const, id: `a-${flight.icao24}`, flight })),
      ...airports.map((airport) => ({ kind: "airport" as const, id: `p-${airport.icao}`, airport })),
    ];
  }, [aircraftMatches, airportData, debounced, popular, recent, trimmed]);
  const searching = trimmed.length >= 2 && (trimmed !== debounced || airportSearch.isFetching);

  useEffect(() => {
    setActive((current) => Math.min(current, Math.max(options.length - 1, 0)));
  }, [options.length]);

  useEffect(() => {
    function dismiss(event: PointerEvent) {
      if (!container.current?.contains(event.target as Node)) setOpen(false);
    }
    document.addEventListener("pointerdown", dismiss);
    return () => document.removeEventListener("pointerdown", dismiss);
  }, []);

  function choose(option: Option) {
    if (option.kind === "aircraft") onSelectAircraft(option.flight);
    else onSelectAirport(option.airport);
    setQuery("");
    setOpen(false);
    input.current?.blur();
  }

  function handleKeyDown(event: React.KeyboardEvent<HTMLInputElement>) {
    if (event.key === "ArrowDown" || event.key === "ArrowUp") {
      event.preventDefault();
      if (!open) { setOpen(true); return; }
      setActive((current) => Math.max(0, Math.min(options.length - 1, current + (event.key === "ArrowDown" ? 1 : -1))));
    } else if (event.key === "Enter" && open && options[active]) {
      event.preventDefault();
      choose(options[active]);
    } else if (event.key === "Escape") {
      event.stopPropagation();
      if (query) setQuery(""); else { setOpen(false); input.current?.blur(); }
    }
  }

  const aircraftCount = aircraftMatches.length;
  const showAircraftGroup = aircraftCount > 0;
  const showAirportGroup = options.length > aircraftCount;
  const empty = trimmed.length >= 2 && !searching && options.length === 0;

  return (
    <div className="omni-search" role="search" ref={container}>
      <div className="omni-input">
        <Search size={15} aria-hidden="true" />
        <input
          ref={input}
          id="omni-search"
          type="text"
          role="combobox"
          aria-label="Search flights and airports"
          aria-autocomplete="list"
          aria-controls={listboxId}
          aria-expanded={open}
          aria-activedescendant={open && options[active] ? `${listboxId}-${active}` : undefined}
          aria-keyshortcuts="Meta+K Control+K /"
          placeholder="Search callsign, registration or airport"
          autoComplete="off"
          spellCheck={false}
          value={query}
          onFocus={() => setOpen(true)}
          onChange={(event) => { setQuery(event.target.value); setActive(0); setOpen(true); }}
          onKeyDown={handleKeyDown}
        />
        {query
          ? <button type="button" className="omni-clear" aria-label="Clear search" onClick={() => { setQuery(""); input.current?.focus(); }}><X size={13} /></button>
          : <kbd className="omni-shortcut mono" aria-hidden="true">{shortcut}</kbd>}
      </div>

      {open && (
        // Keep input focus during pointer selection: Safari otherwise blurs it
        // with no relatedTarget and closes the list before click fires.
        <div className="omni-results" id={listboxId} role="listbox" onMouseDown={(event) => event.preventDefault()}>
          {showAircraftGroup && <div className="omni-group">Aircraft on the map</div>}
          {options.map((option, index) => (
            <div key={option.id}>
              {option.kind === "airport" && index === aircraftCount && showAirportGroup && (
                <div className="omni-group">{trimmed.length >= 2 ? (searching ? "Airports · searching…" : "Airports") : recent.length ? "Recent airports" : "Popular airports"}</div>
              )}
              <button
                type="button"
                id={`${listboxId}-${index}`}
                role="option"
                aria-selected={active === index}
                className={`omni-option ${active === index ? "active" : ""}`}
                onMouseEnter={() => setActive(index)}
                onClick={() => choose(option)}
              >
                {option.kind === "aircraft" ? (
                  <>
                    <span className="omni-icon"><Plane size={14} aria-hidden="true" /></span>
                    <span className="omni-copy">
                      <strong className="mono">{option.flight.callsign || option.flight.icao24.toUpperCase()}</strong>
                      <small>{[option.flight.airline_name, option.flight.aircraft_type, option.flight.registration].filter(Boolean).join(" · ") || "Aircraft"}</small>
                    </span>
                    <span className="omni-tag">Show</span>
                  </>
                ) : (
                  <>
                    <span className="omni-icon omni-code mono">{option.airport.iata || option.airport.icao}</span>
                    <span className="omni-copy">
                      <strong>{option.airport.name}</strong>
                      <small><MapPin size={10} aria-hidden="true" /> {option.airport.region || option.airport.country} · {option.airport.icao}</small>
                    </span>
                    <span className="omni-tag">Board</span>
                  </>
                )}
              </button>
            </div>
          ))}
          {searching && options.length === 0 && <p className="omni-empty">Searching…</p>}
          {empty && <p className="omni-empty">No aircraft in view or airport matches “{trimmed}”.</p>}
          {airportSearch.isError && trimmed.length >= 2 && !searching && <p className="omni-empty" role="alert">Airport search is unavailable right now.</p>}
          <p className="omni-hint">Aircraft search covers what is currently on the map.</p>
        </div>
      )}
    </div>
  );
}
