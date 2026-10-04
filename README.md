# SkyTrace — OpenSky Flight Tracking

SkyTrace is a map-first live flight tracker powered by the OpenSky Network API and public ADS-B feeds. It combines live viewport traffic, airport arrival and departure history, aircraft photos, routes, tracks and altitude profiles in a React application, in the spirit of Flightradar24.

Public demo: [opensky-flight-tracking.vercel.app](https://opensky-flight-tracking.vercel.app/)

## Features

**Map**
- Full-bleed live map. Aircraft glide between feed refreshes (dead reckoning along their reported track and speed) instead of jumping on every poll
- One camera move when an aircraft is selected, never two: no movement when it is already comfortably on screen, a short pan near an edge, one eased flight when it is out of reach. The route is drawn without moving the map again, and a "Show route" button (R) frames it on request
- Follow mode (F) keeps the selected aircraft in the free part of the map as it flies
- Solid silhouettes by category (airliner, heavy, light aircraft, helicopter, glider, balloon), callsign and flight-level labels when zoomed in, hover cards, emergency squawks (7500/7600/7700) pulled out in red with a banner
- Airport markers for known airports; click one to open its departures and arrivals
- Filters: altitude window, hide ground traffic, airline / type / registration text. Emergencies are never filtered out
- Aviation (ft, kt) or metric (m, km/h) units, dark and light map, optional browser geolocation

**Search**
- One field (⌘K, Ctrl K or `/`) for aircraft on the map by callsign, registration, type or airline, and for airports by city, name, IATA, ICAO, region or country

**Selected flight**
- Left dock with a Planespotters photo, big origin and destination codes with a progress bar and time flown / to go, live altitude, speed, vertical rate, track and squawk, then collapsible sections for the airframe, the altitude profile, FlightAware operations and ADS-B signal data
- Altitude-coloured trace with a hover readout for each profile point
- Shareable URL, including for a live aircraft that is not tied to an airport

**Airport board**
- UTC departures and arrivals, loaded as soon as an airport is picked; sortable and filterable; a labelled live snapshot when OpenSky history is unavailable
- Recent and favourite airports stored in the browser

Phones get the same features through bottom sheets, but the desktop layout is the primary one.

## Keyboard

| Key | Action |
| --- | --- |
| `⌘K` / `Ctrl K` / `/` | Focus the search |
| `↑` `↓` `Enter` | Move through and pick a search result; arrows also move through the flight board |
| `F` | Follow or stop following the selected aircraft |
| `R` | Frame the selected aircraft's full route |
| `Esc` | Close search, popover, full map or the selected flight |

## Screenshots

These captures were generated locally against a synthetic backend (deterministic traffic, a procedural base map and a placeholder aircraft photo), because the capture environment had no internet access. They show the layout and behaviour, not real traffic. They contain no credentials or private account data.

### Overview

![SkyTrace overview](docs/screenshots/skytrace-desktop-overview.png)

### Selected flight

![SkyTrace selected flight](docs/screenshots/skytrace-desktop-selected-flight.png)

### Search

![SkyTrace search](docs/screenshots/skytrace-desktop-search.png)

### Airport board

![SkyTrace airport board](docs/screenshots/skytrace-desktop-airport-board.png)

### Light map

![SkyTrace light map](docs/screenshots/skytrace-desktop-light.png)

### Phone

![SkyTrace on a phone](docs/screenshots/skytrace-mobile-selected.png)

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

### Live mode with the deployed APIs

If local OpenSky credentials are unavailable, set `SKYTRACE_API_ORIGIN=https://opensky-flight-tracking.vercel.app` in `.env.local`. The frontend remains on `localhost:5173` for Impeccable Live, while `/api` is proxied to the authenticated production backend. Do not put API secrets in this setting.

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

The application stores only theme, units, display options (labels, airport markers, panel state), live-refresh preference, recent airports, and favorites in browser `localStorage`. No user account or personal flight history is created. Map tiles come from OpenStreetMap. Flight history comes from OpenSky; on Vercel, live positions use ADSB.lol with Airplanes.live as a fallback. If OpenSky history is unavailable, an airport search returns a clearly labelled live snapshot around the airport so the map and list remain useful; it does not claim those aircraft are historical movements.

Origin and destination for historical records come from OpenSky. For a live aircraft, the selected callsign is resolved on demand through the [ADSBDB callsign API](https://github.com/mrjackwills/adsbdb) and, when configured, the FlightAware AeroAPI connected to the Hermes flight-tracker skill. Both enrichments are cached briefly; a missing or disabled source leaves the route explicitly unknown. The selected hex code also gets a one-shot profile lookup from the ADS-B provider, including registration, type, operator and signal fields. Set `SKYTRACE_ROUTE_LOOKUP_ENABLED=0` or `SKYTRACE_FLIGHTAWARE_ENABLED=0` to disable either enrichment.

FlightAware data is fetched server-side with `FLIGHTAWARE_AEROAPI_KEY`; the key is never sent to the browser. A selected aircraft triggers at most one operational lookup per cache window, with failed lookups held for the retry window. The flight dock shows status, scheduled/estimated/actual times, delays, progress, gates, terminals, and filed route when the provider publishes them.

Live viewport requests use a short in-process cache, a small client request spacing, and a provider-aware refresh cadence. OpenSky state queries cost 1–4 credits based on bounding-box area; the default `SKYTRACE_OPENSKY_DAILY_BUDGET=3000` targets 3,000 of the standard 4,000 daily credits and yields roughly 30/60/90/120-second polling for increasingly wide boxes. If the configured credentials are rejected, the private proxy can serve current boxes anonymously at a slower cadence sized for the 400-credit anonymous bucket; set `OPEN_SKY_PROXY_ANONYMOUS_FALLBACK=0` to disable that path. The public ADS-B fallback respects the 250 NM point-endpoint limit by merging a bounded grid for wider viewports (`SKYTRACE_LIVE_MAX_TILES`, default 36), pacing cells 1.3 seconds apart by default, and lengthening its polling interval as the grid grows.

## Provider choices

The production stack keeps OpenSky for recorded airport history and complete live bounding boxes when the private proxy is available, then uses ADSB.lol and Airplanes.live for resilient live coverage. A third public feed is not queried on every refresh: adding one would increase latency and could violate its fair-use rules. [ADSB.fi](https://github.com/adsbfi/opendata) is a useful optional source for a future controlled fallback, but its public endpoints are limited to one request per second and personal, non-commercial use.

For a materially faster and quota-free local setup, the most reliable option is a nearby ADS-B receiver running `readsb`/`tar1090`; the server can consume that local feed and use OpenSky only for history and enrichment. Check each provider's current terms before enabling commercial or high-frequency use: [OpenSky REST API](https://github.com/openskynetwork/opensky-api/blob/master/docs/free/rest.rst), [OpenSky terms](https://opensky-network.org/about/terms-of-use), [ADSB.lol open data](https://www.adsb.lol/docs/open-data/api/), and [ADSB.fi limits](https://github.com/adsbfi/opendata#limits).

## License

MIT

Interface icons are from [Font Awesome Free](https://fontawesome.com) (solid set) by Fonticons, Inc., licensed under [CC BY 4.0](https://fontawesome.com/license/free). Regenerate them with `node scripts/build-icons.mjs <fontawesome-free-web-folder>`.
