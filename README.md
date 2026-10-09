# SkyTrace

Explore the aircraft above you, follow a flight across the map, or inspect traffic around an airport. SkyTrace combines live positions, recorded airport movements, route details and aircraft profiles in one responsive interface.

[Open the public demo](https://opensky-flight-tracking.vercel.app/) · [Run locally](#run-locally) · [Data and privacy](#data-and-privacy)

## What you can do

- **Explore live traffic.** Pan and zoom the map, filter aircraft by altitude or identity, switch units and map theme, and spot emergency squawks. Aircraft with enough position data glide between feed updates.
- **Inspect a flight.** Select an aircraft for its current altitude, speed, route, profile, photo and available operational details. The map makes one purposeful camera move; use **Follow** to stay with it or **Show full route** to frame its trace.
- **Search in one place.** Find a visible aircraft by callsign, registration, type or airline, or find an airport by name, city, IATA or ICAO code.
- **Find airports on the map.** Blue markers cover all geolocated airports in the bundled catalogue. Nearby markers form numbered groups; click to zoom in, then open arrivals and departures. Use **Display → Favourite airports only** to limit the markers to your saved airports.
- **Find airports near you.** Choose **Nearby airports**, allow browser geolocation, and open one of the five closest airports, sorted by distance. Distances are calculated in your browser.
- **Explore an airport live.** Opening an airport shows its local time, sunrise and sunset, the latest METAR and TAF (flight category, wind, visibility, ceiling, QNH), the runways the wind favours, its runways and radio frequencies, and FAA delay programmes or ground stops for US airports. The board starts with FlightAware's next scheduled airline departures or arrivals (scheduled and expected gate times, gate, terminal, delays, cancellations), each joined by callsign to the aircraft seen live so arrivals show their live share of the route flown and an arrival estimate from their position. Below it, other live traffic: aircraft taxiing out or climbing away with their destination, and aircraft inbound, on approach or just landed with their origin and an estimated arrival time in airport-local time. Pick a row seen live to follow that flight on the map.
- **Know the airframe.** A selected aircraft has an **Airframe history** section: registration, manufacturer and model, serial number (MSN), year built and age, the registered owner today, and a timeline of every owner, operator and registration the aircraft has had, with the registry or snapshot each entry comes from. A registration or hex code typed in the search field (`F-HBXA`, `N283VA`, `3986E0`) opens any airframe, even one that is not flying. A button loads the aircraft's recent flights on demand.
- **Review recorded movements.** Switch the airport board to **History** for OpenSky's UTC departures and arrivals on a given date, then filter or sort the list. When recorded movements are unavailable, SkyTrace labels the live airport snapshot clearly.
- **Keep your context.** Share a selected flight by URL. Recent airports, favourites and display preferences stay in your browser.

The same workflows are available on desktop and phone. Data coverage and enrichment depend on the providers; unknown routes and delayed feeds are labelled in the interface.

## Real screenshots

These are **browser screenshots of the running site**, captured on 5 October 2026 from the current local frontend connected to the public SkyTrace API. The maps use real OpenStreetMap tiles and the aircraft are live API responses. No traffic, map tiles or photos were generated for these images. Live positions and availability will differ when you open the demo.

### Live map

![SkyTrace live aircraft map and traffic list](docs/screenshots/skytrace-desktop-overview.png)

### Selected flight

![A selected aircraft, its live map position and flight detail panel](docs/screenshots/skytrace-desktop-selected-flight.png)

### Search and airport board

![Unified aircraft and airport search](docs/screenshots/skytrace-desktop-search.png)

![Paris CDG airport board with a clearly labelled live fallback](docs/screenshots/skytrace-desktop-airport-board.png)

### Light theme and phone

![SkyTrace light map with live aircraft](docs/screenshots/skytrace-desktop-light.png)

![Selected aircraft on a phone](docs/screenshots/skytrace-mobile-selected.png)

## Keyboard shortcuts

| Key | Action |
| --- | --- |
| `⌘K`, `Ctrl K` or `/` | Focus search |
| `↑`, `↓`, `Enter` | Navigate and select search or flight results |
| `F` | Toggle following the selected aircraft |
| `R` | Frame the selected route |
| `Esc` | Close the active search, menu, full map or flight detail |

## Architecture

- **Frontend:** React, TypeScript, Vite, TanStack Query, React Leaflet
- **Backend:** Python `http.server`, Requests, python-dotenv
- **Data:** OpenSky REST API plus the bundled airport and airline datasets. On Vercel, the authenticated proxy serves complete viewport boxes; public ADS-B sources are used only as a resilient fallback. A selected live aircraft can request short-lived callsign, aircraft-profile, and FlightAware operational enrichment; the interface labels the source of each route.
- **Tests:** Vitest, Testing Library, pytest, and Playwright

The Python server owns all OpenSky authentication. Credentials are never sent to the browser.

## Run locally

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

The application stores only theme, units, display options (labels, airport markers, panel state), live-refresh preference, recent airports, and favorites in browser `localStorage`. No user account or personal flight history is created. Map tiles come from OpenStreetMap. Flight history comes from OpenSky; on Vercel, live positions use ADSB.lol with Airplanes.live as a fallback. Airframe history is free and keyless. OpenSky publishes dated copies of its [aircraft database](https://s3.opensky-network.org/data-samples/metadata/); `scripts/build_aircraft_history.py` compares eleven of them (November 2020 to August 2025) and stores each aircraft's changes of registration, owner and operator in `data/aircraft-history/`, so those are dated to a snapshot month and stop at the newest snapshot. For aircraft ever registered in the United States, `scripts/build_faa_registry.py` adds the FAA's public [aircraft registry](https://www.faa.gov/licenses_certificates/aircraft_certification/aircraft_registry/releasable_aircraft_download) (`data/faa-registry/`): the current registration and every earlier one of the airframe with exact dates, city and state, and the export country. The FAA data keeps no street addresses, and individuals', partners' and co-owners' names are not stored: those registrations read "Private owner" (an organisation filter also applies to N-registered owners from OpenSky). The registered owner today comes from the keyless [ADSBDB](https://github.com/mrjackwills/adsbdb) registry (cached a day). US registrations convert to their ICAO24 code arithmetically; other countries resolve through ADSBDB. Recent flights are one FlightAware page per tail, cached an hour and counted against the same budget below. Refresh the datasets by re-running the two scripts on newly downloaded files.

The scheduled board uses one FlightAware AeroAPI page (15 flights, $0.005) per airport and direction, only for the direction on screen, cached ten minutes in the function and at the Vercel CDN so every visitor of that airport shares it. Each function instance stops calling AeroAPI after `SKYTRACE_AEROAPI_MONTHLY_PAGES` (default 600, about $3 of the Personal tier's $5 monthly allowance) or `SKYTRACE_AEROAPI_HOURLY_PAGES` (default 60) pages; selected-aircraft lookups count against the same ceilings and reuse a flight the board already fetched. AeroAPI has no usage endpoint, so these per-instance counters are a safety net rather than an account-wide cap; `/api/health` reports them. The live airport board is built from ADS-B positions within 150 NM of the airport (one public-provider request per refresh) and each callsign's usual route from the [adsb.lol route database](https://github.com/adsblol/vrs-standing-data). It is an observation, not a timetable: aircraft that have not switched on their transponder yet do not appear, and arrival times are estimated from distance and ground speed. Weather comes from the [NOAA Aviation Weather Center](https://aviationweather.gov/data/api/) (the nearest station within 50 km when the airport has no METAR), US delays from the [FAA NAS Status](https://nasstatus.faa.gov/) feed, and runways and frequencies from the bundled [OurAirports](https://ourairports.com/data/) snapshot in `data/airport-details.json` (rebuild it with `scripts/build_airport_details.py`). The favoured runway is a wind-only estimate. Each source fails on its own, and a rate-limited board falls back to the authenticated feed, the map's recent snapshot, then its last good result, labelled as delayed. If OpenSky history is unavailable, an airport search returns a clearly labelled live snapshot around the airport so the map and list remain useful; it does not claim those aircraft are historical movements.

Origin and destination for historical records come from OpenSky. For a live aircraft, the selected callsign is resolved on demand through the [ADSBDB callsign API](https://github.com/mrjackwills/adsbdb) and, when configured, the FlightAware AeroAPI connected to the Hermes flight-tracker skill. Both enrichments are cached briefly; a missing or disabled source leaves the route explicitly unknown. The selected hex code also gets a one-shot profile lookup from the ADS-B provider, including registration, type, operator and signal fields. Set `SKYTRACE_ROUTE_LOOKUP_ENABLED=0` or `SKYTRACE_FLIGHTAWARE_ENABLED=0` to disable either enrichment.

FlightAware data is fetched server-side with `FLIGHTAWARE_AEROAPI_KEY`; the key is never sent to the browser. A selected aircraft triggers at most one operational lookup per cache window, with failed lookups held for the retry window. The flight dock shows status, scheduled/estimated/actual times, delays, progress, gates, terminals, and filed route when the provider publishes them.

Live viewport requests use a short in-process cache, a small client request spacing, and a provider-aware refresh cadence. OpenSky state queries cost 1–4 credits based on bounding-box area; the default `SKYTRACE_OPENSKY_DAILY_BUDGET=3000` targets 3,000 of the standard 4,000 daily credits and yields roughly 30/60/90/120-second polling for increasingly wide boxes. If the configured credentials are rejected, the private proxy can serve current boxes anonymously at a slower cadence sized for the 400-credit anonymous bucket; set `OPEN_SKY_PROXY_ANONYMOUS_FALLBACK=0` to disable that path. The public ADS-B fallback respects the 250 NM point-endpoint limit by merging a bounded grid for wider viewports (`SKYTRACE_LIVE_MAX_TILES`, default 36), pacing cells 1.3 seconds apart by default, and lengthening its polling interval as the grid grows.

## Provider choices

The production stack keeps OpenSky for recorded airport history and complete live bounding boxes when the private proxy is available, then uses ADSB.lol and Airplanes.live for resilient live coverage. A third public feed is not queried on every refresh: adding one would increase latency and could violate its fair-use rules. [ADSB.fi](https://github.com/adsbfi/opendata) is a useful optional source for a future controlled fallback, but its public endpoints are limited to one request per second and personal, non-commercial use.

For a materially faster and quota-free local setup, the most reliable option is a nearby ADS-B receiver running `readsb`/`tar1090`; the server can consume that local feed and use OpenSky only for history and enrichment. Check each provider's current terms before enabling commercial or high-frequency use: [OpenSky REST API](https://github.com/openskynetwork/opensky-api/blob/master/docs/free/rest.rst), [OpenSky terms](https://opensky-network.org/about/terms-of-use), [ADSB.lol open data](https://www.adsb.lol/docs/open-data/api/), and [ADSB.fi limits](https://github.com/adsbfi/opendata#limits).

## License

MIT

Interface icons are from [Font Awesome Free](https://fontawesome.com) (solid set) by Fonticons, Inc., licensed under [CC BY 4.0](https://fontawesome.com/license/free). Regenerate them with `node scripts/build-icons.mjs <fontawesome-free-web-folder>`.

### Airport schedules and data coverage

The map and airport board display observed traffic. No regional timetable integration is enabled: a planned-flight board needs a verified global provider. See [provider research and metadata provenance](docs/FREE_TIMETABLE_SOURCES.md).
