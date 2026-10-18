# 0007. Projection is capped at 150 s

Status: accepted (2026-10-18, from the free ADS-B sources audit). Supersedes the 90 s cap in [0002](0002-estimates-are-never-observations.md); the rest of 0002 stands.

## Decision
Projection between fixes is capped at 150 s instead of 90 s. Projected markers stay outlined, unknown-age fixes are still never projected, and a projected position is still an estimate, never an observation.

## Why
The Global snapshot is refreshed about once a minute (OpenSky free-tier credit budget), so a 90 s cap would freeze aircraft before the next refresh whenever one refresh is late or skipped. 150 s covers one missed refresh.

## Trade-off
Dead-reckoning drifts as a fix ages (turns, climbs, descents). A longer cap shows a less accurate estimate for longer; the outline and the fix age stay visible so the estimate is never mistaken for a fix.
