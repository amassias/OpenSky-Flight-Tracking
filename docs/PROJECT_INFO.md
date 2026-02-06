# Flight Tracker & Departures Viewer - Project Info

## Overview

Flight Tracker & Departures Viewer is a Python + Vanilla JS web application that uses the OpenSky REST API to:
- search airports,
- fetch arrivals/departures,
- display live traffic in the current map viewport,
- and visualize selected flight tracks with altitude profiles.

Last updated: 2026-02-06

## Architecture

### Backend
- `server.py`
  - serves `index.html` and files under `static/`
  - exposes JSON API endpoints under `/api/*`
- `api_client.py`
  - OpenSky OAuth2 + REST requests
  - request normalization and error handling
- `data_loader.py`
  - loads airport and airline datasets from `data/`
  - cached lookup/search helpers

### Frontend
- `index.html`
  - app shell and UI sections (controls, flights panel, map)
- `static/js/app.js`
  - map lifecycle, live markers, flight selection, altitude chart rendering
- `static/css/style.css`
  - responsive layout and component styling

## Data

- `data/iata-icao.csv`: airport metadata and coordinates
- `data/Airlines data`: airline code-to-name mapping

## API Endpoints

- `GET /api/health`
- `GET /api/search-airports?q=...&limit=...`
- `GET /api/airports`
- `GET /api/flights?airport=ICAO&date=YYYY-MM-DD&mode=departure|arrival`
- `GET /api/fetch-flights?...` (backward-compatible alias)
- `GET /api/live-flights?lamin=...&lomin=...&lamax=...&lomax=...`
- `GET /api/flight-info?icao24=...`
- `GET /api/track?icao24=...&time=...`

## Local Development

Run:

```bash
python3 server.py
```

Open:

```text
http://localhost:8000
```

## Repository Hygiene

- Keep secrets only in `.env`.
- `.env` is ignored; `.env.example` is the committed template.
- Local/editor artifacts are ignored (`.venv/`, `.codex/`, `*.code-workspace`, caches).

## Notes

- The airport dataset provides point coordinates (lat/lon), not administrative polygons.
- Airport area highlighting in the map is therefore an estimated operational zone around airport coordinates.
