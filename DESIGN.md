---
name: SkyTrace
description: A map-first flight intelligence console for live airspace and recorded airport movements.
colors:
  bg: "#07121f"
  bg-deep: "#050d17"
  panel: "rgba(9, 24, 39, 0.97)"
  panel-solid: "#0b1b2c"
  panel-raised: "#10263b"
  line: "rgba(144, 183, 210, 0.18)"
  line-strong: "rgba(144, 183, 210, 0.34)"
  text: "#f2f7fb"
  muted: "#9cb1c1"
  quiet: "#6f8799"
  accent: "#b7f34a"
  accent-strong: "#8dc82f"
  accent-soft: "rgba(183, 243, 74, 0.12)"
  cyan: "#67d8ff"
  cyan-soft: "rgba(103, 216, 255, 0.12)"
  amber: "#ffbf69"
  danger: "#ff786f"
  violet: "#b9a4ff"
  command-surface: "rgba(14, 35, 54, 0.72)"
  overlay-surface: "rgba(8, 22, 36, 0.94)"
  card-surface: "rgba(255, 255, 255, 0.025)"
  details-surface: "rgba(9, 24, 39, 0.98)"
  legend-surface: "rgba(8, 22, 36, 0.9)"
  altitude-low: "#38bdf8"
  altitude-climb: "#2dd4bf"
  altitude-cruise: "#a3e635"
  altitude-high: "#fbbf24"
  altitude-extreme: "#fb7185"
  altitude-unknown: "#94a3b8"
typography:
  display:
    fontFamily: "Barlow Semi Condensed, Arial Narrow, sans-serif"
    fontSize: "34px"
    fontWeight: 600
    lineHeight: 0.92
    letterSpacing: "-0.015em"
  headline:
    fontFamily: "Barlow Semi Condensed, Arial Narrow, sans-serif"
    fontSize: "24px"
    fontWeight: 600
    lineHeight: 1
    letterSpacing: "0.01em"
  title:
    fontFamily: "Barlow Semi Condensed, Arial Narrow, sans-serif"
    fontSize: "17px"
    fontWeight: 600
    lineHeight: 1
    letterSpacing: "0.02em"
  body:
    fontFamily: "DM Sans, system-ui, sans-serif"
    fontSize: "11px"
    fontWeight: 400
    lineHeight: 1.55
    letterSpacing: "normal"
  label:
    fontFamily: "IBM Plex Mono, ui-monospace, monospace"
    fontSize: "8px"
    fontWeight: 600
    lineHeight: 1
    letterSpacing: "0.12em"
  mono:
    fontFamily: "IBM Plex Mono, ui-monospace, monospace"
    fontSize: "9px"
    fontWeight: 500
    lineHeight: 1.3
    letterSpacing: "0.03em"
rounded:
  xs: "3px"
  sm: "5px"
  card: "6px"
  pill: "4px"
  md: "7px"
  lg: "10px"
  xl: "12px"
  sheet: "16px"
spacing:
  xs: "3px"
  sm: "5px"
  md: "7px"
  lg: "9px"
  xl: "12px"
  2xl: "14px"
  3xl: "18px"
  4xl: "20px"
  5xl: "30px"
components:
  button-primary:
    backgroundColor: "{colors.accent}"
    textColor: "{colors.bg}"
    typography: "{typography.body}"
    rounded: "{rounded.card}"
    padding: "0 16px"
    height: "42px"
    width: "100%"
  command-search:
    backgroundColor: "{colors.command-surface}"
    textColor: "{colors.text}"
    typography: "{typography.body}"
    rounded: "{rounded.md}"
    padding: "0 10px"
    height: "34px"
    width: "min(500px, 100%)"
  panel:
    backgroundColor: "{colors.panel}"
    textColor: "{colors.text}"
    typography: "{typography.body}"
    rounded: "{rounded.xl}"
    padding: "18px"
  traffic-card:
    backgroundColor: "{colors.card-surface}"
    textColor: "{colors.text}"
    typography: "{typography.body}"
    rounded: "{rounded.card}"
    padding: "9px 10px 9px 14px"
    height: "72px"
  source-pill:
    backgroundColor: "{colors.card-surface}"
    textColor: "{colors.quiet}"
    typography: "{typography.label}"
    rounded: "{rounded.pill}"
    padding: "0 7px"
    height: "22px"
  selected-flight-panel:
    backgroundColor: "{colors.details-surface}"
    textColor: "{colors.text}"
    typography: "{typography.body}"
    rounded: "{rounded.lg}"
    padding: "17px"
    width: "min(500px, calc(100vw - 760px))"
  altitude-legend:
    backgroundColor: "{colors.legend-surface}"
    textColor: "{colors.quiet}"
    typography: "{typography.mono}"
    rounded: "{rounded.card}"
    padding: "7px 9px"
---

# Design System: SkyTrace

## Overview

**Creative North Star: "Airspace Weather Scope"**

SkyTrace is a live operations surface that reads like an aviation weather radar console: a dark geographic field, bright altitude and status signals, a compact command bar, and information that slides in from the edges without hiding the traffic. The map is the instrument; every panel explains what the instrument is showing.

The interface borrows the useful interaction model of modern flight trackers—search above the map, floating map controls, a traffic list, and a selected-flight sheet—while using SkyTrace's own visual grammar, labels, data states, and route enrichment.

**Key Characteristics:**

- A map-first console that keeps live traffic visible while panels provide context.
- Sparse radar lime for live and selected states, with cyan, violet, amber, and coral carrying distinct data meanings.
- Tall display type for headings, a quiet sans-serif reading voice, and mono numerals for measurements and identifiers.
- Opaque or lightly translucent navy surfaces, fine cool borders, and one ambient shadow vocabulary.
- Compact edge panels that become reachable bottom sheets on smaller screens.

## Colors

The palette treats the map as a midnight instrument and the signals as measured events. Lime is reserved for live or actionable focus, cyan for measured geography and routes, violet for estimated enrichment, amber for degraded or ground states, and coral for errors or extreme altitude.

### Primary

- **Radar lime:** live status, selected aircraft, active controls, and primary actions.
- **Flight cyan:** route lines, location feedback, map labels, and measured context.

### Secondary

- **Signal amber:** grounded aircraft, warnings, and degraded provider states.

### Tertiary

- **Route violet:** estimated or enriched route provenance.
- **Altitude bands:** low, climb, cruise, high, extreme, and unknown values use a cyan-to-coral sequence with a slate fallback.

### Neutral

- **Midnight ground:** the full-viewport map and the dark application canvas.
- **Panel navy:** the solid and translucent surfaces used by rails, drawers, sheets, and controls.
- **Cool text:** primary, muted, and quiet text levels keep dense operational information legible.
- **Cool borders:** fine low-contrast and strong focus borders separate the instrument layers.

### Named Rules

**The Signal Clarity Rule.** Reserve radar lime for live state, selection, focus, and actions; let the other signal colors keep their own meanings.

**The Provenance Color Rule.** Keep measured, estimated, degraded, error, and unknown states visually distinct wherever source status is shown.

## Typography

**Display Font:** Barlow Semi Condensed (with Arial Narrow and sans-serif fallbacks)

**Body Font:** DM Sans (with system sans fallback)

**Label/Mono Font:** IBM Plex Mono (with ui-monospace fallback)

**Character:** The display face is compact and tall, giving the console its aviation-instrument read. DM Sans carries explanatory copy while IBM Plex Mono makes UTC times, callsigns, airport codes, and measurements easy to scan.

### Hierarchy

- **Display** (600, 34px, 0.92 line-height): the left rail's invitation and other highest-level statements.
- **Headline** (600, 24px, 1 line-height): drawer titles and selected-flight callsigns.
- **Title** (600, 17px, 1 line-height): panel identities, route endpoints, and supporting headings.
- **Body** (400, 11px, 1.55 line-height): explanatory copy, operator names, and route descriptions.
- **Label** (600, 8px, 0.12em tracking, uppercase mono): compact field captions, source labels, and data groups.
- **Measurement mono** (500, 9px, 1.3 line-height): UTC clocks, codes, statuses, and operational values.

### Named Rules

**The Measurement Voice Rule.** Use IBM Plex Mono for values that must be compared quickly, and keep display headings in sentence case with tight tracking.

## Layout

The desktop workspace is a full-viewport map below a fixed 58px command bar. A 306px left query rail and a right traffic drawer capped at 372px sit 16px from the map edges; a selected-flight sheet anchors to the lower map area without removing the map from view. Map labels, live status, controls, the altitude legend, and the footer occupy clear overlay zones between those panels.

At the 1180px breakpoint, the rail compresses into a shallow search surface and the traffic drawer narrows. At 900px, the map owns the upper stage while search becomes a bottom sheet and traffic becomes a compact bottom panel that can expand. At 520px, labels and secondary source copy collapse before the core headings, metrics, and controls lose readable size. The layout uses small repeated gaps and compact panel padding to sustain an operational density.

## Elevation & Depth

SkyTrace uses tonal layering with a restrained ambient shadow. Dark navy surfaces separate from the map through opacity and cool borders, while drawers and popovers use the shared deep shadow. Signal glows belong to active markers and status dots; they are part of the instrument language rather than a general decoration.

### Shadow Vocabulary

- **Console elevation:** the shared deep shadow used by rails, drawers, and selected-flight details.
- **Map overlay:** a shorter shadow for the live badge and map controls.
- **Result popover:** a deeper local shadow for airport suggestions above the rail.
- **Toast elevation:** a broad shadow that keeps transient feedback readable over the map.

### Named Rules

**The Layered Console Rule.** Let opaque or lightly translucent navy surfaces, fine borders, and a single ambient shadow establish depth; reserve stronger glow for live signals and selected aircraft.

## Shapes

The form language is compact and gently rounded. Rails and drawers use larger corners, cards and fields use mid-size corners, source pills stay tighter, and bottom sheets gain a broad top silhouette on mobile. Borders are usually one pixel, with the stronger cool line reserved for focus and selected details. The selected aircraft uses a circular lime halo, while route geometry uses a thin dashed connector and altitude-colored segments.

## Components

### Primary lime button

The primary action is a full-width lime control with a compact label, a small inline icon, and a short lift on hover. It becomes slightly translucent and waits with reduced opacity while loading.

### Command search input

The top command field is a centered compact search surface with a cyan search mark, an understated keyboard hint, and a cyan focus ring. It accepts airport, flight, and callsign queries without changing the map workflow.

### Panel and traffic card

Panels establish the navy console layer with a fine border and shared ambient depth. Traffic cards are shorter, quieter surfaces in the same drawer; a one-pixel status line, status dot, and mono route mark airspace state while hover and selection keep the card anchored to the map.

### Source pill

The source pill is a small uppercase mono badge. Its live, history, and ready states use the corresponding signal treatment so recorded history and live snapshots never look interchangeable.

### Selected flight panel

The selected-flight panel is a lower map sheet with the callsign and state at the top, origin and destination on a compact route timeline, four measured cards, and an altitude profile with hover readout. Route provenance is shown in violet when enrichment is estimated.

### Altitude legend

The legend is a compact, non-interactive mono key shared by the map and altitude chart. Small rounded swatches explain the five altitude bands and the slate unknown state without competing with the route itself.

## Do's and Don'ts

### Do:

- **Do** keep the live map visible in the first viewport and preserve spatial context as panels open.
- **Do** use the signal colors consistently for live, measured, estimated, warning, error, and altitude states.
- **Do** keep UTC times, airport codes, callsigns, and measurements in IBM Plex Mono.
- **Do** retain labelled controls, visible focus rings, keyboard dismissal, and reduced-motion behavior at every breakpoint.
- **Do** make live snapshot, recorded history, unavailable data, and unknown route provenance explicit in both copy and styling.

### Don't:

- **Don't** cover the map with a generic opaque dashboard layout or hide the traffic instrument behind a modal by default.
- **Don't** spend radar lime on decorative surfaces where it would compete with live state and selection.
- **Don't** merge recorded, live fallback, estimated, degraded, and unavailable states into one neutral badge.
- **Don't** remove the map controls, focus ring, or source labels when the viewport becomes compact.

## Direction contract

THESIS: Make the live airspace the instrument itself. The map stays visible while every control explains freshness, provenance, and altitude.

OWN-WORLD: Midnight navy map chrome, radar lime live signals, cyan measured context, violet estimated routes, and altitude bands rendered through Barlow Semi Condensed, DM Sans, and IBM Plex Mono.

STORY: A visitor scans an airport or callsign, sees what is flying now, opens a recorded movement when available, and follows one aircraft from origin to destination with an altitude path.

FIRST VIEWPORT: A thin command bar spans the top. The map fills the workspace. A left airspace rail holds search and UTC movement controls, a right traffic drawer holds live and recorded results, and a selected aircraft opens a bottom detail sheet without losing the map.

FORM: Airspace weather scope, assigned direction five from seed key bd911b43; a radar console with edge panels, deliberate signal colors, and a single refresh sweep.

FINISH: unreviewed and undocumented is unfinished; this build ends with the finish review, the verdict, DESIGN.md, and every shipping raster carrying its provenance
