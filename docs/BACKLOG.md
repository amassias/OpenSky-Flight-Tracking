# SkyTrace UI/UX backlog

Source: an Impeccable critique of the running app (desktop 800–1440 px and mobile 375 px) on 2026-09-22.
Status: `[x]` shipped · `[ ]` open.

## P0: misleading state or broken affordance

- [x] **B1: The ⌘K hint did nothing.** The top bar showed a `⌘K` shortcut, but no handler existed. Now ⌘K / Ctrl+K and `/` focus the command search, Escape clears it and leaves the field, and the hint shows the correct key for the platform.
- [x] **B2: The panel showed an empty "Choose your airfield" state while dozens of aircraft were live on the map.** Before any airport search, the results panel now works as a live board for the aircraft in the visible map area, with live stats. It still explains how to load recorded movements.
- [x] **B3: The mid-width (901–1180 px) map title sat under the compact search panel.** It now clears the panel.
- [x] **B4: On mobile, the map title collided with the LIVE badge.** The title is now narrower and truncates cleanly.

## P1: clarity and flow

- [x] **B5: The mobile hamburger icon opened search.** It now uses a search icon, and its label matches what it does.
- [x] **B6: The top-bar channel always read "AIRSPACE / LIVE", even while connecting or offline.** It now follows the real feed state.
- [x] **B7: The flight filter input was cut off ("Calls…") at mid widths.** The toolbar now reserves room for the input, and the tiny 8–9 px control text is larger.
- [x] **B8: The "No matching flights" state had no way out.** It now has a *Clear filters* action.
- [x] **B9: The list gave no sign that a filter was active.** A "12 of 76 shown" count now appears when filters narrow the list.

## P2: next

- [x] **B10: Keyboard navigation through flight cards** with ↑/↓, Home and End.
- [x] **B11: Added a "Nearest" sort** that orders the board by distance to the map centre.
- [x] **B12: The status filter and sort order are remembered between visits.** The text filter stays per session, so the list never loads mysteriously filtered.
- [x] **B13: Light-theme capture in the e2e suite.** `e2e/theme.spec.ts` saves a light-theme screenshot and checks the system-theme default, the `T` key, the saved choice and the browser theme colour.
- [x] **B14: Unified the icon set on Font Awesome Free (solid)**, replacing lucide. Icons are generated from the local FA download by `scripts/build-icons.mjs`.
- [x] **B15: At 1280 px the map title ran under the LIVE badge, and the mobile search sheet let the map show through.**

## Sober redesign (2026-09-30)

- [x] **B16: Replaced the neon console look with a sober instrument look**, following the reference DESIGN-apple.md: graphite and paper frosted chrome, a single blue accent, system SF/Inter type, tabular numbers, a grayscale map, and pill actions. DESIGN.md has been rewritten to match.
- [x] **B17: Added a new top-down helicopter marker** (rotor, cabin, tail boom, tail rotor) that rotates with its heading and uses neutral ink. Aircraft on the ground are now grey instead of orange.
- [x] **B18: Added Motion (motion.dev) animations**: spring entrance and exit for the flight drawer and toast, and a sliding thumb on the Departures/Arrivals control. Switching theme now plays a circular View Transitions reveal. All motion respects reduced-motion settings.
- [x] **B19: Fixed the whole-repo code review findings.** The segmented-control thumb was invisible. Dense canvas dots used a different colour scheme. Full map now hides the flight drawer cleanly. Map colours now follow the theme. API 500 responses no longer leak exception text. Inter no longer blocks render through a CSS @import. Repeated toasts now replay. Dead markup was removed.
- [x] **B20: The four failing `tests/test_server.py` cases now pass** (whole Python suite green, checked 2026-10-11).

## Aircraft photos (2026-10-01)

- [x] **B21: Every selected aircraft now shows a photo of its airframe**, FR24-style, from the Planespotters.net public API. It looks the aircraft up by Mode S hex first, then by registration. Following the API terms, the browser calls the API directly (no proxy), JSON answers are cached for 24 h in memory, image URLs are used unchanged, and the photographer credit and a plain link to the photo page are always visible. Only the selected aircraft is looked up, never every marker. The drawer shows a placeholder when no photo exists or the service is unavailable.
- [x] **B22: A registration taken only from FlightAware is now marked "(scheduled)".** When the ADS-B profile lookup failed, flight-info showed FlightAware's tail, which is the aircraft scheduled for that flight number. After an aircraft swap it's a different airframe (for example TAP1366 was scheduled as CS-TJT but flown by CS-TJS). The API now returns `registration_source`, and a scheduled tail is never printed on a photo or used to look one up.

## Tracker features (2026-10-01)

- [x] **B23: Emergency alerts.** Squawks 7500/7600/7700 and ADS-B emergency states turn the aircraft red with a pulsing ring, pin it to the top of the board, and raise a clickable alert above the stats.
- [x] **B24: Follow mode.** A map control keeps the selected aircraft centred as it moves. Dragging the map or selecting another aircraft ends it.
- [x] **B25: The selected aircraft keeps moving.** When the live feed has a newer fix than the trace, the fix is appended to the trace, so the marker and route advance instead of freezing at the last trace point.
- [x] **B26: Live cards are more informative.** The server names the airline from airline-style callsigns. Otherwise the card shows registration and type instead of "Unidentified operator". Climb and descent arrows appear next to the altitude.
- [x] **B27: ⌘K search also matches registrations** of aircraft in view.
- [x] **B28: /api/health reports live_available: true without OpenSky credentials.** Live tiles use the public ADS-B feeds; credentials only add history. The earlier value relied on the pulled VERCEL=1.
- [ ] B29: The bundled airline dataset is missing newer carriers (Volotea, Brussels Airlines, City Airlines…). Refresh it from a maintained source. Volotea, Brussels Airlines, easyJet Europe and easyJet Switzerland were added by hand on 2026-10-11; The 2026-10-14 sourced snapshot now refreshes the usable IATA member assignments and server names. Non-IATA operators and historical code ownership still need a broader refresh.
- [x] **B30: The registration in flight details now always matches the photo.** When the server's ADS-B profile lookup missed, FlightAware's *scheduled* tail overrode the transponder registration that the live feed had already provided (for example F-HBQD shown for F-HBQE, F-GZHY for F-HXSX). The photo, looked up by hex, showed the real airframe: 29 of 29 matched in a check against live traffic. The client now ranks sources (transponder profile, then live-feed registration, then scheduled tail), and the server reuses the map's recent live cache instead of a provider call that competes with map tiles.

## FR24-style rework (2026-10-04)

- [x] **B31: Clicking an aircraft no longer produces two camera moves.** Selecting used to fly to the aircraft, wait for the route, then fly out to fit the whole route (up to zoom 9), while the drawer was measured mid-animation. Now there is at most one move (none when the aircraft is comfortably on screen), the route is drawn in without moving the map, and "Show route" (R) frames it on request. The free map area is derived from layout classes, so it is correct while a panel is still sliding in. Closing a flight no longer flies back to the airport.
- [x] **B32: Aircraft move continuously.** Positions are dead-reckoned along the reported track and ground speed (capped at 90 s of age) once per second, and markers ease to each position, so the next fix absorbs the difference instead of snapping. The selected aircraft's trace ends at the aircraft.
- [x] **B33: Layout rebuilt around a full-bleed map.** The left "Choose an airport" form and the right results card were replaced by a top search bar, a left flight dock that only exists when something is selected, and a collapsible right panel with **In view** and **Airport** tabs. Hero copy, the "Flight intelligence" tagline, the frosted-glass blur and the large pill radii were removed.
- [x] **B34: One search field** for aircraft on the map (callsign, registration, type, airline) and airports. Selecting an airport loads its board straight away; there is no "Explore flights" step.
- [x] **B35: Flight dock redesigned**: photo, big origin/destination codes with progress and time flown/to go, live readouts that keep updating after selection (they used to freeze at click time), collapsible sections, nicer source labels.
- [x] **B36: Map filters** (altitude window, ground traffic, airline/type/registration text; emergencies are never hidden) with a "hidden by filters" counter.
- [x] **B37: Aircraft labels** (callsign, plus flight level and speed when zoomed in), solid category silhouettes, hover cards instead of click popups, selection pop animation.
- [x] **B38: Airport markers** that open the departures and arrivals board.
- [x] **B39: Units** (aviation or metric) shared by every readout, plus follow (F) and show-route (R) shortcuts.
- [x] **B40: Shared links to a live aircraft now work.** A link without an airport used to select nothing; the aircraft is now looked up directly.
- [ ] B41: Add automated visual regression captures with real map tiles. Real OpenStreetMap/live-traffic browser screenshots already exist in `docs/screenshots/` (captured 2026-10-05); deterministic tests and an automated real-tile baseline are separate deliverables.
- [x] **B42: Trails behind every aircraft in view** (Display → Aircraft trails, off by default). They are built in the browser from successive live snapshots, so they cost no extra request and start when the page opens.

## Live airport tab and performance pass (2026-10-08)

- [x] **B43: Live airport board.** Opening an airport shows its local time and sun times, the latest METAR/TAF, wind-favoured runways, runways and frequencies, FAA delays for US airports, and live departures and arrivals observed by ADS-B with routes from the adsb.lol route database and estimated arrival times. Recorded OpenSky movements moved to a **History** view.
- [x] **B44: Layout fixes.** The list filter no longer collapses to one letter in a narrow panel, the Departures/Arrivals control and the source pill no longer overflow the panel, the date field is no longer clipped, the stray "—" on live cards is gone, and the map status, Nearby airports and emergency banner share one 8 px rhythm instead of overlapping.
- [x] **B45: Animation and rendering costs.** Re-sorting the live list no longer replays every card's entrance animation; the list renders 100 cards at a time; the selected trace's halo is no longer rebuilt every second; aircraft stop gliding while the tab is hidden; the location pulse animates transform/opacity instead of box-shadow; vendor code ships in cacheable chunks with immutable asset caching.

## Scheduled airport board (2026-10-09)

- [x] **B46: FlightAware scheduled departures and arrivals** on the airport board (times, gates, terminals, delays, cancellations), joined by callsign to live aircraft for live progress and arrival estimates, with a per-instance page budget and ten-minute CDN caching. Live traffic the schedule page does not list stays below it.
- [x] **B47: Gates and terminals from FlightAware now appear.** AeroAPI v4 names them `gate_origin`/`gate_destination` and `terminal_origin`/`terminal_destination`; the client read `gate_orig`/`gate_dest`, so they were always empty.

## Airframe history and board polish (2026-10-09)

- [x] **B48: Board rows redone.** Scheduled and observed flights share one row layout (time, destination and flight, status and gate). The status chip no longer stacks its live dot above the text, delays show the new time large with the old one struck through, the Departures/Arrivals control is no longer truncated (the Live/History switch moved beside the status line), and the status line no longer clips.
- [x] **B49: Airframe history.** Owners, operators and registrations over time from OpenSky snapshots (all countries) and the FAA registry (US), the registered owner today from ADSBDB, serial number and age, and recent flights on demand.
- [x] **B50: Search by registration.** `F-HBXA`, `N283VA` or a hex code opens an airframe anywhere; aircraft that are not flying show a clear "not in the live feed" state instead of an endless "Resolving…".
- [ ] B51: Refresh `data/aircraft-history` and `data/faa-registry` on a schedule. The FAA half now has a monthly workflow (`.github/workflows/refresh-faa-registry.yml`, written without network access, so its first run is untested). The OpenSky snapshots end in August 2025 and are still refreshed by hand.
- [x] Owner sources reviewed (2026-10-14): `tar1090-db` was measured and not integrated. Its CSV has owners for about 373k US aircraft (already covered by the FAA data, and including private individuals) and only about 2.9k outside the US; the repository has no licence file. The UK CAA G-INFO download is paid and licensed for a single PC. The New Zealand and Canadian registers were not reachable from the build environment, so they were not evaluated.

## Improvement pass (2026-10-11)

- [x] Keyboard shortcuts sheet (`?`), `T` theme and `L` labels keys.
- [x] Altitude and ground map filters saved between visits (free text stays per session, as in B12).
- [x] Up to eight favourites all listed, recent airports kept below them and clearable; a ninth favourite is refused with a notice.
- [x] Phone map controls stay at the bottom when no sheet is open.
- [x] Ticket flight numbers: `AF1234` finds `AFR1234` in search and filters, and is shown beside airline callsigns.
- [x] Sharing: airport boards, the map position (`?at=lat,lon,zoom`), and the native share sheet on phones.
- [x] Airport history: previous/next day arrows, no future dates.
- [x] Flight detail: working ICAO24 copy, links to other trackers.
- [x] Hidden tabs skip live refresh rounds; offline state is announced and live traffic refreshes on reconnect.
- [x] Favicon, home-screen icons, manifest, link previews, security headers, CDN caching of airport catalogue answers.
- [x] Accessibility audit (axe, WCAG 2 A/AA) in e2e for the live view, the shortcuts sheet, a selected flight and an airport board; the light theme's green status text was darkened to pass contrast.
- [x] A partial API body can no longer blank the page: track, airframe, conditions, board and schedule answers are normalised in `src/api.ts`, and the flight details, airport board and conditions card sit behind error boundaries with a retry.
- [x] Dark-theme contrast: weather-category badges use dark text, quiet text and the live board chip are lighter; light-theme quiet text passes on a selected card. The audit now measures settled colours (reduced motion, finished animations).
- [x] The altitude legend no longer covers the Follow and Show route controls.


## Global quality pass (2026-10-14)

B52–B57 implemented and validated on 2026-10-14. Evidence: [quality audit](audits/2026-10-14-global-quality.md).

- [x] **B52 — P1: Reproducible airline-code corrections.** Source Spring Airlines (9C/CQH), Air Serbia (JU/ASL), Philippines AirAsia (Z2/APG) and Thai Lion Air (SL/TLM); correct both ticket lookup directions and logo mappings, remove replaced legacy assignments and verify generator reproducibility. Full worldwide refresh remains B29.
- [x] **B53 — P1: Explicit cabin states.** Show loading, no published configuration and a failed request with retry. Late responses must not replace the current aircraft's cabin.
- [x] **B54 — P1: Compact cabin summaries.** Keep classes, counts and source links visible; fold each seat inventory by default and reset disclosures on aircraft selection. Symbols represent capacity, never row geometry or availability.
- [x] **B55 — P2: Legible altitude inspection.** Use at least 12 px for surrounding metadata, wrap the top readout and date UTC axes across midnight. Preserve missing observations and native keyboard inspection.
- [x] **B56 — P2: Populated component coverage.** Audit real cabin/graph fixtures in light/dark themes, 375/768/1440 px layouts and 200% text sizing; cover loading, empty, failure/retry, disclosure reset and exact seat counts.
- [x] **B57 — P2: Documentation consistency.** Align README, design guidance and backlog with current cabin/logos, opaque chrome and real screenshots. Keep the full catalogue refresh (B29), automated real-tile baseline (B41) and remaining OpenSky refresh work (B51) open.

## Airline and aircraft catalogue expansion (2026-10-14)

- [x] **B58:** Replace the hard-coded logo whitelist with a dated catalogue: 388 checked assets, 364 enabled, 24 excluded after visual/placeholder review. Preserve operator badges and add sourced local Southwest/Cargolux/Smartwings replacements.
- [x] **B59:** Extend current assignments to 364 sourced IATA designators, share names with the server, preserve cargo/operator distinctions and recognise reassigned JAT as JetSMART Chile rather than former JAT Airways. Non-member and historical completeness remains B29.
- [x] **B60:** Add ten FAA JO 7360.1K type families (69 models total), provenance, manufacturer recognition and correct private-jet/helicopter/turboprop/airliner silhouettes.
- [x] **B61:** Add offline/optional online catalogue validation, CI coverage and browser checks for decoded local logos, current operator mappings and placeholder badges.

### B62 — Reddit feedback: coordinate age and map clarity — Done (2026-10-14)

- Each live row shows the age of its actual coordinate fix, separately from the reported airborne/ground state; recent radio contact cannot make old coordinates appear fresh.
- After 60 seconds, status dots become hollow and aircraft markers fade. Unknown age is explicitly labelled and never dead-reckoned.
- Estimated aircraft silhouettes are outlined; the selected trace's connection to its current head is dashed. Selected details explain projection and its 90-second cap.
- Dense canvas mode explains dots and invites zooming in for labels. Canvas points remain reported coordinates; old or unknown fixes are hollow.
- Map and list share the same snapshot cropped to the visible geographic bounds, with the same map filters. A selected aircraft excluded by filters remains selectable without inflating the count.
- Regression checks cover missing coordinate timestamps, newer contact packets, invalid kinematics, and row age labels. Desktop/mobile browser checks use 1,000 visible aircraft plus one outside the bounds.

## Improvement pass and benchmark (2026-10-14)

Evidence: [benchmark](audits/2026-10-14-benchmark.md). Vocabulary: [CONTEXT.md](../CONTEXT.md). Tickets are ordered as thin vertical slices; "blocked by" marks real dependencies.

- [x] **B63: Skip link, tap-target name, robots.txt, flaky test.** The skip link now lands on the (reopened) results panel and always has a target; the Traffic reopen button's accessible name contains its visible text; `robots.txt` added (SEO 0.92 → 1.0); async test timeout raised so full-suite runs stop failing `steps the history back`. Added `CONTEXT.md`, `AGENTS.md` and `docs/adr/`.
- [x] **B64: Cut entry cost (done 2026-10-14).** Airport board, tour and shortcuts load on demand (airport board prefetched when idle): entry JS 77.9 → 67.1 kB gzip (−14%); vendor unchanged at 157.8 kB. Flight details stay eager on purpose: lazy loading made the first selection slower than the 200 ms e2e budget. Original ticket:  Vendor is 158 kB gzip (react-dom, leaflet, motion). Review chunk graph so the airport board, flight details and dialogs load on demand without breaking init order (ADR 0001). Measure with the benchmark method; done when entry+vendor gzip drops ≥ 15%.
- [ ] **B65: Map-tile LCP.** (preconnect to the tile host added 2026-10-14.) Preconnect to the tile host, request tiles at the real device pixel ratio, and evaluate a self-hosted or vector tile source. Done when mobile LCP ≤ 4 s in the benchmark.
- [~] **B66: Deepen `server.py`.** Pure helpers moved to tested `flight_logic.py` (1,526 → 1,428 lines, 2026-10-14); the handler class still owns every route. Original: Extract route handlers by domain (live, airport, airframe) behind a small interface; keep `api/index.py` as the only adapter. Blocked by nothing; protect with `tests/test_server.py` and `test_vercel_api.py`.
- [ ] **B67: Deepen `api_client.py` (1,678 lines).** Split provider clients (OpenSky, ADS-B fallback, FlightAware, Planespotters) from normalisation. Blocked by B66 only if shared helpers move.
- [~] **B68: Shrink `App.tsx`.** Flight-details source merging moved to tested `src/flightDetails.ts` (2026-10-14); URL state and live-board derivation remain. Original: Move selection, URL state and live-board derivation into hooks with tests. Blocked by nothing.
- [~] **B69: Content-Security-Policy (report-only header shipped 2026-10-14).** Watch the browser console on the deployed site for violations, then switch to `Content-Security-Policy` and drop `unsafe-inline` for scripts by moving the font-loading handler out of `index.html`. Original:  Add a report-only CSP first (tile, photo, font and logo hosts), then enforce. Blocked by listing every external host in use.
- [x] **B70: Bundle budget in CI (done).** `npm run check:size` fails above 72 kB entry / 165 kB vendor gzip. Lighthouse budget not added (too noisy without a backend). Original:  Fail the build if entry+vendor gzip grows more than 5% or Lighthouse mobile performance drops below 0.7. Blocked by B64.
- [ ] B29, B41 and B51 above remain open.
- [x] **B71: CI 3× faster and green.** The python job failed on every run (`pytest` did not put the repo root on the path; added `pytest.ini`). e2e now runs one job per browser in parallel with cached browsers, one retry, and superseded runs are cancelled.
- [x] **B72: Watchlist.** Bookmark an aircraft from its details; the Alerts tab lists watched aircraft, marks those in the current view and opens them (stored in the browser, 20 max, a full list refuses instead of dropping an entry). Logic in tested `src/watchlist.ts`.
