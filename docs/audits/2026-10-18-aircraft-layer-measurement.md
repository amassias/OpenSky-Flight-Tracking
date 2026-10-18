# Aircraft layer measurement (issue #23)

Reproduce: `npm run dev -- --host 127.0.0.1 --port 4400`, then `node scripts/bench-aircraft-layer.mjs http://127.0.0.1:4400 <cpuThrottle> <seconds>`. It loads the real app with a mocked 10,000-aircraft Global snapshot, drags the map continuously and records `requestAnimationFrame` intervals. A throttle above 1 uses a 390x844 viewport at device pixel ratio 3 and Chrome CPU throttling, as in the prototype. Decision and fallback condition: [ADR 0009](../adr/0009-maplibre-gl-aircraft-layer.md).

## What was measured

Apple M3, Chromium through ANGLE/Metal (hardware GL), the real app (Leaflet, React, no tile network), 10,000 aircraft drawn, 8 s per cell, single run per cell.

| Setting | Avg fps | p95 frame ms | Worst frame ms |
|---|---|---|---|
| Desktop 1280x800, world view (zoom 5) | 59 to 60 | 16.8 | 17.6 to 33 |
| Phone proxy, CPU 4x | 56 to 57 | 17.6 | 67 to 149 |
| Phone proxy, CPU 6x | 41.7 | 34.2 | 116 |

The software renderer that Playwright uses by default (SwiftShader) gave 1.9 fps for the same page (measured before the update-rate change below), which is why `e2e` tests assert drawn counts and painted pixels, never frame rates.

## What the first integration taught

The first version updated the source at a fixed 10 Hz. In the real app that gave 53 to 55 fps on desktop (p95 frame 33 ms) and 6 to 12 fps at a 4x throttle, against 60 fps in both cells of the prototype. The profile was dominated by MapLibre's cross-tile symbol matching (`findMatches`, `range`), which runs for every `setData`. At a world view an aircraft moves well under a pixel per second, so the update rate now adapts to the view (`updateIntervalMs`: 100 ms when zoomed in, up to 2 s on a world view). The table above is after that change and includes continuous panning.

## Not measured (be explicit)

- **No real phone.** CPU throttling slows JavaScript only; the M3 GPU and memory bandwidth are far faster than a mid-range Android GPU. The 30 fps phone criterion is supported by a proxy, not proven. ADR 0009 states the condition under which the layer moves to deck.gl.
- **Noisy host.** Other builds and test runs shared this machine; the same configuration varied by a factor of two between runs before the update-rate change. Single runs, no confidence intervals. Treat the numbers as order of magnitude.
- **No basemap tiles** (the run does not wait for or measure tile loading), so tile decoding and compositing are not in the figures.
- **Close zoom** (update interval 100 ms to 400 ms) was not benchmarked with 10,000 aircraft, since a close view holds far fewer; the 100 ms interval is the prototype's measured 10 Hz case.
- No power, thermal or memory measurement; no run longer than 10 s.

## Not verified, needs a real phone

Spec #11, ticket #23 asked for 30 fps on a phone. This was not measured on a phone, so the criterion is open, not met.

- **Real mid-range phone.** Run `scripts/bench-aircraft-layer.mjs` against a mid-range Android phone (Chrome remote debugging) with the real basemap and 10,000 aircraft. The pass line is the one in ADR 0009: average at least 30 fps and p95 frame at most 50 ms over 10 s of pan and zoom, and no main-thread task over 50 ms each second while idle. Below that, switch to deck.gl as ADR 0009 describes.
- **Real basemap tiles on a phone**, including their decoding and compositing next to the layer.
- **A run longer than 10 s**, with power, thermal and memory readings.
