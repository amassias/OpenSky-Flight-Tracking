# 0003. Independent public sources for current-flight traces

Status: accepted (2026-10-17)

## Context

A working live-position API is not an altitude history. Airplanes.live requires access approval; ADSB.fi documents current-position queries but its globe trace files returned HTTP 403. ADSB.lol's public trace files intermittently time out from both the development machine and production. OpenSky's tracks endpoint can work locally while its Vercel network path times out.

TheAirTraffic's official site states that it provides unrestricted real-time and historical air traffic data for sharing and learning. Its public full/recent readsb trace files returned valid aircraft identities and current observations in tests near Paris, Chicago and Singapore. This is verified public access, not a contractual availability or commercial redistribution guarantee. No numeric quota or SLA was found.

## Decision

- Fetch current-flight traces from TheAirTraffic, with ADSB.lol as an independent fallback. Never bypass a denied endpoint or reuse credentials from a third party.
- Keep requests on demand for the selected aircraft, cache for at most 90 seconds, pace each provider to at most one request start per 1.05 seconds per function instance, and cool down failed providers. These per-instance controls do not promise a deployment-wide quota.
- Validate aircraft hex, expected callsign and observation time before accepting a provider; a mismatched primary trace must not suppress the fallback.
- Read a full file, then its recent counterpart if the full file's latest usable point is older than 60 seconds. Merge observed timestamps from the same provider only; recent points win at overlaps. Preserve null altitudes and flight/emergency boundaries. The server still extracts only the current flight leg.
- Keep cache entries separate by aircraft and callsign. Do not use these live files to answer historical-date requests.
- Credit the actual source with a link next to the graph and show the latest observation in UTC. Preserve genuine no-data results and retryable provider failures as distinct states.

## Consequences

- The profile no longer depends on one public trace host. A full file's lag need not discard the recorded history or freeze its current tail.
- The implementation is isolated in `aircraft_tracks.py`, shared by the existing OpenSky client and HTTP/ASGI adapters, without a new dependency.
- Free community feeds have coverage gaps and no verified SLA. Published personal/non-commercial restrictions on other sources still apply; endpoint availability alone is not a licence for commercial reuse.
