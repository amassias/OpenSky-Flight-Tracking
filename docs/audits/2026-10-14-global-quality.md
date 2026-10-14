# SkyTrace global quality audit — 14 October 2026

## Delivered

Backlog B52–B57 is implemented. Airline corrections have source URLs and check dates in `data/airline-code-corrections.json`. The generator applies them to the same table used by ticket searches, ticket-number labels and operator logos. Legacy CQH/9S and JU/JAT assignments no longer survive regeneration. The CI checks that the committed generated table matches its inputs.

Cabin information has explicit loading, empty and error states, with a retry after an error. Classes and exact published counts remain visible while the per-variant seat inventory is folded. Native disclosures work by keyboard and reset on a different aircraft/configuration; unrelated source metadata does not reset them. Query identity and cancellation prevent a previous aircraft's response appearing for the new selection. Tests cover both multiple real catalogue variants and delayed responses.

The altitude profile wraps its top readout, uses 12 px surrounding metadata and dates its axes when crossing midnight UTC. Missing altitude stays missing and is announced in the native inspector's accessible value. Aviation/metric readouts are unit-tested.

README, DESIGN and backlog now distinguish the existing real-map screenshots from an automated visual regression baseline. Opaque chrome and 6/8/10 px radius tokens are documented consistently. Logo failures retain Claude's operator badges.

## Validation

- `npm run check`: lint clean, 179 unit tests passing, TypeScript and production build successful.
- `python3 scripts/build_airline_codes.py --check`: generated output matches its sources; also added to CI.
- `npx playwright test e2e/cabin-quality.spec.ts e2e/aircraft-detail.spec.ts e2e/accessibility.spec.ts e2e/mobile-layout.spec.ts e2e/ux-quality.spec.ts --workers=2`: 57 passed, 9 explicitly skipped (device-inapplicable shortcuts/hover and redundant tablet/wide mobile-device cases).
- After normalising the cabin identity to avoid resetting on unrelated metadata: the cabin/detail subset was rerun on Chromium and mobile WebKit (18 passed, 6 device-inapplicable cases skipped), and all 179 unit tests, lint and build passed again.
- Populated cabin/graph fixtures: light/dark, 375/768/1440 px, 200% text, native disclosure activation, exact 292-seat inventory, midnight labels, missing-observation keyboard inspection, empty state and failed request/retry.
- WCAG A/AA axe checks pass on the populated fixtures and the existing map, airport and selected-flight flows in Chromium, Firefox and mobile WebKit.
- Browser screenshots visually inspected together: compact light desktop, compact dark phone and 200% phone chart. Automated assertions check drawer overflow.
- Impeccable component detector: no findings. React review: unconditional hooks, query identities/cancellation, stable native disclosure keys, no new dependencies or effects.

## Limits and remaining backlog

Browser API fixtures are deterministic test data, not live traffic observations. Map tiles in the local captures came from OpenStreetMap; network availability is not a visual baseline guarantee. Source publication counts do not establish the exact aircraft layout or current seat availability.

B29 (full global airline catalogue refresh), B41 (automated real-tile visual baseline), and B51's remaining OpenSky snapshot refresh stay open. This pass adds no new provider or paid service, changes no public API response schema, and does not itself confirm production deployment.
