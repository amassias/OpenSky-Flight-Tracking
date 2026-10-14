import { useQuery } from "@tanstack/react-query";
import { api } from "../api";
import { operatorCode } from "../aircraftIdentity";
import { cabinSummary, cabinTone, checkedAgo, distinctSeatMapUrl } from "../cabin";
import type { Flight } from "../types";

export function AircraftCabin({ flight }: { flight: Flight }) {
  // Reset native disclosures when a different aircraft/configuration is selected.
  const registration = flight.registration_source === "schedule" ? null : flight.registration ?? null;
  const key = [flight.icao24, operatorCode(flight), flight.aircraft_type?.toUpperCase(), registration].join(":");
  return <CabinContent key={key} flight={flight} />;
}

function CabinContent({ flight }: { flight: Flight }) {
  const operator = operatorCode(flight);
  const type = flight.aircraft_type?.toUpperCase() ?? "";
  const registration = flight.registration_source === "schedule" ? null : flight.registration ?? null;
  const { data, isPending, isError, refetch, isFetching } = useQuery({
    queryKey: ["aircraft-enrichment", operator, type, registration],
    queryFn: ({ signal }) => api.aircraftEnrichment(operator, type, registration, signal),
    enabled: Boolean(operator && type), staleTime: 24 * 60 * 60_000, retry: false,
  });
  if (!operator || !type) return null;
  const heading = <h3>Cabin & seats</h3>;
  if (isPending) return <section className="cabin-section" aria-label="Cabin configurations">{heading}<p className="conditions-note" role="status">Loading published cabin configurations…</p></section>;
  if (isError && !data) return <section className="cabin-section" aria-label="Cabin configurations">{heading}<p className="conditions-note" role="status">Cabin configurations could not be loaded.</p><button type="button" className="secondary-button" disabled={isFetching} onClick={() => { void refetch(); }}>Retry cabin</button></section>;
  if (!data?.configurations?.length || data.operator_code !== operator || data.aircraft_type !== type) return <section className="cabin-section" aria-label="Cabin configurations">{heading}<p className="conditions-note">No published configuration available for this operator and aircraft type.</p></section>;
  return <section className="cabin-section" aria-label="Cabin configurations">
    <h3>Cabin & seats</h3>
    <p className="conditions-note">{data.match_level === "airframe" ? "Configuration of this aircraft" : `${data.configurations.length === 1 ? "Published configuration" : "Published configurations"} for this operator and aircraft type. This aircraft’s layout is not confirmed; other layouts may exist.`}</p>
    {data.configurations.map(config => {
      const seatMapUrl = distinctSeatMapUrl(config);
      return <details className="cabin-variant" key={config.id} open={data.configurations.length === 1}>
        <summary>{config.total_seats} seats <span>{cabinSummary(config)}</span></summary>
        <div className="cabin-inventory">
          {config.classes.map(c => <div key={c.name} className="cabin-class" data-tone={cabinTone(c.name)}>
            <div className="cabin-class-heading"><h4><span className="cabin-swatch" aria-hidden="true" />{c.name}</h4><strong>{c.seats}<span> seats</span></strong></div>
          </div>)}
          <details className="cabin-inventory-toggle">
            <summary>Show seat inventory</summary>
            <p className="cabin-inventory-caption">Each symbol represents one seat</p>
            {config.classes.map(c => <div key={c.name} className="cabin-class" data-tone={cabinTone(c.name)}>
              <p className="conditions-note">{c.name}</p>
              <div className="cabin-seat-grid" role="img" aria-label={`${c.name}: ${c.seats} seats. Capacity illustration, not seat positions.`}>
                {Array.from({ length: c.seats }, (_, index) => <svg key={index} className="cabin-seat" viewBox="0 0 16 18" aria-hidden="true"><rect className="seat-back" x="3" y="1" width="10" height="10" rx="2" /><path className="seat-cushion" d="M3 9h10v5H3z" /><path className="seat-arms" d="M1 8v7h14V8M4 15v2m8-2v2" /></svg>)}
              </div>
            </div>)}
          </details>
          <p className="cabin-inventory-note">Capacity illustration. Seat positions and aisle layout are shown in the published seat map.</p>
          <a className="cabin-map-link" href={seatMapUrl ?? config.source.url} target="_blank" rel="noreferrer">View published seat map <span aria-hidden="true">↗</span></a>
        </div>
        {config.note && <p className="conditions-note">{config.note}</p>}
        {config.amenities && <ul className="cabin-amenities">{Object.values(config.amenities).filter(Boolean).map(value => <li key={value}>{value}</li>)}</ul>}
        <div className="cabin-sources">
          <a href={config.source.url} target="_blank" rel="noreferrer">Source: {config.source.name} ↗</a>
          <small title={config.source.checked_at}>{checkedAgo(config.source.checked_at)}</small>
          {config.assignment_source && <a href={config.assignment_source.url} target="_blank" rel="noreferrer">Aircraft assignment source ↗</a>}
        </div>
      </details>;
    })}
  </section>;
}
