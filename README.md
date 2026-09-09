# SkyTrace — OpenSky Flight Tracking

SkyTrace is a map-first flight intelligence interface powered by the OpenSky Network API. It combines live viewport traffic, airport arrival and departure history, aircraft tracks, and altitude profiles in a responsive React application.

## Features

- Live aircraft polling in the visible map area
- Airport search by city, name, IATA, ICAO, region, or country
- UTC arrival and departure queries
- Flight filtering, sorting, status summaries, and detailed tracks
- Dark and light OpenStreetMap map themes
- Shareable flight URLs
- Recent and favorite airports stored locally in the browser
- Altitude-colored tracks with a hover readout for each profile point
- Optional browser geolocation marker with an accuracy radius
- Desktop, tablet, and mobile layouts with keyboard support
- Explicit loading, empty, rate-limit, credential, and network states

## Architecture

- **Frontend:** React, TypeScript, Vite, TanStack Query, React Leaflet
- **Backend:** Python `http.server`, Requests, python-dotenv
- **Data:** OpenSky REST API plus the bundled airport and airline datasets. A selected live aircraft can request a short-lived callsign route enrichment; the interface labels this route as estimated.
- **Tests:** Vitest, Testing Library, pytest, and Playwright

The Python server owns all OpenSky authentication. Credentials are never sent to the browser.

## Local setup

Requirements:

- Node.js 22+
- Python 3.10+
- An [OpenSky Network](https://opensky-network.org/) API client

Install dependencies:

```bash
npm install
python3 -m pip install -r requirements-dev.txt
```

Create the local environment file:

```bash
cp .env.example .env
```

Then set both values in `.env`:

```dotenv
OPEN_SKY_CLIENT_ID=your_client_id
OPEN_SKY_CLIENT_SECRET=your_client_secret
```

Never commit `.env`. It is already ignored by Git.

## Development

Start the API server:

```bash
python3 server.py
```

In another terminal, start Vite:

```bash
npm run dev
```

Open `http://localhost:5173`. Vite proxies `/api` to the Python server at `http://localhost:8000`.

## Production build

```bash
npm run build
python3 server.py
```

The server automatically serves `dist/index.html` and its hashed assets. Open `http://localhost:8000`.

## Validation

```bash
npm run lint
npm run test
python3 -m pytest -q
npm run build
npm run test:e2e
```

Unit and E2E tests use deterministic API responses and do not consume OpenSky credits. To perform a live smoke test, configure `.env`, run both servers, and verify health, airport search, arrivals, departures, viewport traffic, and a flight track.

## API endpoints

- `GET /api/health`
- `GET /api/search-airports?q=...&limit=...`
- `GET /api/airports`
- `GET /api/flights?airport=ICAO&date=YYYY-MM-DD&mode=departure|arrival`
- `GET /api/fetch-flights?...` — compatibility alias
- `GET /api/live-flights?lamin=...&lomin=...&lamax=...&lomax=...`
- `GET /api/flight-info?icao24=...&callsign=...`
- `GET /api/track?icao24=...&time=...`

## Data and privacy

The application stores only theme, live-refresh preference, recent airports, and favorites in browser `localStorage`. No user account or personal flight history is created. Map tiles come from OpenStreetMap. Flight history comes from OpenSky; on Vercel, live positions use ADSB.lol with Airplanes.live as a fallback. If OpenSky history is unavailable, an airport search returns a clearly labelled live snapshot around the airport so the map and list remain useful; it does not claim those aircraft are historical movements.

Origin and destination for historical records come from OpenSky. For a live aircraft, the selected callsign is resolved on demand through the [ADSBDB callsign API](https://github.com/mrjackwills/adsbdb) and cached briefly; a missing or disabled resolver leaves the route explicitly unknown. Set `SKYTRACE_ROUTE_LOOKUP_ENABLED=0` to disable this enrichment.

## License

MIT
