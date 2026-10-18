# 0006: Import operator logos from pinned bulk catalogues

Status: accepted, 2026-10-18.

## Decision

Keep existing validated IATA logos and exclusions. Add local, directly ICAO-indexed marks through a repeatable development command, using immutable source archives and committed hashes. No runtime lookup, periodic job or manual per-airline search is required. Prefer the ICAO-named source; the secondary source requires an unambiguous assignment from SkyTrace's code table. Retain source documentation and trademark attribution.

## Consequences

Non-IATA operators can have a mark without inventing a ticket designator. Local assets remove the CDN dependency for newly covered operators. Pillow is a development dependency for actual PNG decoding, integrity/dimension checks and blank-image detection; SVGs use a restrictive static-vector validator. Provenance remains outside the compact runtime table. Preserve protected wrong-code/placeholder exclusions even if another source offers an image. Unavailable sources abort before changing generated outputs; individual bad images are reported and skipped. The source catalogues are snapshots with possible stale branding, not an authoritative live operator registry. Coverage is intentionally incomplete when identity is uncertain.
