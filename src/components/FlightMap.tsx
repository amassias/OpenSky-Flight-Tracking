import { memo, useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import L from "leaflet";
import { Circle, CircleMarker, MapContainer, Marker, Polyline, TileLayer, Tooltip, useMap } from "react-leaflet";
import { LocateFixed, Maximize2, Minimize2, Navigation, Pause, Play } from "./icons";
import { Minus, Plus, Route } from "./customIcons";
import { groupAirports, nearestAirports } from "../airportMap";
import { api } from "../api";
import type { Airport, Bounds, Flight, LiveAircraft, LiveFlightsResponse, MapTheme, TrackPoint, TrackResponse } from "../types";
import { isAircraftInBounds, LIVE_AIRCRAFT_CACHE_TTL_MS, pruneExpiredViewportCache, viewportCacheKey, writeViewportCache, type ViewportCacheEntry } from "../liveCache";
import { aircraftIconKind, altitudeColor, emergencyInfo, boundsEqual, expandBounds, formatAltitude, formatSpeed, liveAircraftToFlight, quantizeBounds, splitBoundsIntoTiles, viewportTileCount, type AircraftIconKind } from "../utils";
import { filterAircraft, type MapFilters } from "../mapFilters";
import { projectPosition, subscribeToTick, useNowSeconds } from "../aircraftMotion";
import { flightLevelText, speedText, useUnits } from "../units";
import { AltitudeLegend } from "./AltitudeLegend";

const DEFAULT_CENTER: [number, number] = [48.5, 2.2];
const NO_AIRCRAFT: LiveAircraft[] = [];
/** Reveal labels only when there is enough room to read them. */
const LABEL_MIN_ZOOM = 7;
const LABEL_DETAIL_ZOOM = 9;
const AIRPORT_CLUSTER_MAX_ZOOM = 9;

// Leaflet paths and canvas dots cannot read CSS custom properties, so the
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
  '<path class="aircraft-svg-rotor" d="M6.2 5.2 19.8 18.8M6.2 18.8 19.8 5.2"/>',
  '<ellipse class="aircraft-svg-fill" cx="13.4" cy="12" rx="4.6" ry="3.1"/>',
  '<path class="aircraft-svg-fill" d="M2.6 11.2h7v1.6h-7z"/>',
  '<path class="aircraft-svg-fill" d="M2 8.8h1.5v6.4H2z"/>',
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
    case "heavy":
      return `<path class="aircraft-svg-fill" transform="rotate(90 12 12) translate(-1.2 -1.2) scale(1.1)" d="${AIRLINER_PATH}"/>`;
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
  emergency?: boolean;
  label?: { primary: string; secondary: string };
}

function planeIcon({ heading = 0, active = false, onGround = false, icao24, kind = "airliner", emergency = false, label }: PlaneIconOptions) {
  const labelHtml = label
    ? `<span class="aircraft-label"><b>${escapeHtml(label.primary)}</b><i>${escapeHtml(label.secondary)}</i></span>`
    : "";
  return L.divIcon({
    className: `aircraft-marker-wrap${active ? " aircraft-marker-selected" : ""}`,
    html: `<span class="aircraft-marker kind-${kind} ${active ? "active" : ""} ${onGround ? "ground" : ""} ${emergency ? "emergency" : ""}" data-aircraft-kind="${kind}"${icao24 ? ` data-icao24="${icao24}"` : ""} style="--heading:${Number.isFinite(heading) ? heading : 0}deg"><svg viewBox="0 0 24 24" aria-hidden="true">${aircraftIconSvg(kind)}</svg></span>${labelHtml}`,
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

interface AircraftMarkerProps {
  aircraft: LiveAircraft;
  active: boolean;
  onSelect: (flight: Flight) => void;
  theme?: MapTheme;
}

function areMarkersEqual(
  previous: AircraftMarkerProps,
  next: AircraftMarkerProps,
) {
  if (previous.active !== next.active || previous.onSelect !== next.onSelect || previous.theme !== next.theme) return false;
  const a = previous.aircraft;
  const b = next.aircraft;
  // Every poll returns fresh objects, so compare the fields the marker draws
  // rather than identity — otherwise every aircraft re-renders every 15s.
  return a.icao24 === b.icao24
    && a.latitude === b.latitude
    && a.longitude === b.longitude
    && a.time_position === b.time_position
    && a.true_track === b.true_track
    && a.on_ground === b.on_ground
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

function liveTooltip(aircraft: LiveAircraft) {
  return (
    <Tooltip direction="right" offset={[16, 0]} opacity={1} className="aircraft-tooltip">
      <strong>{aircraft.callsign || aircraft.registration || aircraft.icao24.toUpperCase()}</strong>
      <span>{[aircraft.aircraft_type, aircraft.airline_name].filter(Boolean).join(" · ") || "Aircraft"}</span>
      <span className="mono">{formatAltitude(aircraft.baro_altitude)} · {formatSpeed(aircraft.velocity)}</span>
    </Tooltip>
  );
}

const AircraftMarker = memo(function AircraftMarker({ aircraft, active, onSelect }: AircraftMarkerProps) {
  const units = useUnits();
  const iconKind = aircraftIconKind(aircraft);
  const heading = aircraft.true_track ?? 0;
  const emergency = emergencyInfo(aircraft) !== null;
  const labelPrimary = aircraft.callsign || aircraft.registration || aircraft.icao24.toUpperCase();
  const labelSecondary = [
    aircraft.baro_altitude != null && !aircraft.on_ground ? flightLevelText(aircraft.baro_altitude, units) : null,
    aircraft.velocity != null && !aircraft.on_ground ? speedText(aircraft.velocity, units).replace(" ", "") : null,
  ].filter(Boolean).join(" · ");
  const icon = useMemo(
    () => planeIcon({ heading, active, onGround: aircraft.on_ground === true, icao24: aircraft.icao24, kind: iconKind, emergency, label: { primary: labelPrimary, secondary: labelSecondary } }),
    [aircraft.icao24, aircraft.on_ground, active, iconKind, heading, emergency, labelPrimary, labelSecondary],
  );
  // A fresh fix is already some seconds old when it arrives, so start from
  // where the aircraft is now rather than where it was reported.
  const position = useMemo<[number, number]>(
    () => projectPosition(aircraft, Date.now() / 1000) ?? [aircraft.latitude ?? 0, aircraft.longitude ?? 0],
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [aircraft.latitude, aircraft.longitude, aircraft.time_position],
  );
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
  }), [selectAircraft]);

  // Only dead-reckoning ticks glide. Leaflet's own camera animations must
  // position markers immediately or they visibly lag behind their map point.
  useEffect(() => subscribeToTick((now) => {
    const current = aircraftRef.current;
    const marker = markerRef.current;
    if (!marker || current.on_ground) return;
    const next = projectPosition(current, now);
    const shown = marker.getLatLng();
    if (next && (next[0] !== shown.lat || next[1] !== shown.lng)) {
      const element = marker.getElement();
      if (!element?.closest(".map-camera-moving")) element?.classList.add("aircraft-gliding");
      marker.setLatLng(next);
    }
  }), []);

  useLayoutEffect(() => {
    // Firefox can swallow Leaflet's delegated click while a map pan is still
    // settling. Listening on the marker element itself keeps aircraft
    // selection responsive during that short transition.
    let element: HTMLElement | null = null;
    let timer: ReturnType<typeof setTimeout> | undefined;
    let attempts = 0;
    const bind = () => {
      element = markerRef.current?.getElement() ?? null;
      if (element) {
        element.addEventListener("pointerdown", selectAircraft, true);
        element.addEventListener("mousedown", selectAircraft, true);
        element.addEventListener("click", selectAircraft, true);
        return;
      }
      if (attempts < 10) {
        attempts += 1;
        timer = setTimeout(bind, 50);
      }
    };
    bind();
    return () => {
      if (timer) clearTimeout(timer);
      element?.removeEventListener("pointerdown", selectAircraft, true);
      element?.removeEventListener("mousedown", selectAircraft, true);
      element?.removeEventListener("click", selectAircraft, true);
    };
  }, [selectAircraft, icon]);
  if (aircraft.latitude == null || aircraft.longitude == null) return null;
  return <Marker ref={markerRef} position={position} icon={icon} eventHandlers={eventHandlers}>{!active && liveTooltip(aircraft)}</Marker>;
}, areMarkersEqual);

const AircraftDot = memo(function AircraftDot({ aircraft, active, onSelect, theme = "dark" }: AircraftMarkerProps) {
  const position = useMemo<[number, number]>(() => [aircraft.latitude ?? 0, aircraft.longitude ?? 0], [aircraft.latitude, aircraft.longitude]);
  // Same encoding as the DOM markers: neutral ink, grey on the ground, blue when selected.
  const color = active ? MAP_COLORS[theme].accent : emergencyInfo(aircraft) ? MAP_COLORS[theme].danger : aircraft.on_ground ? MAP_COLORS[theme].ground : MAP_COLORS[theme].aircraft;
  const pathOptions = useMemo(() => ({
    color,
    fillColor: color,
    fillOpacity: active ? 1 : 0.78,
    opacity: active ? 1 : 0.9,
    weight: active ? 2 : 1,
  }), [active, color]);
  const aircraftRef = useRef(aircraft);
  aircraftRef.current = aircraft;
  const eventHandlers = useMemo(() => ({
    click: () => onSelect(liveAircraftToFlight(aircraftRef.current)),
  }), [onSelect]);
  if (aircraft.latitude == null || aircraft.longitude == null) return null;
  return <CircleMarker center={position} radius={active ? 5 : 3} pathOptions={pathOptions} eventHandlers={eventHandlers}>{liveTooltip(aircraft)}</CircleMarker>;
}, areMarkersEqual);

interface BoundsReporterProps { onBounds: (bounds: Bounds) => void }
function BoundsReporter({ onBounds }: BoundsReporterProps) {
  const map = useMap();
  useEffect(() => {
    function report() {
      const bounds = map.getBounds();
      onBounds(quantizeBounds(expandBounds({
        lamin: Math.max(-90, bounds.getSouth()),
        lomin: Math.max(-180, bounds.getWest()),
        lamax: Math.min(90, bounds.getNorth()),
        lomax: Math.min(180, bounds.getEast()),
      })));
    }
    map.on("moveend", report);
    const initialTimer = setTimeout(report, 120);
    const observer = new ResizeObserver(() => map.invalidateSize({ pan: false }));
    observer.observe(map.getContainer());
    return () => {
      clearTimeout(initialTimer);
      map.off("moveend", report);
      observer.disconnect();
    };
  }, [map, onBounds]);
  return null;
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
    if (workspace.classList.contains("has-dock")) insets.bottom += Math.round(map.getSize().y * 0.5);
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
  airport: Airport | null;
  flight: Flight | null;
  track?: TrackResponse;
  fitRequest: number;
  locateRequest: number;
  onLocationFound: (location: UserLocation) => void;
  onLocationError: (message: string) => void;
}

function MapController({ airport, flight, track, fitRequest, locateRequest, onLocationFound, onLocationError }: MapControllerProps) {
  const map = useMap();
  const selection = useRef<{ id: string; fitted: boolean; revealed: boolean } | null>(null);
  const centeredAirport = useRef<string | null>(null);
  const lastFitRequest = useRef(fitRequest);

  // The aircraft is revealed once per selection.
  const selectedId = flight?.icao24 ?? null;
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
    if (!airportIcao || airportLatitude == null || airportLongitude == null || centeredAirport.current === airportIcao) return;
    const first = centeredAirport.current === null;
    centeredAirport.current = airportIcao;
    // A deep link can resolve its airport after its aircraft. Keep the flight
    // camera in charge until the visitor explicitly changes airport.
    if (flight) return;
    const insets = getSafeInsets(map);
    map.stop();
    if (first) {
      // The first position appears immediately; later changes travel there.
      map.setView(placementCenter(map, [airportLatitude, airportLongitude], 8, insets), 8, { animate: false });
    } else {
      map.flyTo(placementCenter(map, [airportLatitude, airportLongitude], 9, insets), 9, { animate: !prefersReducedMotion(), duration: 1.1, easeLinearity: 0.2 });
    }
  }, [airportIcao, airportLatitude, airportLongitude, flight, map]);

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

/** Zoom-dependent label visibility lives on the map element so zooming never re-renders a marker. */
function MapViewClasses({ labelsEnabled }: { labelsEnabled: boolean }) {
  const map = useMap();
  useEffect(() => {
    const container = map.getContainer();
    const apply = () => {
      const zoom = map.getZoom();
      container.classList.toggle("show-labels", labelsEnabled && zoom >= LABEL_MIN_ZOOM);
      container.classList.toggle("show-label-detail", labelsEnabled && zoom >= LABEL_DETAIL_ZOOM);
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

function useReveal(key: string, ready: boolean): number {
  const [fraction, setFraction] = useState(1);
  useEffect(() => {
    if (!ready) return;
    if (prefersReducedMotion()) {
      setFraction(1);
      return;
    }
    const start = performance.now();
    const duration = 950;
    let frame = 0;
    setFraction(0);
    const step = (now: number) => {
      const progress = Math.min(1, (now - start) / duration);
      setFraction(1 - (1 - progress) ** 3);
      if (progress < 1) frame = requestAnimationFrame(step);
    };
    frame = requestAnimationFrame(step);
    return () => cancelAnimationFrame(frame);
  }, [key, ready]);
  return fraction;
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

  const fraction = useReveal(`${selectedId}:${track?.track.icao24 ?? ""}`, basePoints.length > 1);
  const drawnBase = useMemo(
    () => fraction >= 1 ? basePoints : basePoints.slice(0, Math.max(2, Math.ceil(basePoints.length * fraction))),
    [basePoints, fraction],
  );
  const baseSegments = useMemo(() => buildAltitudeSegments(drawnBase), [drawnBase]);
  const lastBase = basePoints[basePoints.length - 1];
  // The last stretch joins the end of the trace to the aircraft's position now.
  const headSegment = useMemo<TrackSegment | null>(() => {
    if (!head || !lastBase || fraction < 1) return null;
    const altitude = live?.baro_altitude ?? lastBase[3];
    return { positions: [[lastBase[1], lastBase[2]], head], color: altitudeColor(altitude) };
  }, [fraction, head, lastBase, live?.baro_altitude]);
  const halo = useMemo<[number, number][]>(() => {
    const positions = drawnBase.map((point) => [point[1], point[2]] as [number, number]);
    if (headSegment) positions.push(headSegment.positions[1]);
    return positions;
  }, [drawnBase, headSegment]);
  const firstPoint = basePoints[0];
  const startIcon = useMemo(() => routeEndpointIcon("start", theme), [theme]);
  const fallbackIcon = useMemo(
    () => planeIcon({ heading: flight.true_track ?? 0, active: true, onGround: flight.on_ground === true, icao24: flight.icao24, kind: aircraftIconKind(flight) }),
    [flight],
  );

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
      {halo.length > 1 && <Polyline positions={halo} pathOptions={{ color: MAP_COLORS[theme].halo, weight: 8, opacity: 0.7, lineCap: "round", lineJoin: "round" }} />}
      {baseSegments.map((segment, index) => (
        <Polyline key={`${segment.color}-${index}`} positions={segment.positions} pathOptions={{ color: segment.color, weight: 3.5, opacity: 0.96, lineCap: "round", lineJoin: "round" }} />
      ))}
      {headSegment && <Polyline positions={headSegment.positions} pathOptions={{ color: headSegment.color, weight: 3.5, opacity: 0.96, lineCap: "round", lineJoin: "round" }} />}
      {firstPoint && basePoints.length > 1 && (
        <Marker position={[firstPoint[1], firstPoint[2]]} icon={startIcon} keyboard={false}>
          <Tooltip direction="top" offset={[0, -8]} opacity={1} className="aircraft-tooltip"><strong>Trace start</strong><span className="mono">{formatAltitude(firstPoint[3])}</span></Tooltip>
        </Marker>
      )}
      {!live && head && <Marker position={head} icon={fallbackIcon} keyboard={false} />}
    </>
  );
}

interface FlightMapProps {
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
  liveEnabled: boolean;
  liveAvailable: boolean;
  liveProbePending?: boolean;
  expanded: boolean;
  onToggleLive: () => void;
  onToggleExpanded: () => void;
  onSelectFlight: (flight: Flight) => void;
  onSelectAirport?: (airport: Airport) => void;
  onLiveSnapshot?: (data: LiveFlightsResponse, airportIcao: string | null) => void;
  onViewportCenter?: (center: [number, number]) => void;
}

interface ProgressiveLiveState {
  data: LiveFlightsResponse | null;
  fetching: boolean;
  loadedTiles: number;
  totalTiles: number;
  failedTiles: number;
  error: string | null;
}

export function FlightMap({
  airport,
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
  liveEnabled,
  liveAvailable,
  liveProbePending = false,
  expanded,
  onToggleLive,
  onToggleExpanded,
  onSelectFlight,
  onSelectAirport,
  onLiveSnapshot,
  onViewportCenter,
}: FlightMapProps) {
  const [map, setMap] = useState<L.Map | null>(null);
  const [bounds, setBounds] = useState<Bounds | null>(null);
  const handleBounds = useCallback((next: Bounds) => {
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
  const [locationError, setLocationError] = useState<string | null>(null);
  const airportIcaoRef = useRef<string | null>(airport?.icao ?? null);
  const seededViewportRef = useRef(false);
  useEffect(() => {
    airportIcaoRef.current = airport?.icao ?? null;
  }, [airport?.icao]);
  useEffect(() => {
    if (!bounds || !liveAvailable || !liveEnabled) return;
    const controller = new AbortController();
    // The authenticated OpenSky proxy answers the whole viewport in a single
    // call, so only split into a paced grid of small requests when we're
    // limited to the public ADS-B fallback (which caps a single call to a
    // 250 NM radius).
    const usePrivateViewport = liveAvailable && !liveProbePending;
    const tiles = usePrivateViewport ? [bounds] : splitBoundsIntoTiles(bounds);
    const totalViewportTiles = usePrivateViewport ? 1 : viewportTileCount(bounds);
    // A private whole-box request can still be cold (OAuth + upstream) and
    // take several seconds. Prime the map once with one provider-safe centre
    // tile, then let the complete request replace it. This keeps first paint
    // fast without turning every refresh into an extra public-provider call.
    const shouldSeedViewport = usePrivateViewport && !seededViewportRef.current;
    const seedTile = shouldSeedViewport ? splitBoundsIntoTiles(bounds, 1)[0] ?? bounds : null;
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
    const freshAircraft = new Set<string>();
    const coveredTiles: Bounds[] = [];
    let loadedTiles = 0;
    let failedTiles = 0;
    let latestTime: number | null = cachedViewport?.time ?? null;
    let provider: string | undefined = cachedViewport?.provider;
    let cacheTimestamp: number | null = cachedViewport?.cachedAt ?? null;
    // Refresh a complete grid at a cadence proportional to its request cost.
    // A 12-sector Europe view therefore refreshes every three minutes instead
    // of repeating 12 public-provider calls every 20 seconds.
    let refreshAfterSeconds = Math.max(20, Math.min(180, 20 * tiles.length));
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
      for (const aircraft of states) {
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
    });

    const loadTile = async (tile: Bounds) => {
      try {
        const response = await api.liveFlights(tile, controller.signal, !usePrivateViewport);
        if (controller.signal.aborted) return;
        rememberAircraft(response.states);
        for (const aircraft of response.states) {
          retained.set(aircraft.icao24, aircraft);
          freshAircraft.add(aircraft.icao24);
        }
        loadedTiles += 1;
        coveredTiles.push(tile);
        latestTime = Math.max(latestTime ?? 0, response.time ?? 0) || latestTime;
        provider = response.provider || provider;
        refreshAfterSeconds = Math.max(refreshAfterSeconds, response.refresh_after_seconds ?? 20);
        cacheTimestamp = Date.now();
        const data = snapshot();
        saveViewportCache();
        setLiveState({ data, fetching: true, loadedTiles, totalTiles: totalViewportTiles, failedTiles, error: null });
        onLiveSnapshot?.(data, airportIcaoRef.current);
      } catch (error) {
        if (controller.signal.aborted) return;
        failedTiles += 1;
        setLiveState({
          data: retained.size ? snapshot() : null,
          fetching: true,
          loadedTiles,
          totalTiles: totalViewportTiles,
          failedTiles,
          error: error instanceof Error ? error.message : "Live sector unavailable",
        });
      }
    };

    const loadSeed = async () => {
      if (!seedTile) return;
      try {
        const response = await api.liveFlights(seedTile, controller.signal, true);
        if (controller.signal.aborted) return;
        seededViewportRef.current = true;
        rememberAircraft(response.states);
        for (const aircraft of response.states) retained.set(aircraft.icao24, aircraft);
        latestTime = response.time ?? latestTime;
        provider = response.provider || provider;
        refreshAfterSeconds = Math.max(refreshAfterSeconds, response.refresh_after_seconds ?? 20);
        cacheTimestamp = Date.now();
        const data = snapshot();
        saveViewportCache();
        setLiveState({ data, fetching: true, loadedTiles, totalTiles: totalViewportTiles, failedTiles, error: null });
        onLiveSnapshot?.(data, airportIcaoRef.current);
      } catch {
        // The complete request below remains authoritative. A seed failure is
        // intentionally silent so a transient public provider issue cannot
        // make the main live request look failed.
      }
    };

    void loadSeed().then(() => Promise.all(tiles.map(loadTile))).then(() => {
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
      const data = retained.size ? snapshot() : null;
      setLiveState({
        data,
        fetching: false,
        loadedTiles,
        totalTiles: totalViewportTiles,
        failedTiles,
        error: failedTiles && !retained.size ? "Live traffic is temporarily unavailable." : null,
      });
      refreshTimer = setTimeout(() => setLiveRefresh((value) => value + 1), Math.max(20, refreshAfterSeconds) * 1_000);
    });

    return () => {
      controller.abort();
      if (refreshTimer) clearTimeout(refreshTimer);
    };
  }, [bounds, liveAvailable, liveEnabled, liveProbePending, liveRefresh, onLiveSnapshot]);

  const displayedLiveData = liveState.data;
  const hasLiveSnapshot = Boolean(displayedLiveData?.states.length);
  const displayedLiveStates = displayedLiveData?.states ?? NO_AIRCRAFT;
  const selectedIcao24 = selectedFlight ? selectedFlight.icao24.toLowerCase() : null;
  const selectedLive = useMemo(
    () => selectedIcao24 ? displayedLiveStates.find((aircraft) => aircraft.icao24.toLowerCase() === selectedIcao24) ?? null : null,
    [displayedLiveStates, selectedIcao24],
  );
  // The filters narrow the map, never the aircraft the user is looking at.
  const visibleStates = useMemo(() => {
    const kept = filterAircraft(displayedLiveStates, filters);
    return selectedLive && !kept.includes(selectedLive) ? [...kept, selectedLive] : kept;
  }, [displayedLiveStates, filters, selectedLive]);
  // A broad viewport can contain thousands of aircraft. Keep the detailed
  // plane icons for normal views, then switch to a lightweight canvas layer so
  // zooming out does not turn every aircraft into a DOM subtree.
  const denseTraffic = visibleStates.length > 750;
  const hiddenByFilters = displayedLiveStates.length - visibleStates.length;
  const liveStatus = liveState.error || liveState.failedTiles > 0
    ? hasLiveSnapshot ? `Refresh delayed · last snapshot kept · ${liveState.loadedTiles}/${liveState.totalTiles} sectors` : "Live traffic temporarily unavailable"
    : liveState.fetching && liveState.loadedTiles === 0
      ? "Scanning visible airspace…"
      : liveState.fetching
        ? `${visibleStates.length} aircraft · sector ${Math.min(liveState.loadedTiles + 1, liveState.totalTiles)}/${liveState.totalTiles}`
        : liveState.loadedTiles < liveState.totalTiles
          ? `${visibleStates.length} aircraft · ${liveState.loadedTiles}/${liveState.totalTiles} sectors shown`
          : `${visibleStates.length} aircraft`;

  const locationIcon = useMemo(() => userLocationIcon(), []);
  const handleLocationFound = useCallback((location: UserLocation) => {
    setUserLocation(location);
    setLocationError(null);
  }, []);
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
    <section className="map-surface" aria-label="Live flight map">
      <MapContainer ref={setMap} center={DEFAULT_CENTER} zoom={6} zoomControl={false} preferCanvas className="leaflet-map">
        <TileLayer
          attribution='&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors'
          url="https://tile.openstreetmap.org/{z}/{x}/{y}.png"
          className={theme === "dark" ? "map-tiles-dark" : "map-tiles-light"}
          key={theme}
          maxZoom={19}
        />
        <BoundsReporter onBounds={handleBounds} />
        <MapViewClasses labelsEnabled={labelsEnabled} />
        <MapController
          airport={airport}
          flight={selectedFlight}
          track={track}
          fitRequest={fitRequest}
          locateRequest={locateRequest}
          onLocationFound={handleLocationFound}
          onLocationError={handleLocationError}
        />
        <AircraftSelectionBridge aircraft={displayedLiveStates} onSelect={onSelectFlight} />
        {onSelectAirport && <AirportPins airports={airports} activeIcao={airport?.icao ?? null} onSelect={onSelectAirport} />}
        {selectedFlight && <SelectedTrack flight={selectedFlight} track={track} live={selectedLive} theme={theme} following={following} onRelease={releaseFollow} />}
        {visibleStates.map((aircraft) => denseTraffic ? (
          <AircraftDot
            key={aircraft.icao24}
            aircraft={aircraft}
            active={aircraft.icao24 === selectedFlight?.icao24 || aircraft.icao24 === previewFlight?.icao24}
            onSelect={onSelectFlight}
            theme={theme}
          />
        ) : (
          <AircraftMarker
            key={aircraft.icao24}
            aircraft={aircraft}
            active={aircraft.icao24 === selectedFlight?.icao24 || aircraft.icao24 === previewFlight?.icao24}
            onSelect={onSelectFlight}
          />
        ))}
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
            : <><p>From your location · ±{Math.round(userLocation.accuracy)} m</p><ol>{closestAirports.map(({ airport: nearby, distance }) => (
              <li key={nearby.icao}><button type="button" onClick={() => { onSelectAirport?.(nearby); setNearbyOpen(false); }}>
                <span><b>{nearby.iata || nearby.icao}</b><span>{nearby.name}</span></span><small>{distance.toFixed(1)} km</small>
              </button></li>
            ))}</ol></>}
          <button type="button" className="popover-reset" onClick={requestLocation}>{userLocation ? "Update my location" : "Retry location"}</button>
        </section>}
      </div>

      <div className={`map-status ${!liveAvailable ? "offline" : !liveEnabled ? "paused" : "active"}`} aria-live="polite">
        <span className={`pulse-dot ${liveEnabled && liveAvailable ? "active" : ""}`} />
        <strong>{!liveAvailable ? "Offline" : !liveEnabled ? "Paused" : "Live"}</strong>
        <span className="map-status-copy">{!liveAvailable ? "OpenSky credentials required" : !liveEnabled ? "Live traffic paused" : liveStatus}</span>
        {hiddenByFilters > 0 && <span className="map-status-filter">{hiddenByFilters} hidden by filters</span>}
        {liveEnabled && liveState.fetching && liveState.totalTiles > 1 && <span className="live-coverage-progress" aria-hidden="true"><span style={{ transform: `scaleX(${Math.max(0.04, liveState.loadedTiles / liveState.totalTiles)})` }} /></span>}
        {liveEnabled && (liveState.error || liveState.failedTiles > 0) && <button type="button" className="live-retry" onClick={() => setLiveRefresh((value) => value + 1)}>Retry</button>}
      </div>

      <div className="map-controls" role="group" aria-label="Map controls">
        <div className="map-control-group">
          <button type="button" onClick={() => map?.zoomIn()} aria-label="Zoom in" title="Zoom in"><Plus size={17} /></button>
          <button type="button" onClick={() => map?.zoomOut()} aria-label="Zoom out" title="Zoom out"><Minus size={17} /></button>
        </div>
        <div className="map-control-group">
          <button type="button" className={userLocation ? "location-active" : ""} onClick={requestLocation} aria-label="Locate me" title={userLocation ? "Update my location" : "Locate me"}><LocateFixed size={17} /></button>
          <button type="button" disabled={!liveAvailable} onClick={onToggleLive} aria-label={liveEnabled ? "Pause live traffic" : "Resume live traffic"} title={liveAvailable ? (liveEnabled ? "Pause live traffic" : "Resume live traffic") : "OpenSky credentials required"}>
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
      {hasTrace && <AltitudeLegend compact className="map-altitude-legend" />}
    </section>
  );
}
