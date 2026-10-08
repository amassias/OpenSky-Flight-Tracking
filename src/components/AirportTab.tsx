import type { ReactNode } from "react";
import { motion } from "motion/react";
import { CalendarDays, Heart, PlaneLanding, PlaneTakeoff } from "./icons";
import { AirportSearch } from "./AirportSearch";
import type { Airport, FlightMode } from "../types";

interface AirportTabProps {
  selected: Airport | null;
  popular: Airport[];
  recent: Airport[];
  favorites: Airport[];
  date: string;
  mode: FlightMode;
  onDateChange: (date: string) => void;
  onModeChange: (mode: FlightMode) => void;
  onSelect: (airport: Airport) => void;
  onClear: () => void;
  onToggleFavorite: (airport: Airport) => void;
  /** Present once an airport has been opened. */
  heading: { title: string; subtitle: string; source: string; tone: "live" | "history" } | null;
  children: ReactNode;
}

export function AirportTab({ selected, popular, recent, favorites, date, mode, onDateChange, onModeChange, onSelect, onClear, onToggleFavorite, heading, children }: AirportTabProps) {
  const shortcuts = favorites.length ? favorites : recent;
  return (
    <div className="airport-tab">
      <div className="airport-form">
        <AirportSearch
          selected={selected}
          popular={popular}
          recent={recent}
          favorites={favorites}
          onSelect={onSelect}
          onClear={onClear}
          onToggleFavorite={onToggleFavorite}
        />
        {selected && <div className="airport-information">
          <span>{[selected.city, selected.country].filter(Boolean).join(" · ")}{selected.timezone ? ` · ${selected.timezone}` : ""}</span>
          <button type="button" className="icon-button" aria-label={favorites.some((item) => item.icao === selected.icao) ? "Remove airport from favourites" : "Add airport to favourites"} aria-pressed={favorites.some((item) => item.icao === selected.icao)} onClick={() => onToggleFavorite(selected)}><Heart size={14} /></button>
        </div>}
        <div className="airport-form-row">
          <label className="date-control">
            <span className="sr-only">UTC date</span>
            <span className="control-shell"><CalendarDays size={14} aria-hidden="true" /><input type="date" aria-label="UTC date" value={date} onChange={(event) => event.target.value && onDateChange(event.target.value)} /></span>
          </label>
          <div className="mode-switch" role="group" aria-label="Movement type">
            {(["departure", "arrival"] as const).map((option) => (
              <button key={option} type="button" className={mode === option ? "active" : ""} aria-pressed={mode === option} onClick={() => onModeChange(option)}>
                {mode === option && <motion.span layoutId="mode-switch-thumb" className="mode-switch-thumb" transition={{ type: "spring", stiffness: 520, damping: 40 }} />}
                {option === "departure" ? <PlaneTakeoff size={14} aria-hidden="true" /> : <PlaneLanding size={14} aria-hidden="true" />}
                <span>{option === "departure" ? "Departures" : "Arrivals"}</span>
              </button>
            ))}
          </div>
        </div>
      </div>

      {heading ? (
        <>
          <header className="board-heading">
            <div>
              <h2>{heading.title}</h2>
              <p>{heading.subtitle}</p>
            </div>
            <span className={`source-pill ${heading.tone}`} role="status"><span className="source-pill-dot" />{heading.source}</span>
          </header>
          {children}
        </>
      ) : (
        <div className="airport-shortcuts">
          {shortcuts.length > 0 && <>
            <h3>{favorites.length ? <><Heart size={11} aria-hidden="true" /> Favourites</> : "Recent"}</h3>
            <div className="shortcut-list">
              {shortcuts.slice(0, 6).map((airport) => (
                <button key={airport.icao} type="button" onClick={() => onSelect(airport)}>
                  <span className="mono">{airport.iata || airport.icao}</span>
                  <span>{airport.name}</span>
                </button>
              ))}
            </div>
          </>}
          <h3>Busy airports</h3>
          <div className="shortcut-list">
            {popular.slice(0, 8).map((airport) => (
              <button key={airport.icao} type="button" onClick={() => onSelect(airport)}>
                <span className="mono">{airport.iata || airport.icao}</span>
                <span>{airport.name}</span>
              </button>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
