# 0005. Keep aircraft silhouettes stable across zoom

Status: accepted (2026-10-18). Supersedes the dense-dot consequence of ADR 0004. The canvas renderer described below was replaced by the MapLibre GL layer of [0009](0009-maplibre-gl-aircraft-layer.md) and [0010](0010-maplibre-gl-map.md); the shapes, sizes and outline states are unchanged.

## Context

The user wants the current aircraft shapes to remain stable at every zoom. Above
750 visible aircraft, the previous renderer switched to dots. Wider API responses
could also omit type metadata and replace a known model with a generic category
icon when zooming back in.

## Decision

- Keep the existing model/category geometry and dimensions in both rendering paths.
  Dense traffic still uses canvas, not hundreds of additional DOM marker trees.
- Rasterize the embedded local SVG geometry once per shape, colour and outline
  state. Inline the sprite's paths into each cached image; never fetch models or
  images on zoom. Leaflet retains projection, camera transforms and pointer hit
  testing. Its circle paint hook draws the cached silhouette instead of a circle.
- Keep labels sparse and preserve the selected aircraft's full DOM label at every
  zoom. Do not add all airline labels to a dense map.
- Within the existing five-minute aircraft cache, retain missing airframe type,
  category, description and registration for the same ICAO24. Explicit new values
  win. Never borrow callsign, airline, position, altitude, speed or timestamps from
  an older flight observation.

## Consequences

The canvas paint hook depends on Leaflet 1.9's renderer internals, isolated in
`src/aircraftCanvas.ts`. Browser regressions cover actual painted pixels, the
1000-aircraft transition, sparse selection and the return to the same model after
a less detailed feed. No dependency or runtime model download is added.
