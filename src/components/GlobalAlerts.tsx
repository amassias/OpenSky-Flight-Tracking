import { useQuery } from "@tanstack/react-query";
import { api, ApiError } from "../api";
import { emergencyInfo, formatTime, liveAircraftToFlight } from "../utils";
import { useNow } from "../hooks/useNow";
import type { Flight } from "../types";

export function GlobalAlerts({ onSelect }: { onSelect: (flight: Flight) => void }) {
  const now = useNow(10_000) / 1000;
  const alerts = useQuery({
    queryKey: ["global-emergencies"], queryFn: ({ signal }) => api.emergencies(signal),
    staleTime: 30_000, gcTime: 10 * 60_000, retry: false,
    refetchInterval: query => {
      const retry = query.state.error instanceof ApiError ? query.state.error.details?.retry_after_seconds : undefined;
      return Math.max(30, Math.min(300, typeof retry === "number" && Number.isFinite(retry) ? retry : query.state.data?.retry_after_seconds ?? 60)) * 1000;
    },
    refetchOnReconnect: true,
  });
  const age = alerts.data ? Math.max(0, now - alerts.data.time) : 0;
  const expired = age > 300;
  const delayed = Boolean(alerts.isError || alerts.data?.status === "delayed" || age > 90);
  const snapshot = !expired ? alerts.data : undefined;
  return (
    <section className="global-alerts" aria-label="Worldwide emergency signals" aria-busy={alerts.isPending}>
      <div className="alerts-heading"><h2>Worldwide emergency signals</h2>
        <button className="text-button" type="button" disabled={alerts.isFetching} onClick={() => alerts.refetch()}>{alerts.isFetching ? "Refreshing…" : "Refresh"}</button>
      </div>
      <p className="conditions-note">Transponder signals from the worldwide receiver network. Coverage varies; a signal does not establish the cause of an incident.</p>
      {alerts.isPending && <div className="alerts-loading" role="status">Checking worldwide signals…<div className="loading-placeholder" /><div className="loading-placeholder" /></div>}
      {(delayed || expired) && <div className="data-notice-inline" role="status">
        <strong>{snapshot ? "Updates delayed" : "Worldwide signals unavailable"}</strong>
        <p>{snapshot ? "The last observation is kept below. It is not a current emergency report." : alerts.error instanceof ApiError ? alerts.error.message : "The receiver feed could not be refreshed. We will try again automatically."}</p>
        <button className="text-button" type="button" disabled={alerts.isFetching} onClick={() => alerts.refetch()}>Retry</button>
      </div>}
      {snapshot && <>
        <p className="alerts-freshness"><span className={`system-dot ${delayed ? "warning" : "online"}`} aria-hidden="true" />{delayed ? "Last observation" : "Latest snapshot"} · {formatTime(snapshot.time)} UTC · {age < 60 ? "less than a minute ago" : `${Math.floor(age / 60)} min ago`}</p>
        {!snapshot.states.length && <p>{delayed ? "No signals were reported in that observation. Current status is unknown." : "No emergency squawks reported in this snapshot. Coverage depends on the receiver network."}</p>}
        {snapshot.states.map(aircraft => {
          const emergency = emergencyInfo(aircraft);
          return <button className="global-alert-row" type="button" key={aircraft.icao24} disabled={delayed} onClick={() => onSelect(liveAircraftToFlight(aircraft))}>
            <strong>{aircraft.callsign || aircraft.registration || aircraft.icao24.toUpperCase()}</strong>
            {aircraft.airline_name && <span className="alert-operator">{aircraft.airline_name}</span>}
            <span>{emergency?.code} · {emergency?.label}</span>
            <small>{[aircraft.registration, aircraft.aircraft_type].filter(Boolean).join(" · ")}</small>
            <span className="alert-action">{delayed ? "Awaiting a fresh observation" : "View aircraft →"}</span>
          </button>;
        })}
      </>}
      <details className="alerts-help"><summary>What do these codes mean?</summary><dl>
        <dt>7700 · General emergency</dt><dd>A priority signal; the reason is not transmitted in the code.</dd>
        <dt>7600 · Radio communication failure</dt><dd>A signal that the aircraft cannot communicate normally by radio.</dd>
        <dt>7500 · Unlawful interference</dt><dd>A transponder indication, not independent confirmation of an incident.</dd>
      </dl></details>
      <a href="https://api.adsb.lol/docs" target="_blank" rel="noreferrer">Open data source · adsb.lol (ODbL)</a>
    </section>
  );
}
