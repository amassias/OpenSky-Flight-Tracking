# SkyTrace glossary

Shared vocabulary for code, docs, issues and agents. Use these words exactly; if a term is missing, add it here before spreading it through the code.

| Term | Meaning |
| --- | --- |
| **Live feed** | Aircraft states from OpenSky (authenticated proxy) or the public ADS-B fallback, cropped to the visible map bounds. |
| **Fix** | One reported coordinate pair with its own timestamp. Its age is shown separately from the aircraft's airborne/ground state. |
| **Projection** | Dead-reckoning between fixes along track and ground speed, capped at 90 s. Unknown-age fixes are never projected. |
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
