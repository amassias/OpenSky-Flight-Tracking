import type { ReactNode } from "react";
import { motion } from "motion/react";
import { CalendarDays, ChevronDown, Heart, PlaneLanding, PlaneTakeoff, Share2 } from "../../../shared/components/icons";
import { AirportSearch } from "./AirportSearch";
import { PanelBoundary } from "../../../shared/components/PanelBoundary";
import { AirportConditions, LiveBoard } from "./AirportLive";
import type { Airport, Flight, FlightMode, LiveAircraft } from "../../../shared/types";
import { todayUtc } from "../../../shared/utils";

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
  /** Shares the current URL, which already names the open airport. */
  onShare?: () => void;
  /** Forgets the recently opened airports kept in this browser. */
  onClearRecent?: () => void;
  selectedIcao24: string | null;
  liveAircraft?: readonly LiveAircraft[];
  onSelectFlight: (flight: Flight) => void;
  onPreviewFlight?: (flight: Flight | null) => void;
  /** Present once an airport has been opened; describes the recorded-history board. */
  heading: { title: string; subtitle: string } | null;
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

/** The UTC day `days` after an ISO `YYYY-MM-DD` date. */
function shiftDate(date: string, days: number) {
  const next = new Date(`${date}T00:00:00Z`);
  next.setUTCDate(next.getUTCDate() + days);
  return next.toISOString().slice(0, 10);
}

function ViewToggle({ view, onChange }: { view: AirportView; onChange: (view: AirportView) => void }) {
  return (
    <div className="segmented view-toggle" role="group" aria-label="Board view">
      <button type="button" className={view === "live" ? "active" : ""} aria-pressed={view === "live"} onClick={() => onChange("live")}>Live</button>
      <button type="button" className={view === "history" ? "active" : ""} aria-pressed={view === "history"} onClick={() => onChange("history")}>History</button>
    </div>
  );
}

export function AirportTab({
  selected, popular, recent, favorites, date, mode, view, onDateChange, onModeChange, onViewChange, onSelect, onClear,
  onToggleFavorite, onShare, onClearRecent, selectedIcao24, liveAircraft, onSelectFlight, onPreviewFlight, heading, children,
}: AirportTabProps) {
  const favoriteCodes = new Set(favorites.map((airport) => airport.icao));
  const recentOnly = recent.filter((airport) => !favoriteCodes.has(airport.icao));
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
            <div className="airport-identity-actions">
            {onShare && <button type="button" className="icon-button" aria-label="Share this airport" title="Share this airport" onClick={onShare}><Share2 size={14} /></button>}
            <button type="button" className={`icon-button favorite-toggle ${favorite ? "selected" : ""}`} aria-label={favorite ? "Remove airport from favourites" : "Add airport to favourites"} aria-pressed={favorite} onClick={() => onToggleFavorite(selected)}><Heart size={14} /></button>
            </div>
          </header>

          <PanelBoundary label="current conditions" resetKey={selected.icao}>
            <AirportConditions key={selected.icao} airport={selected} />
          </PanelBoundary>

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
          </div>

          {view === "live" ? (
            <LiveBoard airport={selected} mode={mode} selectedIcao24={selectedIcao24} liveAircraft={liveAircraft} toolbar={<ViewToggle view={view} onChange={onViewChange} />} onSelect={onSelectFlight} onPreview={onPreviewFlight} />
          ) : (
            <>
              <div className="history-controls">
                <div className="date-stepper">
                  <button type="button" className="icon-button date-step date-step-prev" aria-label="Previous day" title="Previous day" onClick={() => onDateChange(shiftDate(date, -1))}><ChevronDown size={13} /></button>
                  <label className="date-control">
                    <span className="control-shell"><CalendarDays size={14} aria-hidden="true" /><input type="date" aria-label="UTC date" value={date} max={todayUtc()} onClick={(event) => {
                      // The native picker icon is hidden for room; the whole field opens it.
                      try { event.currentTarget.showPicker?.(); } catch { /* not allowed here */ }
                    }} onChange={(event) => event.target.value && onDateChange(event.target.value)} /></span>
                  </label>
                  <button type="button" className="icon-button date-step date-step-next" aria-label="Next day" title="Next day" disabled={date >= todayUtc()} onClick={() => onDateChange(shiftDate(date, 1))}><ChevronDown size={13} /></button>
                </div>
                <ViewToggle view={view} onChange={onViewChange} />
              </div>
              {heading && (
                <header className="board-heading">
                  <div>
                    <h3>{heading.title}</h3>
                    <p>{heading.subtitle}</p>
                  </div>
                </header>
              )}
              {children}
            </>
          )}
        </>
      ) : (
        <div className="airport-shortcuts">
          {favorites.length > 0 && <>
            <h3><Heart size={11} aria-hidden="true" /> Favourites</h3>
            <ShortcutList airports={favorites} onSelect={onSelect} />
          </>}
          {recentOnly.length > 0 && <>
            <h3>Recent{onClearRecent && <button type="button" className="shortcuts-clear" onClick={onClearRecent}>Clear</button>}</h3>
            <ShortcutList airports={recentOnly.slice(0, favorites.length ? 3 : 6)} onSelect={onSelect} />
          </>}
          <h3>Busy airports</h3>
          <ShortcutList airports={popular.slice(0, 8)} onSelect={onSelect} />
        </div>
      )}
    </div>
  );
}
