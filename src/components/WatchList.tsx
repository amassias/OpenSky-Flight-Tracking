import { watchStatuses, type WatchEntry } from "../watchlist";
import { formatAltitude } from "../utils";
import type { LiveAircraft } from "../types";
import { X } from "./icons";

interface WatchListProps {
  entries: readonly WatchEntry[];
  live: readonly LiveAircraft[];
  onOpen: (entry: WatchEntry, live: LiveAircraft | null) => void;
  onRemove: (entry: WatchEntry) => void;
}

/** Aircraft the visitor saved, with whether each one is in the current live view. */
export function WatchList({ entries, live, onOpen, onRemove }: WatchListProps) {
  const statuses = watchStatuses(entries, live);
  return (
    <section className="watch-list" aria-label="Watched aircraft">
      <h2>Watching</h2>
      {!statuses.length && <p className="conditions-note">Press the bookmark on an aircraft to keep it here. Your list stays in this browser.</p>}
      {statuses.map(({ entry, live: aircraft }) => (
        <div className="watch-row" key={entry.icao24}>
          <button type="button" className="watch-open" onClick={() => onOpen(entry, aircraft)}>
            <strong className="mono">{entry.label}</strong>
            <span className={aircraft ? "watch-state in-view" : "watch-state"}>
              {aircraft ? `In view · ${aircraft.on_ground ? "on ground" : formatAltitude(aircraft.baro_altitude ?? aircraft.geo_altitude)}` : "Not in the current map view"}
            </span>
            {entry.registration && entry.registration !== entry.label && <small>{entry.registration}</small>}
          </button>
          <button type="button" className="icon-button" onClick={() => onRemove(entry)} aria-label={`Stop watching ${entry.label}`} title="Stop watching"><X size={14} /></button>
        </div>
      ))}
    </section>
  );
}
