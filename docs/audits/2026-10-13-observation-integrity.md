# SkyTrace second audit — observation integrity and reading

The interface retains SkyTrace's map-first identity. The remaining product-specific weaknesses concern trust in flight information, continuity during network work, and dense trace inspection.

## Initial assessment

| Dimension | Score / 4 | Evidence |
| --- | --- | --- |
| Accessibility | 3 | Existing keyboard and Axe checks pass; altitude inspection relies on mouse hover and repeatedly announces pointer changes |
| Performance | 3 | Dense traffic remains efficient; a 10,000-point altitude plot creates 9,999 separate line elements |
| Responsive design | 3 | Phone sheets work but their fixed half-screen height requires extensive scrolling |
| Theming | 3 | Established tokens are coherent; the chart fill uses a hard-coded colour outside the palette |
| Implementation integrity | 2 | A usual callsign route outranks the matching operational route; aged telemetry and asynchronous restoration can blur flight identity |
| Total | 14 / 20 | Good foundation, with material data-interpretation issues |

Scores are a heuristic audit assessment, not a WCAG certification. Existing aircraft selection, canvas traffic rendering, timestamped global alert states and theme controls are retained.

## Findings and implementation

| Priority | Location and impact | Resolution |
| --- | --- | --- |
| P1 | `server.py`: AFR531 live endpoint showed DIAP–DNMM while the matching operational episode reported SCEL–LFPG; the usual route misidentified the current journey | Match callsign, transponder registration, episode time and arrival state before preferring the operational endpoints. Reject old or conflicting episodes; endpoint names cannot come from a conflicting usual route |
| P1 | `App.tsx`: delayed enrichment can overwrite newer emergency/navigation signals; a recorded flight can borrow today's route | Preserve the latest transponder packet and the original recorded endpoints/times. A changed callsign is not silently merged into the same selected flight; the map also separates recorded and current flight instances |
| P1 | `AltitudeChart.tsx`: irregular observation times are evenly spaced by index, unknown altitude can be drawn as a fabricated low point | Scale by actual UTC time, break drawing across missing altitude, preserve extrema in a bounded visual sample |
| P1 | Shared aircraft URL is rewritten before asynchronous lookup completes | Preserve the pending aircraft identity; show retryable lookup state and let later explicit user selection take priority |
| P2 | Selected values appear current without their observation age | Show last position time and age, mark delayed/unknown observations, avoid claiming that missing coverage proves an aircraft is not flying |
| P2 | Live altitude trace is fetched once; refresh can remove the point inspector and its focus | Refresh only the selected live trace every 90 seconds; retain the previous graph and show a delayed update notice on failure |
| P2 | Hover-only chart inspection is inaccessible to keyboard and awkward on touch (WCAG keyboard operability) | Add native point slider, time/altitude readout, date-aware UTC axes, touch inspection and restrained announcements |
| P2 | Long details are constrained to a half-height phone sheet | Add expandable reading mode, persistent return/map controls, preserve selection and scroll context, and make the covered map inert |

## Measurement and verification

Rendering the same 10,000-point trace with the previous and revised components produced **9,999 drawing elements before, 5 after**. The revised graph retains every original observation for inspection; unit tests verify peak preservation, missing-data gaps, time spacing and a bounded visual sample. This is a DOM-complexity measurement, not a claimed frame-rate multiplier.

Backend tests exercise operational route preference and rejection of stale/different episodes. Frontend/browser tests cover historical-route isolation, dated stale positions, 10,000-point keyboard inspection, accessibility, mobile expansion/focus, slow shared links/retry and trace refresh without losing observations or focus. The existing dense-map and theme suites remain release checks.

The deterministic design scan has no blocking findings. Remaining advisories concern existing colour/radius/type entries; they do not justify replacing the established visual identity.

## Limits

Operational data remains optional and subject to the existing provider budget. No additional lookup is performed per map marker. Matching an operational episode establishes correspondence with the provider record; it does not establish an incident's cause. Public receiver coverage can still omit positions or traces, so missing data stays explicitly unknown.

Release checks passed: lint/build, 151 frontend unit tests, 124 Python tests and 165 Chromium/Firefox/mobile WebKit tests (15 platform-specific skips). Total: 440 passing release tests. The separate before/after render measurement is recorded above and is not included in that total.
