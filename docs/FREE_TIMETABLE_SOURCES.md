# Free timetable sources

Checked 8 October 2026. A public ADS-B receiver network supplies observed aircraft positions, not a complete passenger timetable. A missing aircraft does not establish a cancelled flight. The application keeps operator timetables and observed traffic in separate views.

| Source | Coverage and free access | Decision |
| --- | --- | --- |
| [Avinor flight data](https://partner.avinor.no/tjenester/flydata/) | 43 operator airports in Norway, public XML, no API key or subscription. Scheduled flights, status/time updates, cancellations and optional gate/check-in/baggage fields. | Connected. Poll no more than every three minutes per airport and show the required linked attribution beside the data. |
| [OurAirports](https://ourairports.com/data/) | Public-domain airport metadata; no timetables. | Bundled city/type/service metadata; preserves the existing catalogue's names and coordinates. |
| [Aviationstack](https://aviationstack.com/pricing) | Free plan: 100 monthly requests, personal/noncommercial use. Flight schedules and future-flight features are in the paid Basic tier (advertised $49.99/month at inspection). | No dependency on a paid plan or secret key. |
| [Schiphol Flight API](https://developer.schiphol.nl/apis/flight-api/conditions) | Airport-specific; account/key and contractual limitations including storage duration and redistribution. | Not a freely redistributable global source. |

No verified free, openly reusable global timetable feed was found, including for CDG. This is a scoped integration, not a claim that none can ever exist. Avinor is a free operator feed, not an open-source global timetable database. The adapter itself is included in this repository.

## Avinor contract

- Fixed HTTPS upstream: `https://asrv.avinor.no/XmlFeed/v1.0`, using `airport`, `TimeFrom=96`, `TimeTo=144`, both directions. Private Sandefjord Torp is not covered.
- The server holds a 180-second per-airport cache shared across dates and directions, serializes refreshes per airport, and backs off for 180 seconds after failure. Vercel additionally caches each timetable URL for 180 seconds. These are instance/CDN caches, not a durable globally coordinated lock; a larger multi-region deployment would need shared caching to guarantee a global polling limit.
- After an upstream failure, the last successfully fetched snapshot can be displayed for at most 15 minutes, visibly marked stale. Older snapshots are not returned.
- Required visible attribution: **Flydata fra Avinor**, linked to `https://www.avinor.no/`. The operator provides no completeness or timeliness guarantee.
- Airport coverage is an explicit allowlist verified against the [official airport selector](https://www.avinor.no/en/airport/oslo/).
- Day filtering is by scheduled **UTC** date. Local display uses the airport IANA timezone and includes the day/month, so midnight/daylight-saving conversions remain visible. Full requested days must fit the operator's rolling 96-hour past / 144-hour future window.
- `E` supplies a revised time; `N` supplies the time of the next information update, never an ETA. `C` cancels the flight and suppresses estimates/delay calculations. `D` is labelled off-block rather than takeoff. Positive delays are calculated relative to scheduled time; missing values stay unknown.
- Schedule identifiers are not ADS-B aircraft identities. Rows do not pretend to select a live aircraft or fabricate a track.
- Airline display names snapshot: [Avinor airlineNames endpoint](https://asrv.avinor.no/airlineNames/v1.0), downloaded 8 October 2026. Attribution remains alongside the timetable.

## Airport metadata provenance

`data/airport-metadata.json` is reproducible using `node scripts/build-airport-metadata.mjs /path/to/airports.csv` and [OurAirports' CSV](https://github.com/davidmegginson/ourairports-data/blob/main/airports.csv), retrieved 8 October 2026. Fields are documented in the [data dictionary](https://ourairports.com/help/data-dictionary.html). 7,640 of the existing 7,895 airports match by ICAO; unmatched records retain existing information. Military designation is only a heuristic for explicit name/keyword wording, not an authoritative classification.

Timezone values are derived with [geo-tz 8.1.9](https://github.com/evansiroky/node-geo-tz) (MIT code) from [timezone-boundary-builder](https://github.com/evansiroky/timezone-boundary-builder) boundaries, derived from OpenStreetMap contributors. The timezone-derived subset of the distributed metadata is available under the [Open Database License 1.0](https://opendatacommons.org/licenses/odbl/1-0/); OurAirports fields remain public domain. Source timezone boundary data and the generation script are linked here for reproducibility.
