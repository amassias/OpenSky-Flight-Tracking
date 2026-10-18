# 0008. Global snapshot plus local feed

Status: accepted (2026-10-18, from the free ADS-B sources audit in `docs/audits/2026-10-18-free-adsb-sources.md`)

## Decision
The Live feed combines two sources:

- **Global snapshot**: one OpenSky `/states/all` call without a bounding box, made server-side through the private OpenSky proxy with OAuth2, once every 115 s at the default budget of 3,000 credits a day (`ceil(86,400 x 4 / budget)`; the first draft said about 86 s, which is the cadence of a 4,000 credit budget, the whole allowance with no headroom). It is shared by all visitors through a CDN cache and only fetched at wide zoom.
- **Local feed**: point-and-radius requests to adsb.fi v3 (adsb.lol as fallback) every 5 to 10 s when the view fits two 250 NM cells or fewer, merged by `icao24` keeping the newest fix.

The 24 to 36 cell tiling for wide views is removed. If OpenSky is unavailable or over quota, the last snapshot stays on the map labelled with its age, and wide views fall back to reduced local-cell coverage.

## Why
Only OpenSky returns the whole world in one request (measured: about 10,000 aircraft, 4 credits). adsb.lol and adsb.fi are capped at a 250 NM radius, so covering a wide view with them needs dozens of requests that exhaust shared-IP quotas and leave peripheral cells dropped. Per-cell tiling was the cause of partial coverage.

## Trade-offs
- The world refreshes about every 2 minutes (115 s), not every second; only close zoom approaches real time.
- The free-tier credit budget (4,000 per day on a standard account) sets the snapshot cadence. The default spends 3,000 (`SKYTRACE_OPENSKY_DAILY_BUDGET`, capped at 4,000), which leaves room for the other OpenSky calls; an anonymous fallback is limited to 400 a day.
- **The credit counter is per function instance, not a strict guarantee.** The spend is counted in the memory of the process that made the calls. Several warm Vercel instances, or a cold start that resets the count, can each spend up to the budget, so the account-wide total can exceed it. What holds is the cadence (each instance refuses to call more often than every 115 s, and the CDN absorbs most visitors) and OpenSky's own 429, which degrades the snapshot as a quota. A shared counter (Edge Config or a KV store) would make the budget strict; it was not built because one instance serves this traffic.
- **The "snapshot from N s ago" notice counts from the absolute snapshot time (`time`).** The global snapshot is cached `s-maxage=60` while the server refreshes every 115 s, so a relative `age_seconds` written into a cached body is stale when it arrives; it stays in the payload for logs only.
- The site must stay free, ad-free and non-resold, with source attribution: OpenSky requires a written licence for a live commercial product, adsb.fi forbids commercial use, adsb.lol asks to be contacted for production.
- Single point of dependency on OpenSky for wide views, mitigated by the degradation rule above.

## Consequences
Every aircraft keeps the source and fix age of its latest fix (see [0002](0002-estimates-are-never-observations.md)). Position projection is capped at 150 s ([0007](0007-projection-cap-150-seconds.md)) so aircraft do not freeze between snapshots.
