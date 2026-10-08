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
- [ ] B13: Add a light-theme visual regression capture to the e2e suite.
- [x] **B14: Unified the icon set on Font Awesome Free (solid)**, replacing lucide. Icons are generated from the local FA download by `scripts/build-icons.mjs`.
- [x] **B15: At 1280 px the map title ran under the LIVE badge, and the mobile search sheet let the map show through.**

## Sober redesign (2026-09-30)

- [x] **B16: Replaced the neon console look with a sober instrument look**, following the reference DESIGN-apple.md: graphite and paper frosted chrome, a single blue accent, system SF/Inter type, tabular numbers, a grayscale map, and pill actions. DESIGN.md has been rewritten to match.
- [x] **B17: Added a new top-down helicopter marker** (rotor, cabin, tail boom, tail rotor) that rotates with its heading and uses neutral ink. Aircraft on the ground are now grey instead of orange.
- [x] **B18: Added Motion (motion.dev) animations**: spring entrance and exit for the flight drawer and toast, and a sliding thumb on the Departures/Arrivals control. Switching theme now plays a circular View Transitions reveal. All motion respects reduced-motion settings.
- [x] **B19: Fixed the whole-repo code review findings.** The segmented-control thumb was invisible. Dense canvas dots used a different colour scheme. Full map now hides the flight drawer cleanly. Map colours now follow the theme. API 500 responses no longer leak exception text. Inter no longer blocks render through a CSS @import. Repeated toasts now replay. Dead markup was removed.
- [ ] B20: Four Python tests in `tests/test_server.py` were already failing before this work (live-fallback and 401 status handling). They need a separate fix.

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
- [ ] B29: The bundled airline dataset is missing newer carriers (Volotea, Brussels Airlines, City Airlines…). Refresh it from a maintained source.
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
- [ ] B41: Add a real-tile visual regression capture; the screenshots in this repo use a procedural base map because the capture environment had no internet access.
- [ ] B42: Show a short trail behind every aircraft in view (needs a cheap batched history source).

## Live airport tab and performance pass (2026-10-08)

- [x] **B43: Live airport board.** Opening an airport shows its local time and sun times, the latest METAR/TAF, wind-favoured runways, runways and frequencies, FAA delays for US airports, and live departures and arrivals observed by ADS-B with routes from the adsb.lol route database and estimated arrival times. Recorded OpenSky movements moved to a **History** view.
- [x] **B44: Layout fixes.** The list filter no longer collapses to one letter in a narrow panel, the Departures/Arrivals control and the source pill no longer overflow the panel, the date field is no longer clipped, the stray "—" on live cards is gone, and the map status, Nearby airports and emergency banner share one 8 px rhythm instead of overlapping.
- [x] **B45: Animation and rendering costs.** Re-sorting the live list no longer replays every card's entrance animation; the list renders 100 cards at a time; the selected trace's halo is no longer rebuilt every second; aircraft stop gliding while the tab is hidden; the location pulse animates transform/opacity instead of box-shadow; vendor code ships in cacheable chunks with immutable asset caching.

## Scheduled airport board (2026-10-09)

- [x] **B46: FlightAware scheduled departures and arrivals** on the airport board (times, gates, terminals, delays, cancellations), joined by callsign to live aircraft for live progress and arrival estimates, with a per-instance page budget and ten-minute CDN caching. Live traffic the schedule page does not list stays below it.
- [x] **B47: Gates and terminals from FlightAware now appear.** AeroAPI v4 names them `gate_origin`/`gate_destination` and `terminal_origin`/`terminal_destination`; the client read `gate_orig`/`gate_dest`, so they were always empty.
