# 0010. MapLibre GL is the map; Leaflet is removed

Status: accepted (2026-10-18, issue #24 of spec #11). Supersedes the Leaflet parts of [0009](0009-maplibre-gl-aircraft-layer.md) and the canvas fallback of [0005](0005-stable-silhouettes-across-zoom.md).

## Decision
One MapLibre GL map draws the basemap, every layer and the detailed markers. `leaflet`, `react-leaflet` and `@types/leaflet` are removed from the dependencies, along with the Leaflet canvas renderer (`aircraftCanvas.ts`) and the density sampling above 3,000 aircraft that only it needed.

- **Basemap.** OpenStreetMap raster tiles, as before. MapLibre has no per-layer CSS filter, so the grey look comes from raster paint properties; the dark map inverts the brightness range (`basemap.ts`). The theme switch repaints in place; the map is no longer rebuilt.
- **Zoom scale.** Shared links, the `at` parameter, label thresholds and the airport clustering keep the 256 px scale of Leaflet. MapLibre's zoom is that minus one (`mapCamera.ts`); nothing outside the map component sees the difference. The wheel zooms continuously, so a link may carry two decimals.
- **Layers.** Anything made of lines or areas is a GeoJSON layer on the map: the altitude trace and its halo, the dashed stretch to the estimated position, the heading line and the destination guide, trails, the accuracy circle, and the aircraft symbols of ADR 0009 (now a layer of the same map, not a second canvas). `LAYER_ORDER` in `mapLayers.ts` fixes their stacking.
- **Markers.** Below 750 aircraft, and for the selected aircraft, airports, clusters, the trace start, the heading arrow and the visitor's position, markers stay DOM elements (`maplibregl.Marker` through `useDomMarker`), so labels, keyboard focus, the airline logos and the CSS-only states (estimated, delayed, selected) work as before.
- **Tooltips** are one small card owned by the map (`mapTooltip.ts`), shown on hover and on keyboard focus.
- **Camera.** `flyTo` and `easeTo` replace Leaflet's `flyTo`, `panTo` and `flyToBounds`. A target is placed in the area no docked panel covers by moving the centre (`placementCenter`), not by MapLibre padding, which would stay set. The follow camera tags its moves (`follow`) so it neither clears the hover preview nor reports the map as moving.
- **Geolocation** uses `navigator.geolocation` directly, with the same options and messages as Leaflet's `locate`.
- **Loading.** The map is its own chunk (about 256 kB gzip), requested by the map component right after the first paint, so it no longer waits for a dense view. The vendor chunk shrinks by about 45 kB gzip (Leaflet and react-leaflet), so the first load is about 40 kB gzip lighter than before the map moved. Budgets in `scripts/check-bundle-size.mjs` follow.
- **Content security.** MapLibre fetches tiles instead of using `<img>` elements, so the report-only policy gains `https://tile.openstreetmap.org` in `connect-src` (it stays in `img-src`).
- **Development hook.** In development builds only, the map is exposed as `window.__skytraceMap` so a browser test can switch a layer off to measure it or ask where the map puts a coordinate.

## Why
Two engines meant two cameras to keep in step (a MapLibre canvas mirrored the Leaflet camera on every frame and zoom animation), two hit-testing paths and a fallback renderer nobody could keep honest. One engine removes the sync code, lets the aircraft layer and the lines share a depth order, and keeps the 10,000-aircraft layer that #23 measured.

## Consequences
- **No WebGL, no map.** Leaflet worked without WebGL; MapLibre does not. The map area then says so (`map-unavailable`). The audit of free sources and the target audience (current browsers, phones) make this rare; the live feed, list, airport boards and flight details do not depend on the map being drawn, but the list follows the visible area, so it stays empty until a view exists.
- Wheel zoom is gentler than Leaflet's (one wheel notch is a fraction of a level, not several), and drag has inertia. Browser tests that used one large wheel movement to jump several levels now use the zoom buttons.
- Everything the axe audit saw only in the app chrome now includes the map: the markers carry a name, and MapLibre's own controls are limited to the attribution.
- A pixel-exact comparison with Leaflet was not made: label placement, trace widths and tile greys were compared by eye on screenshots in both themes.

## Date-line correction (2026-10-18)

Map camera bounds use a continuous longitude interval: west is canonical and
east may exceed 180 when the view crosses the date line. Membership wraps each
aircraft longitude into that interval; guard bands and quantisation preserve
it. Only provider requests split the interval into ordered boxes inside
[-180, 180]. This keeps both sides of the Pacific visible without sending an
invalid bounding box or substituting worldwide traffic for the visible view.
Shared links retain fractional zoom and accept the full declared 1–19 range;
MapLibre can further constrain the lowest zoom to the height of its viewport.
