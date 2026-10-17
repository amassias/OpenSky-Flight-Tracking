# API and altitude profile reliability — 2026-10-17

## Findings

Reviewed `d27fdb4`, `d028e96` and `d59dde6` against the API/client boundary. The existing altitude identity bug was introduced in `8693cdf` on October 13; it is not introduced by the latest retry commits.

- `_get_adsb_lol_track` overwrote the aircraft hex variable with an emergency code (often `None`) when a trace point carried flight metadata. Both the returned identity and cache key were corrupted. `handle_track` then correctly rejected the mismatched trace. Preserve aircraft identity and use a separate event code.
- `_track_for_candidate_times` swallowed provider errors and returned HTTP 200 with no path. TanStack Query's newly added retries could not run and the no-data section disappeared. Preserve provider errors through the API as HTTP 503; genuine missing traces remain empty successes.
- A stale full-day file prevented trying the recent file. Validate recency before accepting a file or caching it, then try recent if necessary. Keep callsign, time and flight-leg validation intact.
- Public probes from this machine found ADSB.lol timing out, Airplanes.live returning 403, and ADSB.fi returning 200 in about 0.08 s. Start cold live-feed requests with ADSB.fi while preserving independent fallbacks and the existing temporary failure ordering. This is a dated observation, not an availability guarantee.
- The deployed track endpoint on the previous version returned HTTP 200 / zero points after 24.1 s during an outage. Trace requests now use separate 2 s connect and 4 s read timeouts instead of a 12 s timeout per file, and return a safe retryable provider error.

## Validation

Failing regressions were recorded before the corresponding fixes. Coverage includes normal/emergency metadata identity, cache reuse, stale full to recent fallback, outage after a stale full file, cold provider order, provider failure propagation and real parser → FastAPI response.

- `npm run check`: lint, 198 frontend tests, TypeScript and production build passed.
- `python3 -m pytest -q`: 148 passed.
- Chromium full existing suite: 73 passed, 2 intentional mobile-only skips.
- Added browser regression: provider outage exhausts automatic retries, keeps Altitude profile and Retry track visible, then renders the chart after manual retry; no page errors.

## Limit

No verified independent public trace provider was available in the live probes. A healthy live feed does not imply available historical altitude data. The fix cannot manufacture missing observations: when ADSB.lol is unreachable, the user receives a retryable error. Serverless historical-date traces remain intentionally unavailable.
