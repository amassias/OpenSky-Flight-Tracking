# Working on SkyTrace

Read [CONTEXT.md](CONTEXT.md) for vocabulary, [PRODUCT.md](PRODUCT.md) and [DESIGN.md](DESIGN.md) for intent, [docs/BACKLOG.md](docs/BACKLOG.md) for open work and [docs/adr](docs/adr) for decisions already made.

## Feedback loop (run before every commit)

```bash
npm run check                 # eslint, vitest, tsc + vite build
python3 -m pytest -q          # server, catalogue and enrichment
npx playwright test --project=chromium   # when the UI changed
```

## Rules

- Write the failing test first for behaviour changes; fix flaky tests, never retry them away.
- Prefer deep modules: small interfaces, logic behind them. `src/App.tsx`, `server.py` and `api_client.py` are the known shallow, oversized files (see backlog B66–B68).
- Do not add a dependency without a measured reason in the commit message.
- Keep labels honest: source and age on every data point.
- Record a decision in `docs/adr/` when it is hard to reverse, surprising, or the result of a real trade-off.
