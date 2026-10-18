# SkyTrace glossary

Shared vocabulary for code, docs, issues and agents. Use these words exactly; if a term is missing, add it here before spreading it through the code.

| Term | Meaning |
| --- | --- |
| **Live feed** | Aircraft states reaching the map, made of the Global snapshot and, when zoomed in, the Local feed. Each aircraft keeps the source and age of its latest fix. |
| **Global snapshot** | Every aircraft in the world in one shared state list, refreshed about every two minutes (115 s at the default credit budget). Covers any zoom level. |
| **Local feed** | Aircraft within the visible area at close zoom, refreshed every few seconds. Merged with the Global snapshot by aircraft: whichever fix is newest wins, so a fresher Local fix replaces the snapshot's and an older one never does (see ADR 0008). |
| **Fix** | One reported coordinate pair with its own timestamp. Its age is shown separately from the aircraft's airborne/ground state. |
| **Projection** | Dead-reckoning between fixes along track and ground speed, capped at 150 s. Unknown-age fixes are never projected. |
| **Focus label** | The on-map label shown only for the selected aircraft, followed aircraft, emergency squawks and the few aircraft nearest the map centre at close zoom. |
| **Aircraft layer** | The WebGL (MapLibre GL) symbol layer that draws every aircraft of a view holding more than 750, as a layer of the map itself. The selected aircraft keeps its detailed marker. |
| **Trace** | The recorded path of one aircraft, always validated against its aircraft, callsign and requested time. |
| **Trail** | The browser-built path since the page opened, from successive live snapshots. Not a trace. |
| **Callsign** | The ADS-B flight identifier (`AFR1234`). |
| **Ticket flight number** | The passenger-facing number (`AF1234`) derived from an airline callsign. |
| **Airframe** | One physical aircraft, identified by ICAO24 hex and registration, with owner and registration history. |
| **Scheduled tail** | The registration FlightAware assigns to a flight number. It can differ from the airframe actually flying. |
| **Board** | An airport's departures and arrivals: scheduled (FlightAware), live (observed) or history (OpenSky, UTC). |
| **Dock** | The left flight-detail panel shown only when an aircraft is selected. |
| **Traffic panel** | The right panel with the In view, Airport and Alerts tabs. |
| **Enrichment** | Optional short-lived lookups for a selected aircraft (route, profile, FlightAware details). Each source is labelled. |
| **Catalogue** | Bundled, sourced datasets in `data/` (airports, airlines, logos, aircraft types, cabins). |

## Principles

- Never present an estimate as an observation. Label source, age and uncertainty.
- A missing answer stays missing; never substitute another flight or aircraft.
- Server owns credentials. The browser never sees them.
