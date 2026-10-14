# Reddit feedback: position freshness, estimates and viewport counts

Feedback supplied by Arthur as a screenshot of r/ADSB comments, 2026-10-14.

## Findings and corrections

1. Rows previously showed the reported flight state without coordinate age. Live rows now show `Seen 4s ago` or minutes/seconds and unknown age. The actual `time_position` is authoritative; `last_contact` can describe a newer packet without coordinates.
2. Aircraft icons already dead-reckoned at reported speed/heading, capped at 90 seconds. Estimated silhouettes are now outlined, with explicit map help and selected-flight explanation. Invalid kinematics or unknown fix time never project. The trace-to-head connection is dashed because it is not a recorded track observation. After 60 seconds the icon fades. Dense canvas dots continue to show reported coordinates and become hollow after 60 seconds or when age is unknown.
3. More than 750 visible filtered aircraft uses canvas dots to keep the map responsive. The visible guide explains this mode and zooming in for labels. Non-dense views also explain disabled labels or label zoom levels.
4. Map requests include a padded region; the old list received the whole padded response while the map could keep a different progressive snapshot. Snapshot publication now happens in one effect from the map's displayed data, cropped to the visible geographic bounds. Both map and panel apply the same map filters. Retaining an out-of-filter selected marker does not inflate the traffic count. Coordinates in the bounds describe the reported fix, not projected motion.

## Validation

- Lint, Vitest and production build.
- Targeted regression tests for older coordinates with newer contact, missing coordinate time, invalid kinematics and live row labels.
- Browser fixture: 1,000 in-bounds aircraft plus one outside; map and panel both show 1,000, canvas mode and explanatory guide visible, old rows have hollow status indicators.
- Desktop and 390 × 844 mobile inspection. Mobile guide placed below the nearby-airport control.

## Positioning question

The second comment asks why build this rather than tar1090 or a commercial frontend. This is a positioning question, not a defect to fix by inventing superiority. SkyTrace is a personal interface experiment combining map selection, mobile details, airport information and observed altitude inspection, using third-party feeds. No unique coverage or new ADS-B decoder is claimed. No Reddit reply was sent as part of this change.
