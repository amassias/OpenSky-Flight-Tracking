import { useState } from "react";
import type { Airport, ScheduledFlight, TimetableResponse } from "../types";

function timetableTime(value: string | null, timezone: string): string {
  if (!value) return "—";
  return new Intl.DateTimeFormat("en-GB", { timeZone: timezone, hour: "2-digit", minute: "2-digit", day: "2-digit", month: "short" }).format(new Date(value));
}

function statusLabel(flight: ScheduledFlight): string {
  if (flight.status === "cancelled") return "Cancelled";
  if (flight.status === "departed") return "Departed (off-block)";
  if (flight.status === "arrived") return "Arrived";
  if (flight.status === "next-info") return "Awaiting update";
  if (flight.delayed) return "Delayed";
  if (flight.status === "estimated") return "Time updated";
  if (flight.status === "unknown") return "Status unavailable";
  return "Scheduled";
}

export function TimetableBoard({ airport, data, loading, error, onRetry }: { airport: Airport | null; data?: TimetableResponse; loading: boolean; error: boolean; onRetry: () => void }) {
  const [localTime, setLocalTime] = useState(false);
  const timezone = localTime && airport?.timezone ? airport.timezone : "UTC";
  if (!airport) return null;
  return <section className="timetable-board" aria-label="Flight timetable" aria-busy={loading}>
    <div className="timetable-source">
      <p>Planned flights · separate from ADS-B observations</p>
      {data?.provider === "Avinor" && <a href="https://www.avinor.no/" target="_blank" rel="noreferrer">Flydata fra Avinor</a>}
    </div>
    {loading && !data && <p className="timetable-message" role="status">Loading airport timetable…</p>}
    {error && <div className="timetable-message" role="alert"><p>The timetable could not be reached.</p><button type="button" onClick={onRetry}>Retry</button></div>}
    {data?.notice && <p className="timetable-message" role="status">{data.notice}</p>}
    {data?.coverage === "unsupported" && <div className="timetable-message"><p>Free operator data covers 43 Avinor airports in Norway. Global schedules need another licensed source.</p><a href="?airport=ENGM&view=schedule">Open Oslo timetable</a></div>}
    {data?.coverage === "available" && <>
      <div className="timetable-tools">
        <span>{data.flights.length} {data.mode === "arrival" ? "arrivals" : "departures"}</span>
        <label><input type="checkbox" checked={localTime} disabled={!airport.timezone} onChange={(event) => setLocalTime(event.target.checked)} /> Local times</label>
      </div>
      <p className="timetable-meta">Times: {timezone}. Selected day is UTC.{data.updated_at && ` Source updated ${timetableTime(data.updated_at, timezone)}.`}{data.stale ? " Cached data · refresh failed." : " Refreshes every 3 minutes."}</p>
      {!data.flights.length ? <p className="timetable-message">No flights reported for this UTC day and direction.</p> : <ol className="timetable-list">
        {data.flights.map((flight) => <li key={flight.id} className={`timetable-flight ${flight.status === "cancelled" ? "cancelled" : flight.delayed ? "delayed" : ""}`}>
          <div className="timetable-flight-heading"><strong className="mono">{flight.flight_number}</strong><span className="timetable-status">{statusLabel(flight)}{flight.delay_minutes ? ` · +${flight.delay_minutes} min` : ""}</span></div>
          <p className="timetable-route"><strong>{flight.other_airport}</strong> {flight.other_airport_name}</p>
          <p className="timetable-airline">{flight.airline_name}</p>
          <dl className="timetable-times">
            <div><dt>Scheduled</dt><dd>{timetableTime(flight.scheduled, timezone)}</dd></div>
            <div><dt>Estimated</dt><dd>{timetableTime(flight.estimated, timezone)}</dd></div>
            <div><dt>{flight.actual_event === "off-block" ? "Off-block" : "Actual"}</dt><dd>{timetableTime(flight.actual, timezone)}</dd></div>
          </dl>
          {(flight.gate || flight.terminal || flight.check_in || flight.baggage_belt) && <p className="timetable-meta">{[flight.gate && `Gate ${flight.gate}`, flight.terminal && `Terminal ${flight.terminal}`, flight.check_in && `Check-in ${flight.check_in}`, flight.baggage_belt && `Baggage ${flight.baggage_belt}`].filter(Boolean).join(" · ")}</p>}
          {flight.next_information && <p className="timetable-meta">Next information: {timetableTime(flight.next_information, timezone)}</p>}
        </li>)}
      </ol>}
    </>}
  </section>;
}
