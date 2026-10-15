import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { api, readableApiError } from "../api";
import { useAirframeHistory } from "../hooks/useAirframeHistory";
import { airframeAge, describePeriod, distinctOwners, entryTitle, registrationsOf } from "../airframe";
import type { Flight } from "../types";

const dayFormatter = new Intl.DateTimeFormat("en-GB", { timeZone: "UTC", day: "numeric", month: "short", hour: "2-digit", minute: "2-digit", hour12: false });

function flightTime(value?: string | null): string {
  if (!value) return "—";
  const parsed = new Date(value);
  return Number.isNaN(parsed.getTime()) ? "—" : `${dayFormatter.format(parsed)}Z`;
}

interface AirframeHistoryProps {
  flight: Flight;
}

/** Facts, owners and operators over time, and recent flights of the selected airframe. */
export function AirframeHistory({ flight }: AirframeHistoryProps) {
  const [wantFlights, setWantFlights] = useState(false);
  const history = useAirframeHistory(flight.icao24);
  const data = history.data;
  // The registry knows the tail of this exact transponder code; a scheduled
  // tail from a flight plan can belong to another airframe.
  const registration = data?.registration ?? (flight.registration_source === "schedule" ? null : flight.registration) ?? null;
  const recentFlights = useQuery({
    queryKey: ["airframe-flights", registration],
    queryFn: ({ signal }) => api.aircraftFlights(registration!, signal),
    enabled: wantFlights && Boolean(registration),
    staleTime: 30 * 60_000,
    retry: false,
  });

  if (history.isPending) return <div className="chart-skeleton airframe-skeleton" role="status" aria-label="Loading airframe history" />;
  if (history.isError) {
    return (
      <div role="status">
        <p className="track-error">Airframe history unavailable · {readableApiError(history.error)}</p>
        <button className="secondary-button" type="button" onClick={() => history.refetch()}>Try again</button>
      </div>
    );
  }

  const entries = data?.history ?? [];
  const registry = data?.registry ?? null;
  const facts = data?.airframe ?? {};
  const age = airframeAge(facts.built);
  const registrations = registrationsOf(entries);
  const owners = distinctOwners(entries);
  const ownerToday = registry?.owner || flight.aircraft_owner || entries.find((entry) => entry.current && entry.owner)?.owner || null;
  const model = [facts.manufacturer ?? registry?.manufacturer, facts.model ?? registry?.type].filter(Boolean).join(" ");

  if (!data?.found && !registration && !flight.registration) return null;

  return (
    <div className="airframe">
      {(registration || model || flight.aircraft_description || flight.aircraft_type) && <div className="airframe-hero">
        {registration && <strong className="airframe-registration mono">{registration}</strong>}
        {(model || flight.aircraft_description || flight.aircraft_type) && <span className="airframe-model">{model || flight.aircraft_description || flight.aircraft_type}</span>}
      </div>}

      <dl className="airframe-facts">
        {ownerToday && <div><dt>Owner today</dt><dd>{ownerToday}{registry?.owner_country ? <small>{registry.owner_country}</small> : null}</dd></div>}
        {facts.serial && <div><dt>Serial (MSN)</dt><dd className="mono">{facts.serial}</dd></div>}
        {(facts.built ?? flight.aircraft_year) && <div><dt>Built</dt><dd className="mono">{facts.built ?? flight.aircraft_year}{age != null ? <small>{age} {age === 1 ? "year" : "years"} old</small> : null}</dd></div>}
        {(facts.country ?? registry?.owner_country) && <div><dt>Registered in</dt><dd>{facts.country ?? registry?.owner_country}</dd></div>}
        {facts.engines && <div className="airframe-wide"><dt>Engines</dt><dd>{facts.engines}</dd></div>}
        {facts.seats && <div><dt>Seats</dt><dd className="mono">{facts.seats}</dd></div>}
      </dl>

      {entries.length > 0 ? (
        <>
          <h4 className="airframe-subhead">
            History
            <small>{registrations.length > 1 ? `${registrations.length} registrations · ` : ""}{owners.length} {owners.length === 1 ? "owner or operator" : "owners and operators"}</small>
          </h4>
          <ol className="airframe-timeline">
            {entries.map((entry, index) => (
              <li key={`${entry.source}-${entry.icao24}-${entry.registration}-${entry.from}-${index}`} className={entry.current ? "is-current" : undefined}>
                <span className="timeline-dot" aria-hidden="true" />
                <div className="timeline-body">
                  <div className="timeline-head">
                    <strong className={entry.owner || entry.operator ? undefined : "is-muted"}>{entryTitle(entry)}</strong>
                    {entry.registration && <span className="reg-chip mono">{entry.registration}</span>}
                  </div>
                  {(entry.owner && entry.operator && entry.operator !== entry.owner) || entry.location || entry.event ? (
                    <p className="timeline-meta">
                      {[
                        entry.owner && entry.operator && entry.operator !== entry.owner ? `Operated by ${entry.operator}` : null,
                        entry.location,
                        entry.event,
                      ].filter(Boolean).join(" · ")}
                    </p>
                  ) : null}
                  <p className="timeline-period">
                    <span className="mono">{describePeriod(entry, data?.snapshots?.last)}</span>
                  </p>
                </div>
              </li>
            ))}
          </ol>
        </>
      ) : null}

      {registration && <div className="airframe-flights">
        <h4 className="airframe-subhead">Recent flights<small>last ~10 days</small></h4>
        {!wantFlights ? (
          <button type="button" className="secondary-button" onClick={() => setWantFlights(true)}>Show recent flights of {registration}</button>
        ) : recentFlights.isPending ? (
          <div className="chart-skeleton" role="status" aria-label="Loading recent flights" />
        ) : recentFlights.isError ? (
          <p className="track-error" role="status">Recent flights unavailable · {readableApiError(recentFlights.error)}</p>
        ) : !recentFlights.data.available ? (
          <p className="track-error" role="status">
            Recent flights are unavailable right now.
          </p>
        ) : recentFlights.data.flights.length === 0 ? (
          <p className="track-error">No recent flights found for {registration}.</p>
        ) : (
          <ul className="airframe-flight-list">
            {recentFlights.data.flights.map((item) => (
              <li key={item.fa_flight_id ?? `${item.ident}-${item.scheduled_out}`}>
                <span className="mono">{flightTime(item.actual_out ?? item.scheduled_out)}</span>
                <span className="mono airframe-route">{item.origin?.code_iata || item.origin?.code_icao || "—"} → {item.destination?.code_iata || item.destination?.code_icao || "—"}</span>
                <span className="airframe-flight-ident mono">{item.ident_iata || item.ident}</span>
                <span className={`flight-state ${item.cancelled ? "is-alert" : ""}`}>{item.cancelled ? "Cancelled" : (item.status ?? "").split("/")[0].trim() || "—"}</span>
              </li>
            ))}
          </ul>
        )}
      </div>}
      <p className="profile-footnote">Individuals' names are not shown.</p>
    </div>
  );
}
