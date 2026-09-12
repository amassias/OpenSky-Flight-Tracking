# SkyTrace — OpenSky Flight Tracking

SkyTrace is a map-first flight intelligence interface powered by the OpenSky Network API. It combines live viewport traffic, airport arrival and departure history, aircraft tracks, and altitude profiles in a responsive React application.

## Features

- Live aircraft polling in the visible map area
- Complete live viewport coverage when zooming out, with a short provider cache and labelled stale-snapshot recovery during rate limits
- Airport search by city, name, IATA, ICAO, region, or country
- UTC arrival and departure queries
- Flight filtering, sorting, status summaries, and detailed tracks
- Dark and light OpenStreetMap map themes
- Shareable flight URLs
- Recent and favorite airports stored locally in the browser
- Altitude-colored tracks with a hover readout for each profile point
- Rich aircraft profile on selection (registration, type, operator, signal and navigation data)
- Optional browser geolocation marker with an accuracy radius
- Desktop, tablet, and mobile layouts with keyboard support
- Explicit loading, empty, rate-limit, credential, and network states

## Architecture

- **Frontend:** React, TypeScript, Vite, TanStack Query, React Leaflet
- **Backend:** Python `http.server`, Requests, python-dotenv
- **Data:** OpenSky REST API plus the bundled airport and airline datasets. On Vercel, the authenticated proxy serves complete viewport boxes; public ADS-B sources are used only as a resilient fallback. A selected live aircraft can request short-lived callsign, aircraft-profile, and FlightAware operational enrichment; the interface labels the source of each route.
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

Origin and destination for historical records come from OpenSky. For a live aircraft, the selected callsign is resolved on demand through the [ADSBDB callsign API](https://github.com/mrjackwills/adsbdb) and, when configured, the FlightAware AeroAPI connected to the Hermes flight-tracker skill. Both enrichments are cached briefly; a missing or disabled source leaves the route explicitly unknown. The selected hex code also gets a one-shot profile lookup from the ADS-B provider, including registration, type, operator and signal fields. Set `SKYTRACE_ROUTE_LOOKUP_ENABLED=0` or `SKYTRACE_FLIGHTAWARE_ENABLED=0` to disable either enrichment.

FlightAware data is fetched server-side with `FLIGHTAWARE_AEROAPI_KEY`; the key is never sent to the browser. A selected aircraft triggers at most one operational lookup per cache window, with failed lookups held for the retry window. The details drawer shows status, scheduled/estimated/actual times, delays, progress, gates, terminals, and filed route when the provider publishes them.

Live viewport requests use a short in-process cache, a small client request spacing, and a provider-aware refresh cadence. OpenSky state queries cost 1–4 credits based on bounding-box area; the default `SKYTRACE_OPENSKY_DAILY_BUDGET=3000` targets 3,000 of the standard 4,000 daily credits and yields roughly 30/60/90/120-second polling for increasingly wide boxes. If the configured credentials are rejected, the private proxy can serve current boxes anonymously at a slower cadence sized for the 400-credit anonymous bucket; set `OPEN_SKY_PROXY_ANONYMOUS_FALLBACK=0` to disable that path. The public ADS-B fallback respects the 250 NM point-endpoint limit by merging a bounded grid for wider viewports (`SKYTRACE_LIVE_MAX_TILES`, default 36) and lengthening its polling interval as the grid grows.

## License

MIT
