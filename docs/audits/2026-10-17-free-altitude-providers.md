# Free sources for altitude profiles — checked 2026-10-17

## Selection

TheAirTraffic is integrated for current-flight traces, with ADSB.lol as the independent fallback. Five live-aircraft probes across Paris, Chicago and Singapore returned matching identities and usable altitude observations; production verification is separate from these local probes.

| Provider | Free access and requirement | Altitude history suitable here | Decision |
| --- | --- | --- | --- |
| TheAirTraffic | Public full/recent trace files, no key in the probes. Official site describes unrestricted live/historical data sharing; no numeric quota, SLA or formal redistribution licence located. | Full-day files plus current recent observations; both in readsb format. | Integrate on demand, pace, cache, attribute and retain independent fallback. |
| ADSB.lol | Public API/data under ODbL; production users are asked to contact the operator. | Public full/recent traces exist but intermittently time out. | Keep as independent fallback and retain attribution. |
| OpenSky | Free REST API within its authentication/credit and usage rules. | `/tracks/all` returned 55 points locally; production proxy logs show connection timeouts. | Keep existing local OpenSky path; do not make Vercel profile availability depend on it. |
| ADSB.fi | Public API for personal/non-commercial use, attribution/link, 1 request/s. | Documented endpoints are current positions. Globe trace probe returned 403. | Keep live feed; do not treat it as verified historical trace access. |
| Airplanes.live | API probe returns 403 requesting project approval. | Awaiting access; no assumption that approval covers trace files. | Access request already sent separately by the user. |
| ADS-B Exchange | Official community API is $10/month; free samples cover the first day of each month. | Samples are unsuitable for current flights. | Exclude from a no-cost current-profile integration. |
| Aviationstack | Free plan for basic real-time flight data; historical data is an advanced paid feature. | No verified free sequence of timestamped altitude observations for the current flight. | Exclude from this profile integration. |

## Primary references

- TheAirTraffic mission and public map: https://theairtraffic.com/ and https://globe.theairtraffic.com/
- ADSB.lol API and terms: https://api.adsb.lol/docs
- ADSB.fi documented public endpoints, limits and terms: https://github.com/adsbfi/opendata/blob/main/README.md
- OpenSky tracks: https://github.com/openskynetwork/opensky-api/blob/master/docs/free/rest.rst
- Airplanes.live documentation/spec: https://airplanes.live/api-docs/ and https://airplanes.live/openapi.yaml
- ADS-B Exchange community pricing: https://adsbexchange.com/community/developer-hub/
- ADS-B Exchange sample limitations: https://www.adsbexchange.com/data-products/sample-data/
- Aviationstack free/paid distinction: https://aviationstack.com/faq

## Live probes from the development machine

These are dated observations, not a coverage or uptime guarantee. The HTTP handler validated callsign and extracted the current leg in the first three probes; the additional regional probes exercised the new source client directly.

| Area | Hex / callsign | Source | Points | Latest point age | Request time |
| --- | --- | --- | ---: | ---: | ---: |
| Paris | 400982 / BAW352 | TheAirTraffic | 319 | 28 s | 1.21 s |
| Paris | 4400b2 / EJU92MA | TheAirTraffic | 332 | 35 s | 2.13 s |
| Paris | 4520aa / JAF1VY | TheAirTraffic | 268 | 35 s | 2.08 s |
| Chicago | a0658c / N12441 | TheAirTraffic | 3138 | 6 s | 1.28 s |
| Singapore | 7c8066 / QFA256 | TheAirTraffic | 3548 | 7 s | 1.20 s |

## Verification scope

Regression tests cover independent failover, full/recent merging and deduplication, matching aircraft/callsign/time, per-flight cache isolation, denied-access cooldown, genuinely missing traces, recoverable failures, malformed observations, unit conversion, emergency events and historical request exclusion. Browser checks verify the source link, UTC observation time, retry/recovery and retained point inspection.

Implementation decision: [ADR 0003](../adr/0003-independent-current-flight-traces.md).

Local validation: `npm run check` passed (199 frontend tests, lint, TypeScript and production build); `python3 -m pytest -q` passed (162 tests); Chromium passed 74 tests with 2 intentional mobile-only skips. The UI detector reported no findings.
