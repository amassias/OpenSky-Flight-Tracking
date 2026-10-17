# Aircraft silhouette implementation — 17 October 2026

- 39 real-aircraft binary glTF models, producing 60 explicitly mapped ICAO codes.
- Geometry from the pinned Flightradar24/FlightGear GPLv2 collection; all 60 code
  associations have pinned OpenAircraftType reference records (CC-BY-SA-3.0).
- 3D source checksums are verified offline, and `--check` reproduces the checked-in
  vector geometry, catalogue, rotor layer, type metadata and public source notices.
- The initial HTML contains one SVG sprite. There are no additional model/image
  requests and no geometry duplication per marker; no runtime dependency added.

## Validation

- `npm run check`: lint, 201 unit tests, TypeScript and production build pass.
- `npm run check:size`: entry 69.1 kB gzip / 72 kB budget; vendor 158.9 / 165 kB.
- Aircraft-detail + silhouette browser tests: 19 passed, 2 intentional mobile
  mouse-hover skips across Chromium, Firefox and mobile WebKit.
- Map-regression + silhouette browser tests: 24 passed, 3 intentional mobile
  wheel-input skips across the same browsers. Zero aircraft DOM mutations over
  2.2 seconds in the existing stationary-feed performance check.
- Browser checks cover actual rendered SVG use bounds, distinct model references,
  heading, fallback, emergency/ground/freshness styles, light/dark themes, reduced
  motion and animated EC135 rotor, selection, and 900 aircraft rendered on canvas
  with only the selected aircraft receiving a detailed marker.
- A live-feed local browser check around Paris displayed 64 aircraft, of which
  61 used model sprites (nine different source models). This is one dated snapshot,
  not a global coverage estimate. No browser JavaScript errors were reported.

[Source contact sheet](aircraft-silhouettes.png) ·
[Live desktop capture](aircraft-silhouettes-live-desktop.png)

Native theme transitions were allowed to finish before the final browser captures.
The model sources/licences and rebuild recipe are in
[`data/aircraft-silhouettes/README.md`](../../data/aircraft-silhouettes/README.md).
The implementation is local; no commit, push or deployment was requested.
