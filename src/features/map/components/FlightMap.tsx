import { airlineBadge, airlineLogo, type AirlineBadge } from "../../../shared/aircraftIdentity";
import { aircraftGlyph } from "../aircraftGlyph";
import { AircraftHoverStore } from "../aircraftHover";
import { MAP_COLORS } from "../aircraftLayer";
import { AircraftGlLayer } from "./AircraftGlLayer";
import { MapCanvas } from "./MapCanvas";
import { useMapHandle, type MapHandle } from "../mapHandle";
import { focusLabels, labelLevelForZoom, placeLabels, type FocusReason, type LabelLevel } from "../mapLabels";
import { headingProjection } from "../headingProjection";
import { destinationGuide } from "../futurePath";
import { positionAge, positionAgeLabel, sameLiveFlight } from "../../flights/flightTelemetry";
import { useMediaQuery } from "../../../shared/hooks/useMediaQuery";
import { memo, useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import type { LngLatBounds, LayerSpecification, Map as GlMap } from "maplibre-gl";
import { LocateFixed, Maximize2, Minimize2, Navigation, Pause, Play } from "../../../shared/components/icons";
import { Minus, Plus, Route } from "../../../shared/components/customIcons";
import { groupAirports, nearestAirports } from "../airportMap";
import { api } from "../../../shared/api";
import type { Airport, Bounds, Flight, LiveAircraft, LiveFlightsResponse, MapTheme, MapView, TrackPoint, TrackResponse } from "../../../shared/types";
import { newestFix, preserveAirframeAppearance, isAircraftInBounds, LIVE_AIRCRAFT_CACHE_TTL_MS, pruneExpiredViewportCache, viewportCacheKey, writeViewportCache, type ViewportCacheEntry } from "../../flights/liveCache";
import { aircraftIconKind, altitudeColor, emergencyInfo, boundsEqual, expandBounds, formatAltitude, liveAircraftToFlight, quantizeBounds, splitBoundsIntoTiles, viewportTileCount, type AircraftIconKind } from "../../../shared/utils";
import { filterAircraft, type MapFilters } from "../mapFilters";
import { catchUpPosition, isPositionEstimated, projectPosition, subscribeToFrame, subscribeToTick, useNowSeconds } from "../aircraftMotion";
import { causeFromError, causeFromReason, describeLiveStatus, type LiveCause } from "../liveStatus";
import { distanceText, flightLevelText, speedText, useUnits } from "../../../shared/units";
import { boundsAround, circlePolygon, fromGlZoom, mercatorPixel, placementCenter, toGlZoom, visibleBoundsFromEdges, type Insets } from "../mapCamera";
import { useGeoJsonLayers, useOverlayToken } from "../mapLayers";
import { sharedTooltip } from "../mapTooltip";
import { useDomMarker } from "../useDomMarker";
import { AltitudeLegend } from "./AltitudeLegend";
import { AircraftHoverPreview } from "./AircraftHoverPreview";

/** Recent positions kept per aircraft for its trail. */
const TRAIL_POINTS = 8;
/** Local feed cells asked for around the centre when the Global snapshot is unavailable. */
const REDUCED_COVERAGE_CELLS = 4;
/** The Local feed (close zoom) refreshes every 5 to 10 s (ADR 0008). */
const LOCAL_FEED_REFRESH_SECONDS = 8;
const NO_AIRCRAFT: LiveAircraft[] = [];
const AIRPORT_CLUSTER_MAX_ZOOM = 9;

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

/** What a DOM marker is made of: the classes of its element and its inner markup. */
interface MarkerLook { className: string; html: string }

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

const AIRCRAFT_MARKER_SIZE = 30;

function planeIcon({ heading = 0, active = false, onGround = false, icao24, kind = "airliner", aircraftType, emergency = false, label, airborne = false }: PlaneIconOptions): MarkerLook {
  const { model, glyph, kind: resolvedKind } = aircraftGlyph(kind, aircraftType);
  kind = resolvedKind;
  const labelHtml = label
    ? `<span class="aircraft-label label-level-${label.level ?? 3}">${label.logo ? `<img class="airline-logo" src="${escapeHtml(label.logo)}" alt="" width="20" height="20" referrerpolicy="no-referrer"${label.badge ? ` data-badge-text="${escapeHtml(label.badge.text)}" data-badge-color="${escapeHtml(label.badge.color)}"` : ""} />` : label.badge ? airlineBadgeHtml(label.badge) : ""}<b>${escapeHtml(label.primary)}</b><i>${escapeHtml(label.secondary)}</i></span>`
    : "";
  return {
    className: `aircraft-marker-wrap${active ? " aircraft-marker-selected" : ""}`,
    html: `<span class="aircraft-marker kind-${kind}${model ? " aircraft-model" : ""} ${active ? "active" : ""} ${onGround ? "ground" : ""} ${airborne ? "airborne" : ""} ${emergency ? "emergency" : ""}" data-aircraft-kind="${kind}"${model ? ` data-aircraft-model="${model.id}" data-aircraft-match="${model.match}"` : ""}${icao24 ? ` data-icao24="${icao24}"` : ""} style="--heading:${Number.isFinite(heading) ? heading : 0}deg">${glyph}</span>${labelHtml}`,
  };
}

function airportPinIcon(airport: Airport, active: boolean): MarkerLook {
  return {
    className: "airport-pin-wrap",
    html: `<span class="airport-pin${active ? " active" : ""}"><i></i><b>${escapeHtml(airport.iata || airport.icao)}</b></span>`,
  };
}

/**
 * One delegated listener on the map container catches a press on an aircraft
 * marker even while the map is settling after a viewport change, and keeps the
 * press from turning into an accidental map drag. The marker keeps its own
 * handlers for normal interactions; this is only an early, delegated fallback.
 */
function AircraftSelectionBridge({ aircraft, onSelect }: {
  aircraft: LiveAircraft[];
  onSelect: (flight: Flight) => void;
}) {
  const { map } = useMapHandle();
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
    // it before the marker's own click handler has been installed.
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

const USER_LOCATION_LOOK: MarkerLook = {
  className: "user-location-icon-wrap",
  html: '<span class="user-location-marker" aria-hidden="true"><span class="user-location-dot"></span></span>',
};

function routeEndpointIcon(kind: "start" | "end", theme: MapTheme): MarkerLook {
  const start = kind === "start";
  const color = start ? MAP_COLORS[theme].ground : MAP_COLORS[theme].accent;
  const path = start
    ? '<path d="M6 21V3m0 0h12l-3 4 3 4H6" />'
    : '<path d="M5 21V3m0 0h13l-3 4 3 4H5m0 0h13v6H5" />';
  return {
    className: "route-endpoint-icon-wrap",
    html: `<span class="route-endpoint-marker route-endpoint-${kind}" style="--endpoint-color:${color}" aria-hidden="true"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round">${path}</svg></span>`,
  };
}

function updateMarkerObservation(element: HTMLElement | null, aircraft: LiveAircraft, now: number) {
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
  const handle = useMapHandle();
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
  const look = useMemo(
    () => planeIcon({ heading, active, onGround: aircraft.on_ground === true, icao24: aircraft.icao24, kind: iconKind, aircraftType: aircraft.aircraft_type, emergency, airborne: aircraft.on_ground === false, label: selected || labelLevel ? { primary: labelPrimary, secondary: labelSecondary, level: selected ? 3 : labelLevel, logo: selected || labelLevel >= 2 ? logo : null, badge: selected || labelLevel >= 2 ? badge : null } : undefined }),
    [aircraft.icao24, aircraft.aircraft_type, aircraft.on_ground, active, selected, labelLevel, iconKind, heading, emergency, labelPrimary, labelSecondary, logo, badge],
  );
  // A fresh fix is already some seconds old when it arrives, so start from
  // where the aircraft is now rather than where it was reported.
  // Only the first position is given to the marker; every later move is made
  // imperatively below so a new fix eases in instead of jumping.
  const initialPosition = useRef<[number, number]>(projectPosition(aircraft, Date.now() / 1000) ?? [aircraft.latitude ?? 0, aircraft.longitude ?? 0]);
  const catchUp = useRef<{ from: [number, number]; startedAt: number } | null>(null);
  // Read through a ref so the handler identity never changes.
  const aircraftRef = useRef(aircraft);
  aircraftRef.current = aircraft;
  const selectAircraft = useCallback(() => {
    onSelect(liveAircraftToFlight(aircraftRef.current));
  }, [onSelect]);
  // Select on press so a progressive tile refresh cannot replace the marker
  // between pointer-down and click-up. Keeping click covers keyboard/synthetic
  // activation while the selection itself is idempotent.
  const events = useMemo(() => ({
    mousedown: selectAircraft,
    click: selectAircraft,
    mouseover: (event: MouseEvent) => {
      if (window.matchMedia("(hover: hover) and (pointer: fine)").matches) {
        onHover?.(aircraftRef.current, { x: event.clientX, y: event.clientY });
      }
    },
    mouseout: () => onLeave?.(aircraftRef.current.icao24),
  }), [selectAircraft, onHover, onLeave]);
  const visible = aircraft.latitude != null && aircraft.longitude != null;
  const { markerRef, elementRef } = useDomMarker({
    handle, position: initialPosition.current, className: look.className, html: look.html, size: AIRCRAFT_MARKER_SIZE,
    title: `View ${labelPrimary}`, label: `View ${labelPrimary}`, zIndex: selected || active ? 900 : 100, events,
  });

  useEffect(() => {
    const logoElement = elementRef.current?.querySelector<HTMLImageElement>(".airline-logo");
    const hideLogo = () => swapLogoForBadge(logoElement);
    logoElement?.addEventListener("error", hideLogo);
    if (logoElement?.complete && !logoElement.naturalWidth) hideLogo();
    return () => logoElement?.removeEventListener("error", hideLogo);
  }, [labelPrimary, look, elementRef]);

  useEffect(() => {
    updateMarkerObservation(elementRef.current, aircraft, Date.now() / 1000);
  }, [aircraft, look, elementRef]);

  // A new fix pulls the marker from where it is shown to the new estimate over
  // about 1.5 s.
  useEffect(() => {
    const shown = markerRef.current?.getLngLat();
    if (shown) catchUp.current = { from: [shown.lat, shown.lng], startedAt: Date.now() / 1000 };
  }, [aircraft.latitude, aircraft.longitude, aircraft.time_position, markerRef]);

  // Movement runs on the 10 to 30 fps frame clock and pauses while the page is hidden.
  useEffect(() => subscribeToFrame((now) => {
    const current = aircraftRef.current;
    const marker = markerRef.current;
    if (!marker || current.on_ground) return;
    const projected = projectPosition(current, now);
    const pull = catchUp.current;
    const next = projected && pull ? catchUpPosition(pull.from, projected, now - pull.startedAt) : projected;
    const shown = marker.getLngLat();
    if (next && (next[0] !== shown.lat || next[1] !== shown.lng)) marker.setLngLat([next[1], next[0]]);
  }), [markerRef]);

  useEffect(() => subscribeToTick((now) => {
    updateMarkerObservation(elementRef.current, aircraftRef.current, now);
  }), [elementRef]);

  useEffect(() => {
    if (elementRef.current) elementRef.current.hidden = !visible;
  }, [visible, elementRef]);
  return null;
}, areMarkersEqual);

function TrafficAircraft({ aircraft, selectedId, followedId, previewId, labelsEnabled, dense, theme, onSelect, hoverStore }: {
  aircraft: readonly LiveAircraft[]; selectedId: string | null; followedId: string | null; previewId?: string; labelsEnabled: boolean;
  dense: boolean; theme: MapTheme; onSelect: (flight: Flight) => void; hoverStore: AircraftHoverStore;
}) {
  const { map } = useMapHandle();
  const showHover = useCallback((item: LiveAircraft, pointer: { x: number; y: number }) => {
    const rect = map.getContainer().getBoundingClientRect();
    const point = { x: pointer.x - rect.left, y: pointer.y - rect.top };
    const insets = getSafeInsets(map);
    hoverStore.show({ aircraft: item, x: point.x, y: point.y, width: rect.width, height: rect.height,
      insetLeft: insets.left, insetRight: insets.right });
  }, [hoverStore, map]);
  const leaveHover = useCallback((icao24: string) => hoverStore.hideLater(icao24), [hoverStore]);
  useEffect(() => {
    const clear = (event: { follow?: boolean }) => { if (!event.follow) hoverStore.clear(); };
    const resume = () => hoverStore.resume();
    map.getContainer().addEventListener("pointermove", resume, { passive: true });
    map.on("movestart", clear);
    map.on("zoomstart", clear);
    return () => { map.getContainer().removeEventListener("pointermove", resume); map.off("movestart", clear); map.off("zoomstart", clear); hoverStore.clear(); };
  }, [hoverStore, map]);
  const [view, setView] = useState(() => ({ zoom: fromGlZoom(map.getZoom()), bounds: map.getBounds(), center: map.getCenter() }));
  useEffect(() => {
    const update = () => setView({ zoom: fromGlZoom(map.getZoom()), bounds: map.getBounds(), center: map.getCenter() });
    map.on("zoomend", update);
    map.on("moveend", update);
    map.on("resize", update);
    return () => { map.off("zoomend", update); map.off("moveend", update); map.off("resize", update); };
  }, [map]);
  // Focus labels: only the selected and followed aircraft, emergencies and the few aircraft
  // nearest the centre carry a label; every other aircraft stays a plain silhouette.
  const level = labelLevelForZoom(view.zoom);
  const labelled = useMemo(() => {
    if (!labelsEnabled) return new Map<string, LabelLevel>();
    const focus = focusLabels({ aircraft, selectedId, followedId, center: view.center, zoom: view.zoom,
      inView: item => containsPoint(view.bounds, item.latitude!, item.longitude!) });
    const byId = new Map(aircraft.map(item => [item.icao24, item]));
    const priority: Record<FocusReason, number> = { selected: 4, followed: 3, emergency: 2, nearest: 1 };
    const kept = placeLabels(focus.flatMap(({ id, reason }) => {
      const item = byId.get(id)!;
      if (item.latitude == null || item.longitude == null) return [];
      const point = map.project([item.longitude, item.latitude]);
      const detail = id === selectedId || level >= 3;
      return [{ id, priority: priority[reason], x: point.x + 18, y: point.y - (detail ? 21 : 14),
        width: detail ? 172 : Math.max(85, (item.callsign || item.registration || item.icao24).length * 8 + (level >= 2 ? 38 : 16)), height: detail ? 44 : 30 }];
    }), selectedId);
    return new Map([...kept].map(id => [id, id === selectedId ? 3 : Math.max(1, level) as LabelLevel]));
  }, [aircraft, followedId, labelsEnabled, level, map, selectedId, view]);
  // Aircraft with a label or the selection keep a detailed marker; the rest are silhouettes.
  const detailedIds = useMemo(() => new Set([...labelled.keys(), ...(selectedId ? [selectedId] : [])]), [labelled, selectedId]);
  const detailed = dense ? aircraft.filter(item => detailedIds.has(item.icao24)) : aircraft;
  return <>{dense && <AircraftGlLayer aircraft={aircraft} theme={theme} previewId={previewId ?? null} excludeId={selectedId} excludeIds={detailedIds}
    onSelect={onSelect} onHover={showHover} onLeave={leaveHover} />}
    {detailed.map(item => <AircraftMarker key={item.icao24} aircraft={item} active={item.icao24 === selectedId || item.icao24 === previewId}
      selected={item.icao24 === selectedId} labelLevel={labelled.get(item.icao24) ?? 0} onSelect={onSelect} onHover={showHover} onLeave={leaveHover} />)}</>;
}

/** Whether a position is inside the camera's bounds, which may reach past +-180 with world copies. */
function containsPoint(bounds: LngLatBounds, latitude: number, longitude: number): boolean {
  if (latitude < bounds.getSouth() || latitude > bounds.getNorth()) return false;
  const wrapped = [longitude, longitude + 360, longitude - 360];
  return wrapped.some((value) => value >= bounds.getWest() && value <= bounds.getEast());
}

interface BoundsReporterProps { onBounds: (visible: Bounds) => void }
function BoundsReporter({ onBounds }: BoundsReporterProps) {
  const { map } = useMapHandle();
  useEffect(() => {
    const report = () => {
      const bounds = map.getBounds();
      onBounds(visibleBoundsFromEdges({ south: bounds.getSouth(), west: bounds.getWest(), north: bounds.getNorth(), east: bounds.getEast() }));
    };
    map.on("moveend", report);
    const initialTimer = setTimeout(report, 120);
    return () => {
      clearTimeout(initialTimer);
      map.off("moveend", report);
    };
  }, [map, onBounds]);
  return null;
}

/** Map bounds the camera will show once it arrives at `center` and `viewZoom`. */
function boundsAt(map: GlMap, center: [number, number], viewZoom: number): Bounds {
  const container = map.getContainer();
  return boundsAround(center, viewZoom, { width: container.clientWidth, height: container.clientHeight });
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

function prefersReducedMotion() {
  return window.matchMedia("(prefers-reduced-motion: reduce)").matches;
}

/**
 * Part of the map that no docked panel covers. It is derived from the layout
 * classes and CSS variables rather than from element rectangles, so it is
 * already correct while a panel is still sliding in; measuring the panel
 * mid-animation is what used to send the first camera move to the wrong place.
 */
function getSafeInsets(map: GlMap): Insets {
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
      insets.bottom += sheet ? sheet.getBoundingClientRect().height : Math.round(map.getContainer().clientHeight * 0.5);
    }
    return insets;
  }
  insets.top += 52;
  if (workspace.classList.contains("has-dock")) insets.left += width("--dock-width", 392) + edge;
  if (workspace.classList.contains("traffic-open")) insets.right += width("--traffic-width", 360) + edge;
  return insets;
}

/** Moves the camera to `center` at the shared `viewZoom`, flying there unless motion is reduced. */
function flyCamera(map: GlMap, center: [number, number], viewZoom: number, options: { animate: boolean; duration: number; follow?: boolean; linear?: boolean }) {
  const target = { center: [center[1], center[0]] as [number, number], zoom: toGlZoom(viewZoom) };
  if (!options.animate) { map.jumpTo(target); return; }
  if (options.linear) map.easeTo({ ...target, duration: options.duration * 1000, easing: (t) => t, essential: true }, { follow: options.follow });
  else map.flyTo({ ...target, duration: options.duration * 1000, essential: true }, { follow: options.follow });
}

/** Frames `points` (latitude, longitude) inside the free part of the map, with a tenth of margin around them. */
function fitPoints(map: GlMap, points: [number, number][], options: { animate: boolean; duration: number; maxZoom: number; extraPadding?: number }) {
  if (!points.length) return;
  const south = Math.min(...points.map((point) => point[0]));
  const north = Math.max(...points.map((point) => point[0]));
  const west = Math.min(...points.map((point) => point[1]));
  const east = Math.max(...points.map((point) => point[1]));
  const margin = 0.1;
  const insets = getSafeInsets(map);
  const extra = options.extraPadding ?? 0;
  const camera = map.cameraForBounds([
    [west - (east - west) * margin, south - (north - south) * margin],
    [east + (east - west) * margin, north + (north - south) * margin],
  ], {
    padding: { left: insets.left + extra, top: insets.top + extra, right: insets.right + extra, bottom: insets.bottom + extra },
    maxZoom: toGlZoom(options.maxZoom),
  });
  if (!camera?.center) return;
  const [lng, lat] = Array.isArray(camera.center) ? camera.center : "lng" in camera.center ? [camera.center.lng, camera.center.lat] : [camera.center.lon, camera.center.lat];
  map.stop();
  flyCamera(map, [lat, lng], fromGlZoom(camera.zoom ?? map.getZoom()), options);
}

function fitRoute(map: GlMap, track: TrackResponse | undefined, animate: boolean) {
  const points: [number, number][] = [];
  for (const point of track?.track.path ?? []) if (Number.isFinite(point[1]) && Number.isFinite(point[2])) points.push([point[1], point[2]]);
  fitPoints(map, points, { animate, duration: 1.1, maxZoom: 9 });
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
function revealPoint(map: GlMap, point: [number, number], animate: boolean) {
  const insets = getSafeInsets(map);
  const pixel = map.project([point[1], point[0]]);
  const safe = { left: insets.left + 56, top: insets.top + 56, right: map.getContainer().clientWidth - insets.right - 56, bottom: map.getContainer().clientHeight - insets.bottom - 56 };
  const inside = pixel.x >= safe.left && pixel.x <= safe.right && pixel.y >= safe.top && pixel.y <= safe.bottom;
  // Preserve the visitor's zoom level on selection. A forced zoom made an
  // ordinary click feel like a second, unrelated camera action.
  if (inside) return;
  const zoom = fromGlZoom(map.getZoom());
  map.stop();
  flyCamera(map, placementCenter(point, zoom, insets), zoom, { animate, duration: 0.8 });
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
  /** The camera announces where it is headed before it gets there, so the traffic for the destination loads while it is flying. */
  onPrefetch: (visible: Bounds) => void;
}

function MapController({ airport, airportFocusRequest, flight, track, fitRequest, locateRequest, onLocationFound, onLocationError, onPrefetch }: MapControllerProps) {
  const { map } = useMapHandle();
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
      map.jumpTo({ center: placementCenterLngLat([airportLatitude, airportLongitude], 8, insets), zoom: toGlZoom(8) });
    } else {
      const target = placementCenter([airportLatitude, airportLongitude], 9, insets);
      onPrefetch(boundsAt(map, target, 9));
      flyCamera(map, target, 9, { animate: !prefersReducedMotion(), duration: 0.9 });
    }
  }, [airportIcao, airportLatitude, airportLongitude, airportFocusRequest, flight, map, onPrefetch]);

  useEffect(() => {
    if (!locateRequest) return;
    if (!navigator.geolocation) { onLocationError("Geolocation not supported."); return; }
    navigator.geolocation.getCurrentPosition((position) => {
      const { latitude, longitude, accuracy } = position.coords;
      onLocationFound({ latitude, longitude, accuracy: Number.isFinite(accuracy) ? accuracy : 0 });
      // Frame the accuracy circle, but never closer than street level of a city (zoom 11).
      const ring = circlePolygon([latitude, longitude], Math.max(accuracy, 20));
      const camera = map.cameraForBounds([[Math.min(...ring.map((p) => p[0])), Math.min(...ring.map((p) => p[1]))], [Math.max(...ring.map((p) => p[0])), Math.max(...ring.map((p) => p[1]))]], { maxZoom: toGlZoom(11) });
      const zoom = camera?.zoom != null ? fromGlZoom(camera.zoom) : 11;
      map.stop();
      flyCamera(map, [latitude, longitude], Math.min(zoom, 11), { animate: !prefersReducedMotion(), duration: 0.9 });
    }, (error) => {
      onLocationError(`Geolocation error: ${error.message || "location is unavailable"}.`);
    }, { enableHighAccuracy: true, timeout: 10_000, maximumAge: 0 });
  }, [locateRequest, map, onLocationError, onLocationFound]);
  return null;
}

/** [longitude, latitude] of the camera that places `point` in the uncovered area. */
function placementCenterLngLat(point: [number, number], viewZoom: number, insets: Insets): [number, number] {
  const [latitude, longitude] = placementCenter(point, viewZoom, insets);
  return [longitude, latitude];
}

/** Marks on the map container what the camera is doing and whether labels are on. */
function MapViewClasses({ labelsEnabled }: { labelsEnabled: boolean }) {
  const { map } = useMapHandle();
  useEffect(() => {
    const container = map.getContainer();
    container.classList.toggle("show-labels", labelsEnabled);
    // The follow camera nudges the map every second; that is not the map "moving".
    const cameraStart = (event: { follow?: boolean }) => { if (!event.follow) container.classList.add("map-camera-moving"); };
    const cameraEnd = () => container.classList.remove("map-camera-moving");
    map.on("movestart", cameraStart);
    map.on("zoomstart", cameraStart);
    map.on("moveend", cameraEnd);
    return () => {
      map.off("movestart", cameraStart);
      map.off("zoomstart", cameraStart);
      map.off("moveend", cameraEnd);
      container.classList.remove("show-labels", "show-label-detail", "map-camera-moving");
    };
  }, [labelsEnabled, map]);
  return null;
}

/** A tooltip owned by the map, shown above a DOM marker while it is hovered or focused. */
function useMarkerTooltip(html: string | null, elementRef: { current: HTMLElement | null }, handle: MapHandle) {
  useEffect(() => {
    const element = elementRef.current;
    if (!element || !html) return;
    const tooltip = sharedTooltip(handle.map.getContainer());
    const show = () => tooltip.showAbove(html, element);
    const hide = () => tooltip.hide();
    element.addEventListener("mouseenter", show);
    element.addEventListener("focus", show);
    element.addEventListener("mouseleave", hide);
    element.addEventListener("blur", hide);
    return () => {
      element.removeEventListener("mouseenter", show);
      element.removeEventListener("focus", show);
      element.removeEventListener("mouseleave", hide);
      element.removeEventListener("blur", hide);
      tooltip.hide();
    };
  }, [html, elementRef, handle]);
}

function AirportPins({ airports, activeIcao, onSelect }: { airports: Airport[]; activeIcao: string | null; onSelect: (airport: Airport) => void }) {
  const { map } = useMapHandle();
  const [viewport, setViewport] = useState(() => ({ zoom: fromGlZoom(map.getZoom()), bounds: map.getBounds() }));
  useEffect(() => {
    const update = () => setViewport({ zoom: fromGlZoom(map.getZoom()), bounds: map.getBounds() });
    map.on("moveend", update);
    map.on("zoomend", update);
    return () => { map.off("moveend", update); map.off("zoomend", update); };
  }, [map]);
  const groups = useMemo(() => {
    const south = viewport.bounds.getSouth();
    const north = viewport.bounds.getNorth();
    const west = viewport.bounds.getWest();
    const east = viewport.bounds.getEast();
    // A tenth of the view around it, so pins appear just before they scroll in.
    const latPadding = (north - south) * 0.1;
    const lngPadding = (east - west) * 0.1;
    const visible = airports.filter((airport) => airport.latitude != null && airport.longitude != null
      && airport.latitude >= south - latPadding && airport.latitude <= north + latPadding
      && [airport.longitude, airport.longitude + 360, airport.longitude - 360].some((value) => value >= west - lngPadding && value <= east + lngPadding));
    if (viewport.zoom >= AIRPORT_CLUSTER_MAX_ZOOM) return visible.map((airport) => [airport]);
    const active = visible.filter((airport) => airport.icao === activeIcao);
    return [...active.map((airport) => [airport]), ...groupAirports(visible.filter((airport) => airport.icao !== activeIcao),
      (airport) => mercatorPixel(airport.latitude!, airport.longitude!, viewport.zoom))];
  }, [airports, activeIcao, viewport]);
  return <>
    {groups.map((group) => group.length === 1 ? (
      <AirportPin key={group[0].icao} airport={group[0]} active={group[0].icao === activeIcao} onSelect={onSelect} />
    ) : <AirportCluster key={group.map((airport) => airport.icao).join(",")} airports={group} />)}
  </>;
}

function AirportCluster({ airports }: { airports: Airport[] }) {
  const handle = useMapHandle();
  const { map } = handle;
  const center = useMemo<[number, number]>(() => {
    const latitudes = airports.map((airport) => airport.latitude!);
    const longitudes = airports.map((airport) => airport.longitude!);
    return [(Math.min(...latitudes) + Math.max(...latitudes)) / 2, (Math.min(...longitudes) + Math.max(...longitudes)) / 2];
  }, [airports]);
  const look = useMemo<MarkerLook>(() => ({ className: "airport-cluster-wrap", html: `<span class="airport-cluster">${airports.length}</span>` }), [airports.length]);
  const events = useMemo(() => ({ click: () => {
    map.stop();
    fitPoints(map, airports.map((airport) => [airport.latitude!, airport.longitude!] as [number, number]), {
      animate: !prefersReducedMotion(), duration: 0.7, maxZoom: Math.min(9, fromGlZoom(map.getZoom()) + 2), extraPadding: 32 });
  } }), [map, airports]);
  const { elementRef } = useDomMarker({ handle, position: center, className: look.className, html: look.html, size: 32,
    title: `${airports.length} airports · Zoom to explore`, zIndex: 600, events });
  useMarkerTooltip(`<strong>${airports.length} airports</strong><span>Click to zoom and choose an airport</span>`, elementRef, handle);
  return null;
}

function AirportPin({ airport, active, onSelect }: { airport: Airport; active: boolean; onSelect: (airport: Airport) => void }) {
  const handle = useMapHandle();
  const look = useMemo(() => airportPinIcon(airport, active), [airport, active]);
  const events = useMemo(() => ({ click: () => onSelect(airport) }), [airport, onSelect]);
  const { elementRef } = useDomMarker({ handle, position: [airport.latitude!, airport.longitude!], className: look.className, html: look.html, size: 24,
    title: `${airport.name} · Arrivals & departures`, zIndex: active ? 700 : 500, events });
  useMarkerTooltip(`<strong>${escapeHtml(airport.name)}</strong><span>${escapeHtml(airport.icao)}${airport.iata ? ` · ${escapeHtml(airport.iata)}` : ""} · Arrivals &amp; departures</span>`, elementRef, handle);
  return null;
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

const lineString = (positions: [number, number][], properties: GeoJSON.GeoJsonProperties): GeoJSON.Feature<GeoJSON.LineString> => ({
  type: "Feature", properties, geometry: { type: "LineString", coordinates: positions.map(([latitude, longitude]) => [longitude, latitude]) },
});

const ROUND_LINE = { "line-cap": "round", "line-join": "round" } as const;
const TRACE_LAYERS: LayerSpecification[] = [
  { id: "trace-halo", type: "line", source: "trace", filter: ["==", ["get", "kind"], "halo"], layout: ROUND_LINE,
    paint: { "line-color": ["get", "color"], "line-width": 8, "line-opacity": ["get", "opacity"] } },
  { id: "trace-line", type: "line", source: "trace", filter: ["==", ["get", "kind"], "line"], layout: ROUND_LINE,
    paint: { "line-color": ["get", "color"], "line-width": 3.5, "line-opacity": ["get", "opacity"] } },
  // The stretch from the end of the trace to the estimated position is dashed: it is not a recorded fix.
  { id: "trace-head", type: "line", source: "trace", filter: ["==", ["get", "kind"], "head"], layout: { "line-join": "round" },
    paint: { "line-color": ["get", "color"], "line-width": 3.5, "line-opacity": ["get", "opacity"], "line-dasharray": [1.4, 2] } },
];
const PROJECTION_LAYERS: LayerSpecification[] = [
  // A wide invisible line makes the thin projection easy to hover.
  { id: "projection-hit", type: "line", source: "projection", paint: { "line-color": "#000", "line-width": 18, "line-opacity": 0 } },
  { id: "projection-future", type: "line", source: "projection", filter: ["==", ["get", "kind"], "future"],
    paint: { "line-color": ["get", "color"], "line-width": 2, "line-opacity": 0.8, "line-dasharray": [5, 6] } },
  { id: "projection-heading", type: "line", source: "projection", filter: ["==", ["get", "kind"], "heading"],
    paint: { "line-color": ["get", "color"], "line-width": 2, "line-opacity": 0.8, "line-dasharray": [2.5, 3.5] } },
];
const PROJECTION_TIPS: Record<string, string> = {
  future: "Estimated direct line to destination · not a filed route",
  heading: "Estimated heading · next 2 min",
};

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
  const handle = useMapHandle();
  const { map } = handle;
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
  const firstPoint = basePoints[0];
  const startLook = useMemo(() => routeEndpointIcon("start", theme), [theme]);
  const showStart = Boolean(firstPoint && basePoints.length > 1 && fade > 0.5);

  const halo = MAP_COLORS[theme].halo;
  const traceData = useMemo<GeoJSON.FeatureCollection>(() => {
    const features: GeoJSON.Feature[] = [];
    if (drawnBase.length > 1) features.push(lineString(drawnBase.map((point) => [point[1], point[2]] as [number, number]), { kind: "halo", color: halo, opacity: 0.7 * fade }));
    if (headSegment) features.push(lineString(headSegment.positions, { kind: "halo", color: halo, opacity: 0.7 * fade * headFade }));
    for (const segment of baseSegments) features.push(lineString(segment.positions, { kind: "line", color: segment.color, opacity: 0.96 * fade }));
    if (headSegment) features.push(lineString(headSegment.positions, { kind: "head", color: headSegment.color, opacity: 0.96 * headFade }));
    return { type: "FeatureCollection", features };
  }, [baseSegments, drawnBase, fade, halo, headFade, headSegment]);
  useGeoJsonLayers(handle, "trace", TRACE_LAYERS, traceData);
  useOverlayToken(handle, "trace", traceData.features.length > 0);

  const units = useUnits();
  const fallbackLook = useMemo(
    () => planeIcon({ heading: flight.true_track ?? 0, active: true, onGround: flight.on_ground === true, icao24: flight.icao24, kind: aircraftIconKind(flight), aircraftType: flight.aircraft_type, airborne: flight.on_ground === false, label: { primary: flight.callsign || flight.registration || flight.icao24.toUpperCase(), secondary: [flight.baro_altitude != null ? flightLevelText(flight.baro_altitude, units) : null, flight.velocity != null ? speedText(flight.velocity, units) : null].filter(Boolean).join(" · "), logo: airlineLogo(flight), badge: airlineBadge(flight) } }),
    [flight, units],
  );

  const projection = headingProjection(live ?? flight, now, head);
  const futurePath = destinationGuide({ ...flight, ...live }, now, head);
  const projectionData = useMemo<GeoJSON.FeatureCollection>(() => {
    if (futurePath) return { type: "FeatureCollection", features: [lineString(futurePath, { kind: "future", color: theme === "dark" ? "#a1a1a6" : "#515154" })] };
    if (projection) return { type: "FeatureCollection", features: [lineString(projection, { kind: "heading", color: MAP_COLORS[theme].accent })] };
    return { type: "FeatureCollection", features: [] };
  }, [futurePath, projection, theme]);
  useGeoJsonLayers(handle, "projection", PROJECTION_LAYERS, projectionData);
  useOverlayToken(handle, "future-path", Boolean(futurePath));
  useOverlayToken(handle, "heading-projection", !futurePath && Boolean(projection));
  // A sticky tooltip explains what the dashed line is, wherever it is hovered.
  useEffect(() => {
    const tooltip = sharedTooltip(map.getContainer());
    const move = (event: { point: { x: number; y: number }; features?: Array<{ properties?: Record<string, unknown> }> }) => {
      const kind = String(event.features?.[0]?.properties?.kind ?? "");
      if (PROJECTION_TIPS[kind]) { tooltip.show(PROJECTION_TIPS[kind], event.point.x, event.point.y); map.getCanvas().style.cursor = "help"; }
    };
    const leave = () => { tooltip.hide(); map.getCanvas().style.cursor = ""; };
    map.on("mousemove", "projection-hit", move);
    map.on("mouseleave", "projection-hit", leave);
    return () => { map.off("mousemove", "projection-hit", move); map.off("mouseleave", "projection-hit", leave); tooltip.hide(); map.getCanvas().style.cursor = ""; };
  }, [map]);

  const heading = (live?.true_track ?? flight.true_track ?? 0) - 90;
  const arrowLook = useMemo<MarkerLook>(() => ({ className: "heading-arrow-wrap",
    html: `<span class="heading-arrow" style="transform:rotate(${heading}deg);color:${MAP_COLORS[theme].accent}"><svg viewBox="0 0 20 20"><path d="m5 4 9 6-9 6" fill="none" stroke="currentColor" stroke-width="2"/></svg></span>` }), [heading, theme]);

  const followStarted = useRef(false);
  useEffect(() => {
    if (!following) {
      followStarted.current = false;
      return;
    }
    const container = map.getContainer();
    const stopForManualMapUse = (event: PointerEvent) => {
      if (event.target instanceof Element && event.target.closest(".aircraft-marker-wrap, .airport-pin-wrap")) return;
      // Give the pointer back to the visitor as soon as they interact with the map.
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
      const zoom = Math.max(fromGlZoom(map.getZoom()), 9);
      map.stop();
      flyCamera(map, placementCenter(head, zoom, insets), zoom, { animate, duration: 0.9 });
      return;
    }
    // One second of linear pan per one-second tick keeps the aircraft still on screen.
    flyCamera(map, placementCenter(head, fromGlZoom(map.getZoom()), insets), fromGlZoom(map.getZoom()), { animate, duration: 1, linear: true, follow: true });
  }, [following, head, map]);

  return (
    <>
      {!futurePath && projection && <HeadingArrow position={projection[1]} look={arrowLook} />}
      {showStart && firstPoint && <TraceStart position={[firstPoint[1], firstPoint[2]]} look={startLook} altitude={firstPoint[3]} />}
      {!live && head && <FallbackAircraft position={head} look={fallbackLook} />}
    </>
  );
}

function HeadingArrow({ position, look }: { position: [number, number]; look: MarkerLook }) {
  const handle = useMapHandle();
  useDomMarker({ handle, position, className: look.className, html: look.html, size: 20, interactive: false });
  return null;
}

function TraceStart({ position, look, altitude }: { position: [number, number]; look: MarkerLook; altitude: TrackPoint[3] }) {
  const handle = useMapHandle();
  const { elementRef } = useDomMarker({ handle, position, className: look.className, html: look.html, size: 26, interactive: false });
  useMarkerTooltip(`<strong>Trace start</strong><span class="mono">${escapeHtml(formatAltitude(altitude))}</span>`, elementRef, handle);
  return null;
}

/** The selected aircraft when no live feed carries it: drawn where the flight record says it is. */
function FallbackAircraft({ position, look }: { position: [number, number]; look: MarkerLook }) {
  const handle = useMapHandle();
  const { elementRef } = useDomMarker({ handle, position, className: look.className, html: look.html, size: AIRCRAFT_MARKER_SIZE, interactive: false, zIndex: 900 });
  useEffect(() => {
    const logoElement = elementRef.current?.querySelector<HTMLImageElement>(".airline-logo");
    const hideLogo = () => swapLogoForBadge(logoElement);
    logoElement?.addEventListener("error", hideLogo);
    if (logoElement?.complete && !logoElement.naturalWidth) hideLogo();
    return () => logoElement?.removeEventListener("error", hideLogo);
  }, [look, elementRef]);
  return null;
}

/** Faint lines through the positions this page has seen for each aircraft. */
const TRAIL_LAYERS: LayerSpecification[] = [
  { id: "trails", type: "line", source: "trails", layout: { "line-cap": "round" }, paint: { "line-color": ["get", "color"], "line-width": 1.5, "line-opacity": 0.5 } },
];

function Trails({ trails }: { trails: Array<{ icao24: string; positions: [number, number][]; color: string }> }) {
  const handle = useMapHandle();
  const data = useMemo<GeoJSON.FeatureCollection>(() => ({
    type: "FeatureCollection",
    features: trails.map((trail) => lineString(trail.positions, { color: trail.color })),
  }), [trails]);
  useGeoJsonLayers(handle, "trails", TRAIL_LAYERS, data);
  useOverlayToken(handle, "trails", trails.length > 0);
  return null;
}

const ACCURACY_LAYERS: LayerSpecification[] = [
  { id: "accuracy-fill", type: "fill", source: "accuracy", paint: { "fill-color": ["get", "color"], "fill-opacity": 0.08 } },
  { id: "accuracy-line", type: "line", source: "accuracy", paint: { "line-color": ["get", "color"], "line-width": 1, "line-opacity": 0.5 } },
];

/** The visitor's position: an accuracy circle and a pulsing dot. */
function UserLocationMarker({ location, theme }: { location: UserLocation; theme: MapTheme }) {
  const handle = useMapHandle();
  const data = useMemo<GeoJSON.FeatureCollection>(() => ({
    type: "FeatureCollection",
    features: [{ type: "Feature", properties: { color: MAP_COLORS[theme].accent },
      geometry: { type: "Polygon", coordinates: [circlePolygon([location.latitude, location.longitude], Math.max(location.accuracy, 20))] } }],
  }), [location, theme]);
  useGeoJsonLayers(handle, "accuracy", ACCURACY_LAYERS, data);
  useOverlayToken(handle, "user-location", true);
  const { elementRef } = useDomMarker({ handle, position: [location.latitude, location.longitude], className: USER_LOCATION_LOOK.className, html: USER_LOCATION_LOOK.html, size: 30, zIndex: 300, interactive: false });
  useMarkerTooltip(`<strong>Your location</strong><span class="mono">Accuracy ±${Math.round(location.accuracy)} m</span>`, elementRef, handle);
  return null;
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
}

/** How old the positions on the map were when the last answer reached the browser. */
interface LastAnswer {
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
  const [handle, setHandle] = useState<MapHandle | null>(null);
  const map = handle?.map ?? null;
  const appliedInitialView = useRef(false);
  useEffect(() => {
    if (!map || !initialView || appliedInitialView.current) return;
    appliedInitialView.current = true;
    map.jumpTo({ center: [initialView.longitude, initialView.latitude], zoom: toGlZoom(initialView.zoom) });
  }, [initialView, map]);
  useEffect(() => {
    if (!map || !onViewChange) return;
    const report = () => {
      const center = map.getCenter();
      // Zoom is continuous with the wheel; the shared link keeps two decimals.
      onViewChange({ latitude: center.lat, longitude: center.lng, zoom: Math.round(fromGlZoom(map.getZoom()) * 100) / 100 });
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
  // Bounds the camera reports are widened and snapped before they become a request.
  const handleVisible = useCallback((visible: Bounds) => handleBounds(quantizeBounds(expandBounds(visible), 0.25), visible), [handleBounds]);
  const [mapUnavailable, setMapUnavailable] = useState(false);
  const handleMapUnavailable = useCallback(() => setMapUnavailable(true), []);
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
  const lastAnswerRef = useRef<LastAnswer | null>(null);
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
    // refreshes every 5 to 10 s.
    const minRefreshSeconds = wideView ? 20 : 5;
    let refreshAfterSeconds = wideView ? 20 : LOCAL_FEED_REFRESH_SECONDS;
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
        const known = aircraftCacheRef.current.get(states[index].icao24);
        // Snapshot and Local feed meet here: the newest fix per aircraft wins.
        const aircraft = newestFix(known, preserveAirframeAppearance(states[index], known));
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
            keptSnapshotRef.current = { states: response.states };
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
        lastAnswerRef.current = { ageSeconds: wideView && response.degraded ? response.age_seconds ?? 0 : 0, receivedAt: Date.now() };
        rememberAircraft(response.states);
        for (const aircraft of response.states) {
          retained.set(aircraft.icao24, aircraft);
          freshAircraft.add(aircraft.icao24);
        }
        loadedTiles += 1;
        coveredTiles.push(...covered);
        latestTime = Math.max(latestTime ?? 0, response.time ?? 0) || latestTime;
        provider = response.provider || provider;
        refreshAfterSeconds = Math.max(minRefreshSeconds, wideView ? refreshAfterSeconds : 0, response.refresh_after_seconds ?? refreshAfterSeconds);
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
        coverageRef.current = { bounds, until: Date.now() + Math.max(minRefreshSeconds, refreshAfterSeconds) * 1_000 };
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
      refreshTimer = setTimeout(requestLiveRefresh, retrySoon ? (cause ? 30_000 : 5_000) : Math.max(cause ? 30 : minRefreshSeconds, refreshAfterSeconds) * 1_000);
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
    // Every aircraft is drawn: no density sampling (ADR 0009).
    return selectedLive && !kept.includes(selectedLive) ? [...kept, selectedLive] : kept;
  }, [displayedLiveStates, filters, selectedLive]);
  // A broad viewport can contain thousands of aircraft. Keep the detailed
  // plane icons for normal views, then switch to the map's WebGL layer so
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
  const lastAnswer = lastAnswerRef.current;
  const snapshotAge = lastAnswer ? lastAnswer.ageSeconds + Math.max(0, statusNow - lastAnswer.receivedAt) / 1000 : null;
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
      <MapCanvas theme={theme} initialView={initialView ? { center: [initialView.latitude, initialView.longitude], zoom: initialView.zoom } : undefined}
        onUnavailable={handleMapUnavailable} onReady={setHandle}>
        <BoundsReporter onBounds={handleVisible} />
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
          onPrefetch={handleVisible}
        />
        <AircraftSelectionBridge aircraft={displayedLiveStates} onSelect={selectFlightAndCloseHover} />
        {onSelectAirport && <AirportPins airports={airports} activeIcao={airport?.icao ?? null} onSelect={onSelectAirport} />}
        {selectedFlight && selectedFlight.data_source !== "scheduled" && <SelectedTrack flight={selectedFlight} track={track} live={selectedLive} theme={theme} following={following} onRelease={releaseFollow} />}
        {trailsEnabled && !denseTraffic && <Trails trails={trails.filter((trail) => trail.icao24 !== selectedIcao24)} />}
        <TrafficAircraft aircraft={visibleStates} selectedId={selectedIcao24} followedId={following ? followingIcao24 : null} previewId={previewFlight?.icao24}
          labelsEnabled={labelsEnabled} dense={denseTraffic} theme={theme} onSelect={selectFlightAndCloseHover} hoverStore={hoverStore} />
        {userLocation && <UserLocationMarker location={userLocation} theme={theme} />}
      </MapCanvas>
      {mapUnavailable && <div className="map-unavailable" role="alert">
        <strong>The map could not start</strong>
        <span>This browser could not create a WebGL context. The list of aircraft in view still works once a flight or airport is chosen from the search.</span>
      </div>}

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
