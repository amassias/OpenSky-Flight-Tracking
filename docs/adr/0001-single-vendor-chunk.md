# 0001. Ship libraries in one vendor chunk

Status: accepted (2026-10-08, restated 2026-10-14)

## Context
Splitting React from its consumers into several manual chunks broke module initialisation order (import cycle between library chunks). We also tried `LazyMotion` with an async feature bundle on 2026-10-14 to cut the entry cost of `motion`.

## Decision
`vite.config.ts` puts every `node_modules` import in one `vendor` chunk, cached immutably across deploys.

## Consequences
- Dynamic imports of libraries do not create separate chunks: the `LazyMotion` experiment changed the bundle by under 1 kB and was reverted.
- Real savings need the chunk graph reviewed deliberately (see backlog B64), not piecemeal lazy imports.

## Update 2026-10-18
MapLibre GL is the one library outside the vendor chunk, loaded on demand for dense aircraft views; see [0009](0009-maplibre-gl-aircraft-layer.md).
