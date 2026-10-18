# Prototype: 10,000 animated aircraft on WebGL (issue #12, spec #11)

Branch: `prototype/webgl-10k-aircraft`. Code: `prototype/webgl-bench/` (throwaway, not wired into the app build).
Reproduce: `cd prototype/webgl-bench && npm install && npm run dev` then, in another shell, `node run-bench.mjs 10`. Pure fleet logic: `npm test`.

## What was built

A standalone page that draws 10,000 oriented aircraft (clustered over North America, Europe, East Asia), moves every aircraft by its heading and speed at 20 data updates per second, and pans and zooms the camera continuously for the whole run. Three renderers:

- `maplibre-setdata`: MapLibre GL 5.6 symbol layer, whole GeoJSON source replaced each update with `setData`.
- `maplibre-update`: same layer, incremental `source.updateData({update: [...]})` by feature id.
- `deck`: deck.gl 9.4 `IconLayer` (`MapboxOverlay`, separate canvas) on the same MapLibre map.

Icons are rotated per aircraft and coloured by altitude band, as in the spec. Selection, hover preview and follow mode were not prototyped (see "Not measured").

## Measurements

Machine: Apple M3, headless Chromium 1228 through ANGLE/Metal (real GPU, not software). 10 s per cell after a 2 s warm-up, 10,000 aircraft, 20 updates/s, continuous pan and zoom. "Phone" rows use a 390x844 viewport at device pixel ratio 3 and Chrome DevTools CPU throttling (4x and 6x). Frame time is the `requestAnimationFrame` interval; "update ms" is the main-thread cost of advancing the fleet and handing data to the renderer.

| Setting | Renderer | Avg fps | p95 frame ms | Worst frame ms | Update ms p50 / p95 |
|---|---|---|---|---|---|
| Desktop | MapLibre setData | 60.0 | 17.0 | 17.7 | 2.5 / 2.9 |
| Desktop | MapLibre updateData | 60.0 | 17.1 | 17.7 | 6.8 / 8.1 |
| Desktop | deck.gl IconLayer | 60.0 | 17.5 | 17.7 | 0.6 / 0.8 |
| Phone proxy, CPU 4x | MapLibre setData | 59.9 | 17.5 | 33.3 | 10.0 / 11.2 |
| Phone proxy, CPU 4x | MapLibre updateData | 53.1 | 33.3 | 66.6 | 27.7 / 32.2 |
| Phone proxy, CPU 4x | deck.gl IconLayer | 60.0 | 17.6 | 17.7 | 1.1 / 1.6 |
| Phone proxy, CPU 6x | MapLibre setData | 54.9 | 33.1 | 49.2 | 14.9 / 16.7 |
| Phone proxy, CPU 6x | MapLibre updateData | 31.8 | 67.5 | 84.3 | 41.7 / 48.4 |
| Phone proxy, CPU 6x | deck.gl IconLayer | 60.0 | 17.5 | 17.7 | 1.7 / 2.5 |

Findings:

- Both renderers hold 60 fps on desktop with 10,000 moving, rotating aircraft.
- In MapLibre, replacing the whole source with `setData` beat the incremental `updateData` at every setting (the feature-by-feature diff costs about 3x more main-thread time here). The ticket's expectation that incremental updates are cheaper did not hold for "every aircraft moves every update".
- MapLibre `setData` stays at or above 30 fps (avg 54.9, p95 frame 33 ms) under 6x CPU throttling. `updateData` falls to 31.8 fps average at 6x, which is the edge.
- deck.gl is the cheapest on the main thread (under 3 ms) because it uploads typed-array attributes.

## Not measured (be explicit)

- **No real phone.** CPU throttling slows JavaScript only. The M3 GPU, memory bandwidth and the Metal driver are far faster than a mid-range Android GPU, and mobile GPUs are exactly where fill rate and texture uploads bite. The 30 fps phone criterion of the ticket is therefore only supported by a proxy, not proven.
- **No basemap.** The page uses a plain background with no tiles, labels or Leaflet-style markers, so the real map will cost more than measured.
- **No power or thermal measurement**, no memory measurement, no long run beyond 10 s per cell.
- deck.gl "update ms" covers `setProps` only; attribute upload happens during the render and is included in frame time but not in that column.
- Selection, hover, follow mode, silhouette variety (ADR 0004/0005) and picking were not built.
- Single run per cell, no confidence intervals.

## Decision

**Use MapLibre GL (symbol layer, `setData` of the whole source on each update tick).** Rule from the ticket: MapLibre if it holds 30 fps or better on the phone, otherwise deck.gl. On the best available proxy (6x CPU throttle, phone viewport, DPR 3) MapLibre `setData` holds 54.9 fps with the 30 fps floor at the p95 frame, so the rule selects MapLibre.

Conditions attached to the decision:

1. Do not use `updateData` for the bulk per-tick movement; use `setData` (or update the source at 10 Hz instead of 20 Hz, which halves the cost).
2. The first renderer-migration ticket (#23) must re-measure on a real mid-range phone with the real basemap before the Leaflet removal merges. If it drops below 30 fps there, switch the aircraft layer to deck.gl `IconLayer` on the same MapLibre map (already proven here: `MapboxOverlay` works and keeps the basemap in MapLibre), which has about 5 to 10 times more main-thread headroom.
3. Keep the density sampling above about 3,000 aircraft on Leaflet until the migration lands, as the spec says.

## Links

Renderer migration tickets should link this document and the branch `prototype/webgl-10k-aircraft`. The issue comment is left for the caller (nothing was pushed).
