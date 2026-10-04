---
name: SkyTrace
description: A sober, map-first flight tracker. Flat graphite or paper panels dock at the edges of a full-bleed grayscale map; one blue marks every action and the selected aircraft.
colors:
  bg: "#0b0b0c"
  panel: "#1c1c1e"
  panel-solid: "#1c1c1e"
  panel-raised: "#2c2c2e"
  fill: "rgba(255, 255, 255, 0.06)"
  fill-strong: "rgba(255, 255, 255, 0.1)"
  line: "rgba(255, 255, 255, 0.08)"
  line-strong: "rgba(255, 255, 255, 0.16)"
  text: "#f5f5f7"
  muted: "#a1a1a6"
  quiet: "#8e8e93"
  accent: "#2997ff"
  accent-press: "#0a84ff"
  accent-soft: "rgba(41, 151, 255, 0.16)"
  ok: "#30d158"
  warn: "#ffd60a"
  danger: "#ff453a"
  aircraft: "#f5f5f7"
  aircraft-ground: "#8e8e93"
  light-bg: "#f5f5f7"
  light-panel: "#ffffff"
  light-panel-solid: "#ffffff"
  light-text: "#1d1d1f"
  light-muted: "#515154"
  light-quiet: "#6e6e73"
  light-accent: "#0066cc"
  light-ok: "#248a3d"
  light-aircraft: "#1d1d1f"
  altitude-low: "#64d2ff"
  altitude-climb: "#0a84ff"
  altitude-cruise: "#5e5ce6"
  altitude-high: "#bf5af2"
  altitude-extreme: "#ff375f"
  altitude-unknown: "#8e8e93"
typography:
  display:
    fontFamily: "-apple-system, BlinkMacSystemFont, SF Pro Display, Inter, Segoe UI, system-ui, sans-serif"
    fontSize: "28px"
    fontWeight: 600
    lineHeight: 1.08
    letterSpacing: "-0.03em"
  headline:
    fontFamily: "-apple-system, BlinkMacSystemFont, SF Pro Display, Inter, Segoe UI, system-ui, sans-serif"
    fontSize: "22px"
    fontWeight: 600
    lineHeight: 1.1
    letterSpacing: "-0.025em"
  title:
    fontFamily: "-apple-system, BlinkMacSystemFont, SF Pro Display, Inter, Segoe UI, system-ui, sans-serif"
    fontSize: "17px"
    fontWeight: 600
    lineHeight: 1.15
    letterSpacing: "-0.02em"
  body-strong:
    fontFamily: "-apple-system, BlinkMacSystemFont, SF Pro Text, Inter, Segoe UI, system-ui, sans-serif"
    fontSize: "15px"
    fontWeight: 600
    lineHeight: 1.3
    letterSpacing: "-0.01em"
  body:
    fontFamily: "-apple-system, BlinkMacSystemFont, SF Pro Text, Inter, Segoe UI, system-ui, sans-serif"
    fontSize: "13px"
    fontWeight: 400
    lineHeight: 1.45
    letterSpacing: "-0.01em"
  caption:
    fontFamily: "-apple-system, BlinkMacSystemFont, SF Pro Text, Inter, Segoe UI, system-ui, sans-serif"
    fontSize: "12px"
    fontWeight: 400
    lineHeight: 1.35
    letterSpacing: "0"
rounded:
  sm: "6px"
  md: "8px"
  lg: "10px"
  pill: "980px"
spacing:
  xs: "4px"
  sm: "8px"
  md: "12px"
  lg: "16px"
  xl: "20px"
  2xl: "24px"
components:
  button-primary:
    backgroundColor: "{colors.accent}"
    textColor: "#ffffff"
    typography: "{typography.body}"
    rounded: "{rounded.pill}"
    height: "44px"
  button-secondary:
    backgroundColor: "transparent"
    textColor: "{colors.accent}"
    rounded: "{rounded.pill}"
    padding: "7px 16px"
  icon-button:
    backgroundColor: "transparent"
    textColor: "{colors.muted}"
    rounded: "{rounded.pill}"
    size: "34px"
  floating-panel:
    backgroundColor: "{colors.panel}"
    textColor: "{colors.text}"
    rounded: "{rounded.lg}"
    padding: "20px"
  command-search:
    backgroundColor: "{colors.fill}"
    textColor: "{colors.text}"
    rounded: "{rounded.pill}"
    height: "34px"
  segmented-control:
    backgroundColor: "{colors.fill-strong}"
    textColor: "{colors.muted}"
    rounded: "{rounded.pill}"
    height: "36px"
  flight-row:
    backgroundColor: "transparent"
    textColor: "{colors.text}"
    rounded: "{rounded.md}"
    height: "68px"
  inset-card:
    backgroundColor: "{colors.fill}"
    textColor: "{colors.text}"
    rounded: "{rounded.md}"
    padding: "14px"
  status-pill:
    backgroundColor: "{colors.fill-strong}"
    textColor: "{colors.muted}"
    rounded: "{rounded.pill}"
    height: "24px"
---

## Overview

SkyTrace is an operate-mode instrument: a visitor explores live traffic, picks an aircraft and reads its story without losing the map. The visual world is deliberately quiet. Chrome is graphite (dark) or paper (light): flat, opaque panels with hairline borders, no blur and no decorative copy. Panels are named after what they do ("In view", "Airport", "Filters"), not introduced with slogans. The map is rendered in grayscale so the only colour on it is data: neutral aircraft glyphs, the selected aircraft in blue, and an altitude-graded track.

## Colors

- **One accent.** `accent` (#2997ff on dark, #0066cc on light) marks every action: primary button, focus ring, links, the selected aircraft and the route end. There is no second brand colour.
- **Status is semantic, not decorative.** `ok` means airborne or live. `warn` is reserved for a degraded feed (paused, offline, signal alert) and `danger` for errors. Aircraft on the ground are grey, never orange.
- **Aircraft ink.** Every marker uses `aircraft` ink (white on dark, near-black on light), including the dense canvas dots, so zooming never changes an aircraft's colour.
- **Altitude ramp.** A cool, ordered ramp (cyan to blue, indigo, purple, pink) colours the selected track and its legend only.
- Leaflet paths and canvas dots cannot read CSS variables, so `MAP_COLORS` in `FlightMap.tsx` mirrors the tokens per theme.

## Typography

System type first: `-apple-system`/SF on Apple platforms, Inter (loaded from Google Fonts in `index.html`) elsewhere. The weight ladder is 400 / 500 / 600, with headlines at 600 and tight negative tracking. Numbers use `font-variant-numeric: tabular-nums` instead of a monospace face, and uppercase tracked labels are not used. The UI floor is 12px.

## Layout

The map fills the workspace. On desktop, a search panel sits on the left, the traffic board on the right and the flight drawer at the bottom-centre, all floating with 16px insets. Between 901 and 1180px the search panel collapses to a compact bar. At 900px and below, search and flight details become bottom sheets and the board docks above the map's bottom edge.

## Elevation & Depth

Depth comes from material, not shadow. Floating chrome uses `panel` with `backdrop-filter: saturate(180%) blur(20px)` and a 1px hairline. The one shadow (`0 8px 30px`, soft) belongs to overlays that sit above other chrome: the flight drawer, popovers and the toast.

## Shapes

Four radii: `sm` 8px for small tiles, `md` 12px for rows and inset cards, `lg` 18px for panels and sheets, and `pill` for every action, search field, segmented control and status chip.

## Motion

Motion is quiet, eased with `cubic-bezier(0.22, 1, 0.36, 1)`, and always respects `prefers-reduced-motion` (CSS media query plus Motion's `MotionConfig reducedMotion="user"`).

- **Motion (motion.dev)** springs the flight drawer and toast in and out (`AnimatePresence`) and slides the segmented-control thumb (`layoutId`).
- **View Transitions API:** switching theme reveals the new theme as a circle expanding from the toggle button.
- CSS handles the small things: a subtle list cascade on first render, the live-dot ping, button press `scale(0.95)`, and marker heading rotation.

## Do's and Don'ts

- Do keep one blue for actions and selection; add emphasis with weight and size, not new hues.
- Do keep the map grayscale; colour on the map must mean data.
- Don't use glows, gradients, coloured left borders or uppercase monospace labels.
- Don't use orange for normal states; `warn` is for degraded feeds only.
- Don't animate on a loop except the single live-status ping.

## Layout (desktop)

The map fills the window under a 48 px bar. Everything else docks to its edges:

- **Top bar:** brand, one search field for aircraft in view, registrations and airports (⌘K or `/`), feed status, UTC clock, theme.
- **Left dock (392 px):** appears only when an aircraft is selected, and keeps the same instance when another aircraft is picked, so the content cross-fades instead of the panel re-entering. Order: identity, photo, route hero with progress, live readouts, then collapsible sections (Aircraft, Altitude profile, Operations, Signal).
- **Right panel (352 px):** tabs for **In view** (live board, follows the map) and **Airport** (departures and arrivals for a UTC date). Collapsible to a single "Traffic" button.
- **Map toolbar (top-left of the free map):** Filters and Display popovers. **Map controls (bottom-right of the free map):** zoom, locate, pause, full map, follow and show route.
- Every overlay anchors to the part of the map the docks do not cover through the `--inset-left` and `--inset-right` custom properties, and the camera uses the same insets so an aircraft is framed in the visible area rather than under a panel.

## Motion

- Selecting an aircraft makes at most one camera move: none when it is comfortably on screen, a short pan near an edge or a panel, one eased flight when it is out of reach. The trace is then revealed from its start to the aircraft without moving the camera again. "Show route" (R) is the explicit way to frame the whole trace.
- Aircraft glide between feed refreshes by dead reckoning along their reported track and ground speed; markers ease to each new position over the one-second tick, and a fresh fix absorbs the difference instead of snapping.
- Panels spring in from their own edge, the selection pops, the tab and Departures/Arrivals thumbs slide. All motion respects reduced-motion settings.
