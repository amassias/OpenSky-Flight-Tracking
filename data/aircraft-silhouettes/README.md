# Model-specific overhead silhouettes

39 real-aircraft models are projected into 64×64, nose-east monochrome vector
sprites. The map references the shared generated symbols; it never downloads 3D models,
textures, or an external icon service. Generated SVGs are in
`src/assets/aircraft/models/`; the initial HTML embeds `sprites.svg` once, and the runtime uses
`rotors.json` and `catalogue.json`. A helicopter has separate body and rotor geometry.

## Sources and licences

- **Geometry and derived sprites: GPL-2.0-only.** Flightradar24's community model
  collection, revision `dd53267690c6a4ecbb290a3acf0284333a5d68a9`:
  <https://github.com/Flightradar24/fr24-3d-models/tree/dd53267690c6a4ecbb290a3acf0284333a5d68a9>.
  Model credit goes to FlightGear, FGMEMBERS and the original aircraft authors.
  The unchanged `UPSTREAM-MODELS.md` preserves the original model-by-model source
  and author links. `GPL-2.0.txt` supplies the licence. Each generated SVG is a
  modified work: orthographic projection, raster union, contour simplification,
  normalization and eastward rotation, made for SkyTrace on 2026-10-17.
- **Reference type records and derived type metadata: CC-BY-SA-3.0.**
  OpenAircraftType contributors and Wikipedia contributors, revision
  `d7bdee5bc8d48f281daba79127d12956aa4574c5`:
  <https://github.com/atoff/OpenAircraftType/tree/d7bdee5bc8d48f281daba79127d12956aa4574c5>.
  The original records in `type-sources/` are unchanged. `type-metadata.json`
  selects the available ICAO, model, class, engines and dimension fields;
  absent values remain absent. `UPSTREAM-TYPES.md` preserves the source notice;
  see `CC-BY-SA-3.0.txt` for the licence. The reference catalogue validates the
  code-to-model associations; it does not replace SkyTrace's existing curated
  aircraft names or claim to be an authoritative current registry.

No fictional model or model with a different asset licence is included. The
external-buffer An-225 glTF is also excluded from this binary-glTF pipeline.
Textures, liveries and airline marks are not extracted.

## Rebuild and obtain the corresponding source

From the repository root, with Python 3.13:

```sh
python3 -m pip install -r scripts/requirements-aircraft-icons.txt
python3 scripts/build_aircraft_silhouettes.py
```

The script downloads every original binary glTF model into
`.cache/aircraft-models/`. `manifest.json` records its exact upstream path,
commit, SHA-256, source licence, intended orientation and ICAO associations.
These pinned original model files, the source links in `UPSTREAM-MODELS.md`,
the generator and the manifest are the corresponding source for the sprites.
Keep these notices, the source manifest, generator and licence with redistributed
sprite packs; the pinned source URLs offer the original downloadable files.
For an entirely local rebuild once the source is downloaded:

```sh
python3 scripts/build_aircraft_silhouettes.py --offline --check
python3 scripts/build_aircraft_silhouettes.py --offline --preview /tmp/aircraft.png
```

`--cache PATH` selects an existing source directory. Normal frontend builds do
not run this script and need neither Python libraries nor network access to the
model or type repositories.

## Matching and rendering

`catalogue.json` maps explicit ICAO type codes to a model sprite. `type` denotes a
matching published type; `family` denotes a deliberately shared representative
shape (for example A20N uses the A320 shape). This is a representative overhead
symbol, not a claim about an individual airframe's exact variant, winglets,
engines, dimensions or livery. All symbols are normalized for legibility, not
scaled to real-world map dimensions. Missing and unsupported codes keep the
existing category glyph. Aircraft identity is never inferred from an operator,
callsign, registration prefix, speed or altitude.

The existing dense traffic threshold still uses canvas dots. A selected aircraft
retains its detailed sprite even in that view or after a viewport refresh removes
it from the feed. Ground, emergency, selected, estimated-position and freshness
styles remain controlled by the map. Rotor animation respects reduced motion.
