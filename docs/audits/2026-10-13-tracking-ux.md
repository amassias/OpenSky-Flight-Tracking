# SkyTrace reliability and usability audit — 13 October 2026

Inspected the published site, current source, desktop and 390 px mobile views in both themes. The agreed direction preserves SkyTrace's map-first identity and English interface.

| Priority | Observed issue | Delivered response |
| --- | --- | --- |
| P1 | Worldwide feed intermittently fails during refresh; upstream causes were hidden | Bounded retry, failure classification in server logs, per-instance request sharing, rate-limit cooldown and explicit aged fallback |
| P1 | Old emergency observations can look current | Timestamp and age, delayed state, no live selection of stale rows, five-minute expiration and no CDN caching of degraded responses |
| P1 | Opening a previously visited airport after an off-map aircraft can leave the camera elsewhere | Explicit airport-focus request separate from the airport identity; clear hover preview and retain deep-link aircraft priority |
| P1 | Unnamed interactive map markers; tabs lack standard keyboard navigation | Named aircraft markers, roving tab focus, arrow/Home/End controls and focus restoration after closing details |
| P2 | Flight information is below a large photograph and expanded registry history | Route, measurements and operations precede photos; aircraft reference and ownership history are collapsible |
| P1 | A usual callsign route can generate a misleading distance/arrival estimate | Label the route provenance and omit geometric distance and arrival estimates for callsign-only routes |
| P2 | Small secondary typography and repeated aircraft type | Rem-based panel text, larger metadata, wrapped airport names and a simpler flight-list identity |
| P2 | Mobile details cover another active sheet with no explicit return | One visible sheet, preserved underlying list, labelled return and larger touch controls |
| P2 | Airport times mix schedule, estimates and actual values without concise explanations | Local-time/UTC-offset notice, visible time-kind labels and original-schedule explanation |
| P2 | Search help overwhelms the result menu | Short summary with expandable explanation |
| P2 | CSS globally disables all reduced-motion feedback; decorative loops continue | Targeted spatial-motion alternatives, stationary loading states, reduced tab travel and animation pause in hidden pages |

## Evidence and limits

The intermittent failure was reproduced on production before implementation, between successful snapshots. Available retained logs did not identify the precise upstream failure. New logging distinguishes timeout, connection, HTTP status, invalid payload and stale timestamp without exposing credentials. Retries and caches improve resilience; they cannot guarantee receiver-network availability or emergency coverage.

No new paid provider or persistent incident database is introduced. Last-known snapshots live in server-instance/browser caches; cold server instances may have no previous result. Absence of a signal does not establish absence of an incident, and transponder codes do not establish its cause.

## Validation

Backend tests cover retry/recovery, 429 cooldown, stale expiration, invalid timestamps, empty snapshots, concurrent requests and cache headers. Frontend tests cover fresh/delayed/expired observations, empty old observations and retry recovery. Browser checks cover keyboard/mobile return, airport camera, enlarged text, reduced motion, both themes, accessibility and dense 900-aircraft rendering. See the repository's test commands in README for reproduction.

Release validation: `npm run check` passed (140 unit tests, lint and production build); Python suite passed (118 tests); full Chromium/Firefox/mobile WebKit suite passed (149 tests, 13 platform-specific skips). The dense-map clock check recorded zero aircraft DOM mutations during its measurement. No blocking deterministic design-detector findings remained.
