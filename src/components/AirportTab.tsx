import type { ReactNode } from "react";
import { motion } from "motion/react";
import { CalendarDays, Heart, PlaneLanding, PlaneTakeoff } from "./icons";
import { AirportSearch } from "./AirportSearch";
import { AirportConditions, LiveBoard } from "./AirportLive";
import type { Airport, Flight, FlightMode, LiveAircraft } from "../types";

export type AirportView = "live" | "history";

interface AirportTabProps {
  selected: Airport | null;
  popular: Airport[];
  recent: Airport[];
  favorites: Airport[];
  date: string;
  mode: FlightMode;
  view: AirportView;
  onDateChange: (date: string) => void;
  onModeChange: (mode: FlightMode) => void;
  onViewChange: (view: AirportView) => void;
  onSelect: (airport: Airport) => void;
  onClear: () => void;
  onToggleFavorite: (airport: Airport) => void;
  selectedIcao24: string | null;
  liveAircraft?: readonly LiveAircraft[];
  onSelectFlight: (flight: Flight) => void;
  onPreviewFlight?: (flight: Flight | null) => void;
  /** Present once an airport has been opened; describes the recorded-history board. */
  heading: { title: string; subtitle: string; source: string; tone: "live" | "history" } | null;
  /** The recorded-history board (stats and flight list). */
  children: ReactNode;
}

function ShortcutList({ airports, onSelect }: { airports: Airport[]; onSelect: (airport: Airport) => void }) {
  return (
    <div className="shortcut-list">
      {airports.map((airport) => (
        <button key={airport.icao} type="button" onClick={() => onSelect(airport)}>
          <span className="mono">{airport.iata || airport.icao}</span>
          <span>{airport.name}</span>
        </button>
      ))}
    </div>
  );
}

export function AirportTab({
  selected, popular, recent, favorites, date, mode, view, onDateChange, onModeChange, onViewChange, onSelect, onClear,
  onToggleFavorite, selectedIcao24, liveAircraft, onSelectFlight, onPreviewFlight, heading, children,
}: AirportTabProps) {
  const shortcuts = favorites.length ? favorites : recent;
  const favorite = selected ? favorites.some((item) => item.icao === selected.icao) : false;
  return (
    <div className={`airport-tab ${selected ? "has-airport" : ""}`}>
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
      </div>

      {selected ? (
        <>
          <header className="airport-identity">
            <div>
              <h2><span className="mono">{selected.iata || selected.icao}</span> {selected.name}</h2>
              <p>{[selected.city, selected.country].filter(Boolean).join(" · ")}</p>
            </div>
            <button type="button" className={`icon-button favorite-toggle ${favorite ? "selected" : ""}`} aria-label={favorite ? "Remove airport from favourites" : "Add airport to favourites"} aria-pressed={favorite} onClick={() => onToggleFavorite(selected)}><Heart size={14} /></button>
          </header>

          <AirportConditions key={selected.icao} airport={selected} />

          <div className="board-controls">
            <div className="mode-switch" role="group" aria-label="Movement type">
              {(["departure", "arrival"] as const).map((option) => (
                <button key={option} type="button" className={mode === option ? "active" : ""} aria-pressed={mode === option} onClick={() => onModeChange(option)}>
                  {mode === option && <motion.span layoutId="mode-switch-thumb" className="mode-switch-thumb" transition={{ type: "spring", stiffness: 520, damping: 40 }} />}
                  {option === "departure" ? <PlaneTakeoff size={14} aria-hidden="true" /> : <PlaneLanding size={14} aria-hidden="true" />}
                  <span>{option === "departure" ? "Departures" : "Arrivals"}</span>
                </button>
              ))}
            </div>
            <div className="segmented board-view" role="group" aria-label="Board source">
              <button type="button" className={view === "live" ? "active" : ""} aria-pressed={view === "live"} onClick={() => onViewChange("live")}>Live</button>
              <button type="button" className={view === "history" ? "active" : ""} aria-pressed={view === "history"} onClick={() => onViewChange("history")}>History</button>
            </div>
          </div>

          {view === "live" ? (
            <LiveBoard airport={selected} mode={mode} selectedIcao24={selectedIcao24} liveAircraft={liveAircraft} onSelect={onSelectFlight} onPreview={onPreviewFlight} />
          ) : (
            <>
              <div className="history-controls">
                <label className="date-control">
                  <span className="control-shell"><CalendarDays size={14} aria-hidden="true" /><input type="date" aria-label="UTC date" value={date} onChange={(event) => event.target.value && onDateChange(event.target.value)} /></span>
                </label>
                {heading && <span className={`source-pill ${heading.tone}`} role="status"><span className="source-pill-dot" />{heading.source}</span>}
              </div>
              {heading && (
                <header className="board-heading">
                  <h3>{heading.title}</h3>
                  <p>{heading.subtitle}</p>
                </header>
              )}
              {children}
            </>
          )}
        </>
      ) : (
        <div className="airport-shortcuts">
          {shortcuts.length > 0 && <>
            <h3>{favorites.length ? <><Heart size={11} aria-hidden="true" /> Favourites</> : "Recent"}</h3>
            <ShortcutList airports={shortcuts.slice(0, 6)} onSelect={onSelect} />
          </>}
          <h3>Busy airports</h3>
          <ShortcutList airports={popular.slice(0, 8)} onSelect={onSelect} />
        </div>
      )}
    </div>
  );
}
