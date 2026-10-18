# SkyTrace aircraft symbols

Known ICAO types now use the generated model silhouettes documented in
[`data/aircraft-silhouettes/README.md`](../../../data/aircraft-silhouettes/README.md).
Those SVG sprites are derived from GPLv2 model geometry; their licence and source
manifest are separate from the generic fallback assets described below. The
shared sprite is embedded once in the initial HTML, so all markers reference its
symbols without additional image or model downloads.

The airplane silhouette used by the live map is adapted from the Tabler
[`plane.svg`](https://github.com/tabler/tabler-icons/blob/main/icons/outline/plane.svg)
icon and is distributed under the [MIT license](https://github.com/tabler/tabler-icons/blob/main/LICENSE).

Helicopters use the generated model silhouettes and the drawn rotorcraft glyph in
`src/features/map/aircraftGlyph.ts`.

The SVG files are kept here as the source assets. The map inlines their path
geometry so map markers inherit the current theme and remain lightweight.
