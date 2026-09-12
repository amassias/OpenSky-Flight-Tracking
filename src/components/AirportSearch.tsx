import { useEffect, useId, useRef, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { Heart, MapPin, Search, X } from "lucide-react";
import { api } from "../api";
import type { Airport } from "../types";

interface AirportSearchProps {
  selected: Airport | null;
  popular: Airport[];
  recent: Airport[];
  favorites: Airport[];
  onSelect: (airport: Airport) => void;
  onClear?: () => void;
  onToggleFavorite: (airport: Airport) => void;
}

export function AirportSearch({
  selected,
  popular,
  recent,
  favorites,
  onSelect,
  onClear,
  onToggleFavorite,
}: AirportSearchProps) {
  const listboxId = useId();
  const container = useRef<HTMLDivElement>(null);
  const [query, setQuery] = useState(selected ? `${selected.icao} · ${selected.name}` : "");
  const [debouncedQuery, setDebouncedQuery] = useState("");
  const [open, setOpen] = useState(false);
  const [activeIndex, setActiveIndex] = useState(0);

  useEffect(() => {
    const timer = window.setTimeout(() => setDebouncedQuery(query.trim()), 220);
    return () => window.clearTimeout(timer);
  }, [query]);

  useEffect(() => {
    if (selected && !open) setQuery(`${selected.icao} · ${selected.name}`);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selected]);

  const search = useQuery({
    queryKey: ["airport-search", debouncedQuery],
    queryFn: () => api.searchAirports(debouncedQuery),
    enabled: open && debouncedQuery.length >= 2,
  });

  const searching = query.trim().length >= 2;
  const options = searching ? (query.trim() === debouncedQuery ? search.data ?? [] : []) : (recent.length ? recent : popular.slice(0, 6));

  // A shrinking result set would otherwise leave aria-activedescendant
  // pointing at an option that no longer exists.
  useEffect(() => {
    setActiveIndex((current) => (current >= options.length ? Math.max(options.length - 1, 0) : current));
  }, [options.length]);

  useEffect(() => {
    function dismiss(event: PointerEvent) {
      if (!container.current?.contains(event.target as Node)) setOpen(false);
    }
    document.addEventListener("pointerdown", dismiss);
    return () => document.removeEventListener("pointerdown", dismiss);
  }, []);

  function choose(airport: Airport) {
    onSelect(airport);
    setQuery(`${airport.icao} · ${airport.name}`);
    setOpen(false);
  }

  function handleKeyDown(event: React.KeyboardEvent<HTMLInputElement>) {
    if (event.key === "ArrowDown") {
      event.preventDefault();
      // The first ArrowDown only reveals the list, so it does not also skip
      // past the first option.
      if (!open) {
        setOpen(true);
        setActiveIndex(0);
        return;
      }
      setActiveIndex((current) => Math.max(0, Math.min(current + 1, options.length - 1)));
      return;
    }
    if (event.key === "ArrowUp") {
      event.preventDefault();
      setActiveIndex((current) => Math.max(current - 1, 0));
      return;
    }
    if (event.key === "Enter" && open && options[activeIndex]) {
      event.preventDefault();
      choose(options[activeIndex]);
      return;
    }
    if (event.key === "Escape") setOpen(false);
  }

  return (
    <div className="airport-search" ref={container} onBlur={(event) => { if (!event.currentTarget.contains(event.relatedTarget)) setOpen(false); }}>
      <label className="field-label" htmlFor="airport-search">Airport</label>
      <div className="search-input-wrap">
        <Search size={17} aria-hidden="true" />
        <input
          id="airport-search"
          role="combobox"
          aria-autocomplete="list"
          aria-controls={listboxId}
          aria-expanded={open}
          aria-activedescendant={open && options[activeIndex] ? `${listboxId}-${activeIndex}` : undefined}
          value={query}
          placeholder="Search city, airport, IATA or ICAO"
          autoComplete="off"
          onFocus={() => setOpen(true)}
          onChange={(event) => { setQuery(event.target.value); setOpen(true); setActiveIndex(0); }}
          onKeyDown={handleKeyDown}
        />
        {query && (
          <button type="button" className="clear-button" aria-label="Clear airport" onClick={() => { setQuery(""); onClear?.(); setOpen(true); }}>
            <X size={15} />
          </button>
        )}
      </div>

      {open && (
        <div className="airport-results" id={listboxId} role="listbox">
          <div className="results-caption">
            {search.isFetching ? "Searching…" : debouncedQuery.length >= 2 ? `${options.length} matches` : recent.length ? "Recent airports" : "Popular airports"}
          </div>
          {options.map((airport, index) => {
            const favorite = favorites.some((item) => item.icao === airport.icao);
            return (
              <div
                id={`${listboxId}-${index}`}
                className={`airport-option ${activeIndex === index ? "active" : ""}`}
                role="option"
                aria-selected={activeIndex === index}
                key={airport.icao}
              >
                <button type="button" className="airport-choice" onClick={() => choose(airport)}>
                  <span className="airport-code mono">{airport.iata || airport.icao}</span>
                  <span className="airport-copy">
                    <strong>{airport.name}</strong>
                    <small><MapPin size={11} /> {airport.region || airport.country} · {airport.icao}</small>
                  </span>
                </button>
                <button type="button" className={`favorite-button ${favorite ? "selected" : ""}`} aria-label={`${favorite ? "Remove" : "Add"} ${airport.name} ${favorite ? "from" : "to"} favorites`} onClick={() => onToggleFavorite(airport)}>
                  <Heart size={15} fill={favorite ? "currentColor" : "none"} />
                </button>
              </div>
            );
          })}
          {!search.isFetching && options.length === 0 && <p className="no-match">No airport found. Try an ICAO code or city.</p>}
        </div>
      )}
    </div>
  );
}
