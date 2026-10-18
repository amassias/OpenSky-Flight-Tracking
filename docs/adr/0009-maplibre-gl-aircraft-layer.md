# 0009. Draw dense aircraft with MapLibre GL, loaded on demand

Status: Superseded in part by [ADR 0010](0010-maplibre-gl-map.md) (issue #24 moved the whole map to MapLibre GL). The decision to draw dense aircraft with one MapLibre symbol layer, the update rate, the bundle budget and the deck.gl condition still stand; the Leaflet statements below are struck through (accepted 2026-10-18, issue #23 of spec #11; prototype in `docs/audits/2026-10-18-webgl-renderer-prototype.md`, measurements in `docs/audits/2026-10-18-aircraft-layer-measurement.md`)

## Decision
Once a view holds more than 750 aircraft, they are drawn by **one MapLibre GL symbol layer**, not by DOM markers (~~on a transparent canvas, not by Leaflet markers~~). Below 750 the detailed markers (labels, focus, keyboard) are unchanged.

- ~~Leaflet stays the map: basemap, gestures, airports, tracks and the selected aircraft's detailed marker. The MapLibre canvas lives in a Leaflet pane, is pinned to the viewport, and copies the Leaflet camera on every move (MapLibre zoom = Leaflet zoom - 1; zoom animations are mirrored with `easeTo`).~~ Superseded by ADR 0010: MapLibre is the map, the layer belongs to it and there is no second camera to mirror.
- The whole GeoJSON source is replaced with `setData` on each update (the prototype measured it about 3x cheaper than `updateData` when every aircraft moves). Colours and outlines (estimated, old or unknown-age fixes) are baked into one image per silhouette, colour and fill, rasterised once from the same SVG as the DOM markers.
- The update rate adapts to the view: 10 Hz when zoomed in, down to one update every 2 s on a world view, where the fastest aircraft moves under 0.6 px between updates (`updateIntervalMs`). Pan and zoom never wait for an update.
- No density sampling: all 10,000 aircraft are drawn. Sampling at 3,000 remains only in the fallback below.
- MapLibre ships as its **own lazy chunk** (about 256 kB gzip), fetched only when a view first becomes dense. This is the one exception to [0001](0001-single-vendor-chunk.md): it imports nothing from the other libraries, so it cannot create the import cycle that rule guards against.
- The CSP report-only header gains `worker-src 'self' blob:` (MapLibre parses GeoJSON in a worker).
- ~~Without WebGL, or if MapLibre fails to start, the previous Leaflet canvas layer is used, with the 3,000-aircraft density sample.~~ Removed by ADR 0010: the Leaflet canvas renderer and the density sample are gone; without WebGL the map reports itself unavailable.

## Why
The (former) Leaflet canvas could not draw 10,000 moving aircraft (hence the 3,000 sample). The prototype showed MapLibre GL and deck.gl both hold 60 fps on desktop, and MapLibre `setData` stays above 30 fps under a 6x CPU throttle at a phone viewport. MapLibre was preferred because it keeps one WebGL context and a single mental model with the map.

## Bundle budget
`scripts/check-bundle-size.mjs` budgets: entry 81 kB (measured 73.8, +2.4 kB for the layer and shared glyph code), vendor unchanged at 175 kB (158.9), and a new `maplibre` budget of 282 kB (measured 256.2). A visitor who never sees more than 750 aircraft at once never downloads the chunk.

## deck.gl fallback condition
The decision rests on a CPU-throttled desktop proxy, not a real phone. **Switch the dense layer to a deck.gl `IconLayer` (`MapboxOverlay`-style, same canvas-in-a-pane approach, about 5 to 10 times more main-thread headroom in the prototype) if either holds when `scripts/bench-aircraft-layer.mjs` is run against a real mid-range phone (Chrome remote debugging) with the real basemap:**

1. average below 30 fps, or p95 frame above 50 ms, over 10 s of continuous pan and zoom with 10,000 aircraft in view; or
2. a main-thread task over 50 ms every second while the map is idle (the 2 s world-view update).

Then record the numbers in a new audit and supersede this ADR. Nothing in the app outside `AircraftGlLayer.tsx` knows which engine draws the layer.

## Consequences
- Selected, followed and previewed aircraft keep their detailed markers; the WebGL layer excludes the selected one.
- Hover and click are resolved from the drawn list (degree-box rejection, then pixel distance), so touch and mouse behave the same.
- Focus labels and keyboard access for dense views are separate tickets; this layer draws silhouettes only.
