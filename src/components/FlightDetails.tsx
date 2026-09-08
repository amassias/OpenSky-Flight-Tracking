import { Copy, Gauge, Navigation, PlaneLanding, PlaneTakeoff, Share2, X } from "lucide-react";
import type { Flight, TrackResponse } from "../types";
import { formatAltitude, formatSpeed, formatTime, statusLabel } from "../utils";
import { AltitudeChart } from "./AltitudeChart";

interface FlightDetailsProps {
  flight: Flight;
  track?: TrackResponse;
  trackLoading: boolean;
  trackError?: string;
  onRetryTrack: () => void;
  onClose: () => void;
  onShare: () => void;
}

export function FlightDetails({ flight, track, trackLoading, trackError, onRetryTrack, onClose, onShare }: FlightDetailsProps) {
  const path = track?.track.path ?? [];
  return (
    <aside className="details-drawer" aria-label="Selected flight details">
      <div className="drawer-handle" aria-hidden="true" />
      <header className="details-heading">
        <div>
          <span className="eyebrow">Selected flight</span>
          <h2 className="mono">{flight.callsign || flight.icao24.toUpperCase()}</h2>
          <p>{flight.airline_name || "Unidentified operator"}</p>
        </div>
        <div className="details-actions">
          <button type="button" className="icon-button" onClick={onShare} aria-label="Copy share link"><Share2 size={17} /></button>
          <button type="button" className="icon-button" onClick={onClose} aria-label="Close flight details"><X size={19} /></button>
        </div>
      </header>

      <div className="route-timeline">
        <div className="route-stop">
          <PlaneTakeoff size={17} aria-hidden="true" />
          <div><strong className="mono">{flight.departure_airport || "---"}</strong><span>{flight.departure_airport_name || "Unknown origin"}</span></div>
          <time className="mono">{formatTime(flight.first_seen)}</time>
        </div>
        <div className="route-line"><span /></div>
        <div className="route-stop">
          <PlaneLanding size={17} aria-hidden="true" />
          <div><strong className="mono">{flight.arrival_airport || "---"}</strong><span>{flight.arrival_airport_name || "Unknown destination"}</span></div>
          <time className="mono">{formatTime(flight.last_seen)}</time>
        </div>
      </div>

      <div className="metrics-grid">
        <div className="metric-card"><Navigation size={15} /><span>Altitude</span><strong className="mono">{formatAltitude(flight.baro_altitude ?? flight.geo_altitude)}</strong></div>
        <div className="metric-card"><Gauge size={15} /><span>Ground speed</span><strong className="mono">{formatSpeed(flight.velocity)}</strong></div>
        <div className="metric-card"><Copy size={15} /><span>ICAO24</span><strong className="mono">{flight.icao24.toUpperCase()}</strong></div>
        <div className="metric-card"><span className={`status-dot status-${flight.status || "unknown"}`} /><span>Status</span><strong>{statusLabel(flight.status, flight.on_ground)}</strong></div>
      </div>

      <section className="profile-card">
        <div className="profile-title"><span>Altitude profile</span><small className="mono">{trackLoading ? "Loading…" : path.length ? `${path.length} points` : "No track"}</small></div>
        {trackLoading ? <div className="chart-skeleton" /> : trackError ? <div role="status"><p className="track-error">{trackError}</p><button className="secondary-button" type="button" onClick={onRetryTrack}>Retry track</button></div> : <AltitudeChart points={path} />}
      </section>
    </aside>
  );
}
