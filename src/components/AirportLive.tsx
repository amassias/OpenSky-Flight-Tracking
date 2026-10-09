import { memo, useMemo, type ReactNode } from "react";
import { useQuery } from "@tanstack/react-query";
import { ChevronDown, Moon, PlaneLanding, PlaneTakeoff, Radio, Sun, TriangleAlert } from "./icons";
import { RunwayIcon, WindArrow } from "./customIcons";
import { api, readableApiError } from "../api";
import { PHASE_LABEL, boardRowToFlight, localTime, mergeSchedule, minutesUntil, relativeAge, runwayLength, scheduleEntryToFlight, sunTimes, surfaceName, utcOffsetLabel, visibilityText, type ScheduleEntry, type ScheduleTone } from "../airportLive";
import { useNow } from "../hooks/useNow";
import type { Airport, AirportConditionsResponse, BoardFlight, Flight, FlightMode, LiveAircraft } from "../types";
import { formatAltitude, formatSpeed } from "../utils";
import { distanceText, useUnits } from "../units";

const CATEGORY_HINT: Record<string, string> = {
  VFR: "Visual flight rules: ceiling above 3,000 ft and visibility over 5 SM",
  MVFR: "Marginal VFR: ceiling 1,000–3,000 ft or visibility 3–5 SM",
  IFR: "Instrument flight rules: ceiling 500–1,000 ft or visibility 1–3 SM",
  LIFR: "Low IFR: ceiling below 500 ft or visibility under 1 SM",
};

function temperature(value?: number | null) {
  return value == null ? "—" : `${Math.round(value)}°`;
}

function delayHeadline(delay: NonNullable<AirportConditionsResponse["delays"]>[number]) {
  const span = delay.avg ? `avg ${delay.avg}` : delay.min && delay.max ? `${delay.min} – ${delay.max}` : delay.max ? `up to ${delay.max}` : null;
  return [delay.direction ? `${delay.direction} delays` : delay.category, span].filter(Boolean).join(" · ");
}

/** Local clock, sun times and the latest weather, runways and delays for one airport. */
export function AirportConditions({ airport }: { airport: Airport }) {
  const units = useUnits();
  const now = useNow(30_000);
  const conditions = useQuery({
    queryKey: ["airport-conditions", airport.icao],
    queryFn: ({ signal }) => api.airportConditions(airport.icao, signal),
    staleTime: 4 * 60_000,
    refetchInterval: 5 * 60_000,
    retry: 1,
  });
  const data = conditions.data;
  const weather = data?.weather ?? null;
  const sun = airport.latitude != null && airport.longitude != null ? sunTimes(airport.latitude, airport.longitude, now) : null;
  const isDay = sun ? now >= sun.sunrise && now < sun.sunset : null;
  const favoured = new Set(data?.favoured_runways ?? []);
  const category = weather?.flight_category ?? null;
  const delays = data?.delays ?? null;

  return (
    <section className="airport-conditions" aria-label={`Conditions at ${airport.iata || airport.icao}`}>
      <div className="airport-clock">
        <span><strong className="mono">{localTime(now, airport.timezone)}</strong> local · {utcOffsetLabel(now, airport.timezone)}</span>
        {sun && (
          <span className="airport-sun" title="Sunrise and sunset, local time">
            {isDay ? <Sun size={12} aria-hidden="true" /> : <Moon size={12} aria-hidden="true" />}
            <span className="mono">↑ {localTime(sun.sunrise, airport.timezone)}</span>
            <span className="mono">↓ {localTime(sun.sunset, airport.timezone)}</span>
          </span>
        )}
      </div>

      {conditions.isPending ? (
        <div className="conditions-card is-loading" role="status" aria-label="Loading weather" />
      ) : conditions.isError ? (
        <div className="conditions-card conditions-empty" role="status">
          Weather unavailable · {readableApiError(conditions.error)}
          <button type="button" onClick={() => conditions.refetch()}>Retry</button>
        </div>
      ) : (
        <div className="conditions-card">
          {weather ? (
            <>
              <div className="weather-row">
                {category && <span className={`flight-category category-${category.toLowerCase()}`} title={CATEGORY_HINT[category]}>{category}</span>}
                <span className="weather-wind" title={weather.wind_variable ? "Variable wind" : weather.wind_dir != null ? `Wind from ${weather.wind_dir}°` : "Wind"}>
                  {weather.wind_dir != null && !weather.wind_variable && (weather.wind_kt ?? 0) > 0 && (
                    <WindArrow size={12} aria-hidden="true" style={{ transform: `rotate(${weather.wind_dir}deg)` }} />
                  )}
                  <span className="mono">
                    {(weather.wind_kt ?? 0) === 0 ? "Calm" : `${weather.wind_variable ? "VRB" : `${String(weather.wind_dir ?? 0).padStart(3, "0")}°`} ${weather.wind_kt} kt${weather.gust_kt ? ` G${weather.gust_kt}` : ""}`}
                  </span>
                </span>
                <span className="mono" title="Visibility">{visibilityText(weather.visibility, units)}</span>
                <span className="mono" title="Temperature / dew point">{temperature(weather.temperature_c)} / {temperature(weather.dewpoint_c)}</span>
              </div>
              <div className="weather-row weather-row-secondary">
                <span title="Cloud cover">{weather.cover === "CAVOK" ? "CAVOK" : weather.ceiling_ft != null ? `Ceiling ${weather.ceiling_ft.toLocaleString("en-US")} ft` : weather.clouds.length ? `${weather.clouds[0].cover} ${weather.clouds[0].base_ft?.toLocaleString("en-US") ?? ""} ft` : "No ceiling"}</span>
                {weather.qnh_hpa != null && <span className="mono">QNH {weather.qnh_hpa}</span>}
                {weather.weather && <span className="mono">{weather.weather}</span>}
                <span className="weather-age">{weather.station_distance_km != null ? `${weather.station} · ${distanceText(weather.station_distance_km, units)} away · ` : ""}{relativeAge(weather.observed_at, now) ?? ""}</span>
              </div>
            </>
          ) : (
            <div className="weather-row weather-row-secondary"><span>No weather report within 50 km.</span></div>
          )}

          {favoured.size > 0 && (
            <div className="runway-favoured">
              <RunwayIcon size={13} aria-hidden="true" />
              <span>Wind favours <strong className="mono">{[...favoured].join(" · ")}</strong></span>
            </div>
          )}

          <details className="conditions-more">
            <summary>
              <span>Runways, frequencies & forecast</span>
              <ChevronDown size={12} className="panel-section-chevron" aria-hidden="true" />
            </summary>
            <div className="conditions-more-body">
              {data?.runways.length ? (
                <table className="runway-table">
                  <caption className="sr-only">Runways</caption>
                  <thead><tr><th scope="col">Runway</th><th scope="col">Length</th><th scope="col">Surface</th><th scope="col">Head / cross</th></tr></thead>
                  <tbody>
                    {data.runways.map((runway) => {
                      const best = [...runway.ends].sort((a, b) => (b.headwind_kt ?? -99) - (a.headwind_kt ?? -99))[0];
                      const active = runway.ends.some((end) => favoured.has(end.ident));
                      return (
                        <tr key={runway.ends.map((end) => end.ident).join("/")} className={active ? "is-favoured" : undefined}>
                          <th scope="row" className="mono">{runway.ends.map((end) => end.ident).join("/")}</th>
                          <td className="mono">{runwayLength(runway.length_ft, units)}</td>
                          <td>{surfaceName(runway.surface)}</td>
                          <td className="mono">{best?.headwind_kt != null ? `${best.ident} ${Math.round(best.headwind_kt)} / ${Math.round(best.crosswind_kt ?? 0)} kt` : "—"}</td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              ) : <p className="conditions-note">No runway data for this airport.</p>}
              {data?.runway_basis === "wind" && <p className="conditions-note">Estimated from the surface wind only. Controllers also choose runways for noise, traffic flow and procedures.</p>}
              {data?.runway_basis === "calm" && <p className="conditions-note">Wind is calm: no runway is favoured.</p>}

              {data?.frequencies.length ? (
                <ul className="frequency-list" aria-label="Frequencies">
                  {data.frequencies.slice(0, 10).map((frequency) => (
                    <li key={`${frequency.type}-${frequency.mhz}-${frequency.description}`}>
                      <Radio size={11} aria-hidden="true" />
                      <span>{frequency.type}</span>
                      <span className="frequency-name">{frequency.description}</span>
                      <strong className="mono">{frequency.mhz.toFixed(3)}</strong>
                    </li>
                  ))}
                </ul>
              ) : null}

              {weather?.raw && <p className="raw-report"><span>METAR</span><code>{weather.raw}</code></p>}
              {weather?.taf && <p className="raw-report"><span>TAF</span><code>{weather.taf}</code></p>}

              <p className="conditions-note">
                {[
                  airport.icao, airport.iata, data?.airport.elevation_ft != null ? `Elevation ${data.airport.elevation_ft.toLocaleString("en-US")} ft` : null,
                ].filter(Boolean).join(" · ")}
                {data?.airport.wikipedia && <> · <a href={data.airport.wikipedia} target="_blank" rel="noreferrer">Wikipedia</a></>}
                {airport.website && <> · <a href={airport.website} target="_blank" rel="noreferrer">Website</a></>}
              </p>
              <p className="conditions-note">Weather: NOAA Aviation Weather Center · Runways & frequencies: OurAirports{delays ? " · Delays: FAA NAS Status" : ""}</p>
            </div>
          </details>
        </div>
      )}

      {delays && delays.length > 0 && delays.map((delay, index) => (
        <div key={`${delay.category}-${index}`} className="delay-alert" role="status">
          <TriangleAlert size={13} aria-hidden="true" />
          <span><strong>{delayHeadline(delay)}</strong>{delay.reason ? <small>{delay.reason.length > 90 ? `${delay.reason.slice(0, 90)}…` : delay.reason}</small> : null}</span>
        </div>
      ))}
      {delays && delays.length === 0 && <p className="delay-clear">FAA: no delay programme or ground stop reported.</p>}
    </section>
  );
}

interface RowViewProps {
  /** Struck-through original time above the expected one when a flight moved. */
  timeOld?: string | null;
  time: string;
  timeTone?: "warn" | "ok";
  timeNote?: string | null;
  code: string;
  place: string;
  ident: string;
  airline?: string | null;
  /** Share of the route flown, 0 to 1. */
  progress?: number | null;
  chip: string;
  tone: ScheduleTone;
  live?: boolean;
  aside?: string | null;
  cancelled?: boolean;
}

/** The one row layout of the board: time, destination and flight, status and gate. */
function RowView({ timeOld, time, timeTone, timeNote, code, place, ident, airline, progress, chip, tone, live, aside, cancelled }: RowViewProps) {
  return (
    <>
      <span className="board-time">
        {timeOld && <small className="board-time-old mono">{timeOld}</small>}
        <strong className={`mono ${timeTone ? `tone-${timeTone}` : ""} ${cancelled ? "is-cancelled" : ""}`}>{time}</strong>
        {timeNote && <small className="mono">{timeNote}</small>}
      </span>
      <span className="board-main">
        <span className="board-dest">
          <span className="board-code mono">{code}</span>
          <span className={`board-place ${cancelled ? "is-cancelled" : ""}`}>{place}</span>
        </span>
        <span className="board-ident"><span className="mono">{ident}</span>{airline ? <span className="board-airline">{airline}</span> : null}</span>
        {progress != null && (
          <span className="board-progress" role="img" aria-label={`${Math.round(progress * 100)}% of the route flown`}>
            <span className="board-progress-track"><span style={{ transform: `scaleX(${Math.min(1, Math.max(0, progress))})` }} /></span>
            <span className="mono">{Math.round(progress * 100)}%</span>
          </span>
        )}
      </span>
      <span className="board-aside">
        <span className={`board-chip tone-${tone}`}>{live && <span className="live-dot" aria-hidden="true" />}{chip}</span>
        {aside ? <small className="mono">{aside}</small> : null}
      </span>
    </>
  );
}

interface BoardRowProps {
  row: BoardFlight;
  mode: FlightMode;
  airport: Airport;
  now: number;
  selected: boolean;
  onSelect: (flight: Flight) => void;
  onPreview?: (flight: Flight | null) => void;
}

const PHASE_TONE: Record<BoardFlight["phase"], ScheduleTone> = {
  parked: "neutral", taxiing: "live", departed: "live", inbound: "neutral", approach: "live", final: "ok", landed: "ok",
};

/** An aircraft seen live around the airport that the schedule page does not list. */
const BoardRow = memo(function BoardRow({ row, mode, airport, now, selected, onSelect, onPreview }: BoardRowProps) {
  useUnits();
  const other = mode === "departure" ? row.destination : row.origin;
  const flight = useMemo(() => boardRowToFlight(row, airport, mode), [airport, mode, row]);
  const eta = row.eta && row.phase !== "landed" ? row.eta : null;
  const airline = row.airline_name || [row.registration, row.aircraft_type].filter(Boolean).join(" · ");
  const minutes = eta ? minutesUntil(eta, now) : null;
  const motion = row.on_ground ? ((row.velocity ?? 0) >= 2 ? formatSpeed(row.velocity) : "") : formatAltitude(row.baro_altitude);
  return (
    <button
      type="button"
      className={`board-row ${selected ? "selected" : ""}`}
      aria-pressed={selected}
      onClick={() => onSelect(flight)}
      onMouseEnter={() => onPreview?.(flight)}
      onMouseLeave={() => onPreview?.(null)}
      onFocus={() => onPreview?.(flight)}
      onBlur={() => onPreview?.(null)}
    >
      <RowView
        time={eta ? localTime(eta * 1000, airport.timezone) : row.phase === "parked" ? "—" : "Now"}
        timeNote={minutes == null ? null : minutes === 0 ? "now" : `in ${minutes} min`}
        code={other?.iata || other?.icao || "—"}
        place={other ? other.city || other.name || "" : row.route_known ? "Route elsewhere" : "Route unknown"}
        ident={row.callsign || row.icao24.toUpperCase()}
        airline={airline}
        chip={PHASE_LABEL[row.phase]}
        tone={PHASE_TONE[row.phase]}
        aside={motion}
      />
    </button>
  );
});

interface ScheduleRowProps {
  entry: ScheduleEntry;
  mode: FlightMode;
  airport: Airport;
  now: number;
  selected: boolean;
  onSelect: (flight: Flight) => void;
  onPreview?: (flight: Flight | null) => void;
}

/** One FlightAware flight: gate times, gate and status, live progress when the aircraft is in view. */
const ScheduleRow = memo(function ScheduleRow({ entry, mode, airport, now, selected, onSelect, onPreview }: ScheduleRowProps) {
  useUnits();
  const { flight, live } = entry;
  const other = mode === "departure" ? flight.destination : flight.origin;
  const selectable = useMemo(() => scheduleEntryToFlight(entry), [entry]);
  const changed = entry.expectedMs != null && entry.scheduledMs != null && Math.abs(entry.delayMinutes) >= 5;
  const gate = mode === "departure" ? flight.gate_orig : flight.gate_dest;
  const terminal = (mode === "departure" ? flight.terminal_orig : flight.terminal_dest)?.replace(/^(T|Terminal)\s*/i, "");
  const airborneArrival = mode === "arrival" && Boolean(live) && live!.on_ground === false;
  const eta = airborneArrival ? entry.liveEtaMs : null;
  const minutes = eta != null ? minutesUntil(eta / 1000, now) : null;
  const shown = changed ? entry.expectedMs : entry.scheduledMs;
  const content = (
    <RowView
      timeOld={changed && entry.scheduledMs != null ? localTime(entry.scheduledMs, airport.timezone) : null}
      time={shown != null ? localTime(shown, airport.timezone) : "—"}
      timeTone={changed ? (entry.delayMinutes > 0 ? "warn" : "ok") : undefined}
      timeNote={minutes == null ? null : minutes === 0 ? "now" : `in ${minutes} min`}
      code={other?.code_iata || other?.code_icao || other?.code || "—"}
      place={other?.city || other?.name || "Unknown"}
      ident={flight.ident_iata || flight.ident || ""}
      airline={flight.airline_name}
      progress={airborneArrival ? entry.progress : null}
      chip={entry.status}
      tone={entry.tone}
      live={Boolean(live)}
      aside={[gate ? `Gate ${gate}` : null, terminal ? `T${terminal}` : null].filter(Boolean).join(" · ") || null}
      cancelled={Boolean(flight.cancelled)}
    />
  );
  if (!selectable) return <div className={`board-row is-static tone-${entry.tone}`} title="Not in live view yet">{content}</div>;
  return (
    <button
      type="button"
      className={`board-row tone-${entry.tone} ${selected ? "selected" : ""}`}
      aria-pressed={selected}
      onClick={() => onSelect(selectable)}
      onMouseEnter={() => onPreview?.(selectable)}
      onMouseLeave={() => onPreview?.(null)}
      onFocus={() => onPreview?.(selectable)}
      onBlur={() => onPreview?.(null)}
    >
      {content}
    </button>
  );
});

interface LiveBoardProps {
  airport: Airport;
  mode: FlightMode;
  selectedIcao24: string | null;
  /** Aircraft on the map, matched to scheduled flights by callsign. */
  liveAircraft?: readonly LiveAircraft[];
  /** Rendered at the right end of the status line (the Live/History switch). */
  toolbar?: ReactNode;
  onSelect: (flight: Flight) => void;
  onPreview?: (flight: Flight | null) => void;
}

const NO_AIRCRAFT: readonly LiveAircraft[] = [];

/**
 * The airport board: FlightAware's scheduled flights (times, gates, delays)
 * joined to the aircraft seen live, then any live traffic the schedule page
 * does not list, observed by ADS-B around the airport.
 */
export function LiveBoard({ airport, mode, selectedIcao24, liveAircraft = NO_AIRCRAFT, toolbar, onSelect, onPreview }: LiveBoardProps) {
  const units = useUnits();
  const now = useNow(15_000);
  const board = useQuery({
    queryKey: ["airport-board", airport.icao],
    queryFn: ({ signal }) => api.airportBoard(airport.icao, signal),
    staleTime: 20_000,
    // Routes beyond one refresh's lookup budget arrive on the next call.
    refetchInterval: (query) => (query.state.data?.routes_pending ? 8_000 : 30_000),
    retry: 1,
  });
  // One AeroAPI page per airport and direction, shared through the CDN for ten minutes.
  const schedule = useQuery({
    queryKey: ["airport-schedule", airport.icao, mode],
    queryFn: ({ signal }) => api.airportSchedule(airport.icao, mode, signal),
    staleTime: 9 * 60_000,
    refetchInterval: 10 * 60_000,
    retry: false,
  });
  const observed = mode === "departure" ? board.data?.departures ?? [] : board.data?.arrivals ?? [];
  const merged = useMemo(() => {
    const flights = schedule.data?.available ? schedule.data.flights : [];
    if (!flights.length) return null;
    // Board rows already carry the board's phase; map aircraft cover the rest of the sky.
    const candidates = [...(board.data?.departures ?? []), ...(board.data?.arrivals ?? []), ...liveAircraft];
    return mergeSchedule(flights, candidates, mode, airport, now);
  }, [airport, board.data, liveAircraft, mode, now, schedule.data]);
  const rows = merged ? observed.filter((row) => !merged.matchedIcao24.has(row.icao24)) : observed;
  const scheduledCount = merged?.entries.length ?? 0;
  const age = board.data ? relativeAge(board.data.time, now) : null;
  // A failed refresh keeps the last board on screen and says it is delayed.
  const delayed = Boolean(board.data && (board.isError || board.data.degraded));
  const summary = [
    scheduledCount ? `${scheduledCount} scheduled` : `${rows.length} ${mode === "departure" ? "departing" : "arriving"}`,
    scheduledCount && rows.length ? `${rows.length} also live` : null,
    // "Just now" is the normal case and not worth the room next to the toggle.
    age && age !== "just now" ? age : null,
  ].filter(Boolean).join(" · ");

  return (
    <section className="live-board" aria-label={`Live ${mode === "departure" ? "departures" : "arrivals"}`}>
      <div className="live-board-meta">
        <span className={`pulse-dot ${board.isError || delayed ? "warn" : "active"}`} aria-hidden="true" />
        <span className="live-board-meta-text">
          {board.isPending ? "Scanning the airport area…" : !board.data ? "Live board unavailable" : summary}
        </span>
        {delayed && <span className="meta-flag" title="The live feed is rate limited; the last result is shown">Live feed limited</span>}
        {board.isFetching && !board.isPending && <span className="list-spinner" aria-hidden="true" />}
        {toolbar}
      </div>

      <div className="live-board-rows" aria-busy={board.isFetching}>
        {board.isPending && Array.from({ length: 5 }, (_, index) => <div key={index} className="board-row skeleton" aria-hidden="true" />)}
        {board.isError && !board.data && (
          <div className="message-state compact">
            <h3>Live board unavailable</h3>
            <p>{readableApiError(board.error)}</p>
            <button type="button" className="secondary-button" onClick={() => board.refetch()}>Try again</button>
          </div>
        )}
        {merged && merged.entries.length > 0 && (
          <>
            <h4 className="board-section">Scheduled {mode === "departure" ? "departures" : "arrivals"}</h4>
            {merged.entries.map((entry) => (
              <ScheduleRow key={entry.flight.fa_flight_id ?? entry.flight.ident ?? ""} entry={entry} mode={mode} airport={airport} now={now} selected={entry.live?.icao24 === selectedIcao24} onSelect={onSelect} onPreview={onPreview} />
            ))}
            {rows.length > 0 && <h4 className="board-section">Also seen live</h4>}
          </>
        )}
        {board.data && rows.length === 0 && !scheduledCount && (
          <div className="message-state compact">
            {mode === "departure" ? <PlaneTakeoff size={22} aria-hidden="true" /> : <PlaneLanding size={22} aria-hidden="true" />}
            <h3>No {mode === "departure" ? "departures" : "arrivals"} observed right now</h3>
            <p>{mode === "departure"
              ? "Aircraft at the stand often switch their transponder on only at pushback. Departures appear while they taxi and climb out."
              : `No aircraft within ${distanceText(board.data.radius_nm * 1.852, units)} is heading here with a known route.`}</p>
          </div>
        )}
        {rows.map((row) => (
          <BoardRow key={row.icao24} row={row} mode={mode} airport={airport} now={now} selected={row.icao24 === selectedIcao24} onSelect={onSelect} onPreview={onPreview} />
        ))}
      </div>

      {schedule.data && (schedule.data.available || schedule.data.reason === "budget") && (
        <p className="live-board-source">
          {schedule.data.available
            ? <>Times, gates and status: FlightAware AeroAPI, the next {schedule.data.flights.length} airline {mode === "departure" ? "departures" : "arrivals"}{schedule.data.fetched_at ? `, updated ${relativeAge(schedule.data.fetched_at, now)}` : ""}{schedule.data.stale ? " (refresh delayed)" : ""}. Progress and arrival estimates use the aircraft's live position.</>
            : "The scheduled board is paused: this month's FlightAware allowance is used. Live observations continue below."}
        </p>
      )}
      {board.data && (
        <p className="live-board-source">
          Observed live by ADS-B within {distanceText(board.data.radius_nm * 1.852, units)} ({board.data.aircraft_scanned} aircraft scanned)
          {board.data.routes_pending > 0 ? ` · resolving ${board.data.routes_pending} more routes` : ""}.
          Routes come from each callsign's usual service (adsb.lol), not a timetable; arrival times are estimated from distance and ground speed.
        </p>
      )}
    </section>
  );
}
