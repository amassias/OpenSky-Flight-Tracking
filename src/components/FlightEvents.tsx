import type { Airport, Flight, TrackResponse } from "../types";
import { emergencyInfo, formatTime } from "../utils";
import { confirmedDiversion, possibleDiversion } from "../flightEvents";

export function FlightEvents({ flight, track, airports }: { flight: Flight; track?: TrackResponse; airports?: ReadonlyMap<string, Airport> }) {
  const signal = emergencyInfo(flight);
  const events = track?.track.emergency_events ?? [];
  const diversion = possibleDiversion(flight, track, airports);
  const confirmed = confirmedDiversion(flight);
  if (!signal && !events.length && !diversion && !confirmed) return null;
  return (
    <section className="flight-events" aria-label="Flight alerts and events">
      <h3>Flight alerts & events</h3>
      {signal && <p><strong>{signal.code} · {signal.label}</strong><span>Reported by the transponder. The signal does not identify the cause.</span></p>}
      {confirmed && <p><strong>Diverted · reported by FlightAware</strong><span>{flight.flightaware?.status || "The operational provider reports a diversion."}</span></p>}
      {diversion && <p><strong>{diversion.returned ? "Possible return to origin" : "Possible diversion"} · ADS-B estimate</strong><span>Ground positions observed near {diversion.airport.iata || diversion.airport.icao} ({diversion.airport.name}), away from the listed destination, which may come from a usual callsign route. This does not confirm a diversion or its cause.</span></p>}
      {events.length > 0 && <>
        <ul>{events.map((event) => {
          const label = emergencyInfo({ squawk: event.code, emergency: event.code })?.label ?? "Priority signal";
          return <li key={`${event.first_seen}-${event.code}`}><strong>{event.code} · {label}</strong><span>{formatTime(event.first_seen)}–{formatTime(event.last_seen)} UTC observed{event.ended_at ? ` · signal changed at ${formatTime(event.ended_at)} UTC` : " · end not observed"}</span></li>;
        })}</ul>
        <p className="conditions-note">Source: adsb.lol / readsb trace for this flight. Codes are sampled; absence of a recorded code does not prove that no incident occurred.</p>
      </>}
    </section>
  );
}
