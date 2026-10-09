import { useMemo, type ReactNode } from "react";
import { motion } from "motion/react";
import { ChevronDown, Copy, Database, Plane, Share2, TrendDown, TrendUp, TriangleAlert, X } from "./icons";
import type { AircraftPhoto } from "../api";
import type { Airport, Flight, TrackResponse } from "../types";
import { compassPoint, emergencyInfo, formatAltitude, formatDuration, formatSpeed, formatTime, routeProgress, statusLabel, verticalTrend } from "../utils";
import { distanceText, useUnits, verticalRateText } from "../units";
import { AirframeHistory } from "./AirframeHistory";
import { useAirframeHistory } from "../hooks/useAirframeHistory";
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
  onShare: () => void;
}

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

export function FlightDetails({ flight: liveFlight, track, trackLoading, trackError, routeLoading = false, routeError, photo, photoLoading = false, photoError = false, airports, onRetryTrack, onClose, onShare }: FlightDetailsProps) {
  useUnits();
  // The registry fills what the live feed did not say, such as the tail and
  // type of an airframe opened from a registration search.
  const airframe = useAirframeHistory(liveFlight.icao24).data;
  const flight = useMemo(() => {
    if (!airframe) return liveFlight;
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
  const operations = flight.flightaware;
  const emergency = emergencyInfo(flight);
  const statusKey = flight.status || (flight.on_ground === true ? "on_ground" : flight.on_ground === false ? "airborne" : "unknown");
  const trend = flight.on_ground ? null : verticalTrend(flight.vertical_rate);
  const origin = flight.departure_airport ? airports?.get(flight.departure_airport) : undefined;
  const destination = flight.arrival_airport ? airports?.get(flight.arrival_airport) : undefined;
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
  const hasRoute = Boolean(flight.departure_airport || flight.arrival_airport);

  // Progress comes from the aircraft's position along origin -> destination.
  // Sighting times (first_seen / last_seen) are not used: for a route guessed
  // from the callsign they only bracket when the aircraft was heard, which is
  // how a flight picked up mid-air used to read "100% flown".
  const startTime = flight.first_seen ?? null;
  const endTime = flight.last_seen ?? null;
  const coordinates = (airport?: Airport, fallback?: { latitude?: number | null; longitude?: number | null } | null) =>
    airport?.latitude != null && airport.longitude != null ? airport : fallback;
  const geometry = flight.on_ground === true && !flight.departure_airport ? null : routeProgress(
    coordinates(origin, operations?.origin),
    coordinates(destination, operations?.destination),
    flight,
  );
  const flightawareProgress = operations?.progress_percent != null && operations.progress_percent >= 0 ? operations.progress_percent : null;
  const progress = geometry?.percent ?? flightawareProgress;
  const remaining = geometry?.etaSeconds != null && statusKey === "airborne" ? formatDuration(geometry.etaSeconds) : null;

  // An airframe opened from a registration search has no live position or
  // route unless it happens to be flying: say so instead of "Resolving…".
  const offline = !routeLoading && flight.latitude == null && flight.longitude == null && !hasRoute && !flight.on_ground;

  const hasProfile = Boolean(flight.registration || flight.aircraft_type || flight.aircraft_description || flight.aircraft_owner || flight.aircraft_year);
  const heading = flight.true_track ?? flight.nav_heading ?? null;

  return (
    <motion.aside
      className="details-drawer dock-panel"
      aria-label="Selected flight details"
      initial={{ opacity: 0, x: -28 }}
      animate={{ opacity: 1, x: 0 }}
      exit={{ opacity: 0, x: -20, transition: { duration: 0.16, ease: "easeIn" } }}
      transition={{ type: "spring", stiffness: 420, damping: 40, mass: 0.9 }}
    >
      <div className="dock-content" key={flight.icao24}>
      <div className="drawer-handle" aria-hidden="true" />
      <header className="details-heading">
        <div className="details-title">
          <h2 className="mono">{flight.callsign || flight.icao24.toUpperCase()}</h2>
          <p>{flight.airline_name || [flight.aircraft_owner, flight.aircraft_type].filter(Boolean).join(" · ") || "Operator not published"}</p>
        </div>
        <div className="details-actions">
          <button type="button" className="icon-button" onClick={onShare} aria-label="Copy share link" title="Copy share link"><Share2 size={16} /></button>
          <button type="button" className="icon-button" onClick={onClose} aria-label="Close flight details" title="Close (Esc)"><X size={18} /></button>
        </div>
      </header>

      <div className="details-chips">
        <span className={`details-status status-${statusKey}`}><span className={`status-dot status-${statusKey}`} />{offline ? "No live position" : statusLabel(flight.status, flight.on_ground)}</span>
        {emergency && <span className="details-emergency"><TriangleAlert size={12} aria-hidden="true" /> {/^[0-9]+$/.test(emergency.code) ? `Squawk ${emergency.code}` : "Emergency"} · {emergency.label}</span>}
        {flight.aircraft_type && <span className="details-chip mono">{flight.aircraft_type}</span>}
        {flight.registration && flight.registration_source !== "schedule" && <span className="details-chip mono">{flight.registration}</span>}
      </div>

      <AircraftPhotoFigure flight={flight} photo={photo} loading={photoLoading} error={photoError} />

      {offline ? (
        <section className="airframe-offline" aria-label="Live status">
          <Plane size={18} aria-hidden="true" />
          <div>
            <strong>Not in the live feed right now</strong>
            <p>This airframe is not transmitting within range of a receiver. Its registry history is below; if it flies, its position and route appear here.</p>
          </div>
        </section>
      ) : (
        <>
      <section className="route-hero" aria-label="Route">
        <div className="route-hero-ends">
          <RouteEndpoint
            role="Origin"
            icao={routeLoading && !flight.departure_airport ? "···" : flight.departure_airport}
            iata={origin?.iata || operations?.origin?.code_iata}
            name={routeLoading && !flight.departure_airport ? "Resolving origin…" : flight.departure_airport_name || (hasRoute ? "Unknown origin" : "Unknown")}
            time={formatTime(startTime)}
            align="start"
          />
          <RouteEndpoint
            role="Destination"
            icao={routeLoading && !flight.arrival_airport ? "···" : flight.arrival_airport}
            iata={destination?.iata || operations?.destination?.code_iata}
            name={routeLoading && !flight.arrival_airport ? "Resolving destination…" : flight.arrival_airport_name || (hasRoute ? "Unknown destination" : "Unknown")}
            time={formatTime(endTime)}
            align="end"
          />
        </div>
        <div className="route-progress" role="img" aria-label={progress != null ? `Flight progress ${Math.round(progress)} percent` : "Flight progress unknown"}>
          <span className="route-progress-track"><span className="route-progress-fill" style={{ transform: `scaleX(${(progress ?? 0) / 100})` }} /></span>
          {progress != null && <span className="route-progress-plane" style={{ left: `${progress}%` }}><Plane size={14} /></span>}
        </div>
        <div className="route-hero-foot mono">
          <span>{geometry ? `${Math.round(geometry.percent)}% · ${distanceText(geometry.flownKm)} flown` : progress != null ? `${Math.round(progress)}% flown` : "Progress unavailable"}</span>
          <span>{remaining ? `${remaining} to go` : geometry ? `${distanceText(geometry.remainingKm)} to go` : ""}</span>
        </div>
        {routeSourceLabel && <small className="route-source">{routeSourceLabel}{flight.route_provider ? ` · ${flight.route_provider}` : ""}</small>}
      </section>

      <div className="live-readouts" aria-label="Live readouts">
        <div>
          <span>Altitude</span>
          {/* Barometric altitude on the ground reads a few hundred feet off with QNH; say "Ground" instead. */}
          <strong className="mono">{flight.on_ground ? "Ground" : formatAltitude(flight.baro_altitude ?? flight.geo_altitude)}</strong>
          <small className="mono">
            {trend === "climbing" && <TrendUp size={11} className="trend trend-up" aria-hidden="true" />}
            {trend === "descending" && <TrendDown size={11} className="trend trend-down" aria-hidden="true" />}
            {flight.vertical_rate != null && !flight.on_ground ? verticalRateText(flight.vertical_rate) : "—"}
          </small>
        </div>
        <div>
          <span>Speed</span>
          <strong className="mono">{formatSpeed(flight.velocity)}</strong>
          <small className="mono">{flight.nav_altitude_mcp != null ? `Sel. ${formatFeet(flight.nav_altitude_mcp)}` : "—"}</small>
        </div>
        <div>
          <span>Track</span>
          <strong className="mono">{heading != null ? `${Math.round(heading)}°` : "—"}</strong>
          <small className="mono">{heading != null ? compassPoint(heading) : "—"}</small>
        </div>
        <div>
          <span>Squawk</span>
          <strong className={`mono ${emergency ? "signal-alert-text" : ""}`}>{profileValue(flight.squawk)}</strong>
          <small className="mono">{flight.icao24.toUpperCase()}</small>
        </div>
      </div>

        </>
      )}

      <Section title="Aircraft" aside={flight.source || (flight.data_source === "live-nearby" ? "ADS-B live" : "OpenSky")} open>
        <div className="aircraft-profile-grid">
          <div><span>Registration</span><strong className="mono">{profileValue(flight.registration, hasProfile ? "Unknown" : "Not published")}{flight.registration && flight.registration_source === "schedule" ? " (scheduled)" : ""}</strong></div>
          <div><span>Type code</span><strong className="mono">{profileValue(flight.aircraft_type)}</strong></div>
          <div className="aircraft-profile-wide"><span>Aircraft</span><strong>{profileValue(flight.aircraft_description, "Type not published")}</strong></div>
          <div className="aircraft-profile-wide"><span>Operator / owner</span><strong>{profileValue(flight.aircraft_owner, "Not published")}</strong></div>
          <div><span>Build year</span><strong className="mono">{profileValue(flight.aircraft_year)}</strong></div>
          <div><span>Category</span><strong className="mono">{profileValue(flight.aircraft_category ?? flight.category)}</strong></div>
        </div>
      </Section>

      <Section title="Airframe history" aside="Owners · registrations" open>
        <AirframeHistory flight={flight} />
      </Section>

      <Section title="Altitude profile" aside={trackLoading ? "Loading trace…" : path.length ? `${path.length} points${track?.track.trace_kind === "full" ? " · full trace" : ""}` : "No track"} open>
        {trackLoading ? <div className="chart-skeleton" /> : trackError ? <div role="status"><p className="track-error">{trackError}</p><button className="secondary-button" type="button" onClick={onRetryTrack}>Retry track</button></div> : <AltitudeChart points={path} />}
      </Section>

      {operations && (
        <Section title="Operations" aside="FlightAware" open>
          <div className="operations-status-row">
            <strong>{operations.status || "Status unavailable"}</strong>
            <span className={operations.cancelled ? "operations-flag is-alert" : operations.diverted ? "operations-flag is-warning" : "operations-flag"}>
              {operations.cancelled ? "Cancelled" : operations.diverted ? "Diverted" : flightawareProgress != null ? `${Math.round(flightawareProgress)}% complete` : "Operational"}
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
          {operations.route && <p className="operations-route"><span>Filed route</span><strong className="mono">{operations.route}</strong></p>}
          <p className="profile-footnote"><Database size={12} aria-hidden="true" /> Queried after selection and cached for 15 minutes.</p>
        </Section>
      )}

      <Section title="Signal and navigation" aside={emergency ? emergency.label : undefined}>
        <div className="signal-profile-grid">
          <div><span>Last position</span><strong className="mono">{formatAge(flight.seen_position_seconds)}</strong></div>
          <div><span>Last message</span><strong className="mono">{formatAge(flight.seen_seconds)}</strong></div>
          <div><span>Selected altitude</span><strong className="mono">{formatFeet(flight.nav_altitude_mcp)}</strong></div>
          <div><span>QNH</span><strong className="mono">{flight.nav_qnh == null ? "—" : `${flight.nav_qnh} hPa`}</strong></div>
          <div><span>Selected heading</span><strong className="mono">{flight.nav_heading == null ? "—" : `${Math.round(flight.nav_heading)}°`}</strong></div>
          <div><span>Nav modes</span><strong className="mono">{flight.nav_modes?.length ? flight.nav_modes.join(" · ") : "—"}</strong></div>
          <div><span>Messages</span><strong className="mono">{flight.messages == null ? "—" : flight.messages.toLocaleString("en-US")}</strong></div>
          <div><span>Signal</span><strong className="mono">{flight.rssi == null ? "—" : `${flight.rssi.toFixed(1)} dBFS`}</strong></div>
          <div><span>Emergency</span><strong className={flight.emergency && flight.emergency !== "none" ? "signal-alert-text" : ""}>{profileValue(flight.emergency, "None reported")}</strong></div>
          <div><span>NIC / NACp</span><strong className="mono">{flight.nic == null && flight.nac_p == null ? "—" : `${profileValue(flight.nic)} / ${profileValue(flight.nac_p)}`}</strong></div>
          <div><span>Accuracy radius</span><strong className="mono">{flight.rc == null ? "—" : `${Math.round(flight.rc)} m`}</strong></div>
          <div><span>ICAO24</span><strong className="mono"><Copy size={11} aria-hidden="true" /> {flight.icao24.toUpperCase()}</strong></div>
        </div>
        <p className="profile-footnote"><Database size={12} aria-hidden="true" /> Queried after selection and cached briefly.</p>
      </Section>
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

function AircraftPhotoFigure({ flight, photo, loading, error }: AircraftPhotoFigureProps) {
  const airframe = flight.registration_source === "schedule" ? null : flight.registration;
  const identity = [airframe, flight.aircraft_type].filter(Boolean).join(" · ");
  if (loading && !photo) return <div className="aircraft-photo aircraft-photo-loading" role="status" aria-label="Loading aircraft photo" />;
  if (!photo) {
    return (
      <div className="aircraft-photo aircraft-photo-empty">
        <Plane size={22} aria-hidden="true" />
        <span>{error ? "Photo service unavailable" : `No photo of ${airframe || "this aircraft"} yet`}</span>
      </div>
    );
  }
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
        <span>© {photo.photographer}</span>
        <a href={photo.link} target="_blank" rel="noopener">Planespotters.net</a>
      </figcaption>
    </figure>
  );
}
