import { Activity, Copy, Database, Gauge, Navigation, Plane, PlaneLanding, PlaneTakeoff, Radio, Share2, ShieldAlert, X } from "lucide-react";
import type { Flight, TrackResponse } from "../types";
import { formatAltitude, formatSpeed, formatTime, statusLabel } from "../utils";
import { AltitudeChart } from "./AltitudeChart";

interface FlightDetailsProps {
  flight: Flight;
  track?: TrackResponse;
  trackLoading: boolean;
  trackError?: string;
  routeLoading?: boolean;
  routeError?: string;
  onRetryTrack: () => void;
  onClose: () => void;
  onShare: () => void;
}

export function FlightDetails({ flight, track, trackLoading, trackError, routeLoading = false, routeError, onRetryTrack, onClose, onShare }: FlightDetailsProps) {
  const path = track?.track.path ?? [];
  const routeSourceLabel = flight.route_source === "callsign"
    ? "Estimated from callsign"
    : flight.route_source === "opensky"
      ? "OpenSky flight record"
      : flight.route_source === "flightaware"
        ? "FlightAware operational data"
      : flight.route_source === "mixed"
        ? "Combined flight data"
        : routeError
          ? "Route lookup unavailable"
          : null;
  const originName = routeLoading && !flight.departure_airport ? "Resolving origin…" : flight.departure_airport_name || "Unknown origin";
  const destinationName = routeLoading && !flight.arrival_airport ? "Resolving destination…" : flight.arrival_airport_name || "Unknown destination";
  const statusKey = flight.status || (flight.on_ground === true ? "on_ground" : flight.on_ground === false ? "airborne" : "unknown");
  const profileValue = (value?: string | number | null, fallback = "—") => value == null || value === "" ? fallback : String(value);
  const formatAge = (value?: number | null) => value == null || !Number.isFinite(value) ? "—" : `${value < 10 ? value.toFixed(1) : Math.round(value)} s ago`;
  const formatFeet = (value?: number | null) => value == null || !Number.isFinite(value) ? "—" : `${Math.round(value).toLocaleString("en-US")} ft`;
  const formatOperationalTime = (value?: string | null) => {
    if (!value) return "—";
    const timestamp = new Date(value);
    if (Number.isNaN(timestamp.getTime())) return value;
    return new Intl.DateTimeFormat("en-GB", {
      timeZone: "UTC",
      day: "2-digit",
      month: "short",
      hour: "2-digit",
      minute: "2-digit",
      hour12: false,
    }).format(timestamp) + "Z";
  };
  const formatDelay = (value?: number | null) => {
    if (value == null || !Number.isFinite(value)) return "—";
    const minutes = Math.round(value / 60);
    if (minutes === 0) return "On time";
    return `${minutes > 0 ? "+" : "−"}${Math.abs(minutes)} min`;
  };
  const hasProfile = Boolean(flight.registration || flight.aircraft_type || flight.aircraft_description || flight.aircraft_owner || flight.aircraft_year);
  const operations = flight.flightaware;
  return (
    <aside className="details-drawer" aria-label="Selected flight details">
      <div className="drawer-handle" aria-hidden="true" />
      <header className="details-heading">
        <div>
          <h2 className="mono">{flight.callsign || flight.icao24.toUpperCase()}</h2>
          <p>{flight.airline_name || "Unidentified operator"}</p>
        </div>
        <div className="details-actions">
          <span className={`details-status status-${statusKey}`}><span className={`status-dot status-${statusKey}`} />{statusLabel(flight.status, flight.on_ground)}</span>
          <button type="button" className="icon-button" onClick={onShare} aria-label="Copy share link"><Share2 size={17} /></button>
          <button type="button" className="icon-button" onClick={onClose} aria-label="Close flight details"><X size={19} /></button>
        </div>
      </header>

      <div className="route-timeline">
        <div className="route-stop">
          <PlaneTakeoff size={17} aria-hidden="true" />
          <div><small className="route-role">Origin</small><strong className="mono">{flight.departure_airport || "---"}</strong><span>{originName}</span></div>
          <time className="mono">{formatTime(flight.first_seen)}</time>
        </div>
        <div className="route-line"><span /></div>
        <div className="route-stop">
          <PlaneLanding size={17} aria-hidden="true" />
          <div><small className="route-role">Destination</small><strong className="mono">{flight.arrival_airport || "---"}</strong><span>{destinationName}</span></div>
          <time className="mono">{formatTime(flight.last_seen)}</time>
        </div>
        {routeSourceLabel && <small className="route-source">{routeSourceLabel}{flight.route_provider ? ` · ${flight.route_provider}` : ""}</small>}
      </div>

      {operations && <section className="operations-card" aria-label="FlightAware operations">
        <header className="profile-section-heading">
          <span><Activity size={15} aria-hidden="true" /> Operations</span>
          <small className="mono">FlightAware</small>
        </header>
        <div className="operations-status-row">
          <strong>{operations.status || "Status unavailable"}</strong>
          <span className={operations.cancelled ? "operations-flag is-alert" : operations.diverted ? "operations-flag is-warning" : "operations-flag"}>
            {operations.cancelled ? "Cancelled" : operations.diverted ? "Diverted" : operations.progress_percent != null && operations.progress_percent >= 0 ? `${Math.round(operations.progress_percent)}% complete` : "Operational"}
          </span>
        </div>
        <div className="operations-grid">
          <div><span>Scheduled departure</span><strong className="mono">{formatOperationalTime(operations.scheduled_out)}</strong></div>
          <div><span>Estimated departure</span><strong className="mono">{formatOperationalTime(operations.estimated_out)}</strong></div>
          <div><span>Actual off-block</span><strong className="mono">{formatOperationalTime(operations.actual_out)}</strong></div>
          <div><span>Departure delay</span><strong className="mono">{formatDelay(operations.departure_delay)}</strong></div>
          <div><span>Scheduled arrival</span><strong className="mono">{formatOperationalTime(operations.scheduled_in)}</strong></div>
          <div><span>Estimated arrival</span><strong className="mono">{formatOperationalTime(operations.estimated_in)}</strong></div>
          <div><span>Actual in-gate</span><strong className="mono">{formatOperationalTime(operations.actual_in)}</strong></div>
          <div><span>Arrival delay</span><strong className="mono">{formatDelay(operations.arrival_delay)}</strong></div>
          {(operations.gate_orig || operations.terminal_orig) && <div><span>Origin gate / terminal</span><strong className="mono">{[operations.gate_orig, operations.terminal_orig].filter(Boolean).join(" · ")}</strong></div>}
          {(operations.gate_dest || operations.terminal_dest) && <div><span>Destination gate / terminal</span><strong className="mono">{[operations.gate_dest, operations.terminal_dest].filter(Boolean).join(" · ")}</strong></div>}
        </div>
        {operations.progress_percent != null && operations.progress_percent >= 0 && <div className="operations-progress" aria-label={`Flight progress ${Math.round(operations.progress_percent)} percent`}>
          <div><span>Flight progress</span><strong className="mono">{Math.round(operations.progress_percent)}%</strong></div>
          <div className="operations-progress-track"><span style={{ width: `${Math.max(0, Math.min(100, operations.progress_percent))}%` }} /></div>
        </div>}
        {operations.route && <p className="operations-route"><span>Filed route</span><strong className="mono">{operations.route}</strong></p>}
        <p className="profile-footnote"><Database size={12} aria-hidden="true" /> Queried after selection and cached for 15 minutes.</p>
      </section>}

      <section className="aircraft-profile-card" aria-label="Aircraft profile">
        <header className="profile-section-heading">
          <span><Plane size={15} aria-hidden="true" /> Aircraft profile</span>
          <small className="mono">{profileValue(flight.source || flight.data_source, "ADS-B")}</small>
        </header>
        <div className="aircraft-profile-grid">
          <div><span>Registration</span><strong className="mono">{profileValue(flight.registration, hasProfile ? "Unknown" : "Not published")}</strong></div>
          <div><span>Type code</span><strong className="mono">{profileValue(flight.aircraft_type)}</strong></div>
          <div className="aircraft-profile-wide"><span>Aircraft</span><strong>{profileValue(flight.aircraft_description, "Type not published")}</strong></div>
          <div className="aircraft-profile-wide"><span>Operator / owner</span><strong>{profileValue(flight.aircraft_owner, "Not published")}</strong></div>
          <div><span>Build year</span><strong className="mono">{profileValue(flight.aircraft_year)}</strong></div>
          <div><span>Category</span><strong className="mono">{profileValue(flight.aircraft_category ?? flight.category)}</strong></div>
        </div>
      </section>

      <div className="metrics-grid">
        <div className="metric-card"><Navigation size={15} /><span>Altitude</span><strong className="mono">{formatAltitude(flight.baro_altitude ?? flight.geo_altitude)}</strong></div>
        <div className="metric-card"><Gauge size={15} /><span>Ground speed</span><strong className="mono">{formatSpeed(flight.velocity)}</strong></div>
        <div className="metric-card"><Copy size={15} /><span>ICAO24</span><strong className="mono">{flight.icao24.toUpperCase()}</strong></div>
        <div className="metric-card"><span className={`status-dot status-${flight.status || "unknown"}`} /><span>Status</span><strong>{statusLabel(flight.status, flight.on_ground)}</strong></div>
      </div>

      <section className="signal-profile-card" aria-label="Aircraft signal data">
        <header className="profile-section-heading">
          <span><Radio size={15} aria-hidden="true" /> Signal and navigation</span>
          {flight.emergency && flight.emergency !== "none" && <small className="signal-alert"><ShieldAlert size={12} /> {flight.emergency}</small>}
        </header>
        <div className="signal-profile-grid">
          <div><span>Last position</span><strong className="mono">{formatAge(flight.seen_position_seconds)}</strong></div>
          <div><span>Last message</span><strong className="mono">{formatAge(flight.seen_seconds)}</strong></div>
          <div><span>Squawk</span><strong className="mono">{profileValue(flight.squawk)}</strong></div>
          <div><span>Selected altitude</span><strong className="mono">{formatFeet(flight.nav_altitude_mcp)}</strong></div>
          <div><span>QNH</span><strong className="mono">{flight.nav_qnh == null ? "—" : `${flight.nav_qnh} hPa`}</strong></div>
          <div><span>Heading</span><strong className="mono">{flight.nav_heading == null ? "—" : `${Math.round(flight.nav_heading)}°`}</strong></div>
          <div><span>Nav modes</span><strong className="mono">{flight.nav_modes?.length ? flight.nav_modes.join(" · ") : "—"}</strong></div>
          <div><span>Messages</span><strong className="mono">{flight.messages == null ? "—" : flight.messages.toLocaleString("en-US")}</strong></div>
          <div><span>Signal</span><strong className="mono">{flight.rssi == null ? "—" : `${flight.rssi.toFixed(1)} dBFS`}</strong></div>
          <div><span>Emergency</span><strong className={flight.emergency && flight.emergency !== "none" ? "signal-alert-text" : ""}>{profileValue(flight.emergency, "None reported")}</strong></div>
          <div><span>NIC / NACp</span><strong className="mono">{flight.nic == null && flight.nac_p == null ? "—" : `${profileValue(flight.nic)} / ${profileValue(flight.nac_p)}`}</strong></div>
          <div><span>Accuracy radius</span><strong className="mono">{flight.rc == null ? "—" : `${Math.round(flight.rc)} m`}</strong></div>
        </div>
        <p className="profile-footnote"><Database size={12} aria-hidden="true" /> Live enrichment is queried only after selection and cached briefly.</p>
      </section>

      <section className="profile-card">
        <div className="profile-title"><span>Altitude profile</span><small className="mono">{trackLoading ? "Loading…" : path.length ? `${path.length} points` : "No track"}</small></div>
        {trackLoading ? <div className="chart-skeleton" /> : trackError ? <div role="status"><p className="track-error">{trackError}</p><button className="secondary-button" type="button" onClick={onRetryTrack}>Retry track</button></div> : <AltitudeChart points={path} />}
      </section>
    </aside>
  );
}
