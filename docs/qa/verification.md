# SkyTrace corrections — 8 September 2026

Base: `8c34d30`. Branch: `fix/map-fluidity`.

## Reproduced problems

- At rest, 300 aircraft caused 3,600 marker DOM mutations in 2.2 seconds in Chromium. The UTC clock updated the entire application every second; each marker received a newly constructed icon.
- The results panel intercepted clicks on desktop map controls.
- CARTO tiles displayed “API KEY REQUIRED” during visual verification.
- The public deployment's live-flight endpoint returned an upstream Airplanes.live HTTP 403. ADSB.lol returned live aircraft for the same area.
- Shared airport/flight initialization kept overriding later user interactions.

## Changes

- Isolate the UTC clock and memoize aircraft markers, positions, icons, and event handlers.
- Debounce viewport requests, cancel obsolete requests, preserve markers during loading, and limit unused viewport cache lifetime.
- Observe map size changes, respect reduced motion, and cap track auto-zoom.
- Keep map controls accessible; correct light-theme contrast and hidden-panel keyboard visibility.
- Initialize shared selections once and dismiss airport suggestions on outside click or focus exit.
- Surface track errors with a retry action.
- Use OpenStreetMap tiles with visible attribution and browser caching. Dark mode adjusts tile colors locally.
- Vercel live positions use ADSB.lol with Airplanes.live fallback and bounded request timeouts. Live capability is independent of historical OpenSky credentials.
- Update compatible transitive dependencies; npm audit reports zero vulnerabilities.

## Verification

- `npm run check`: lint, 3 frontend tests and production build pass.
- `python3 -m pytest -q`: 20 tests pass, including provider outage handling.
- Browser suite: Chromium, Firefox, WebKit with iPhone 13 viewport. 16 tests pass; 2 desktop runs of a mobile-only test are intentionally skipped.
- After correction: zero aircraft DOM mutations over 2.2 seconds in the same 300-aircraft test on all three engines. This measures idle DOM churn, not FPS or field Core Web Vitals.
- Live local smoke test using the Vercel provider route: 74 aircraft and 40 loaded map tiles; no browser page errors. Counts vary over time.
- Desktop dark/light and mobile screenshots inspected.

## Limits

Changes are local and have not been pushed or deployed. Provider reachability from a new Vercel deployment still needs verification there. Historical airport data depends on OpenSky access; local tests use deterministic fixtures. WebKit mobile is emulation, not a physical iPhone. Public map/data providers can still experience outages or quotas.
