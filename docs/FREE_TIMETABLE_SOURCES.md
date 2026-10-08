# Worldwide timetable source evaluation

Checked 8 October 2026. The requirement is a usable worldwide airport timetable: planned flights, revised times, delays and cancellations. ADS-B observations are not a substitute. The previously connected Norwegian-only Avinor adapter has been removed, including its UI, API route, automatic polling and Oslo shortcut. The airport board continues to show observed movements or explicitly labelled nearby traffic.

| Source | Verified access limits | Decision |
| --- | --- | --- |
| [Avinor](https://partner.avinor.no/tjenester/flydata/) | Free operator feed for 43 Norwegian airports. | Removed: does not satisfy worldwide coverage. |
| [Aviationstack pricing](https://aviationstack.com/pricing) | Free plan: 100 monthly requests, personal/noncommercial real-time flights. Flight schedules and future-flight features are in the paid Basic tier ($49.99/month at inspection). | Not a free worldwide timetable solution. |
| [FlightAware AeroAPI](https://www.flightaware.com/commercial/aeroapi/) | Worldwide schedules and airport scheduled-arrival/departure endpoints are metered. Requires an account/API key. | A possible licensed provider, not an unrestricted free source. No new paid calls enabled. |
| [SkyLink current rate limits](https://skylinkapi.com/docs/rate-limits/) and [getting started](https://skylinkapi.com/docs/getting-started/) | A free trial requires an application and review; quota and overage apply. Its GitHub examples advertise 1,000 free monthly requests, but the current official onboarding does not describe a permanently available self-service free service. | Candidate for evaluation only; account, access, live worldwide coverage and terms would need verification. No credentials or trial have been provisioned. |
| [AirLabs documentation](https://www.airlabs.co/docs/) and [terms](https://airlabs.co/terms-of-service) | Advertises global schedules; requires a key/subscription. Terms allow limited-period free trials. | A free key or open-source client does not establish free worldwide data access or complete airport coverage. Not connected. |
| [Schiphol Flight API](https://developer.schiphol.nl/apis/flight-api/conditions) | Airport-specific, account/key and storage/redistribution constraints. | Does not satisfy worldwide coverage. |

No currently usable free provider covering every airport was verified. This is a research finding, not a claim that no such provider can ever exist. Providers' worldwide coverage claims must be tested on airports across regions and checked against missing services before implementation. No timetable button is shown until a provider meeting the requirement is actually connected and validated.

## Airport metadata provenance

`data/airport-metadata.json` is reproducible using `node scripts/build-airport-metadata.mjs /path/to/airports.csv` and [OurAirports' CSV](https://github.com/davidmegginson/ourairports-data/blob/main/airports.csv), retrieved 8 October 2026. Fields are documented in the [data dictionary](https://ourairports.com/help/data-dictionary.html). 7,640 of the existing 7,895 airports match by ICAO; unmatched records retain existing information. Military designation is only a heuristic for explicit name/keyword wording, not an authoritative classification.

Timezone values are derived with [geo-tz 8.1.9](https://github.com/evansiroky/node-geo-tz) (MIT code) from [timezone-boundary-builder](https://github.com/evansiroky/timezone-boundary-builder) boundaries, derived from OpenStreetMap contributors. The timezone-derived subset of the distributed metadata is available under the [Open Database License 1.0](https://opendatacommons.org/licenses/odbl/1-0/); OurAirports fields remain public domain. Source timezone boundary data and the generation script are linked here for reproducibility.
