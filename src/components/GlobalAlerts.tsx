import { useQuery } from "@tanstack/react-query";
import { api, ApiError } from "../api";
import { emergencyInfo, formatTime, liveAircraftToFlight } from "../utils";
import type { Flight } from "../types";

export function GlobalAlerts({ onSelect }: { onSelect: (flight: Flight) => void }) {
  const alerts = useQuery({ queryKey: ["global-emergencies"], queryFn: ({ signal }) => api.emergencies(signal), staleTime: 60_000, refetchInterval: 60_000, retry: false });
  return (
    <section className="global-alerts" aria-label="Worldwide emergency signals">
      <h2>Worldwide emergency signals</h2>
      <p className="conditions-note">Squawks 7500, 7600 and 7700, including aircraft outside your map. These signals do not establish the cause of an incident.</p>
      {alerts.isPending && <p role="status">Checking worldwide signals…</p>}
      {alerts.isError && <div className="data-notice-inline" role="status">{alerts.error instanceof ApiError ? alerts.error.message : "Global emergency feed is temporarily unavailable. Check your connection and retry."}<button type="button" onClick={() => alerts.refetch()}>Retry</button></div>}
      {alerts.data && <>
        <p className="conditions-note">adsb.lol · snapshot {formatTime(alerts.data.time)} UTC{alerts.isError ? " · refresh failed; last snapshot kept" : " · refreshed every minute"}</p>
        {!alerts.data.states.length && !alerts.isError && <p>No emergency squawks reported in this snapshot. Coverage depends on the receiver network.</p>}
        {alerts.data.states.map(aircraft => {
          const emergency = emergencyInfo(aircraft);
          return <button className="global-alert-row" type="button" key={aircraft.icao24} onClick={() => onSelect(liveAircraftToFlight(aircraft))}>
            <strong>{aircraft.callsign || aircraft.registration || aircraft.icao24.toUpperCase()}</strong>
            <span>{emergency?.code} · {emergency?.label}</span>
            <small>{aircraft.registration} {aircraft.aircraft_type} · Open aircraft</small>
          </button>;
        })}
      </>}
      <a href="https://api.adsb.lol/docs" target="_blank" rel="noreferrer">Open data source · adsb.lol (ODbL)</a>
    </section>
  );
}
