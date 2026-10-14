# Airline/logo and aircraft-type expansion — 14 October 2026

## Source and coverage

All 38 pages of the public IATA member directory were retrieved. Of 380 displayed members, 363 rows had an unstarred two-character IATA designator and a three-letter ICAO code. Grouping the two Lufthansa rows produces 362 current assignments; two retained sourced non-member assignments bring the correction layer to 364. Every record has the individual IATA/primary source URL and check date. Shared/starred designators or missing ICAO codes were not guessed. This is member-directory coverage, not all airlines worldwide or a history of code ownership.

The same layer feeds the frontend's generated ticket/callsign table and the backend airline-name cache. `operator_names` distinguishes Lufthansa passenger/cargo names under their shared IATA code. JAT now maps to JA/JetSMART Chile according to the current IATA source; it is no longer treated as former JAT Airways in the current lookup. Legacy records remain for non-members; their freshness is not established.

## Logo review

388 dated asset records replace the inline whitelist. All original/current candidates were fetched and PNG-decoded for the review; contact sheets were visually inspected. Twenty CDN images were identical generic aircraft placeholders. Four further images (5C, 5H, JG and KJ) visibly represented a different or earlier code holder and are disabled. These 24 entries use the operator badge.

Southwest, Cargolux and Smartwings use unchanged sourced local assets instead of visibly incorrect CDN images. Sources and attribution are in `public/airline-logos/README.md`. 364 asset records are enabled; this is an asset count, not a guarantee that every operator has a logo. Explicit group/operator overrides and ambiguous-operator handling remain intact. Only visible/selected markers request their logos.

Image availability does not certify brand identity. CDN logos may depict an older visual identity; failures retain the operator badge. The catalogue distinguishes its image-check date from the additional brand-review date for local replacements.

## Aircraft families

Ten FAA JO 7360.1K additions bring the model-name lookup from 59 to 69 entries. Source/model metadata is stored separately. GL7T covers Global 7500/8000, TBM9 a family of TBM variants, and EC45 the EC145/H145 family; these labels do not confirm an exact airframe variant. Manufacturer recognition is extended and business jets are not shown with regional-airliner silhouettes. Known H160/EC45/B429 helicopter and C919 airliner types are covered.

## Validation

- `npm run check`: 182 unit tests, lint and production build pass.
- `python3 -m pytest -q`: 132 tests pass, with one existing dependency deprecation warning.
- `python3 scripts/build_airline_codes.py --check`: generated assignment table matches the sources.
- `python3 scripts/check_airline_logos.py`: offline catalogue, local-source asset and model-provenance checks pass; also added to CI.
- `python3 scripts/check_airline_logos.py --online --iata U2,AZ,VF,V7,VJ,WN,CV,QS`: selected remote PNG checks pass. The checker reports without editing files; full network checking is optional.
- `npx playwright test e2e/logo-catalogue.spec.ts e2e/aircraft-detail.spec.ts --workers=2`: 13 pass across Chromium, Firefox and mobile WebKit; 2 mouse-hover cases skipped on mobile. Local PNG/SVG decoding, modern mapped URLs, placeholder badges and the existing aircraft-detail flows are verified.
