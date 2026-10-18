import { useEffect, useMemo, useState, type ReactNode } from "react";
import { motion } from "motion/react";
import { Bookmark } from "../../../shared/components/customIcons";
import { ChevronDown, Copy, Plane, Share2, TrendDown, TrendUp, TriangleAlert, X } from "../../../shared/components/icons";
import type { AircraftPhoto } from "../../../shared/api";
import type { Airport, Flight, TrackResponse } from "../../../shared/types";
import { bearingDeg, compassPoint, distanceKm, emergencyInfo, flightNumberForCallsign, formatAltitude, formatDuration, formatSpeed, formatTime, routeProgress, statusLabel, verticalTrend } from "../../../shared/utils";
import { distanceText, useUnits, verticalRateText } from "../../../shared/units";
import { PositionObservation } from "../../../shared/components/PositionObservation";
import { AirframeHistory } from "./AirframeHistory";
import { hasAirframeRecord } from "../airframe";
import { useAirframeHistory } from "../hooks/useAirframeHistory";
import { operationsMatchFlight } from "../flightEvents";
import { FlightEvents } from "./FlightEvents";
import { AircraftCabin } from "./AircraftCabin";
import { aircraftModel, aircraftManufacturer } from "../../../shared/aircraftIdentity";
import { aircraftIconKind } from "../../../shared/utils";
import { AltitudeChart } from "./AltitudeChart";

interface FlightDetailsProps {
  flight: Flight;
  track?: TrackResponse;
  trackLoading: boolean;
  trackError?: string;
  routeLoading?: boolean;
  routeError?: string;
  photo?: AircraftPhoto | null;
  photoLoading?: boolean;
  photoError?: boolean;
  /** Known airports by ICAO code, used to show IATA codes and city names. */
  airports?: ReadonlyMap<string, Airport>;
  onRetryTrack: () => void;
  onClose: () => void;
  backLabel?: string;
  onBack?: () => void;
  expanded?: boolean;
  onToggleExpanded?: () => void;
  onShare: () => void;
  /** Whether this airframe is on the visitor's watchlist. */
  watched?: boolean;
  onToggleWatch?: () => void;
  /** The visitor's position, when shared, for "distance from you". */
  observer?: [number, number] | null;
}

const TRACE_SOURCES: Record<string, { name: string; url: string }> = {
  "theairtraffic.com": { name: "TheAirTraffic", url: "https://theairtraffic.com/" },
  "adsb.lol": { name: "ADSB.lol", url: "https://adsb.lol/" },
  "opensky": { name: "OpenSky Network", url: "https://opensky-network.org/" },
};

const profileValue = (value?: string | number | null, fallback = "—") => value == null || value === "" ? fallback : String(value);
const formatAge = (value?: number | null) => value == null || !Number.isFinite(value) ? "—" : `${value < 10 ? value.toFixed(1) : Math.round(value)} s ago`;
const formatFeet = (value?: number | null) => value == null || !Number.isFinite(value) ? "—" : `${Math.round(value).toLocaleString("en-US")} ft`;

function formatOperationalTime(value?: string | null) {
  if (!value) return "—";
  const timestamp = new Date(value);
  if (Number.isNaN(timestamp.getTime())) return value;
  return new Intl.DateTimeFormat("en-GB", { timeZone: "UTC", day: "2-digit", month: "short", hour: "2-digit", minute: "2-digit", hour12: false }).format(timestamp) + "Z";
}

function formatDelay(value?: number | null) {
  if (value == null || !Number.isFinite(value)) return "—";
  const minutes = Math.round(value / 60);
  if (minutes === 0) return "On time";
  return `${minutes > 0 ? "+" : "−"}${Math.abs(minutes)} min`;
}

/** Name an airport the way a board would: "Paris", not "Paris Charles de Gaulle Airport". */
function shortAirportName(name?: string | null, fallback = "Unknown") {
  if (!name) return fallback;
  return name.replace(/\b(international|intl\.?|airport|aeroporto|aéroport|flughafen)\b/gi, "").replace(/\s{2,}/g, " ").trim() || name;
}

function RouteEndpoint({ role, icao, iata, name, time, align }: { role: string; icao?: string | null; iata?: string | null; name?: string | null; time?: string; align: "start" | "end" }) {
  const code = iata || icao || "—";
  const place = name;
  return (
    <div className={`route-point route-point-${align}`}>
      <small>{role}</small>
      <strong className="mono">{code}</strong>
      <span title={name ?? undefined}>{shortAirportName(place)}</span>
      {time && <time className="mono">{time}</time>}
    </div>
  );
}

/**
 * Progress along the route. The bar stays empty until the route is settled
 * (origin, destination and their coordinates), appears in place with a fade
 * rather than sliding in from an interim value, and only then animates changes.
 */
function RouteProgressBar({ progress, pending }: { progress: number | null; pending: boolean }) {
  const [shown, setShown] = useState<number | null>(null);
  const [moving, setMoving] = useState(false);
  useEffect(() => {
    if (!pending && progress != null) setShown(Math.min(100, Math.max(0, progress)));
  }, [pending, progress]);
  const visible = shown != null;
  useEffect(() => {
    if (!visible) return;
    const frame = requestAnimationFrame(() => setMoving(true));
    return () => cancelAnimationFrame(frame);
  }, [visible]);
  return (
    <div className={`route-progress ${visible ? "is-ready" : ""} ${moving ? "is-moving" : ""}`} role="img" aria-label={shown != null ? `Flight progress ${Math.round(shown)} percent` : "Flight progress unknown"}>
      <span className="route-progress-track"><span className="route-progress-fill" style={{ transform: `scaleX(${(shown ?? 0) / 100})` }} /></span>
      {shown != null && <span className="route-progress-plane" style={{ left: `${shown}%` }}><Plane size={14} /></span>}
    </div>
  );
}

/** The airframe hex as a button that puts it on the clipboard. */
function CopyHex({ icao24 }: { icao24: string }) {
  const [copied, setCopied] = useState(false);
  useEffect(() => {
    if (!copied) return;
    const timer = window.setTimeout(() => setCopied(false), 1500);
    return () => window.clearTimeout(timer);
  }, [copied]);
  const hex = icao24.toUpperCase();
  return (
    <button type="button" className="copy-value mono" title="Copy ICAO24 hex code" aria-label={`Copy ICAO24 ${hex}`}
      onClick={() => { void navigator.clipboard?.writeText(hex).then(() => setCopied(true), () => undefined); }}>
      <Copy size={11} aria-hidden="true" /> {copied ? "Copied" : hex}
    </button>
  );
}

/** The same aircraft on other trackers, for cross-checking a route or a gap in coverage. */
function externalTrackers(flight: Flight) {
  const hex = flight.icao24.toLowerCase();
  const callsign = flight.callsign?.trim();
  const registration = flight.registration_source === "schedule" ? null : flight.registration?.trim();
  return [
    { label: "ADS-B Exchange", href: `https://globe.adsbexchange.com/?icao=${encodeURIComponent(hex)}` },
    { label: "adsb.lol", href: `https://adsb.lol/?icao=${encodeURIComponent(hex)}` },
    callsign && /^[A-Z0-9]{2,8}$/i.test(callsign) && callsign.toUpperCase() !== hex.toUpperCase()
      ? { label: "FlightAware", href: `https://www.flightaware.com/live/flight/${encodeURIComponent(callsign.toUpperCase())}` } : null,
    registration ? { label: "Flightradar24", href: `https://www.flightradar24.com/data/aircraft/${encodeURIComponent(registration.toLowerCase())}` } : null,
  ].filter((link): link is { label: string; href: string } => link !== null);
}

function Section({ title, aside, open = false, children }: { title: string; aside?: ReactNode; open?: boolean; children: ReactNode }) {
  return (
    <details className="panel-section" open={open}>
      <summary>
        <span>{title}</span>
        {aside && <small className="mono">{aside}</small>}
        <ChevronDown size={14} className="panel-section-chevron" aria-hidden="true" />
      </summary>
      <div className="panel-section-body">{children}</div>
    </details>
  );
}

export function FlightDetails({ flight: liveFlight, track, trackLoading, trackError, routeLoading = false, photo, photoLoading = false, photoError = false, airports, onRetryTrack, onClose, onBack, expanded = false, onToggleExpanded, backLabel = "Back to traffic", onShare, watched = false, onToggleWatch, observer = null }: FlightDetailsProps) {
  useUnits();
  const flightNumber = flightNumberForCallsign(liveFlight.callsign);
  const aircraftPosition: [number, number] | null = liveFlight.latitude != null && liveFlight.longitude != null ? [liveFlight.latitude, liveFlight.longitude] : null;
  const fromYou = observer && aircraftPosition
    ? `${distanceText(distanceKm(observer, aircraftPosition))} ${compassPoint(bearingDeg(observer, aircraftPosition))} of you`
    : null;
  // The registry fills what the live feed did not say, such as the tail and
  // type of an airframe opened from a registration search.
  const airframe = useAirframeHistory(liveFlight.icao24).data;
  const flight = useMemo(() => {
    if (!airframe) return { ...liveFlight, aircraft_description: liveFlight.aircraft_description || aircraftModel(liveFlight.aircraft_type) };
    const facts = airframe.airframe;
    const registry = airframe.registry;
    const tail = liveFlight.registration_source === "schedule" ? null : liveFlight.registration;
    return {
      ...liveFlight,
      registration: tail ?? airframe.registration ?? liveFlight.registration,
      registration_source: tail ? liveFlight.registration_source : airframe.registration ? "adsb" as const : liveFlight.registration_source,
      aircraft_type: liveFlight.aircraft_type ?? facts.type_code ?? registry?.type_code ?? null,
      aircraft_description: liveFlight.aircraft_description ?? ([facts.manufacturer, facts.model].filter(Boolean).join(" ") || registry?.type) ?? null,
      aircraft_owner: liveFlight.aircraft_owner ?? registry?.owner ?? null,
      aircraft_year: liveFlight.aircraft_year ?? facts.built ?? null,
      // A bare hex code reads better as the tail once the registry knows it.
      callsign: liveFlight.callsign && liveFlight.callsign.toUpperCase() !== liveFlight.icao24.toUpperCase() ? liveFlight.callsign : airframe.registration ?? liveFlight.callsign,
    };
  }, [airframe, liveFlight]);
  const path = track?.track.path ?? [];
  const traceSource = TRACE_SOURCES[track?.track.source ?? ""];
  const airframeHistory = useAirframeHistory(flight.icao24);
  // An aircraft in the air cannot be on a leg that has already arrived: that
  // record is the previous flight under the same callsign, so leave it out.
  const operations = flight.data_source === "scheduled" || operationsMatchFlight(flight) ? flight.flightaware : null;
  const emergency = emergencyInfo(flight);
  const statusKey = flight.status || (flight.on_ground === true ? "on_ground" : flight.on_ground === false ? "airborne" : "unknown");
  const trend = flight.on_ground ? null : verticalTrend(flight.vertical_rate);
  const origin = flight.departure_airport ? airports?.get(flight.departure_airport) : undefined;
  const destination = flight.arrival_airport ? airports?.get(flight.arrival_airport) : undefined;
  const hasRoute = Boolean(flight.departure_airport || flight.arrival_airport);

  // Progress comes from the aircraft's position along origin -> destination.
  // Sighting times (first_seen / last_seen) are not used: for a route guessed
  // from the callsign they only bracket when the aircraft was heard, which is
  // how a flight picked up mid-air used to read "100% flown".
  const startTime = flight.first_seen ?? null;
  const endTime = flight.last_seen ?? null;
  const coordinates = (airport?: Airport, fallback?: { latitude?: number | null; longitude?: number | null } | null) =>
    airport?.latitude != null && airport.longitude != null ? airport : fallback;
  const usualRoute = flight.route_source === "callsign";
  const geometry = (flight.on_ground === true && !flight.departure_airport) ? null : routeProgress(
    coordinates(origin, flight.departure_latitude != null ? { latitude: flight.departure_latitude, longitude: flight.departure_longitude } : operations?.origin),
    coordinates(destination, flight.arrival_latitude != null ? { latitude: flight.arrival_latitude, longitude: flight.arrival_longitude } : operations?.destination),
    flight,
  );
  const flightawareProgress = operations?.progress_percent != null && operations.progress_percent >= 0 ? operations.progress_percent : null;
  const progress = flightawareProgress ?? geometry?.percent ?? null;
  const remaining = !usualRoute && geometry?.etaSeconds != null && statusKey === "airborne" ? formatDuration(geometry.etaSeconds) : null;

  // An airframe opened from a registration search has no live position or
  // route unless it happens to be flying: say so instead of "Resolving…".
  const offline = !routeLoading && flight.latitude == null && flight.longitude == null && !hasRoute && !flight.on_ground;

  const hasProfile = Boolean(flight.registration || flight.aircraft_type || flight.aircraft_description || flight.aircraft_owner || flight.aircraft_year);
  const heading = flight.true_track ?? flight.nav_heading ?? null;

  return (
    <motion.aside
      layout="position"
      className="details-drawer dock-panel"
      aria-label="Selected flight details"
      initial={{ opacity: 1, x: -8 }}
      animate={{ opacity: 1, x: 0 }}
      exit={{ opacity: 0, x: -20, transition: { duration: 0.16, ease: "easeIn" } }}
      transition={{ duration: 0.16, ease: [0.16, 1, 0.3, 1] }}
    >
      <div className="dock-content" id="selected-flight-content" key={flight.icao24}>
      <div className="drawer-handle" aria-hidden="true" />
      <div className="mobile-sheet-toolbar">
        <button type="button" className="mobile-back text-button" onClick={onBack ?? onClose}>{backLabel}</button>
        {onToggleExpanded && <button type="button" className="text-button" aria-expanded={expanded} aria-controls="selected-flight-content" onClick={event => { event.currentTarget.focus({ preventScroll: true }); onToggleExpanded(); }}>{expanded ? "Show map" : "Expand details"}</button>}
      </div>
      <header className="details-heading">
        <div className="details-title">
          <h2 className="mono">{flight.callsign || flight.icao24.toUpperCase()}</h2>
          {(flight.airline_name || flight.aircraft_owner || flight.aircraft_type) && <p>{flight.airline_name || [flight.aircraft_owner, flight.aircraft_type].filter(Boolean).join(" · ")}</p>}
        </div>
        <div className="details-actions">
          {onToggleWatch && <button type="button" className={`icon-button ${watched ? "is-on" : ""}`} onClick={onToggleWatch} aria-pressed={watched} aria-label={watched ? "Stop watching this aircraft" : "Watch this aircraft"} title={watched ? "Stop watching" : "Watch this aircraft"}><Bookmark size={16} /></button>}
          <button type="button" className="icon-button" onClick={onShare} aria-label="Copy share link" title="Copy share link"><Share2 size={16} /></button>
          <button type="button" className="icon-button" onClick={onClose} aria-label="Close flight details" title="Close (Esc)"><X size={18} /></button>
        </div>
      </header>

      <div className="details-chips">
        <span className={`details-status status-${statusKey}`}><span className={`status-dot status-${statusKey}`} />{offline ? "No live position" : statusLabel(flight.status, flight.on_ground)}</span>
        {emergency && <span className="details-emergency"><TriangleAlert size={12} aria-hidden="true" /> {/^[0-9]+$/.test(emergency.code) ? `Squawk ${emergency.code}` : "Emergency"} · {emergency.label}</span>}
        {flightNumber && <span className="details-chip mono" title="Flight number on tickets">{flightNumber}</span>}
        {flight.aircraft_type && <span className="details-chip mono">{flight.aircraft_type}</span>}
        {flight.registration && flight.registration_source !== "schedule" && <span className="details-chip mono">{flight.registration}</span>}
      </div>

      <AircraftPhotoFigure flight={flight} photo={photo} loading={photoLoading} error={photoError} />

      <PositionObservation flight={flight} />
      {flight.data_source === "scheduled" && <p className="conditions-note" role="status">No live position yet</p>}
      <FlightEvents flight={flight} track={track} airports={airports} />


      {offline ? (
        <section className="airframe-offline" aria-label="Live status">
          <Plane size={18} aria-hidden="true" />
          <div>
            <strong>Not in the live feed right now</strong>
          </div>
        </section>
      ) : (
        <>
      {(hasRoute || routeLoading) && <section className="route-hero" aria-label="Route">
        <div className="route-hero-ends">
          <RouteEndpoint
            role="Origin"
            icao={routeLoading && !flight.departure_airport ? "···" : flight.departure_airport}
            iata={origin?.iata || operations?.origin?.code_iata}
            name={routeLoading && !flight.departure_airport ? "Resolving origin…" : flight.departure_airport_name || (hasRoute ? "Unknown origin" : "Unknown")}
            time={startTime && !usualRoute ? formatTime(startTime) : undefined}
            align="start"
          />
          <RouteEndpoint
            role="Destination"
            icao={routeLoading && !flight.arrival_airport ? "···" : flight.arrival_airport}
            iata={destination?.iata || operations?.destination?.code_iata}
            name={routeLoading && !flight.arrival_airport ? "Resolving destination…" : flight.arrival_airport_name || (hasRoute ? "Unknown destination" : "Unknown")}
            time={endTime && !usualRoute ? formatTime(endTime) : undefined}
            align="end"
          />
        </div>
        {progress != null && <>
          <RouteProgressBar key={`${flight.icao24}:${flight.callsign}`} progress={progress} pending={false} />
          <div className="route-hero-foot mono">
            <span>{Math.round(progress)}% {flightawareProgress != null ? "reported progress" : "estimated progress"}</span>
            {geometry && <span>{distanceText(geometry.remainingKm)} remaining{remaining ? ` · ~${remaining}` : ""}</span>}
          </div>
        </>}
        {routeLoading && !hasRoute && <p className="conditions-note" role="status">Looking up route…</p>}
      </section>}

      {usualRoute && <p className="conditions-note route-source-note">Usual route · unconfirmed</p>}
      {flight.route_source === "flightaware" && <p className="conditions-note route-source-note"><a href="https://www.flightaware.com/" target="_blank" rel="noreferrer">FlightAware ↗</a></p>}
      <div className="live-readouts" aria-label="Last reported flight readouts">
        {(flight.on_ground || flight.baro_altitude != null || flight.geo_altitude != null) && <div>
          <span>Altitude</span>
          {/* Barometric altitude on the ground reads a few hundred feet off with QNH; say "Ground" instead. */}
          <strong className="mono">{flight.on_ground ? "Ground" : formatAltitude(flight.baro_altitude ?? flight.geo_altitude)}</strong>
          <small className="mono">
            {trend === "climbing" && <TrendUp size={11} className="trend trend-up" aria-hidden="true" />}
            {trend === "descending" && <TrendDown size={11} className="trend trend-down" aria-hidden="true" />}
            {flight.vertical_rate != null && !flight.on_ground ? verticalRateText(flight.vertical_rate) : null}
          </small>
        </div>}
        {flight.velocity != null && <div>
          <span>Speed</span>
          <strong className="mono">{formatSpeed(flight.velocity)}</strong>
          <small className="mono">{flight.nav_altitude_mcp != null ? `Sel. ${formatFeet(flight.nav_altitude_mcp)}` : null}</small>
        </div>}
        {heading != null && <div>
          <span>Track</span>
          <strong className="mono">{heading != null ? `${Math.round(heading)}°` : "—"}</strong>
          <small className="mono">{heading != null ? compassPoint(heading) : "—"}</small>
        </div>}
        {flight.squawk && <div>
          <span>Squawk</span>
          <strong className={`mono ${emergency ? "signal-alert-text" : ""}`}>{profileValue(flight.squawk)}</strong>
          <small className="mono">{flight.icao24.toUpperCase()}</small>
        </div>}
      </div>
      {fromYou && <p className="from-you mono">{fromYou}</p>}

        </>
      )}

      <AircraftCabin key={`${flight.icao24}:${flight.aircraft_type}`} flight={flight} />

      {operations && (
        <Section title="Operations">
          <div className="operations-status-row">
            <strong>{operations.status || "Status unavailable"}</strong>
            <span className={operations.cancelled ? "operations-flag is-alert" : operations.diverted ? "operations-flag is-warning" : "operations-flag"}>
              {operations.cancelled ? "Cancelled" : operations.diverted ? "Diverted" : flightawareProgress != null ? `${Math.round(flightawareProgress)}% complete` : "Operational"}
            </span>
          </div>
          <div className="operations-grid">
            {operations.scheduled_out != null && <div><span>Scheduled departure</span><strong className="mono">{formatOperationalTime(operations.scheduled_out)}</strong></div>}
            {operations.estimated_out != null && <div><span>Estimated departure</span><strong className="mono">{formatOperationalTime(operations.estimated_out)}</strong></div>}
            {operations.actual_out != null && <div><span>Actual off-block</span><strong className="mono">{formatOperationalTime(operations.actual_out)}</strong></div>}
            {operations.departure_delay != null && <div><span>Departure delay</span><strong className="mono">{formatDelay(operations.departure_delay)}</strong></div>}
            {operations.scheduled_in != null && <div><span>Scheduled arrival</span><strong className="mono">{formatOperationalTime(operations.scheduled_in)}</strong></div>}
            {operations.estimated_in != null && <div><span>Estimated arrival</span><strong className="mono">{formatOperationalTime(operations.estimated_in)}</strong></div>}
            {operations.actual_in != null && <div><span>Actual in-gate</span><strong className="mono">{formatOperationalTime(operations.actual_in)}</strong></div>}
            {operations.arrival_delay != null && <div><span>Arrival delay</span><strong className="mono">{formatDelay(operations.arrival_delay)}</strong></div>}
            {(operations.gate_orig || operations.terminal_orig) && <div><span>Origin gate / terminal</span><strong className="mono">{[operations.gate_orig, operations.terminal_orig].filter(Boolean).join(" · ")}</strong></div>}
            {(operations.gate_dest || operations.terminal_dest) && <div><span>Destination gate / terminal</span><strong className="mono">{[operations.gate_dest, operations.terminal_dest].filter(Boolean).join(" · ")}</strong></div>}
          </div>
          {operations.route && <p className="operations-route"><span>Filed route</span><strong className="mono">{operations.route}</strong></p>}
        </Section>
      )}

      {hasProfile && <Section title="Aircraft">
        <div className="aircraft-profile-grid">
          {flight.registration && <div><span>Registration</span><strong className="mono">{flight.registration}{flight.registration_source === "schedule" ? " (scheduled)" : ""}</strong></div>}
          {flight.aircraft_type && <div><span>Type code</span><strong className="mono">{flight.aircraft_type}</strong></div>}
          {flight.aircraft_description && <div className="aircraft-profile-wide"><span>Aircraft</span><strong>{flight.aircraft_description}</strong></div>}
          {aircraftManufacturer(flight.aircraft_description) && <div><span>Manufacturer</span><strong>{aircraftManufacturer(flight.aircraft_description)}</strong></div>}
          {(flight.airline_name || flight.aircraft_owner) && <div className="aircraft-profile-wide"><span>{flight.airline_name ? "Operator" : "Registered owner"}</span><strong>{flight.airline_name || flight.aircraft_owner}</strong></div>}
          {flight.aircraft_year && <div><span>Build year</span><strong className="mono">{flight.aircraft_year}</strong>{Number(flight.aircraft_year) >= 1900 && Number(flight.aircraft_year) <= new Date().getUTCFullYear() && <small>About {new Date().getUTCFullYear() - Number(flight.aircraft_year)} years old</small>}</div>}
          {aircraftIconKind(flight) !== "unknown" && <div><span>Category</span><strong>{({ helicopter: "Helicopter", glider: "Glider", balloon: "Balloon / airship", small: "Light aircraft", turboprop: "Turboprop", regional: "Regional jet", airliner: "Narrow-body jet", heavy: "Wide-body / heavy", unknown: "" })[aircraftIconKind(flight)]}</strong></div>}
        </div>
      </Section>}

      {(airframeHistory.data && hasAirframeRecord(airframeHistory.data, flight)) && <Section title="Airframe history" aside="Owners · registrations">
        <AirframeHistory flight={flight} />
      </Section>}

      {(path.some(point => point[3] != null && Number.isFinite(point[3])) || Boolean(trackError)) && flight.data_source !== "scheduled" && <Section title="Altitude profile" aside={trackLoading ? "Updating…" : undefined} open>
        {path.some(point => point[3] != null && Number.isFinite(point[3])) ? <>
          <AltitudeChart points={path} />
          {traceSource && <p className="conditions-note trace-provenance"><a href={traceSource.url} target="_blank" rel="noreferrer">{traceSource.name}</a></p>}
          {trackError && <div className="track-refresh-notice"><p>Updates delayed</p><button type="button" className="text-button" onClick={onRetryTrack}>Retry track</button></div>}
        </> : <div className="track-refresh-notice" role="status"><p className="track-error" title={trackError}>Track unavailable</p><button className="text-button" type="button" onClick={onRetryTrack}>Retry track</button></div>}
      </Section>}

      <Section title="Signal and navigation" aside={emergency ? emergency.label : undefined}>
        <div className="signal-profile-grid">
          {(flight.seen_position_seconds != null) && <div><span>Last position</span><strong className="mono">{formatAge(flight.seen_position_seconds)}</strong></div>}
          {(flight.seen_seconds != null) && <div><span>Last message</span><strong className="mono">{formatAge(flight.seen_seconds)}</strong></div>}
          {(flight.nav_altitude_mcp != null) && <div><span>Selected altitude</span><strong className="mono">{formatFeet(flight.nav_altitude_mcp)}</strong></div>}
          {(flight.nav_qnh != null) && <div><span>QNH</span><strong className="mono">{flight.nav_qnh == null ? "—" : `${flight.nav_qnh} hPa`}</strong></div>}
          {(flight.nav_heading != null) && <div><span>Selected heading</span><strong className="mono">{flight.nav_heading == null ? "—" : `${Math.round(flight.nav_heading)}°`}</strong></div>}
          {(Boolean(flight.nav_modes?.length)) && <div><span>Nav modes</span><strong className="mono">{flight.nav_modes?.length ? flight.nav_modes.join(" · ") : "—"}</strong></div>}
          {(flight.messages != null) && <div><span>Messages</span><strong className="mono">{flight.messages == null ? "—" : flight.messages.toLocaleString("en-US")}</strong></div>}
          {(flight.rssi != null) && <div><span>Signal</span><strong className="mono">{flight.rssi == null ? "—" : `${flight.rssi.toFixed(1)} dBFS`}</strong></div>}
          {(Boolean(flight.emergency)) && <div><span>Emergency</span><strong className={flight.emergency && flight.emergency !== "none" ? "signal-alert-text" : ""}>{profileValue(flight.emergency, "None reported")}</strong></div>}
          {(flight.nic != null || flight.nac_p != null) && <div><span>NIC / NACp</span><strong className="mono">{flight.nic == null && flight.nac_p == null ? "—" : `${profileValue(flight.nic)} / ${profileValue(flight.nac_p)}`}</strong></div>}
          {(flight.rc != null) && <div><span>Accuracy radius</span><strong className="mono">{flight.rc == null ? "—" : `${Math.round(flight.rc)} m`}</strong></div>}
          <div><span>ICAO24</span><strong className="mono"><CopyHex icao24={flight.icao24} /></strong></div>
        </div>
      </Section>

      <nav className="external-trackers" aria-label="Open this aircraft on other trackers">
        <span>Also on</span>
        {externalTrackers(flight).map((link) => (
          <a key={link.label} href={link.href} target="_blank" rel="noopener noreferrer">{link.label}</a>
        ))}
      </nav>
      </div>
    </motion.aside>
  );
}

interface AircraftPhotoFigureProps {
  flight: Flight;
  photo?: AircraftPhoto | null;
  loading: boolean;
  error: boolean;
}

function AircraftPhotoFigure({ flight, photo, loading }: AircraftPhotoFigureProps) {
  const airframe = flight.registration_source === "schedule" ? null : flight.registration;
  const identity = [airframe, flight.aircraft_type].filter(Boolean).join(" · ");
  if (loading && !photo) return <div className="aircraft-photo aircraft-photo-loading" role="status" aria-label="Loading aircraft photo" />;
  if (!photo) return null;
  return (
    <figure className="aircraft-photo">
      {/* Planespotters terms: a plain, followable link to the photo page. */}
      <a href={photo.link} target="_blank" rel="noopener" className="aircraft-photo-link">
        <img
          key={photo.src}
          src={photo.src}
          width={photo.width}
          height={photo.height}
          alt={`${identity || flight.callsign || flight.icao24.toUpperCase()}, photo by ${photo.photographer}`}
          decoding="async"
          onLoad={(event) => event.currentTarget.classList.add("is-loaded")}
        />
        {identity && <span className="aircraft-photo-identity mono">{identity}</span>}
      </a>
      <figcaption>
        <a href={photo.link} target="_blank" rel="noopener"><span>{photo.attribution ?? `© ${photo.photographer}`}</span> · {photo.source ?? "Planespotters.net"}</a>
        {photo.licenseName && (photo.licenseUrl
          ? <a href={photo.licenseUrl} target="_blank" rel="noopener">{photo.licenseName}</a>
          : <span>{photo.licenseName}</span>)}
        {photo.source === "Wikimedia Commons" && <span>Registration match</span>}
      </figcaption>
    </figure>
  );
}
