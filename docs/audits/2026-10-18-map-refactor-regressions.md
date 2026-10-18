# Map refactor regression audit — 2026-10-18

Scope: the current MapLibre map, shared camera links, local/global live-feed
handoff and provider tile fusion. OpenStreetMap supplies raster map tiles;
MapLibre is the renderer. This is a bounded audit, not a claim that every
possible defect has been eliminated.

## Reproduced and repaired

1. **Aircraft lost at the date line.** A Pacific view showing longitudes on
   either side of ±180 displayed only the eastern aircraft. Clipping camera
   bounds discarded the other half. Continuous wrapped intervals now drive
   visibility/cache membership and split into valid provider request boxes.
   Browser regression: `e2e/map-audit-regressions.spec.ts`.
2. **Degraded Local feed labelled Live.** A successful HTTP answer carrying
   `degraded: true` was treated as a healthy refresh, and completion cleared its
   degradation cause. Degraded sectors now preserve the cause until a healthy
   round, and old local snapshot timestamps are also recognised. The browser
   regression checks both Delayed and recovery to Live.
3. **Shared map links changed zoom.** Fractional zoom was rounded and legitimate
   low/high zoom values were rejected, even though the map writes them into
   links. Parsing preserves fractions and the map's declared range, rejects
   empty coordinate fields, and accepts Web Mercator's latitude limit.
   Unit and browser regressions exercise reopening the view.
4. **Provider tile fusion rejuvenated old fixes.** Relative `seen`/`seen_pos`
   values from differently timed responses were compared against one newest
   clock. An older observation could win and receive a newer timestamp.
   Ages are now aligned to the common response clock before comparison and
   conversion. The regression proves a five-second-old fix beats a sixty-second
   old one and an aircraft seen only in the old tile keeps its original time.
   Test: `test_viewport_merge_keeps_absolute_fix_times_across_differently_aged_provider_tiles`.

Each regression failed before its corresponding fix. Provider calls are mocked
at the external HTTP interface; production credentials are not required by the
regressions. The date-line fixture returns only aircraft inside each requested
provider box rather than returning both sides regardless of the request.

## Remaining limitations

The published worldwide snapshot still depends on upstream availability,
OpenSky quotas and GitHub Actions scheduling. A fresh Local feed is not proof
of current worldwide coverage. Existing degraded/reduced-coverage labels and
absolute position timestamps remain required. No paid provider or new
infrastructure has been introduced.

## Validation

- `npm run check`: lint, 269 frontend tests and production build passed.
- `python3 -m pytest -q`: 215 backend tests passed.
- Full Chromium suite: 112 passed, 5 device-specific skips.
- Full Firefox + mobile WebKit audit: 201 passed, 27 device-specific skips.
- All three new browser regressions passed on Chromium, Firefox and mobile
  WebKit (9 checks); no retries were used to turn failures into passes.
- Light/dark map screenshots inspected; deterministic UI detector reported
  no findings. Live production smoke verification follows the deployment.
