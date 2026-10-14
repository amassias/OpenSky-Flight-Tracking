# 0002. Estimates are never presented as observations

Status: accepted (2026-10-14, from the Reddit feedback audit)

## Decision
Every position carries its fix age. Projected markers are outlined, projection is capped at 90 s, unknown-age fixes are never projected, and a trace is never substituted from another flight.

## Consequences
New data sources must expose a timestamp and a source label before they reach the map or board.
