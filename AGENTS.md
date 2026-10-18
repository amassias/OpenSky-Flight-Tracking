# Working on SkyTrace

Read [CONTEXT.md](CONTEXT.md) for vocabulary, [PRODUCT.md](PRODUCT.md) and [DESIGN.md](DESIGN.md) for intent, [GitHub Issues](https://github.com/amassias/OpenSky-Flight-Tracking/issues) for open work and [docs/adr](docs/adr) for decisions already made.

Read [docs/REPOSITORY.md](docs/REPOSITORY.md) before moving files or changing entry points, imports, asset paths or catalogue generators.

## Feedback loop (run before every commit)

```bash
npm run check                 # eslint, vitest, tsc + vite build
python3 -m pytest -q          # server, catalogue and enrichment
npx playwright test --project=chromium   # when the UI changed
```

## Rules

- Write the failing test first for behaviour changes; fix flaky tests, never retry them away.
- Prefer deep modules: small interfaces, logic behind them. `src/app/App.tsx`, `backend/server.py` and `backend/api_client.py` are the known shallow, oversized files (see migrated tasks B66–B68 in GitHub Issues).
- Do not add a dependency without a measured reason in the commit message.
- Keep labels honest: source and age on every data point.
- Record a decision in `docs/adr/` when it is hard to reverse, surprising, or the result of a real trade-off.

## Agent skills

### Issue tracker

Issues and specs live in GitHub Issues for `amassias/OpenSky-Flight-Tracking`.
See `docs/agents/issue-tracker.md`.

### Triage labels

Use the five default triage labels.
See `docs/agents/triage-labels.md`.

### Domain docs

Single-context layout: root glossary and `docs/adr/`.
See `docs/agents/domain.md`.
