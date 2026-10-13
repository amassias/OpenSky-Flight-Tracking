import { useQuery } from "@tanstack/react-query";
import { api } from "../api";
import { operatorCode } from "../aircraftIdentity";
import type { Flight } from "../types";

export function AircraftCabin({ flight }: { flight: Flight }) {
  const operator = operatorCode(flight);
  const type = flight.aircraft_type?.toUpperCase() ?? "";
  const registration = flight.registration_source === "schedule" ? null : flight.registration;
  const { data } = useQuery({
    queryKey: ["aircraft-enrichment", operator, type, registration],
    queryFn: ({ signal }) => api.aircraftEnrichment(operator, type, registration, signal),
    enabled: Boolean(operator && type), staleTime: 24 * 60 * 60_000, retry: false,
  });
  if (!data?.configurations?.length || data.operator_code !== operator || data.aircraft_type !== type) return null;
  return <section className="cabin-section" aria-label="Cabin configurations">
    <h3>Cabin & seats</h3>
    <p className="conditions-note">{data.match_level === "airframe" ? "Configuration of this aircraft" : "Published configurations for this operator and aircraft type. This aircraft’s layout is not confirmed."}</p>
    {data.configurations.map(config => <details className="cabin-variant" key={config.id} open={data.configurations.length === 1}>
      <summary>{config.total_seats} seats <span>{config.classes.length === 1 ? config.classes[0].name : `${config.classes.length} cabins`}</span></summary>
      <div className="cabin-diagram" role="img" aria-label={`Seat proportions: ${config.classes.map(c => `${c.name} ${c.seats}`).join(", ")}`}>
        {config.classes.map(c => <span key={c.name} className={`cabin-${c.name.toLowerCase().replaceAll(" ", "-")}`} style={{ flex: c.seats }} />)}
      </div>
      <small className="conditions-note">Seat proportions · schematic</small>
      <dl className="cabin-counts">{config.classes.map(c => <div key={c.name}><dt>{c.name}</dt><dd>{c.seats}</dd></div>)}</dl>
      {config.amenities && <ul className="cabin-amenities">{Object.values(config.amenities).filter(Boolean).map(value => <li key={value}>{value}</li>)}</ul>}
      <div className="cabin-sources">
        <a href={config.seat_map_url} target="_blank" rel="noreferrer">Seat information ↗</a>
        <a href={config.source.url} target="_blank" rel="noreferrer">Source: {config.source.name}</a>
        <small>Checked {config.source.checked_at}</small>
        {config.assignment_source && <a href={config.assignment_source.url} target="_blank" rel="noreferrer">Aircraft assignment source</a>}
      </div>
    </details>)}
  </section>;
}
