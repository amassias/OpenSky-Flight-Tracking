# Benchmark, 2026-10-14

Method: `vite build`, `vite preview` on :4173, Lighthouse (mobile emulation, headless Chrome) against the production build with no backend, so API calls fail by design. Compare runs, not absolute numbers; variance between runs is about ±0.03 on performance.

| Metric | Before | After |
| --- | --- | --- |
| Lighthouse performance | 0.73 | 0.75 |
| Accessibility | 0.98 | 1.00 |
| Best practices | 0.92 | 0.92 |
| SEO | 0.92 | 1.00 |
| Entry JS (gzip) | 77.9 kB | 77.9 kB |
| Vendor JS (gzip) | 157.8 kB | 157.8 kB |
| CSS (gzip) | 15.6 + 6.5 kB | unchanged |
| FCP / LCP | 2.7 s / 6.5 s | 2.5 s / 5.7 s (noisy) |
| Unit tests | 185 / 186 (1 flaky) | 186 / 186 |
| pytest | 132 pass | 132 pass |

Vendor weight by source size: react-dom 545 kB, leaflet 450 kB, motion 480 kB (motion-dom + framer-motion), TanStack Query 87 kB.

Remaining Lighthouse failures: LCP (map tiles from tile.openstreetmap.org, 256 px tiles served at device size), console 500s (no backend in this run), unused JS 123 KiB.

## After B64 (lazy panels)

Entry JS 77.9 → 55.1 kB gzip. Vendor 157.8 kB unchanged (single chunk, ADR 0001). Budget enforced by `npm run check:size`.
