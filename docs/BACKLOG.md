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

- [ ] B10: Keyboard navigation (↑/↓) through flight cards while focus is in the list.
- [ ] B11: Sort the live board by distance to the map centre.
- [ ] B12: Remember the last filter and sort in local preferences.
- [ ] B13: Add a light-theme visual regression capture to the e2e suite.
- [x] **B14: Unified the icon set on Font Awesome Free (solid)**, replacing lucide. Icons are generated from the local FA download by `scripts/build-icons.mjs`.
- [x] **B15: At 1280 px the map title ran under the LIVE badge, and the mobile search sheet let the map show through.**

## Sober redesign (2026-09-30)

- [x] **B16: Replaced the neon console look with a sober instrument look**, following the reference DESIGN-apple.md: graphite and paper frosted chrome, a single blue accent, system SF/Inter type, tabular numbers, a grayscale map, and pill actions. DESIGN.md has been rewritten to match.
- [x] **B17: Added a new top-down helicopter marker** (rotor, cabin, tail boom, tail rotor) that rotates with its heading and uses neutral ink. Aircraft on the ground are now grey instead of orange.
- [x] **B18: Added Motion (motion.dev) animations**: spring entrance and exit for the flight drawer and toast, and a sliding thumb on the Departures/Arrivals control. Switching theme now plays a circular View Transitions reveal. All motion respects reduced-motion settings.
- [x] **B19: Fixed the whole-repo code review findings.** The segmented-control thumb was invisible. Dense canvas dots used a different colour scheme. Full map now hides the flight drawer cleanly. Map colours now follow the theme. API 500 responses no longer leak exception text. Inter no longer blocks render through a CSS @import. Repeated toasts now replay. Dead markup was removed.
- [ ] B20: Four Python tests in `tests/test_server.py` were already failing before this work (live-fallback and 401 status handling). They need a separate fix.
