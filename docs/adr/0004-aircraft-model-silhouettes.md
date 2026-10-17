# 0004. Generate model silhouettes offline

Status: accepted (2026-10-17)

## Context

The user selected model-specific overhead silhouettes, with the broader GPLv2
model collection. Detailed icons must coexist with the dense traffic canvas path
and current map state colours without adding model or texture requests at runtime.

## Decision

Project 39 pinned Flightradar24/FlightGear binary glTF models offline and simplify
their raster union into local SVG paths. Use exact, explicit ICAO associations and
separately labelled family aliases. Preserve the original category glyph as the
fallback. Embed the shared SVG sprite into the initial HTML to avoid extra asset requests,
repeated geometry per marker and increasing the entry JavaScript size.
OpenAircraftType provides a pinned reference subset for the supported type codes.
The helicopter's body and main rotor are separate projected layers.

## Consequences

The pipeline requires NumPy/Pillow only for regeneration; frontend installs gain
no dependency. The model originals are downloaded on demand into an ignored cache,
with commit pins and SHA-256 checks. Generated model artwork remains GPLv2;
OpenAircraftType reference data remains CC-BY-SA-3.0. Source, credits, licences and
rebuild instructions live in `data/aircraft-silhouettes/`. The renderer still uses
canvas dots for dense traffic and existing map interaction/camera behaviour.
