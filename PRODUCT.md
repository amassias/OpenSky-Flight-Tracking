# Product

<!-- impeccable:product-schema 1 -->

## Platform

web

## Users

- Primary audience (inferred from the request): aviation enthusiasts and curious travellers who want to explore live air traffic around a place or airport.
- Secondary audience (confirmed by the existing product): people checking an airport's arrivals and departures or following one aircraft in more detail.

## Product Purpose

SkyTrace is a map-first flight intelligence interface. It lets a visitor explore live ADS-B traffic, search an airport, review arrival and departure movements, select an aircraft, inspect its route and altitude profile, and share a flight view. Success means that a visitor can identify what is flying in the visible area and understand a selected flight without losing the map context.

## Positioning

SkyTrace brings live viewport traffic, airport movement history, an interactive altitude path, and route enrichment into one lightweight open-data interface. The combination is the product's differentiator; the interface must remain clear about whether information is live, recorded, estimated, or unavailable.

## Operating Context

- Visitors use the product in a desktop or mobile browser while panning and zooming a live map.
- The central workflow is exploring traffic first, then searching an airport or flight and opening a detail view.
- A visitor may switch between live traffic and UTC-dated airport movements, and may return through a shareable URL.

## Capabilities and Constraints

- Live aircraft positions are requested for the visible map area and refreshed periodically.
- Airport search supports city, airport name, IATA, ICAO, region, and country terms.
- UTC arrival and departure history, flight filtering, sorting, status summaries, and track details are supported.
- Selected aircraft can show origin, destination, callsign, speed, altitude, track, and an altitude-coloured path with a hover readout.
- The map supports light and dark themes, browser geolocation with an accuracy radius, responsive layouts, keyboard support, and local browser preferences.
- OpenStreetMap provides map tiles. Live traffic uses public ADS-B fallbacks when OpenSky cannot be reached; provider limits and missing history must be presented honestly and must not erase the last useful snapshot.
- No account or personal flight history is created; browser storage is limited to interface preferences, recent airports, and favourites.

## Brand Commitments

- Product name: SkyTrace.
- Product descriptor: Flight intelligence.
- The user explicitly wants a flight-tracker experience inspired by FlightRadar24's map-first interaction model while keeping SkyTrace's own product identity and features.

## Evidence on Hand

- Current implementation and tests in this repository.
- Bundled airport and airline data.
- OpenSky historical endpoints, public ADS-B live fallback providers, ADSBDB callsign enrichment, and OpenStreetMap tiles.
- No customer claims, testimonials, or other marketing proof has been supplied; future UI copy must not invent any.

## Product Principles

1. Put the live map at the centre of the task.
2. Make every data source and freshness state legible.
3. Reveal flight detail without breaking spatial context.
4. Keep dense traffic responsive while preserving useful selection and inspection.
5. Make the same core workflow usable with keyboard, touch, and small screens.

## Accessibility & Inclusion

- Preserve labelled controls, visible keyboard focus, semantic headings, reduced-motion respect where motion is added, and readable contrast in both map themes.
