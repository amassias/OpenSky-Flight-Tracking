import { airlineBadge, airlineLogo, type AirlineBadge } from "../../../shared/aircraftIdentity";
import { AircraftCanvasRenderer, type AircraftCanvasStyle } from "../aircraftCanvas";
import { aircraftSilhouette } from "../aircraftSilhouette";
import { AircraftHoverStore } from "../aircraftHover";
import { labelLevelForZoom, placeLabels, type LabelLevel } from "../mapLabels";
import { headingProjection } from "../headingProjection";
import { destinationGuide } from "../futurePath";
import { positionAge, positionAgeLabel, sameLiveFlight } from "../../flights/flightTelemetry";
import { useMediaQuery } from "../../../shared/hooks/useMediaQuery";
import { memo, useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import L from "leaflet";
import { Circle, CircleMarker, MapContainer, Marker, Polyline, TileLayer, Tooltip, useMap } from "react-leaflet";
import { LocateFixed, Maximize2, Minimize2, Navigation, Pause, Play } from "../../../shared/components/icons";
import { Minus, Plus, Route } from "../../../shared/components/customIcons";
import { groupAirports, nearestAirports } from "../airportMap";
import { api } from "../../../shared/api";
import type { Airport, Bounds, Flight, LiveAircraft, LiveFlightsResponse, MapTheme, MapView, TrackPoint, TrackResponse } from "../../../shared/types";
import { preserveAirframeAppearance, isAircraftInBounds, LIVE_AIRCRAFT_CACHE_TTL_MS, pruneExpiredViewportCache, viewportCacheKey, writeViewportCache, type ViewportCacheEntry } from "../../flights/liveCache";
import { aircraftIconKind, altitudeColor, emergencyInfo, boundsEqual, expandBounds, formatAltitude, liveAircraftToFlight, quantizeBounds, sampleByDensity, splitBoundsIntoTiles, viewportTileCount, type AircraftIconKind } from "../../../shared/utils";
import { filterAircraft, type MapFilters } from "../mapFilters";
import { catchUpPosition, isPositionEstimated, projectPosition, subscribeToFrame, subscribeToTick, useNowSeconds } from "../aircraftMotion";
import { causeFromError, causeFromReason, describeLiveStatus, type LiveCause } from "../liveStatus";
import { distanceText, flightLevelText, speedText, useUnits } from "../../../shared/units";
import { AltitudeLegend } from "./AltitudeLegend";
import { AircraftHoverPreview } from "./AircraftHoverPreview";

/** Recent positions kept per aircraft for its trail. */
const TRAIL_POINTS = 8;
/** The Leaflet renderer draws at most about this many aircraft; more are thinned by density. */
const MAX_DRAWN_AIRCRAFT = 3_000;
/** Local feed cells asked for around the centre when the Global snapshot is unavailable. */
const REDUCED_COVERAGE_CELLS = 4;
const DEFAULT_CENTER: [number, number] = [48.5, 2.2];
const NO_AIRCRAFT: LiveAircraft[] = [];
const AIRPORT_CLUSTER_MAX_ZOOM = 9;

// Leaflet paths and canvas glyphs cannot read CSS custom properties, so the
// theme tokens they need are mirrored here (see --aircraft / --accent).
const MAP_COLORS: Record<MapTheme, { aircraft: string; ground: string; accent: string; halo: string; danger: string }> = {
  dark: { aircraft: "#f5f5f7", ground: "#8e8e93", accent: "#2997ff", halo: "#0b0b0c", danger: "#ff453a" },
  light: { aircraft: "#1d1d1f", ground: "#86868b", accent: "#0066cc", halo: "#ffffff", danger: "#d70015" },
};

// Solid top-down silhouettes, drawn nose-up and turned to the nose-east
// convention the shared heading rotation expects.
const AIRLINER_PATH = "M12 1.4c.9 0 1.5.9 1.5 2.3v5.3l8.5 5.1v2.2l-8.5-2.5v4.5l2.2 1.7v1.8L12 20.7l-3.7 1.1v-1.8l2.2-1.7v-4.5L2 16.3v-2.2L10.5 9V3.7c0-1.4.6-2.3 1.5-2.3z";
const LIGHT_PLANE_PATH = "M12 2.2c.7 0 1.2.9 1.2 2.1v5.4l9 1.5v2.1l-9-.9v4.7l1.9 1.4v1.5L12 19.8l-3.1.9v-1.5l1.9-1.4v-4.7l-9 .9v-2.1l9-1.5V4.3c0-1.2.5-2.1 1.2-2.1z";
// Top-down rotorcraft, drawn nose-east like the plane glyph so the shared
// heading rotation points it where it is flying: main rotor blades, cabin,
// tail boom and tail rotor.
const HELICOPTER_SVG = [
  '<ellipse class="aircraft-svg-fill" cx="13.4" cy="12" rx="4.6" ry="3.1"/>',
  '<path class="aircraft-svg-fill" d="M2.6 11.2h7v1.6h-7z"/>',
  '<path class="aircraft-svg-fill" d="M2 8.8h1.5v6.4H2z"/>',
  '<path class="aircraft-svg-rotor" d="M6.2 5.2 19.8 18.8M6.2 18.8 19.8 5.2"/>',
].join("");

function aircraftIconSvg(kind: AircraftIconKind): string {
  switch (kind) {
    case "helicopter":
      return HELICOPTER_SVG;
    case "glider":
      return '<path d="M2 11.2h20v1.6H2zM11.2 12.8h1.6l1.9 8.2h-1.9l-.8-3.2-.8 3.2H9.3z"/>';
    case "balloon":
      return '<path d="M12 2a6.2 6.2 0 0 1 6.2 6.2c0 3.2-2 5.4-4.2 7.1l-.8.6h-2.4l-.8-.6c-2.2-1.7-4.2-3.9-4.2-7.1A6.2 6.2 0 0 1 12 2Zm-1.2 14h2.4v2.1h-2.4zM9.8 20h4.4v2H9.8z"/>';
    case "small":
      return `<path class="aircraft-svg-fill" transform="rotate(90 12 12)" d="${LIGHT_PLANE_PATH}"/>`;
    case "turboprop":
      return '<g transform="rotate(90 12 12)"><path d="M11 2h2v7l9 3v2l-9-1v6l3 1v2l-4-1-4 1v-2l3-1v-6l-9 1v-2l9-3z"/><path d="M6 7h1v8H6zM17 7h1v8h-1z"/><path class="aircraft-svg-stroke" d="M4 8h5m6 0h5"/></g>';
    case "regional":
      return '<g transform="rotate(90 12 12)"><path d="M12 1l1 3v6l7 5v2l-7-3v5l3 2v1l-4-1-4 1v-1l3-2v-5l-7 3v-2l7-5V4z"/><path d="M8 16h2v4H8zm6 0h2v4h-2z"/></g>';
    case "heavy":
      return '<g transform="rotate(90 12 12)"><path d="M12 1c1 0 2 1 2 3v5l9 6v2l-9-3v4l3 3v2l-5-2-5 2v-2l3-3v-4l-9 3v-2l9-6V4c0-2 1-3 2-3z"/><path d="M5 11h2v5H5zm12 0h2v5h-2z"/></g>';
    case "unknown":
      return '<path d="m21 12-17 6 4-6-4-6z"/>';
    default:
      return `<path class="aircraft-svg-fill" transform="rotate(90 12 12)" d="${AIRLINER_PATH}"/>`;
  }
}

function escapeHtml(value: string): string {
  return value.replace(/[&<>"']/g, (char) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[char] ?? char);
}

interface PlaneIconOptions {
  heading?: number;
  active?: boolean;
  onGround?: boolean;
  icao24?: string;
  kind?: AircraftIconKind;
  aircraftType?: string | null;
  emergency?: boolean;
  label?: { primary: string; secondary: string; logo?: string | null; badge?: AirlineBadge | null; level?: LabelLevel };
  airborne?: boolean;
}

function airlineBadgeHtml(badge: AirlineBadge) {
  return `<span class="airline-badge" style="background:${escapeHtml(badge.color)}">${escapeHtml(badge.text)}</span>`;
}

/** A logo that fails to load gives way to the operator badge, or disappears when there is none. */
function swapLogoForBadge(logo?: HTMLImageElement | null) {
  if (!logo) return;
  const { badgeText, badgeColor } = logo.dataset;
  if (!badgeText || !badgeColor) { logo.remove(); return; }
  logo.insertAdjacentHTML("afterend", airlineBadgeHtml({ text: badgeText, color: badgeColor }));
  logo.remove();
}

function aircraftGlyph(kind: AircraftIconKind, aircraftType?: string | null) {
  const model = aircraftSilhouette(aircraftType);
  kind = model?.kind ?? kind;
  const glyph = model
    ? `<svg viewBox="0 0 64 64" aria-hidden="true"><use href="${model.symbol}"/>${model.rotor ? `<use href="${model.rotor.symbol}" class="aircraft-model-rotor" style="transform-origin:${model.rotor.cx}px ${model.rotor.cy}px"/>` : ""}</svg>`
    : `<svg viewBox="0 0 24 24" aria-hidden="true">${aircraftIconSvg(kind)}</svg>`;
  return { model, glyph, kind };
}

function planeIcon({ heading = 0, active = false, onGround = false, icao24, kind = "airliner", aircraftType, emergency = false, label, airborne = false }: PlaneIconOptions) {
  const { model, glyph, kind: resolvedKind } = aircraftGlyph(kind, aircraftType);
  kind = resolvedKind;
  const labelHtml = label
    ? `<span class="aircraft-label label-level-${label.level ?? 3}">${label.logo ? `<img class="airline-logo" src="${escapeHtml(label.logo)}" alt="" width="20" height="20" referrerpolicy="no-referrer"${label.badge ? ` data-badge-text="${escapeHtml(label.badge.text)}" data-badge-color="${escapeHtml(label.badge.color)}"` : ""} />` : label.badge ? airlineBadgeHtml(label.badge) : ""}<b>${escapeHtml(label.primary)}</b><i>${escapeHtml(label.secondary)}</i></span>`
    : "";
  return L.divIcon({
    className: `aircraft-marker-wrap${active ? " aircraft-marker-selected" : ""}`,
    html: `<span class="aircraft-marker kind-${kind}${model ? " aircraft-model" : ""} ${active ? "active" : ""} ${onGround ? "ground" : ""} ${airborne ? "airborne" : ""} ${emergency ? "emergency" : ""}" data-aircraft-kind="${kind}"${model ? ` data-aircraft-model="${model.id}" data-aircraft-match="${model.match}"` : ""}${icao24 ? ` data-icao24="${icao24}"` : ""} style="--heading:${Number.isFinite(heading) ? heading : 0}deg">${glyph}</span>${labelHtml}`,
    iconSize: [30, 30],
    iconAnchor: [15, 15],
  });
}

function airportPinIcon(airport: Airport, active: boolean) {
  return L.divIcon({
    className: "airport-pin-wrap",
    html: `<span class="airport-pin${active ? " active" : ""}"><i></i><b>${escapeHtml(airport.iata || airport.icao)}</b></span>`,
    iconSize: [24, 24],
    iconAnchor: [12, 12],
  });
}

/**
 * Leaflet attaches layer event handlers in an effect. On Firefox a marker can
 * become clickable before that effect runs (especially while the map is
 * settling after a viewport change). A single capture listener on the map
 * container closes that small gap and also prevents the click from turning
 * into an accidental map drag. The marker keeps its regular Leaflet handler
 * for normal interactions; this is only an early, delegated fallback.
 */
function AircraftSelectionBridge({ aircraft, onSelect }: {
  aircraft: LiveAircraft[];
  onSelect: (flight: Flight) => void;
}) {
  const map = useMap();
  const aircraftRef = useRef(new Map<string, LiveAircraft>());
  const lastSelectionRef = useRef<{ icao24: string; at: number } | null>(null);
  // Keep the ref current during render so a click that lands in the same
  // commit as a new marker already has a flight to resolve.
  const aircraftByHex = useMemo(() => {
    const next = new Map<string, LiveAircraft>();
    for (const item of aircraft) next.set(item.icao24, item);
    return next;
  }, [aircraft]);
  aircraftRef.current = aircraftByHex;

  useLayoutEffect(() => {
    const container = map.getContainer();
    const selectFromEvent = (event: Event) => {
      const target = event.target;
      if (!(target instanceof Element)) return;
      const marker = target.closest<HTMLElement>(".aircraft-marker[data-icao24]");
      const icao24 = marker?.dataset.icao24;
      if (!icao24) return;
      const current = aircraftRef.current.get(icao24);
      if (!current) return;
      const now = performance.now();
      const last = lastSelectionRef.current;
      if (last && last.icao24 === icao24 && now - last.at < 180) return;
      lastSelectionRef.current = { icao24, at: now };
      event.preventDefault();
      event.stopPropagation();
      onSelect(liveAircraftToFlight(current));
    };

    // mousedown is deliberately included: Playwright and Firefox can dispatch
    // it before Leaflet's own click effect has been installed.
    container.addEventListener("pointerdown", selectFromEvent, true);
    container.addEventListener("mousedown", selectFromEvent, true);
    container.addEventListener("click", selectFromEvent, true);
    return () => {
      container.removeEventListener("pointerdown", selectFromEvent, true);
      container.removeEventListener("mousedown", selectFromEvent, true);
      container.removeEventListener("click", selectFromEvent, true);
    };
  }, [map, onSelect]);
  return null;
}

function userLocationIcon() {
  return L.divIcon({
    className: "user-location-icon-wrap",
    html: '<span class="user-location-marker" aria-hidden="true"><span class="user-location-dot"></span></span>',
    iconSize: [30, 30],
    iconAnchor: [15, 15],
  });
}

function routeEndpointIcon(kind: "start" | "end", theme: MapTheme) {
  const start = kind === "start";
  const color = start ? MAP_COLORS[theme].ground : MAP_COLORS[theme].accent;
  const path = start
    ? '<path d="M6 21V3m0 0h12l-3 4 3 4H6" />'
    : '<path d="M5 21V3m0 0h13l-3 4 3 4H5m0 0h13v6H5" />';
  return L.divIcon({
    className: "route-endpoint-icon-wrap",
    html: `<span class="route-endpoint-marker route-endpoint-${kind}" style="--endpoint-color:${color}" aria-hidden="true"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round">${path}</svg></span>`,
    iconSize: [26, 26],
    iconAnchor: [13, 13],
  });
}

function updateMarkerObservation(marker: L.Marker, aircraft: LiveAircraft, now: number) {
  const element = marker.getElement();
  if (!element) return;
  const age = positionAge(aircraft, now);
  const state = age == null ? "unknown" : age > 60 ? "delayed" : "recent";
  if (element.dataset.freshness !== state) {
    element.dataset.freshness = state;
  }
  const estimated = String(isPositionEstimated(aircraft, now));
  if (element.dataset.estimated !== estimated) element.dataset.estimated = estimated;
  const title = `View ${aircraft.callsign || aircraft.registration || aircraft.icao24.toUpperCase()} · ${positionAgeLabel(age)} · ${estimated === "true" ? "Estimated map position" : "Reported map position"}`;
  if (element.title !== title) element.title = title;
}

interface AircraftMarkerProps {
  aircraft: LiveAircraft;
  active: boolean;
  selected?: boolean;
  labelLevel?: LabelLevel;
  onSelect: (flight: Flight) => void;
  onHover?: (aircraft: LiveAircraft, pointer: { x: number; y: number }) => void;
  onLeave?: (icao24: string) => void;
  theme?: MapTheme;
  renderer?: L.Renderer;
}

function areMarkersEqual(
  previous: AircraftMarkerProps,
  next: AircraftMarkerProps,
) {
  if (previous.labelLevel !== next.labelLevel || previous.selected !== next.selected || previous.active !== next.active || previous.onSelect !== next.onSelect || previous.theme !== next.theme) return false;
  const a = previous.aircraft;
  const b = next.aircraft;
  // Every poll returns fresh objects, so compare the fields the marker draws
  // rather than identity — otherwise every aircraft re-renders every 15s.
  return a.icao24 === b.icao24
    && a.latitude === b.latitude
    && a.longitude === b.longitude
    && a.time_position === b.time_position
    && a.last_contact === b.last_contact
    && a.true_track === b.true_track
    && a.on_ground === b.on_ground
    && a.airline_code === b.airline_code
    && a.callsign === b.callsign
    && a.registration === b.registration
    && a.baro_altitude === b.baro_altitude
    && a.velocity === b.velocity
    && a.category === b.category
    && a.aircraft_category === b.aircraft_category
    && a.aircraft_type === b.aircraft_type
    && a.aircraft_description === b.aircraft_description
    && a.squawk === b.squawk
    && a.emergency === b.emergency;
}

const AircraftMarker = memo(function AircraftMarker({ aircraft, active, selected, labelLevel = 0, onSelect, onHover, onLeave }: AircraftMarkerProps) {
  const units = useUnits();
  const iconKind = aircraftIconKind(aircraft);
  const heading = aircraft.true_track ?? 0;
  const emergency = emergencyInfo(aircraft) !== null;
  const logo = airlineLogo(aircraft);
  const badge = airlineBadge(aircraft);
  const labelPrimary = aircraft.callsign || aircraft.registration || aircraft.icao24.toUpperCase();
  const labelSecondary = [
    aircraft.baro_altitude != null && !aircraft.on_ground ? flightLevelText(aircraft.baro_altitude, units) : null,
    aircraft.velocity != null && !aircraft.on_ground ? speedText(aircraft.velocity, units).replace(" ", "") : null,
  ].filter(Boolean).join(" · ");
  const icon = useMemo(
    () => planeIcon({ heading, active, onGround: aircraft.on_ground === true, icao24: aircraft.icao24, kind: iconKind, aircraftType: aircraft.aircraft_type, emergency, airborne: aircraft.on_ground === false, label: selected || labelLevel ? { primary: labelPrimary, secondary: labelSecondary, level: selected ? 3 : labelLevel, logo: selected || labelLevel >= 2 ? logo : null, badge: selected || labelLevel >= 2 ? badge : null } : undefined }),
    [aircraft.icao24, aircraft.aircraft_type, aircraft.on_ground, active, selected, labelLevel, iconKind, heading, emergency, labelPrimary, labelSecondary, logo, badge],
  );
  // A fresh fix is already some seconds old when it arrives, so start from
  // where the aircraft is now rather than where it was reported.
  // Only the first position is passed to Leaflet; every later move is made
  // imperatively below so a new fix eases in instead of jumping.
  const initialPosition = useRef<[number, number]>(projectPosition(aircraft, Date.now() / 1000) ?? [aircraft.latitude ?? 0, aircraft.longitude ?? 0]);
  const catchUp = useRef<{ from: [number, number]; startedAt: number } | null>(null);
  // Read through a ref so the handler identity never changes, which keeps
  // Leaflet from detaching and re-attaching listeners on every refresh.
  const aircraftRef = useRef(aircraft);
  aircraftRef.current = aircraft;
  const markerRef = useRef<L.Marker | null>(null);
  const selectAircraft = useCallback(() => {
    onSelect(liveAircraftToFlight(aircraftRef.current));
  }, [onSelect]);
  // Select on press so a progressive tile refresh cannot replace the marker
  // between pointer-down and click-up. Keeping click covers keyboard/synthetic
  // activation while the selection itself is idempotent.
  const eventHandlers = useMemo(() => ({
    mousedown: selectAircraft,
    click: selectAircraft,
    mouseover: (event: L.LeafletMouseEvent) => {
      if (window.matchMedia("(hover: hover) and (pointer: fine)").matches) {
        onHover?.(aircraftRef.current, { x: event.originalEvent.clientX, y: event.originalEvent.clientY });
      }
    },
    mouseout: () => onLeave?.(aircraftRef.current.icao24),
  }), [selectAircraft, onHover, onLeave]);

  useEffect(() => {
    const element = markerRef.current?.getElement();
    element?.setAttribute("aria-label", `View ${labelPrimary}`);
    element?.setAttribute("title", `View ${labelPrimary}`);
    const logo = element?.querySelector<HTMLImageElement>(".airline-logo");
    const hideLogo = () => swapLogoForBadge(logo);
    logo?.addEventListener("error", hideLogo);
    if (logo?.complete && !logo.naturalWidth) hideLogo();
    return () => logo?.removeEventListener("error", hideLogo);
  }, [labelPrimary, icon]);

  useEffect(() => {
    if (markerRef.current) updateMarkerObservation(markerRef.current, aircraft, Date.now() / 1000);
  }, [aircraft, icon]);

  // A new fix pulls the marker from where it is shown to the new estimate over
  // about 1.5 s.
  useEffect(() => {
    const shown = markerRef.current?.getLatLng();
    if (shown) catchUp.current = { from: [shown.lat, shown.lng], startedAt: Date.now() / 1000 };
  }, [aircraft.latitude, aircraft.longitude, aircraft.time_position]);

  // Movement runs on the 10 to 30 fps frame clock and pauses while the page is
  // hidden. Leaflet's own camera animations position markers immediately.
  useEffect(() => subscribeToFrame((now) => {
    const current = aircraftRef.current;
    const marker = markerRef.current;
    if (!marker || current.on_ground) return;
    const projected = projectPosition(current, now);
    const pull = catchUp.current;
    const next = projected && pull ? catchUpPosition(pull.from, projected, now - pull.startedAt) : projected;
    const shown = marker.getLatLng();
    if (next && (next[0] !== shown.lat || next[1] !== shown.lng)) marker.setLatLng(next);
  }), []);

  useEffect(() => subscribeToTick((now) => {
    const marker = markerRef.current;
    if (marker) updateMarkerObservation(marker, aircraftRef.current, now);
  }), []);

  if (aircraft.latitude == null || aircraft.longitude == null) return null;
  return <Marker ref={markerRef} position={initialPosition.current} icon={icon} title={`View ${labelPrimary}`} alt={`View ${labelPrimary}`} eventHandlers={eventHandlers} />;
}, areMarkersEqual);

function TrafficAircraft({ aircraft, selectedId, previewId, labelsEnabled, dense, theme, onSelect, hoverStore }: {
  aircraft: readonly LiveAircraft[]; selectedId: string | null; previewId?: string; labelsEnabled: boolean;
  dense: boolean; theme: MapTheme; onSelect: (flight: Flight) => void; hoverStore: AircraftHoverStore;
}) {
  const map = useMap();
  const canvasRenderer = useMemo(() => new AircraftCanvasRenderer(), []);
  const showHover = useCallback((item: LiveAircraft, pointer: { x: number; y: number }) => {
    const rect = map.getContainer().getBoundingClientRect();
    const point = { x: pointer.x - rect.left, y: pointer.y - rect.top };
    const insets = getSafeInsets(map);
    hoverStore.show({ aircraft: item, x: point.x, y: point.y, width: rect.width, height: rect.height,
      insetLeft: insets.left, insetRight: insets.right });
  }, [hoverStore, map]);
  const leaveHover = useCallback((icao24: string) => hoverStore.hideLater(icao24), [hoverStore]);
  useEffect(() => {
    const clear = () => hoverStore.clear();
    const resume = () => hoverStore.resume();
    map.getContainer().addEventListener("pointermove", resume, { passive: true });
    map.on("movestart zoomstart", clear);
    return () => { map.getContainer().removeEventListener("pointermove", resume); map.off("movestart zoomstart", clear); hoverStore.clear(); };
  }, [hoverStore, map]);
  const [view, setView] = useState(() => ({ zoom: map.getZoom(), bounds: map.getBounds() }));
  useEffect(() => {
    const update = () => setView({ zoom: map.getZoom(), bounds: map.getBounds() });
    map.on("zoomend moveend resize", update);
    return () => { map.off("zoomend moveend resize", update); };
  }, [map]);
  const level = labelsEnabled && !dense ? labelLevelForZoom(view.zoom) : 0;
  const shown = useMemo(() => {
    if (!level) return new Set<string>();
    return placeLabels(aircraft.flatMap(item => {
      if (item.latitude == null || item.longitude == null || !view.bounds.contains([item.latitude, item.longitude])) return [];
      const point = map.latLngToContainerPoint([item.latitude, item.longitude]);
      const selected = item.icao24 === selectedId;
      const detail = selected || level >= 3;
      return [{ id: item.icao24, x: point.x + 18, y: point.y - (detail ? 21 : 14),
        width: detail ? 172 : Math.max(85, (item.callsign || item.registration || item.icao24).length * 8 + (level >= 2 ? 38 : 16)), height: detail ? 44 : 30 }];
    }), selectedId);
  }, [aircraft, level, map, selectedId, view]);
  return <>{aircraft.map(item => dense && item.icao24 !== selectedId
    ? <AircraftCanvasMarker renderer={canvasRenderer} key={item.icao24} aircraft={item} active={item.icao24 === previewId} theme={theme} onSelect={onSelect} onHover={showHover} onLeave={leaveHover} />
    : <AircraftMarker key={item.icao24} aircraft={item} active={item.icao24 === selectedId || item.icao24 === previewId}
      selected={item.icao24 === selectedId} labelLevel={shown.has(item.icao24) ? level : 0} onSelect={onSelect} onHover={showHover} onLeave={leaveHover} />)}</>;
}

const AircraftCanvasMarker = memo(function AircraftCanvasMarker({ aircraft, active, onSelect, onHover, onLeave, renderer, theme = "dark" }: AircraftMarkerProps) {
  const canvasMarkerRef = useRef<L.CircleMarker | null>(null);
  const position = useMemo<[number, number]>(() => [aircraft.latitude ?? 0, aircraft.longitude ?? 0], [aircraft.latitude, aircraft.longitude]);
  // Same encoding as the DOM markers: neutral ink, grey on the ground, blue when selected.
  const color = active ? MAP_COLORS[theme].accent : emergencyInfo(aircraft) ? MAP_COLORS[theme].danger : aircraft.on_ground ? MAP_COLORS[theme].ground : MAP_COLORS[theme].aircraft;
  const old = (positionAge(aircraft, Date.now() / 1000) ?? Infinity) > 60;
  const glyph = aircraftGlyph(aircraftIconKind(aircraft), aircraft.aircraft_type);
  const size = glyph.model ? (glyph.kind === "heavy" || glyph.kind === "glider" ? 27 : glyph.kind === "small" ? 21 : 25) : 20;
  const pathOptions = useMemo<AircraftCanvasStyle>(() => ({
    color, opacity: old ? 0.55 : 1, weight: 1,
    aircraftGlyph: glyph.glyph, aircraftHeading: aircraft.true_track ?? 0,
    aircraftSize: size, aircraftHollow: old,
  }), [aircraft.true_track, color, glyph.glyph, old, size]);
  const aircraftRef = useRef(aircraft);
  aircraftRef.current = aircraft;
  const eventHandlers = useMemo(() => ({
    click: () => onSelect(liveAircraftToFlight(aircraftRef.current)),
    mouseover: (event: L.LeafletMouseEvent) => {
      if (window.matchMedia("(hover: hover) and (pointer: fine)").matches) {
        onHover?.(aircraftRef.current, { x: event.originalEvent.clientX, y: event.originalEvent.clientY });
      }
    },
    mouseout: () => onLeave?.(aircraftRef.current.icao24),
  }), [onSelect, onHover, onLeave]);
  useEffect(() => {
    let wasOld = old;
    return subscribeToTick(now => {
      const nextOld = (positionAge(aircraftRef.current, now) ?? Infinity) > 60;
      if (nextOld === wasOld) return;
      wasOld = nextOld;
      canvasMarkerRef.current?.setStyle({ aircraftHollow: nextOld, opacity: nextOld ? 0.55 : 1 } as AircraftCanvasStyle);
    });
  }, [active, old]);
  if (aircraft.latitude == null || aircraft.longitude == null) return null;
  return <CircleMarker ref={canvasMarkerRef} renderer={renderer} center={position} radius={size / 2 + 2} pathOptions={pathOptions} eventHandlers={eventHandlers} />;
}, areMarkersEqual);

interface BoundsReporterProps { onBounds: (bounds: Bounds, visible: Bounds) => void }
function BoundsReporter({ onBounds }: BoundsReporterProps) {
  const map = useMap();
  useEffect(() => {
    function report(target?: L.LatLngBounds) {
      const bounds = target ?? map.getBounds();
      const visible = {
        lamin: Math.max(-90, bounds.getSouth()),
        lomin: Math.max(-180, bounds.getWest()),
        lamax: Math.min(90, bounds.getNorth()),
        lomax: Math.min(180, bounds.getEast()),
      };
      onBounds(quantizeBounds(expandBounds(visible), 0.25), visible);
    }
    const onMoveEnd = () => report();
    // The camera announces where it is headed before it gets there, so the
    // traffic for the destination loads while the map is still flying.
    const onPrefetch = (event: L.LeafletEvent) => report((event as L.LeafletEvent & { bounds: L.LatLngBounds }).bounds);
    map.on("moveend", onMoveEnd);
    map.on("viewprefetch", onPrefetch);
    const initialTimer = setTimeout(report, 120);
    const observer = new ResizeObserver(() => map.invalidateSize({ pan: false }));
    observer.observe(map.getContainer());
    return () => {
      clearTimeout(initialTimer);
      map.off("moveend", onMoveEnd);
      map.off("viewprefetch", onPrefetch);
      observer.disconnect();
    };
  }, [map, onBounds]);
  return null;
}

/** Map bounds the camera will show once it arrives at `center` and `zoom`. */
function boundsAt(map: L.Map, center: L.LatLng, zoom: number): L.LatLngBounds {
  const half = map.getSize().divideBy(2);
  const middle = map.project(center, zoom);
  return L.latLngBounds(map.unproject(middle.add([-half.x, half.y]), zoom), map.unproject(middle.add([half.x, -half.y]), zoom));
}

interface UserLocation {
  latitude: number;
  longitude: number;
  accuracy: number;
}

interface TrackSegment {
  positions: [number, number][];
  color: string;
}

interface Insets { left: number; top: number; right: number; bottom: number }

function prefersReducedMotion() {
  return window.matchMedia("(prefers-reduced-motion: reduce)").matches;
}

/**
 * Part of the map that no docked panel covers. It is derived from the layout
 * classes and CSS variables rather than from element rectangles, so it is
 * already correct while a panel is still sliding in; measuring the panel
 * mid-animation is what used to send the first camera move to the wrong place.
 */
function getSafeInsets(map: L.Map): Insets {
  const edge = 16;
  const insets: Insets = { left: edge, top: edge, right: edge, bottom: edge };
  const workspace = map.getContainer().closest<HTMLElement>(".workspace");
  if (!workspace || workspace.closest(".map-expanded")) return insets;
  const styles = window.getComputedStyle(workspace);
  const width = (name: string, fallback: number) => {
    const value = Number.parseFloat(styles.getPropertyValue(name));
    return Number.isFinite(value) ? value : fallback;
  };
  if (window.matchMedia("(max-width: 900px)").matches) {
    // Phones show the panels as bottom sheets.
    if (workspace.classList.contains("has-dock") || workspace.classList.contains("traffic-open")) {
      const sheet = workspace.querySelector<HTMLElement>(workspace.classList.contains("has-dock") ? ".details-drawer" : ".traffic-slot");
      insets.bottom += sheet ? sheet.getBoundingClientRect().height : Math.round(map.getSize().y * 0.5);
    }
    return insets;
  }
  insets.top += 52;
  if (workspace.classList.contains("has-dock")) insets.left += width("--dock-width", 392) + edge;
  if (workspace.classList.contains("traffic-open")) insets.right += width("--traffic-width", 360) + edge;
  return insets;
}

/** Map centre that makes `point` land in the middle of the uncovered area. */
function placementCenter(map: L.Map, point: L.LatLngExpression, zoom: number, insets: Insets): L.LatLng {
  const offset = L.point((insets.left - insets.right) / 2, (insets.top - insets.bottom) / 2);
  return map.unproject(map.project(point, zoom).subtract(offset), zoom).wrap();
}

function fitRoute(map: L.Map, track: TrackResponse | undefined, animate: boolean) {
  const path = track?.track.path ?? [];
  const bounds = L.latLngBounds([]);
  for (const point of path) if (Number.isFinite(point[1]) && Number.isFinite(point[2])) bounds.extend([point[1], point[2]]);
  if (!bounds.isValid()) return;
  const insets = getSafeInsets(map);
  map.stop();
  map.flyToBounds(bounds.pad(0.1), {
    animate,
    duration: 1.1,
    easeLinearity: 0.2,
    maxZoom: 9,
    paddingTopLeft: [insets.left, insets.top],
    paddingBottomRight: [insets.right, insets.bottom],
  });
}

function buildAltitudeSegments(path: TrackResponse["track"]["path"] = []): TrackSegment[] {
  const segments: TrackSegment[] = [];
  for (let index = 1; index < path.length; index += 1) {
    const previous = path[index - 1];
    const current = path[index];
    if (!Number.isFinite(previous?.[1]) || !Number.isFinite(previous?.[2]) || !Number.isFinite(current?.[1]) || !Number.isFinite(current?.[2])) continue;

    const previousAltitude = previous[3];
    const currentAltitude = current[3];
    const averageAltitude = previousAltitude != null && currentAltitude != null
      ? (previousAltitude + currentAltitude) / 2
      : previousAltitude ?? currentAltitude;
    const color = altitudeColor(averageAltitude);
    const start: [number, number] = [previous[1], previous[2]];
    const end: [number, number] = [current[1], current[2]];
    const last = segments[segments.length - 1];

    if (last && last.color === color && last.positions[last.positions.length - 1][0] === start[0] && last.positions[last.positions.length - 1][1] === start[1]) {
      last.positions.push(end);
    } else {
      segments.push({ positions: [start, end], color });
    }
  }
  return segments;
}

/**
 * Brings a freshly selected aircraft into view with a single camera move.
 * Already comfortably on screen: the map does not move at all (the way FR24
 * behaves). Close to a panel or an edge: one short pan. Out of reach: one
 * eased flight. The route is drawn without touching the camera afterwards,
 * so a click never produces two competing motions.
 */
function revealPoint(map: L.Map, point: [number, number], animate: boolean) {
  const insets = getSafeInsets(map);
  const size = map.getSize();
  const pixel = map.latLngToContainerPoint(point);
  const safe = { left: insets.left + 56, top: insets.top + 56, right: size.x - insets.right - 56, bottom: size.y - insets.bottom - 56 };
  const inside = pixel.x >= safe.left && pixel.x <= safe.right && pixel.y >= safe.top && pixel.y <= safe.bottom;
  // Preserve the visitor's zoom level on selection. A forced zoom made an
  // ordinary click feel like a second, unrelated camera action.
  const zoom = map.getZoom();
  if (inside && zoom === map.getZoom()) return;
  const target = placementCenter(map, point, zoom, insets);
  map.stop();
  if (zoom === map.getZoom() && map.getCenter().distanceTo(target) < 400_000) {
    map.panTo(target, { animate, duration: 0.7, easeLinearity: 0.25 });
  } else {
    map.flyTo(target, zoom, { animate, duration: 1, easeLinearity: 0.2 });
  }
}

interface MapControllerProps {
  airportFocusRequest: number;
  airport: Airport | null;
  flight: Flight | null;
  track?: TrackResponse;
  fitRequest: number;
  locateRequest: number;
  onLocationFound: (location: UserLocation) => void;
  onLocationError: (message: string) => void;
}

function MapController({ airport, airportFocusRequest, flight, track, fitRequest, locateRequest, onLocationFound, onLocationError }: MapControllerProps) {
  const map = useMap();
  const selection = useRef<{ id: string; fitted: boolean; revealed: boolean } | null>(null);
  const centeredAirport = useRef<string | null>(null);
  const centeredAirportRequest = useRef(-1);
  const lastFitRequest = useRef(fitRequest);

  // The aircraft is revealed once per selection.
  const selectedId = flight ? `${flight.icao24}:${flight.callsign}:${flight.primary_time ?? flight.first_seen ?? 0}:${flight.data_source ?? ""}` : null;
  const selectedLatitude = flight?.latitude;
  const selectedLongitude = flight?.longitude;
  useEffect(() => {
    if (!selectedId) {
      selection.current = null;
      return;
    }
    if (selection.current?.id !== selectedId) selection.current = { id: selectedId, fitted: false, revealed: false };
    if (selection.current.revealed || selectedLatitude == null || selectedLongitude == null) return;
    selection.current.revealed = true;
    revealPoint(map, [selectedLatitude, selectedLongitude], !prefersReducedMotion());
    // Live position updates must not keep pulling the camera away from the user.
  }, [map, selectedId, selectedLatitude, selectedLongitude]);

  // A recorded flight has no position on the map: frame its trace instead.
  useEffect(() => {
    const current = selection.current;
    if (!flight || !current || current.fitted || !track?.track.path?.length) return;
    if (track.track.icao24 && track.track.icao24.toLowerCase() !== flight.icao24.toLowerCase()) return;
    current.fitted = true;
    if (flight.latitude != null && flight.longitude != null) return;
    fitRoute(map, track, !prefersReducedMotion());
  }, [flight, map, track]);

  useEffect(() => {
    if (fitRequest === lastFitRequest.current) return;
    lastFitRequest.current = fitRequest;
    fitRoute(map, track, !prefersReducedMotion());
  }, [fitRequest, map, track]);

  const airportIcao = airport?.icao ?? null;
  const airportLatitude = airport?.latitude;
  const airportLongitude = airport?.longitude;
  useEffect(() => {
    if (!airportIcao || airportLatitude == null || airportLongitude == null || (centeredAirport.current === airportIcao && centeredAirportRequest.current === airportFocusRequest)) return;
    const first = centeredAirport.current === null && airportFocusRequest === 0;
    // A deep link can resolve its airport after its aircraft. Keep the flight
    // camera in charge until the visitor explicitly changes airport.
    if (flight) return;
    centeredAirport.current = airportIcao;
    centeredAirportRequest.current = airportFocusRequest;
    const insets = getSafeInsets(map);
    map.stop();
    if (first) {
      // The first position appears immediately; later changes travel there.
      map.setView(placementCenter(map, [airportLatitude, airportLongitude], 8, insets), 8, { animate: false });
    } else {
      const target = placementCenter(map, [airportLatitude, airportLongitude], 9, insets);
      map.fire("viewprefetch", { bounds: boundsAt(map, target, 9) });
      map.flyTo(target, 9, { animate: !prefersReducedMotion(), duration: 0.9, easeLinearity: 0.2 });
    }
  }, [airportIcao, airportLatitude, airportLongitude, airportFocusRequest, flight, map]);

  useEffect(() => {
    if (!locateRequest) return;
    map.locate({ setView: true, maxZoom: 11, enableHighAccuracy: true });
  }, [locateRequest, map]);

  useEffect(() => {
    function handleLocationFound(event: L.LocationEvent) {
      onLocationFound({
        latitude: event.latlng.lat,
        longitude: event.latlng.lng,
        accuracy: Number.isFinite(event.accuracy) ? event.accuracy : 0,
      });
    }
    function handleLocationError(event: L.ErrorEvent) {
      onLocationError(event.message || "Location is unavailable in this browser.");
    }
    map.on("locationfound", handleLocationFound);
    map.on("locationerror", handleLocationError);
    return () => {
      map.off("locationfound", handleLocationFound);
      map.off("locationerror", handleLocationError);
    };
  }, [map, onLocationError, onLocationFound]);
  return null;
}

/** A single selected label stays readable at every zoom. */
function MapViewClasses({ labelsEnabled }: { labelsEnabled: boolean }) {
  const map = useMap();
  useEffect(() => {
    const container = map.getContainer();
    const apply = () => {
      container.classList.toggle("show-labels", labelsEnabled);
    };
    apply();
    map.on("zoomend", apply);
    const cameraStart = () => container.classList.add("map-camera-moving");
    const cameraEnd = () => container.classList.remove("map-camera-moving");
    map.on("movestart zoomstart", cameraStart);
    map.on("moveend", cameraEnd);
    return () => {
      map.off("zoomend", apply);
      map.off("movestart zoomstart", cameraStart);
      map.off("moveend", cameraEnd);
      container.classList.remove("show-labels", "show-label-detail");
      container.classList.remove("map-camera-moving");
    };
  }, [labelsEnabled, map]);
  return null;
}

function AirportPins({ airports, activeIcao, onSelect }: { airports: Airport[]; activeIcao: string | null; onSelect: (airport: Airport) => void }) {
  const map = useMap();
  const [viewport, setViewport] = useState(() => ({ zoom: map.getZoom(), bounds: map.getBounds() }));
  useEffect(() => {
    const update = () => setViewport({ zoom: map.getZoom(), bounds: map.getBounds() });
    map.on("moveend zoomend", update);
    return () => { map.off("moveend zoomend", update); };
  }, [map]);
  const groups = useMemo(() => {
    const bounds = viewport.bounds.pad(0.1);
    const visible = airports.filter((airport) => airport.latitude != null && airport.longitude != null
      && bounds.contains([airport.latitude, airport.longitude]));
    if (viewport.zoom >= AIRPORT_CLUSTER_MAX_ZOOM) return visible.map((airport) => [airport]);
    const active = visible.filter((airport) => airport.icao === activeIcao);
    return [...active.map((airport) => [airport]), ...groupAirports(visible.filter((airport) => airport.icao !== activeIcao),
      (airport) => map.project([airport.latitude!, airport.longitude!], viewport.zoom))];
  }, [airports, activeIcao, map, viewport]);
  return <>
    {groups.map((group) => group.length === 1 ? (
      <AirportPin key={group[0].icao} airport={group[0]} active={group[0].icao === activeIcao} onSelect={onSelect} />
    ) : <AirportCluster key={group.map((airport) => airport.icao).join(",")} airports={group} />)}
  </>;
}

function AirportCluster({ airports }: { airports: Airport[] }) {
  const map = useMap();
  const bounds = useMemo(() => L.latLngBounds(airports.map((airport) => [airport.latitude!, airport.longitude!] as [number, number])), [airports]);
  const icon = useMemo(() => L.divIcon({
    className: "airport-cluster-wrap", html: `<span class="airport-cluster">${airports.length}</span>`,
    iconSize: [32, 32], iconAnchor: [16, 16],
  }), [airports.length]);
  const handlers = useMemo(() => ({ click: () => {
    map.stop();
    const insets = getSafeInsets(map);
    map.flyToBounds(bounds, { animate: !prefersReducedMotion(), duration: 0.7,
      maxZoom: Math.min(9, map.getZoom() + 2),
      paddingTopLeft: [insets.left + 32, insets.top + 32], paddingBottomRight: [insets.right + 32, insets.bottom + 32] });
  } }), [map, bounds]);
  return <Marker position={bounds.getCenter()} icon={icon} eventHandlers={handlers} zIndexOffset={600}
    title={`${airports.length} airports · Zoom to explore`}>
    <Tooltip direction="top" offset={[0, -14]} opacity={1} className="aircraft-tooltip">
      <strong>{airports.length} airports</strong><span>Click to zoom and choose an airport</span>
    </Tooltip>
  </Marker>;
}

function AirportPin({ airport, active, onSelect }: { airport: Airport; active: boolean; onSelect: (airport: Airport) => void }) {
  const icon = useMemo(() => airportPinIcon(airport, active), [airport, active]);
  const handlers = useMemo(() => ({ click: () => onSelect(airport) }), [airport, onSelect]);
  return (
    <Marker position={[airport.latitude!, airport.longitude!]} icon={icon} eventHandlers={handlers} zIndexOffset={active ? 700 : 500} title={`${airport.name} · Arrivals & departures`} alt={`${airport.iata || airport.icao}: arrivals and departures`}>
      <Tooltip direction="top" offset={[0, -6]} opacity={1} className="aircraft-tooltip"><strong>{airport.name}</strong><span>{airport.icao}{airport.iata ? ` · ${airport.iata}` : ""} · Arrivals & departures</span></Tooltip>
    </Marker>
  );
}

/**
 * Progress of the route reveal for one selection, 0 to 1. It reads 0 until the
 * animation starts (so a freshly loaded trace never flashes in full), waits a
 * beat for the camera to settle, then eases in and out.
 */
function useReveal(key: string, ready: boolean, duration: number): number {
  const [state, setState] = useState({ key: "", value: 0 });
  useEffect(() => {
    if (!ready) return;
    if (prefersReducedMotion()) {
      setState({ key, value: 1 });
      return;
    }
    const delay = 220;
    const start = performance.now() + delay;
    let frame = 0;
    const step = (now: number) => {
      const progress = Math.min(1, Math.max(0, (now - start) / duration));
      const eased = progress < 0.5 ? 4 * progress ** 3 : 1 - (-2 * progress + 2) ** 3 / 2;
      setState({ key, value: eased });
      if (progress < 1) frame = requestAnimationFrame(step);
    };
    frame = requestAnimationFrame(step);
    return () => cancelAnimationFrame(frame);
  }, [duration, key, ready]);
  return state.key === key ? state.value : 0;
}

/** Eases 0 to 1 over `duration` ms once `active`; stays at 0 until then. */
function useRamp(active: boolean, duration: number): number {
  const [value, setValue] = useState(0);
  useEffect(() => {
    if (!active) { setValue(0); return; }
    if (prefersReducedMotion()) { setValue(1); return; }
    const start = performance.now();
    let frame = 0;
    const step = (now: number) => {
      const progress = Math.min(1, (now - start) / duration);
      setValue(1 - (1 - progress) ** 2);
      if (progress < 1) frame = requestAnimationFrame(step);
    };
    frame = requestAnimationFrame(step);
    return () => cancelAnimationFrame(frame);
  }, [active, duration]);
  return value;
}

/** The first `fraction` of a trace, ending on a point interpolated inside its last segment. */
function revealPath(points: TrackPoint[], fraction: number): TrackPoint[] {
  if (fraction >= 1 || points.length < 3) return points;
  const position = fraction * (points.length - 1);
  const whole = Math.floor(position);
  const part = position - whole;
  const drawn = points.slice(0, whole + 1);
  const from = points[whole];
  const to = points[whole + 1];
  if (to && part > 0) {
    drawn.push(from.map((value, index) => {
      const next = to[index];
      return typeof value === "number" && typeof next === "number" ? value + (next - value) * part : value;
    }) as unknown as TrackPoint);
  }
  return drawn;
}

interface SelectedTrackProps {
  flight: Flight;
  track?: TrackResponse;
  live: LiveAircraft | null;
  theme: MapTheme;
  following: boolean;
  onRelease: () => void;
}

/**
 * Everything drawn for the selected aircraft: the altitude-coloured trace
 * (revealed from its start to the aircraft on selection), the trace origin,
 * and the follow camera. It ticks on its own clock so the aircraft's other
 * traffic never re-renders with it.
 */
function SelectedTrack({ flight, track, live, theme, following, onRelease }: SelectedTrackProps) {
  const map = useMap();
  const now = useNowSeconds(true);
  const selectedId = flight.icao24.toLowerCase();
  const head = useMemo<[number, number] | null>(() => {
    if (live) return projectPosition(live, now);
    return flight.latitude != null && flight.longitude != null ? [flight.latitude, flight.longitude] : null;
  }, [flight.latitude, flight.longitude, live, now]);

  const basePoints = useMemo<TrackPoint[]>(() => {
    if (track?.track.icao24 && track.track.icao24.toLowerCase() !== selectedId) return [];
    return (track?.track.path ?? []).filter((point) => Number.isFinite(point[1]) && Number.isFinite(point[2]));
  }, [selectedId, track]);

  // Long traces take a little longer to draw, within a calm range.
  const revealDuration = Math.min(2200, 1200 + basePoints.length * 2);
  const fraction = useReveal(`${selectedId}:${track?.track.icao24 ?? ""}`, basePoints.length > 1, revealDuration);
  const drawnBase = useMemo(() => revealPath(basePoints, fraction), [basePoints, fraction]);
  // The line also fades in over the first part of the reveal.
  const fade = Math.min(1, fraction * 4);
  // The stretch up to the aircraft joins in once the trace is complete, fading
  // in rather than popping.
  const headFade = useRamp(fraction >= 1, 450);
  const baseSegments = useMemo(() => buildAltitudeSegments(drawnBase), [drawnBase]);
  const lastBase = basePoints[basePoints.length - 1];
  // The last stretch joins the end of the trace to the aircraft's position now.
  const headSegment = useMemo<TrackSegment | null>(() => {
    if (!head || !lastBase || fraction < 1) return null;
    const altitude = live?.baro_altitude ?? lastBase[3];
    return { positions: [[lastBase[1], lastBase[2]], head], color: altitudeColor(altitude) };
  }, [fraction, head, lastBase, live?.baro_altitude]);
  // The halo under the long trace only changes while it is revealed; the
  // one-second head stretch gets its own short halo so a live tick never
  // copies and re-projects the whole trace.
  const halo = useMemo<[number, number][]>(() => drawnBase.map((point) => [point[1], point[2]] as [number, number]), [drawnBase]);
  const firstPoint = basePoints[0];
  const haloOptions = useMemo(() => ({ color: MAP_COLORS[theme].halo, weight: 8, opacity: 0.7 * fade, lineCap: "round" as const, lineJoin: "round" as const }), [fade, theme]);
  const startIcon = useMemo(() => routeEndpointIcon("start", theme), [theme]);
  const units = useUnits();
  const fallbackMarkerRef = useRef<L.Marker | null>(null);
  const fallbackIcon = useMemo(
    () => planeIcon({ heading: flight.true_track ?? 0, active: true, onGround: flight.on_ground === true, icao24: flight.icao24, kind: aircraftIconKind(flight), aircraftType: flight.aircraft_type, airborne: flight.on_ground === false, label: { primary: flight.callsign || flight.registration || flight.icao24.toUpperCase(), secondary: [flight.baro_altitude != null ? flightLevelText(flight.baro_altitude, units) : null, flight.velocity != null ? speedText(flight.velocity, units) : null].filter(Boolean).join(" · "), logo: airlineLogo(flight), badge: airlineBadge(flight) } }),
    [flight, units],
  );
  useEffect(() => {
    const logo = fallbackMarkerRef.current?.getElement()?.querySelector<HTMLImageElement>(".airline-logo");
    const hideLogo = () => swapLogoForBadge(logo);
    logo?.addEventListener("error", hideLogo);
    if (logo?.complete && !logo.naturalWidth) hideLogo();
    return () => logo?.removeEventListener("error", hideLogo);
  }, [fallbackIcon, live]);

  const projection = headingProjection(live ?? flight, now, head);
  const futurePath = destinationGuide({ ...flight, ...live }, now, head);
  const projectionRenderer = useMemo(() => L.svg({ padding: 0.5 }), []);
  const arrowIcon = useMemo(() => L.divIcon({ className: "heading-arrow-wrap",
    html: `<span class="heading-arrow" style="transform:rotate(${(live?.true_track ?? flight.true_track ?? 0) - 90}deg);color:${MAP_COLORS[theme].accent}"><svg viewBox="0 0 20 20"><path d="m5 4 9 6-9 6" fill="none" stroke="currentColor" stroke-width="2"/></svg></span>`,
    iconSize: [20, 20], iconAnchor: [10, 10] }), [live?.true_track, flight.true_track, theme]);

  const followStarted = useRef(false);
  useEffect(() => {
    if (!following) {
      followStarted.current = false;
      return;
    }
    const container = map.getContainer();
    const stopForManualMapUse = (event: PointerEvent) => {
      if (event.target instanceof Element && event.target.closest(".aircraft-marker-wrap, .airport-pin-wrap")) return;
      // Leaflet can ignore dragstart during an animated follow pan. Give the
      // pointer back to the visitor as soon as they interact with the map.
      map.stop();
      onRelease();
    };
    container.addEventListener("pointerdown", stopForManualMapUse, true);
    map.on("dragstart", onRelease);
    return () => {
      container.removeEventListener("pointerdown", stopForManualMapUse, true);
      map.off("dragstart", onRelease);
    };
  }, [following, map, onRelease]);
  useEffect(() => {
    if (!following || !head) return;
    const animate = !prefersReducedMotion();
    const insets = getSafeInsets(map);
    if (!followStarted.current) {
      // First frame: close in on the aircraft, then only pan along with it.
      followStarted.current = true;
      const zoom = Math.max(map.getZoom(), 9);
      map.stop();
      map.flyTo(placementCenter(map, head, zoom, insets), zoom, { animate, duration: 0.9 });
      return;
    }
    // One second of linear pan per one-second tick keeps the aircraft still on screen.
    map.panTo(placementCenter(map, head, map.getZoom(), insets), { animate, duration: 1, easeLinearity: 1, noMoveStart: true });
  }, [following, head, map]);

  return (
    <>
      {futurePath ? <Polyline positions={futurePath} renderer={projectionRenderer} pathOptions={{ className: "estimated-future-path", color: theme === "dark" ? "#a1a1a6" : "#515154", weight: 2, dashArray: "10 12", opacity: 0.8, interactive: true }}>
        <Tooltip sticky className="aircraft-tooltip">Estimated direct line to destination · not a filed route</Tooltip>
      </Polyline> : projection && <>
        <Polyline positions={projection} renderer={projectionRenderer} pathOptions={{ className: "heading-projection", color: MAP_COLORS[theme].accent, weight: 2, dashArray: "5 7", opacity: 0.8 }}>
          <Tooltip sticky className="aircraft-tooltip">Estimated heading · next 2 min</Tooltip>
        </Polyline>
        <Marker position={projection[1]} icon={arrowIcon} keyboard={false} interactive={false} />
      </>}
      {halo.length > 1 && <Polyline positions={halo} pathOptions={haloOptions} />}
      {headSegment && <Polyline positions={headSegment.positions} pathOptions={{ ...haloOptions, opacity: haloOptions.opacity * headFade }} />}
      {baseSegments.map((segment, index) => (
        <Polyline key={`${segment.color}-${index}`} positions={segment.positions} pathOptions={{ color: segment.color, weight: 3.5, opacity: 0.96 * fade, lineCap: "round", lineJoin: "round" }} />
      ))}
      {headSegment && <Polyline positions={headSegment.positions} pathOptions={{ className: "estimated-position-segment", dashArray: "5 7", color: headSegment.color, weight: 3.5, opacity: 0.96 * headFade, lineCap: "round", lineJoin: "round" }} />}
      {firstPoint && basePoints.length > 1 && fade > 0.5 && (
        <Marker position={[firstPoint[1], firstPoint[2]]} icon={startIcon} keyboard={false}>
          <Tooltip direction="top" offset={[0, -8]} opacity={1} className="aircraft-tooltip"><strong>Trace start</strong><span className="mono">{formatAltitude(firstPoint[3])}</span></Tooltip>
        </Marker>
      )}
      {!live && head && <Marker ref={fallbackMarkerRef} position={head} icon={fallbackIcon} keyboard={false} />}
    </>
  );
}

interface FlightMapProps {
  airportFocusRequest?: number;
  readingDetails?: boolean;
  airport: Airport | null;
  airports?: Airport[];
  nearbyAirports?: Airport[];
  airportCatalogLoading?: boolean;
  airportCatalogError?: boolean;
  onRetryAirportCatalog?: () => void;
  selectedFlight: Flight | null;
  previewFlight?: Flight | null;
  track?: TrackResponse;
  theme: MapTheme;
  filters: MapFilters;
  labelsEnabled: boolean;
  /** Faint lines through the positions this page has seen for each aircraft. */
  trailsEnabled?: boolean;
  liveEnabled: boolean;
  liveAvailable: boolean;
  liveProbePending?: boolean;
  expanded: boolean;
  onToggleLive: () => void;
  onToggleExpanded: () => void;
  onSelectFlight: (flight: Flight) => void;
  onSelectAirport?: (airport: Airport) => void;
  onLiveSnapshot?: (data: LiveFlightsResponse, airportIcao: string | null) => void;
  /** Why the live feed is degraded, so the list can name the real cause. */
  onLiveCause?: (cause: LiveCause | null) => void;
  onViewportCenter?: (center: [number, number]) => void;
  /** A shared map position to open on instead of the home airport. */
  initialView?: MapView | null;
  /** Reports the settled centre and zoom after every pan or zoom. */
  onViewChange?: (view: MapView) => void;
  /** The visitor's position once they share it with "Locate me". */
  onUserLocation?: (position: [number, number]) => void;
}

interface ProgressiveLiveState {
  data: LiveFlightsResponse | null;
  fetching: boolean;
  loadedTiles: number;
  totalTiles: number;
  failedTiles: number;
  error: string | null;
  /** Why the live feed is degraded, or null while it is healthy. */
  cause?: LiveCause | null;
  /** Only Local feed cells answered because the Global snapshot was unavailable. */
  reducedCoverage?: boolean;
}

/** The last Global snapshot: never erased, replaced only by a newer one. */
interface KeptSnapshot {
  states: LiveAircraft[];
  /** Age of the snapshot when it reached the browser, and when that was. */
  ageSeconds: number;
  receivedAt: number;
}

export function FlightMap({
  airport,
  airportFocusRequest = 0,
  readingDetails = false,
  airports = [],
  nearbyAirports = [],
  airportCatalogLoading = false,
  airportCatalogError = false,
  onRetryAirportCatalog,
  selectedFlight,
  previewFlight = null,
  track,
  theme,
  filters,
  labelsEnabled,
  trailsEnabled = false,
  liveEnabled,
  liveAvailable,
  liveProbePending = false,
  expanded,
  onToggleLive,
  onToggleExpanded,
  onSelectFlight,
  onSelectAirport,
  onLiveSnapshot,
  onLiveCause,
  onViewportCenter,
  initialView = null,
  onViewChange,
  onUserLocation,
}: FlightMapProps) {
  const isMobile = useMediaQuery("(max-width: 900px)");
  const hoverStore = useMemo(() => new AircraftHoverStore(), []);
  const selectFlightAndCloseHover = useCallback((flight: Flight) => {
    // Camera movement can enter another icon under a stationary pointer.
    // A real pointer move re-enables previews after selection.
    hoverStore.suspend();
    onSelectFlight(flight);
  }, [hoverStore, onSelectFlight]);
  const [map, setMap] = useState<L.Map | null>(null);
  const appliedInitialView = useRef(false);
  useEffect(() => {
    if (!map || !initialView || appliedInitialView.current) return;
    appliedInitialView.current = true;
    map.setView([initialView.latitude, initialView.longitude], initialView.zoom, { animate: false });
  }, [initialView, map]);
  useEffect(() => {
    if (!map || !onViewChange) return;
    const report = () => {
      const center = map.getCenter();
      onViewChange({ latitude: center.lat, longitude: center.lng, zoom: map.getZoom() });
    };
    map.on("moveend", report);
    return () => { map.off("moveend", report); };
  }, [map, onViewChange]);
  const [bounds, setBounds] = useState<Bounds | null>(null);
  // What the visitor actually sees, as opposed to the padded box requested.
  const visibleBoundsRef = useRef<Bounds | null>(null);
  const [visibleBounds, setVisibleBounds] = useState<Bounds | null>(null);
  const handleBounds = useCallback((next: Bounds, visible: Bounds) => {
    visibleBoundsRef.current = visible;
    setVisibleBounds(current => boundsEqual(current, visible) ? current : visible);
    setBounds((current) => (boundsEqual(current, next) ? current : next));
  }, []);
  useEffect(() => {
    if (bounds) onViewportCenter?.([(bounds.lamin + bounds.lamax) / 2, (bounds.lomin + bounds.lomax) / 2]);
  }, [bounds, onViewportCenter]);
  const [locateRequest, setLocateRequest] = useState(0);
  const [fitRequest, setFitRequest] = useState(0);
  // Follow keeps the selected aircraft centred as it moves, like FR24's
  // follow mode. It ends when the user drags the map or picks another aircraft.
  const [followingIcao24, setFollowingIcao24] = useState<string | null>(null);
  const releaseFollow = useCallback(() => setFollowingIcao24(null), []);
  const followedIcao24 = selectedFlight?.icao24;
  const following = Boolean(followedIcao24 && followingIcao24 === followedIcao24);
  const toggleFollowing = useCallback(() => {
    setFollowingIcao24((current) => current === followedIcao24 ? null : followedIcao24 ?? null);
  }, [followedIcao24]);
  const aircraftCacheRef = useRef(new Map<string, LiveAircraft>());
  const aircraftCacheSeenAtRef = useRef(new Map<string, number>());
  const viewportCacheRef = useRef(new Map<string, ViewportCacheEntry>());
  const [liveRefresh, setLiveRefresh] = useState(0);
  // A hidden tab skips its refresh rounds: nobody sees them and each one
  // spends provider quota. The skipped round runs as soon as the tab returns.
  const refreshSkippedRef = useRef(false);
  const requestLiveRefresh = useCallback(() => {
    if (document.hidden) refreshSkippedRef.current = true;
    else setLiveRefresh((value) => value + 1);
  }, []);
  useEffect(() => {
    function resume() {
      if (document.hidden || !refreshSkippedRef.current) return;
      refreshSkippedRef.current = false;
      setLiveRefresh((value) => value + 1);
    }
    document.addEventListener("visibilitychange", resume);
    // Back online: refresh now rather than waiting out the retry timer.
    window.addEventListener("online", requestLiveRefresh);
    return () => {
      document.removeEventListener("visibilitychange", resume);
      window.removeEventListener("online", requestLiveRefresh);
    };
  }, [requestLiveRefresh]);
  const [liveState, setLiveState] = useState<ProgressiveLiveState>({
    data: null,
    fetching: false,
    loadedTiles: 0,
    totalTiles: 0,
    failedTiles: 0,
    error: null,
  });
  const [userLocation, setUserLocation] = useState<UserLocation | null>(null);
  const [nearbyOpen, setNearbyOpen] = useState(false);
  const [guideDismissed, setGuideDismissed] = useState(() => {
    try { return localStorage.getItem("skytrace.mapGuideDismissed") === "1"; } catch { return false; }
  });
  const dismissGuide = useCallback(() => {
    setGuideDismissed(true);
    try { localStorage.setItem("skytrace.mapGuideDismissed", "1"); } catch { /* storage unavailable */ }
  }, []);
  const [locationError, setLocationError] = useState<string | null>(null);
  const airportIcaoRef = useRef<string | null>(airport?.icao ?? null);
  // The last complete private request: while it is fresh, panning inside it
  // needs no network at all.
  const coverageRef = useRef<{ bounds: Bounds; until: number } | null>(null);
  const handledRefreshRef = useRef(0);
  const keptSnapshotRef = useRef<KeptSnapshot | null>(null);
  const degradationRef = useRef<{ cause: LiveCause | null; reducedCoverage: boolean }>({ cause: null, reducedCoverage: false });
  useEffect(() => {
    airportIcaoRef.current = airport?.icao ?? null;
  }, [airport?.icao]);
  useEffect(() => {
    if (!bounds || !liveAvailable || !liveEnabled) return;
    const controller = new AbortController();
    // A close-up view fits one or two cells of the public ADS-B feed, which
    // answers in a fraction of a second (the Local feed). Anything wider is
    // covered by the shared Global snapshot, one request for the whole world
    // (ADR 0008): no tiling, no per-cell cadence.
    const wideView = viewportTileCount(bounds) > 2;
    const tiles = wideView ? [bounds] : splitBoundsIntoTiles(bounds);
    const totalViewportTiles = tiles.length;
    const forcedRefresh = handledRefreshRef.current !== liveRefresh;
    handledRefreshRef.current = liveRefresh;
    const viewportKey = viewportCacheKey(bounds);
    const now = Date.now();
    const staleBefore = now - LIVE_AIRCRAFT_CACHE_TTL_MS;
    for (const [icao24, seenAt] of aircraftCacheSeenAtRef.current) {
      if (seenAt < staleBefore) {
        aircraftCacheSeenAtRef.current.delete(icao24);
        aircraftCacheRef.current.delete(icao24);
      }
    }
    // Expire both the identifier cache and the per-viewport snapshots from
    // the same clock. A failed refresh may keep a snapshot visible, but it
    // must not extend its freshness window indefinitely.
    pruneExpiredViewportCache(viewportCacheRef.current, staleBefore);
    const cachedViewport = viewportCacheRef.current.get(viewportKey);
    const retained = new Map<string, LiveAircraft>();
    // Restore a previously visited viewport before making a network request.
    // It is deliberately short-lived: the response below remains authoritative
    // and replaces stale rows as soon as the provider answers.
    for (const aircraft of cachedViewport?.states ?? []) {
      if (!isAircraftInBounds(aircraft, bounds)) continue;
      retained.set(aircraft.icao24, aircraft);
      aircraftCacheRef.current.set(aircraft.icao24, aircraft);
      if (!aircraftCacheSeenAtRef.current.has(aircraft.icao24)) {
        aircraftCacheSeenAtRef.current.set(aircraft.icao24, cachedViewport?.cachedAt ?? now);
      }
    }
    for (const aircraft of aircraftCacheRef.current.values()) {
      if (isAircraftInBounds(aircraft, bounds)) retained.set(aircraft.icao24, aircraft);
    }
    // The last Global snapshot is never erased: it outlives the short aircraft
    // cache so a long outage still leaves every known aircraft on the map.
    if (wideView) {
      for (const aircraft of keptSnapshotRef.current?.states ?? []) {
        if (!retained.has(aircraft.icao24) && isAircraftInBounds(aircraft, bounds)) retained.set(aircraft.icao24, aircraft);
      }
    }
    // A refresh timer or retry always goes to the network; a pan inside an
    // area that was loaded moments ago just shows what is already known.
    const visible = visibleBoundsRef.current;
    const coverage = coverageRef.current;
    if (!forcedRefresh && !degradationRef.current.cause && visible && coverage && Date.now() < coverage.until
      && visible.lamin >= coverage.bounds.lamin && visible.lamax <= coverage.bounds.lamax
      && visible.lomin >= coverage.bounds.lomin && visible.lomax <= coverage.bounds.lomax) {
      const covered: LiveFlightsResponse = {
        success: true,
        time: cachedViewport?.time ?? null,
        time_iso: null,
        count: retained.size,
        states: Array.from(retained.values()),
        provider: cachedViewport?.provider,
        coverage_tiles: 1,
        coverage_complete: true,
      };
      setLiveState({ data: covered, fetching: false, loadedTiles: 1, totalTiles: 1, failedTiles: 0, error: null, cause: null, reducedCoverage: false });

      const wait = Math.max(1_000, coverage.until - Date.now());
      const timer = setTimeout(requestLiveRefresh, wait);
      return () => clearTimeout(timer);
    }
    const freshAircraft = new Set<string>();
    const coveredTiles: Bounds[] = [];
    let loadedTiles = 0;
    let failedTiles = 0;
    let latestTime: number | null = cachedViewport?.time ?? null;
    let provider: string | undefined = cachedViewport?.provider;
    let cacheTimestamp: number | null = cachedViewport?.cachedAt ?? null;
    // The Global snapshot says how soon it can be refreshed; the Local feed
    // answers every 20 s at most.
    let refreshAfterSeconds = 20;
    // Carried over until this round says otherwise, so the status does not flicker.
    let cause: LiveCause | null = degradationRef.current.cause;
    let reducedCoverage = degradationRef.current.reducedCoverage;
    let refreshTimer: ReturnType<typeof setTimeout> | undefined;

    const snapshot = (): LiveFlightsResponse => ({
      success: true,
      time: latestTime,
      time_iso: latestTime ? new Date(latestTime * 1000).toISOString() : null,
      count: retained.size,
      states: Array.from(retained.values()),
      provider,
      refresh_after_seconds: refreshAfterSeconds,
      coverage_tiles: loadedTiles,
      coverage_complete: loadedTiles >= totalViewportTiles && failedTiles === 0,
      degraded: failedTiles > 0,
      notice: failedTiles > 0 ? "Some live sectors are delayed. Loaded sectors remain visible." : undefined,
    });

    const rememberAircraft = (states: LiveAircraft[]) => {
      const seenAt = Date.now();
      for (let index = 0; index < states.length; index++) {
        const aircraft = preserveAirframeAppearance(states[index], aircraftCacheRef.current.get(states[index].icao24));
        states[index] = aircraft;
        if (!aircraft.icao24) continue;
        aircraftCacheRef.current.set(aircraft.icao24, aircraft);
        aircraftCacheSeenAtRef.current.set(aircraft.icao24, seenAt);
      }
    };
    const saveViewportCache = () => {
      if (cacheTimestamp == null) return;
      writeViewportCache(viewportCacheRef.current, viewportKey, {
        states: Array.from(retained.values()),
        cachedAt: cacheTimestamp,
        time: latestTime,
        provider,
      });
    };

    setLiveState({
      data: retained.size ? snapshot() : null,
      fetching: true,
      loadedTiles: 0,
      totalTiles: totalViewportTiles,
      failedTiles: 0,
      error: null,
      cause,
      reducedCoverage,
    });

    const loadTile = async (tile: Bounds) => {
      try {
        // If the quick public feed is unavailable, the authenticated call still answers.
        const localCell = (cell: Bounds) => api.liveFlights(cell, controller.signal, true).then((quick) => {
          // The public feed answers "degraded and empty" while it is rate limited.
          if (quick.degraded && quick.states.length === 0) throw new Error("Public feed unavailable");
          return quick;
        }).catch((error) => {
          if (controller.signal.aborted || !liveAvailable || liveProbePending) throw error;
          return api.liveFlights(cell, controller.signal, false);
        });
        let response: LiveFlightsResponse;
        let covered: Bounds[] = [tile];
        if (wideView) {
          try {
            response = await api.globalSnapshot(controller.signal);
            // A degraded answer is the last snapshot, labelled with its real age.
            cause = response.degraded ? causeFromReason(response.degraded_reason) : null;
            reducedCoverage = false;
            keptSnapshotRef.current = { states: response.states, ageSeconds: response.degraded ? response.age_seconds ?? 0 : 0, receivedAt: Date.now() };
          } catch (error) {
            if (controller.signal.aborted) throw error;
            // No snapshot: fall back to a few Local feed cells around the centre.
            cause = causeFromError(error);
            const cells = splitBoundsIntoTiles(tile, REDUCED_COVERAGE_CELLS);
            const answers = await Promise.allSettled(cells.map(localCell));
            const answered = answers.flatMap((answer, index) => answer.status === "fulfilled" ? [{ cell: cells[index], response: answer.value }] : []);
            if (!answered.length) throw error;
            reducedCoverage = true;
            covered = answered.map((item) => item.cell);
            response = { ...answered[0].response, states: answered.flatMap((item) => item.response.states) };
          }
        } else {
          response = await localCell(tile);
        }
        if (controller.signal.aborted) return;
        rememberAircraft(response.states);
        for (const aircraft of response.states) {
          retained.set(aircraft.icao24, aircraft);
          freshAircraft.add(aircraft.icao24);
        }
        loadedTiles += 1;
        coveredTiles.push(...covered);
        latestTime = Math.max(latestTime ?? 0, response.time ?? 0) || latestTime;
        provider = response.provider || provider;
        refreshAfterSeconds = Math.max(refreshAfterSeconds, response.refresh_after_seconds ?? 20);
        cacheTimestamp = Date.now();
        const data = snapshot();
        saveViewportCache();
        setLiveState({ data, fetching: true, loadedTiles, totalTiles: totalViewportTiles, failedTiles, error: null, cause, reducedCoverage });

      } catch (error) {
        if (controller.signal.aborted) return;
        failedTiles += 1;
        cause = wideView ? cause ?? causeFromError(error) : causeFromError(error);
        setLiveState({
          data: retained.size ? snapshot() : null,
          fetching: true,
          loadedTiles,
          totalTiles: totalViewportTiles,
          failedTiles,
          error: error instanceof Error ? error.message : "Live sector unavailable",
          cause,
          reducedCoverage,
        });
      }
    };

    void Promise.all(tiles.map(loadTile)).then(() => {
      if (controller.signal.aborted) return;
      // Prune aircraft inside any tile we actually refreshed this round, even
      // when the viewport is too wide to cover in full: those cells are known
      // current, so anything not re-reported there has genuinely left. Aircraft
      // outside every fetched tile are left untouched rather than guessed at.
      for (const [icao24, aircraft] of retained) {
        if (freshAircraft.has(icao24)) continue;
        if (aircraft.latitude == null || aircraft.longitude == null) continue;
        const insideCoveredTile = coveredTiles.some((tile) => (
          tile.lamin <= aircraft.latitude! && aircraft.latitude! <= tile.lamax
          && tile.lomin <= aircraft.longitude! && aircraft.longitude! <= tile.lomax
        ));
        if (insideCoveredTile) {
          retained.delete(icao24);
          aircraftCacheRef.current.delete(icao24);
          aircraftCacheSeenAtRef.current.delete(icao24);
        }
      }
      saveViewportCache();
      if (!wideView && failedTiles === 0) cause = null;
      degradationRef.current = { cause, reducedCoverage };
      if (failedTiles === 0 && loadedTiles > 0 && !cause) {
        coverageRef.current = { bounds, until: Date.now() + Math.max(20, refreshAfterSeconds) * 1_000 };
      }
      const data = retained.size ? snapshot() : null;
      setLiveState({
        data,
        fetching: false,
        loadedTiles,
        totalTiles: totalViewportTiles,
        failedTiles,
        error: failedTiles && !retained.size ? "Live traffic is temporarily unavailable." : null,
        cause,
        reducedCoverage,
      });
      // A failed or empty round is retried quickly instead of waiting a full
      // refresh interval with a blank or stale map.
      const retrySoon = failedTiles > 0 || retained.size === 0;
      // While degraded, retry gently: the server already holds the last snapshot.
      refreshTimer = setTimeout(requestLiveRefresh, retrySoon ? (cause ? 30_000 : 5_000) : Math.max(cause ? 30 : 20, refreshAfterSeconds) * 1_000);
    });

    return () => {
      controller.abort();
      if (refreshTimer) clearTimeout(refreshTimer);
    };
  }, [bounds, liveAvailable, liveEnabled, liveProbePending, liveRefresh, onLiveSnapshot, requestLiveRefresh]);

  const displayedLiveData = liveState.data;
  const hasLiveSnapshot = Boolean(displayedLiveData?.states.length);
  const displayedLiveStates = useMemo(() => {
    const states = displayedLiveData?.states ?? NO_AIRCRAFT;
    return visibleBounds ? states.filter(aircraft => isAircraftInBounds(aircraft, visibleBounds)) : states;
  }, [displayedLiveData, visibleBounds]);
  useEffect(() => {
    if (displayedLiveData) onLiveSnapshot?.({ ...displayedLiveData, states: displayedLiveStates, count: displayedLiveStates.length }, airportIcaoRef.current);
  }, [displayedLiveData, displayedLiveStates, onLiveSnapshot]);
  const selectedCandidate = useMemo(
    () => selectedFlight ? displayedLiveStates.find(aircraft => aircraft.icao24.toLowerCase() === selectedFlight.icao24.toLowerCase()) ?? null : null,
    [displayedLiveStates, selectedFlight],
  );
  const selectedLive = selectedFlight && selectedCandidate && sameLiveFlight(selectedFlight, selectedCandidate) ? selectedCandidate : null;
  const liveSelection = selectedFlight && selectedFlight.data_source !== "scheduled" && selectedFlight.data_source !== "opensky"
    && (selectedFlight.data_source === "live-nearby" || selectedFlight.primary_time === 0);
  const selectedIcao24 = liveSelection && (!selectedCandidate || selectedLive) ? selectedFlight.icao24.toLowerCase() : null;
  // The filters narrow the map, never the aircraft the user is looking at.
  const visibleStates = useMemo(() => {
    const kept = filterAircraft(displayedLiveStates, filters);
    const withSelected = selectedLive && !kept.includes(selectedLive) ? [...kept, selectedLive] : kept;
    // Until the renderer migration, Leaflet draws a density sample above
    // MAX_DRAWN_AIRCRAFT. The selected, followed and emergency aircraft stay.
    return sampleByDensity(withSelected, MAX_DRAWN_AIRCRAFT, (item) => item === selectedLive || item.icao24 === followingIcao24 || Boolean(emergencyInfo(item)));
  }, [displayedLiveStates, filters, followingIcao24, selectedLive]);
  // A broad viewport can contain thousands of aircraft. Keep the detailed
  // plane icons for normal views, then switch to a lightweight canvas layer so
  // zooming out does not turn every aircraft into a DOM subtree.
  const denseTraffic = visibleStates.length > 750;
  // Trails come from successive live snapshots, so they cost no request and
  // start when the page opens. Only airborne aircraft keep one.
  const trailPointsRef = useRef(new Map<string, [number, number][]>());
  const [trails, setTrails] = useState<Array<{ icao24: string; positions: [number, number][]; color: string }>>([]);
  useEffect(() => {
    if (!trailsEnabled) {
      // Runs on every live refresh while off: keep the same array so the map
      // does not re-render for nothing.
      trailPointsRef.current.clear();
      setTrails((current) => (current.length ? [] : current));
      return;
    }
    const next = new Map<string, [number, number][]>();
    for (const aircraft of displayedLiveStates) {
      if (aircraft.latitude == null || aircraft.longitude == null || aircraft.on_ground) continue;
      const points = trailPointsRef.current.get(aircraft.icao24) ?? [];
      const last = points[points.length - 1];
      const point: [number, number] = [aircraft.latitude, aircraft.longitude];
      const moved = !last || Math.abs(last[0] - point[0]) + Math.abs(last[1] - point[1]) > 0.002;
      next.set(aircraft.icao24, moved ? [...points, point].slice(-TRAIL_POINTS) : points);
    }
    trailPointsRef.current = next;
    setTrails(displayedLiveStates.flatMap((aircraft) => {
      const positions = next.get(aircraft.icao24);
      return positions && positions.length > 1
        ? [{ icao24: aircraft.icao24, positions, color: altitudeColor(aircraft.baro_altitude ?? aircraft.geo_altitude) }]
        : [];
    }));
  }, [displayedLiveStates, trailsEnabled]);
  const filteredCount = filterAircraft(displayedLiveStates, filters).length;
  const hiddenByFilters = displayedLiveStates.length - filteredCount;
  const [statusNow, setStatusNow] = useState(() => Date.now());
  useEffect(() => {
    if (!liveState.cause) return;
    setStatusNow(Date.now());
    const timer = setInterval(() => setStatusNow(Date.now()), 5_000);
    return () => clearInterval(timer);
  }, [liveState.cause]);
  const kept = keptSnapshotRef.current;
  const snapshotAge = kept ? kept.ageSeconds + Math.max(0, statusNow - kept.receivedAt) / 1000 : null;
  const liveStatus = liveState.cause && !(liveState.fetching && liveState.loadedTiles === 0 && !hasLiveSnapshot)
    ? describeLiveStatus({ count: filteredCount, cause: liveState.cause, ageSeconds: snapshotAge, reducedCoverage: Boolean(liveState.reducedCoverage) })
    : liveState.error || liveState.failedTiles > 0
    ? hasLiveSnapshot ? `${filteredCount} aircraft · Refresh delayed · last snapshot kept · ${liveState.loadedTiles}/${liveState.totalTiles} sectors` : "Live traffic temporarily unavailable"
    : liveState.fetching && liveState.loadedTiles === 0
      ? hasLiveSnapshot ? `${filteredCount} aircraft · scanning…` : "Scanning visible airspace…"
      : liveState.fetching
        ? `${filteredCount} aircraft · sector ${Math.min(liveState.loadedTiles + 1, liveState.totalTiles)}/${liveState.totalTiles}`
        : liveState.loadedTiles < liveState.totalTiles
          ? `${filteredCount} aircraft · ${liveState.loadedTiles}/${liveState.totalTiles} sectors shown`
          : `${filteredCount} aircraft`;

  const reportedCause = liveState.cause ?? null;
  useEffect(() => {
    onLiveCause?.(reportedCause);
  }, [onLiveCause, reportedCause]);

  const locationIcon = useMemo(() => userLocationIcon(), []);
  const handleLocationFound = useCallback((location: UserLocation) => {
    setUserLocation(location);
    setLocationError(null);
    onUserLocation?.([location.latitude, location.longitude]);
  }, [onUserLocation]);
  const handleLocationError = useCallback((message: string) => {
    setLocationError(message);
  }, []);
  const requestLocation = useCallback(() => {
    setLocationError(null);
    setLocateRequest((value) => value + 1);
  }, []);
  const closestAirports = useMemo(() => userLocation
    ? nearestAirports(nearbyAirports, [userLocation.latitude, userLocation.longitude]) : [], [nearbyAirports, userLocation]);
  const hasTrace = Boolean(track?.track.path && track.track.path.length > 1);

  useEffect(() => {
    function handleShortcuts(event: KeyboardEvent) {
      if (event.metaKey || event.ctrlKey || event.altKey || !selectedFlight) return;
      if (event.target instanceof Element && event.target.closest("input, textarea, select, [contenteditable='true']")) return;
      if (event.key.toLowerCase() === "f") toggleFollowing();
      else if (event.key.toLowerCase() === "r" && hasTrace) setFitRequest((value) => value + 1);
    }
    window.addEventListener("keydown", handleShortcuts);
    return () => window.removeEventListener("keydown", handleShortcuts);
  }, [hasTrace, selectedFlight, toggleFollowing]);

  return (
    <section className="map-surface" aria-label="Live flight map" inert={readingDetails && isMobile}>
      <MapContainer ref={setMap} center={DEFAULT_CENTER} zoom={6} zoomControl={false} preferCanvas className="leaflet-map">
        <TileLayer
          attribution='&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> | <a href="https://opensky-network.org">OpenSky</a>, <a href="https://adsb.fi">adsb.fi</a>, <a href="https://adsb.lol">adsb.lol</a>'
          url="https://tile.openstreetmap.org/{z}/{x}/{y}.png"
          className={theme === "dark" ? "map-tiles-dark" : "map-tiles-light"}
          key={theme}
          maxZoom={19}
        />
        <BoundsReporter onBounds={handleBounds} />
        <MapViewClasses labelsEnabled={labelsEnabled} />
        <MapController
          airport={airport}
          airportFocusRequest={airportFocusRequest}
          flight={selectedFlight}
          track={track}
          fitRequest={fitRequest}
          locateRequest={locateRequest}
          onLocationFound={handleLocationFound}
          onLocationError={handleLocationError}
        />
        <AircraftSelectionBridge aircraft={displayedLiveStates} onSelect={selectFlightAndCloseHover} />
        {onSelectAirport && <AirportPins airports={airports} activeIcao={airport?.icao ?? null} onSelect={onSelectAirport} />}
        {selectedFlight && selectedFlight.data_source !== "scheduled" && <SelectedTrack flight={selectedFlight} track={track} live={selectedLive} theme={theme} following={following} onRelease={releaseFollow} />}
        {trailsEnabled && !denseTraffic && trails.map((trail) => trail.icao24 === selectedIcao24 ? null : (
          <Polyline key={`trail-${trail.icao24}`} positions={trail.positions} interactive={false} pathOptions={{ color: trail.color, weight: 1.5, opacity: 0.5, lineCap: "round" }} />
        ))}
        <TrafficAircraft aircraft={visibleStates} selectedId={selectedIcao24} previewId={previewFlight?.icao24}
          labelsEnabled={labelsEnabled} dense={denseTraffic} theme={theme} onSelect={selectFlightAndCloseHover} hoverStore={hoverStore} />
        {userLocation && (
          <>
            <Circle
              center={[userLocation.latitude, userLocation.longitude]}
              radius={Math.max(userLocation.accuracy, 20)}
              pathOptions={{ color: MAP_COLORS[theme].accent, weight: 1, opacity: 0.5, fillColor: MAP_COLORS[theme].accent, fillOpacity: 0.08 }}
            />
            <Marker position={[userLocation.latitude, userLocation.longitude]} icon={locationIcon}>
              <Tooltip direction="top" offset={[0, -10]} opacity={1} className="aircraft-tooltip">
                <strong>Your location</strong>
                <span className="mono">Accuracy ±{Math.round(userLocation.accuracy)} m</span>
              </Tooltip>
            </Marker>
          </>
        )}
      </MapContainer>

      <AircraftHoverPreview store={hoverStore} />

      <div className="nearby-airports-control">
        <button type="button" className="toolbar-button" aria-expanded={nearbyOpen} aria-controls="nearby-airports-panel" onClick={() => {
          setNearbyOpen((open) => !open);
          if (!nearbyOpen && !userLocation) requestLocation();
        }}><LocateFixed size={14} aria-hidden="true" />Nearby airports</button>
        {nearbyOpen && <section id="nearby-airports-panel" className="nearby-airports-panel" aria-label="Nearby airports">
          <strong>Airports near you</strong>
          {!userLocation ? <p role="status">{locationError || "Waiting for your location…"}</p>
            : airportCatalogLoading ? <p role="status">Loading airports…</p>
            : airportCatalogError ? <p role="status">Airport catalogue unavailable. <button type="button" onClick={onRetryAirportCatalog}>Retry</button></p>
            : closestAirports.length === 0 ? <p>No geolocated airports available.</p>
            : <><p>From your location{userLocation.accuracy >= 1 ? ` · ±${Math.round(userLocation.accuracy)} m` : ""}</p><ol>{closestAirports.map(({ airport: nearby, distance }) => (
              <li key={nearby.icao}><button type="button" onClick={() => { onSelectAirport?.(nearby); setNearbyOpen(false); }}>
                <span><b>{nearby.iata || nearby.icao}</b><span>{nearby.name}</span></span><small>{distanceText(distance)}</small>
              </button></li>
            ))}</ol></>}
          <button type="button" className="popover-reset" onClick={requestLocation}>{userLocation ? "Update my location" : "Retry location"}</button>
        </section>}
      </div>

      <div className="map-overlay-stack">
      {!guideDismissed && <div className="map-data-guide" onAnimationEnd={(event) => { if (event.target === event.currentTarget.lastElementChild) setGuideDismissed(true); }}>
        <button type="button" className="map-data-guide-close" onClick={dismissGuide} aria-label="Dismiss map hints" title="Dismiss">×</button>
        {denseTraffic ? <span>Dense view · aircraft silhouettes show reported positions. Zoom in for labels.</span> : !labelsEnabled ? <span>Labels are off · enable them in Display.</span> : <span>Zoom in for more aircraft labels.</span>}
        <span>Outlined aircraft = estimated position · faded / hollow = fix older than 60s or age unknown.</span>
        <span className="map-data-guide-timer" aria-hidden="true" />
      </div>}
      {hasTrace && <AltitudeLegend compact className="map-altitude-legend" />}
      <div className={`map-status ${!liveAvailable ? "offline" : !liveEnabled ? "paused" : "active"}`} aria-live="polite">
        <span className={`pulse-dot ${liveEnabled && liveAvailable ? "active" : ""}`} />
        <strong>{!liveAvailable ? "Offline" : !liveEnabled ? "Paused" : "Live"}</strong>
        <span className="map-status-copy">{!liveAvailable ? "Live traffic unavailable" : !liveEnabled ? "Live traffic paused" : liveStatus}</span>
        {hiddenByFilters > 0 && <span className="map-status-filter">{hiddenByFilters} hidden by filters</span>}
        {liveEnabled && liveState.fetching && liveState.totalTiles > 1 && <span className="live-coverage-progress" aria-hidden="true"><span style={{ transform: `scaleX(${Math.max(0.04, liveState.loadedTiles / liveState.totalTiles)})` }} /></span>}
        {liveEnabled && (liveState.error || liveState.failedTiles > 0) && <button type="button" className="live-retry" onClick={() => setLiveRefresh((value) => value + 1)}>Retry</button>}
      </div>
      </div>

      <div className="map-controls" role="group" aria-label="Map controls">
        <div className="map-control-group map-zoom-group">
          <button type="button" onClick={() => map?.zoomIn()} aria-label="Zoom in" title="Zoom in"><Plus size={17} /></button>
          <button type="button" onClick={() => map?.zoomOut()} aria-label="Zoom out" title="Zoom out"><Minus size={17} /></button>
        </div>
        <div className="map-control-group">
          <button type="button" className={userLocation ? "location-active" : ""} onClick={requestLocation} aria-label="Locate me" title={userLocation ? "Update my location" : "Locate me"}><LocateFixed size={17} /></button>
          <button type="button" disabled={!liveAvailable} onClick={onToggleLive} aria-label={liveEnabled ? "Pause live traffic" : "Resume live traffic"} title={liveAvailable ? (liveEnabled ? "Pause live traffic" : "Resume live traffic") : "Live traffic unavailable"}>
            {liveEnabled ? <Pause size={17} /> : <Play size={17} />}
          </button>
          <button type="button" onClick={onToggleExpanded} aria-label={expanded ? "Show panels" : "Hide panels"} title={expanded ? "Show panels" : "Full map"}>
            {expanded ? <Minimize2 size={17} /> : <Maximize2 size={17} />}
          </button>
        </div>
        {selectedFlight && (
          <div className="map-control-group">
            <button
              type="button"
              className={following ? "follow-active" : ""}
              onClick={toggleFollowing}
              aria-pressed={following}
              aria-label={following ? "Stop following aircraft" : "Follow selected aircraft"}
              title={following ? "Stop following (F)" : "Follow aircraft (F)"}
            >
              <Navigation size={16} />
            </button>
            <button type="button" disabled={!hasTrace} onClick={() => setFitRequest((value) => value + 1)} aria-label="Show full route" title="Show full route (R)"><Route size={17} /></button>
          </div>
        )}
      </div>
      {locationError && <div className="location-status" role="status">{locationError}</div>}
    </section>
  );
}
