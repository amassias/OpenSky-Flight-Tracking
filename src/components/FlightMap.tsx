import { memo, useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import L from "leaflet";
import { Circle, CircleMarker, MapContainer, Marker, Polyline, Popup, TileLayer, useMap } from "react-leaflet";
import { Crosshair, LocateFixed, Maximize2, Minimize2, Pause, Play } from "lucide-react";
import { api } from "../api";
import type { Airport, Bounds, Flight, LiveAircraft, LiveFlightsResponse, MapTheme, TrackResponse } from "../types";
import { aircraftIconKind, altitudeColor, boundsEqual, expandBounds, formatAltitude, formatSpeed, quantizeBounds, splitBoundsIntoTiles, viewportTileCount, type AircraftIconKind } from "../utils";
import { AltitudeLegend } from "./AltitudeLegend";

const DEFAULT_CENTER: [number, number] = [48.5, 2.2];

// Tabler Icons (MIT): https://github.com/tabler/tabler-icons
// The source SVGs and license notice live in src/assets/aircraft/.
const TABLER_PLANE_PATH = "M16 10h4a2 2 0 0 1 0 4h-4l-4 7h-3l2 -7h-4l-2 2h-3l2 -4l-2 -4h3l2 2h4l-2 -7h3l4 7";
const TABLER_HELICOPTER_PATHS = [
  "M3 10l1 2h6",
  "M12 9a2 2 0 0 0 -2 2v3c0 1.1 .9 2 2 2h7a2 2 0 0 0 2 -2c0 -3.31 -3.13 -5 -7 -5h-2",
  "M13 9l0 -3",
  "M5 6l15 0",
  "M15 9.1v3.9h5.5",
  "M15 19l0 -3",
  "M19 19l-8 0",
];

function aircraftIconSvg(kind: AircraftIconKind): string {
  switch (kind) {
    case "helicopter":
      return `<g class="aircraft-svg-stroke">${TABLER_HELICOPTER_PATHS.map((path) => `<path d="${path}" />`).join("")}</g>`;
    case "glider":
      return '<path d="M2 11.2h20v1.6H2zM11.2 12.8h1.6l1.9 8.2h-1.9l-.8-3.2-.8 3.2H9.3z"/>';
    case "balloon":
      return '<path d="M12 2a6.2 6.2 0 0 1 6.2 6.2c0 3.2-2 5.4-4.2 7.1l-.8.6h-2.4l-.8-.6c-2.2-1.7-4.2-3.9-4.2-7.1A6.2 6.2 0 0 1 12 2Zm-1.2 14h2.4v2.1h-2.4zM9.8 20h4.4v2H9.8z"/>';
    case "small":
      return `<path class="aircraft-svg-stroke" transform="scale(.84) translate(2.3 2.3)" d="${TABLER_PLANE_PATH}"/>`;
    case "heavy":
      return `<path class="aircraft-svg-stroke" transform="scale(1.08) translate(-.9 -.9)" d="${TABLER_PLANE_PATH}"/>`;
    case "airliner":
      return `<path class="aircraft-svg-stroke" d="${TABLER_PLANE_PATH}"/>`;
    default:
      return '<circle cx="12" cy="12" r="4"/><path d="M12 2v3M12 19v3M2 12h3m14 0h3" fill="none" stroke="currentColor" stroke-linecap="round" stroke-width="1.5"/>';
  }
}

function planeIcon(heading = 0, active = false, onGround = false, icao24?: string, kind: AircraftIconKind = "airliner") {
  return L.divIcon({
    className: `aircraft-marker-wrap${active ? " aircraft-marker-selected" : ""}`,
    html: `<span class="aircraft-marker kind-${kind} ${active ? "active" : ""} ${onGround ? "ground" : ""}" data-aircraft-kind="${kind}"${icao24 ? ` data-icao24="${icao24}"` : ""} style="--heading:${Number.isFinite(heading) ? heading : 0}deg"><svg viewBox="0 0 24 24" aria-hidden="true">${aircraftIconSvg(kind)}</svg></span>`,
    iconSize: [30, 30],
    iconAnchor: [15, 15],
  });
}

function liveAircraftToFlight(aircraft: LiveAircraft): Flight {
  return {
    ...aircraft,
    status: aircraft.on_ground ? "on_ground" : "airborne",
    primary_time: 0,
    airline_name: "Live traffic",
  };
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

function routeEndpointIcon(kind: "start" | "end") {
  const start = kind === "start";
  const color = start ? "#67d8ff" : "#b7f34a";
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

type MarkerPosition = [number, number];

interface AircraftMarkerProps {
  aircraft: LiveAircraft;
  active: boolean;
  onSelect: (flight: Flight) => void;
  positionOverride?: MarkerPosition;
  headingOverride?: number | null;
}

function areMarkersEqual(
  previous: AircraftMarkerProps,
  next: AircraftMarkerProps,
) {
  if (previous.active !== next.active || previous.onSelect !== next.onSelect) return false;
  if (previous.positionOverride?.[0] !== next.positionOverride?.[0] || previous.positionOverride?.[1] !== next.positionOverride?.[1]) return false;
  if (previous.headingOverride !== next.headingOverride) return false;
  const a = previous.aircraft;
  const b = next.aircraft;
  // Every poll returns fresh objects, so compare the fields the marker draws
  // rather than identity — otherwise every aircraft re-renders every 15s.
  return a.icao24 === b.icao24
    && a.latitude === b.latitude
    && a.longitude === b.longitude
    && a.true_track === b.true_track
    && a.on_ground === b.on_ground
    && a.callsign === b.callsign
    && a.baro_altitude === b.baro_altitude
    && a.velocity === b.velocity
    && a.category === b.category
    && a.aircraft_category === b.aircraft_category
    && a.aircraft_type === b.aircraft_type
    && a.aircraft_description === b.aircraft_description;
}

const AircraftMarker = memo(function AircraftMarker({ aircraft, active, onSelect, positionOverride, headingOverride }: AircraftMarkerProps) {
  const iconKind = aircraftIconKind(aircraft);
  const heading = headingOverride ?? aircraft.true_track ?? 0;
  const icon = useMemo(() => planeIcon(heading, active, aircraft.on_ground === true, aircraft.icao24, iconKind), [aircraft.icao24, aircraft.on_ground, active, iconKind, heading]);
  const position = useMemo<MarkerPosition>(() => positionOverride ?? [aircraft.latitude ?? 0, aircraft.longitude ?? 0], [aircraft.latitude, aircraft.longitude, positionOverride]);
  // Read through a ref so the handler identity never changes, which keeps
  // Leaflet from detaching and re-attaching listeners on every refresh.
  const aircraftRef = useRef(aircraft);
  aircraftRef.current = aircraft;
  const markerRef = useRef<L.Marker | null>(null);
  const selectAircraft = useCallback(() => {
    const current = aircraftRef.current;
    onSelect(liveAircraftToFlight(current));
  }, [onSelect]);
  // Select on press so a progressive tile refresh cannot replace the marker
  // between pointer-down and click-up. Keeping click covers keyboard/synthetic
  // activation while the selection itself is idempotent.
  const eventHandlers = useMemo(() => ({
    mousedown: selectAircraft,
    click: selectAircraft,
  }), [selectAircraft]);
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
  }, [selectAircraft]);
  if (positionOverride == null && (aircraft.latitude == null || aircraft.longitude == null)) return null;
  return <Marker ref={markerRef} position={position} icon={icon} eventHandlers={eventHandlers}>
    <Popup><strong className="mono">{aircraft.callsign || aircraft.icao24.toUpperCase()}</strong><br />{formatAltitude(aircraft.baro_altitude)} · {formatSpeed(aircraft.velocity)}</Popup>
  </Marker>;
}, areMarkersEqual);

const AircraftDot = memo(function AircraftDot({ aircraft, active, onSelect, positionOverride }: AircraftMarkerProps) {
  const position = useMemo<MarkerPosition>(() => positionOverride ?? [aircraft.latitude ?? 0, aircraft.longitude ?? 0], [aircraft.latitude, aircraft.longitude, positionOverride]);
  const color = altitudeColor(aircraft.baro_altitude ?? aircraft.geo_altitude);
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
    click: () => {
      const current = aircraftRef.current;
      onSelect({
        ...current,
        status: current.on_ground ? "on_ground" : "airborne",
        primary_time: 0,
        airline_name: "Live traffic",
      });
    },
  }), [onSelect]);
  if (positionOverride == null && (aircraft.latitude == null || aircraft.longitude == null)) return null;
  return <CircleMarker center={position} radius={active ? 5 : 3} pathOptions={pathOptions} eventHandlers={eventHandlers}>
    <Popup><strong className="mono">{aircraft.callsign || aircraft.icao24.toUpperCase()}</strong><br />{formatAltitude(aircraft.baro_altitude)} · {formatSpeed(aircraft.velocity)}</Popup>
  </CircleMarker>;
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

interface MapControllerProps {
  airport: Airport | null;
  flight: Flight | null;
  track?: TrackResponse;
  locateRequest: number;
  onLocationFound: (location: UserLocation) => void;
  onLocationError: (message: string) => void;
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

function getRouteFitPadding(map: L.Map): { paddingTopLeft: [number, number]; paddingBottomRight: [number, number] } {
  const mapRect = map.getContainer().getBoundingClientRect();
  const width = mapRect.width;
  const height = mapRect.height;
  let left = 18;
  let top = 18;
  let right = 18;
  let bottom = 18;

  // Keep the route in the part of the map that is actually readable. The
  // panels are siblings of the Leaflet container, so their dimensions are
  // available after the selected-flight drawer has entered the DOM. This is
  // preferable to hard-coding one desktop layout and hiding a long route
  // underneath the details sheet.
  const overlays = document.querySelectorAll<HTMLElement>(".query-panel, .results-panel, .details-drawer");
  overlays.forEach((overlay) => {
    const style = window.getComputedStyle(overlay);
    // Do not use opacity as a visibility test: the drawer intentionally fades
    // in from opacity 0, and route focus can arrive during that animation.
    if (style.visibility === "hidden" || style.display === "none") return;
    const rect = overlay.getBoundingClientRect();
    const overlapLeft = Math.max(0, rect.left - mapRect.left);
    const overlapTop = Math.max(0, rect.top - mapRect.top);
    const overlapRight = Math.min(width, rect.right - mapRect.left);
    const overlapBottom = Math.min(height, rect.bottom - mapRect.top);
    if (overlapRight <= overlapLeft || overlapBottom <= overlapTop) return;

    // A full-width bottom sheet only reduces the vertical map area. Applying
    // horizontal padding for it would collapse the safe rectangle to zero.
    const fullWidthSheet = rect.width >= width * 0.8;
    // The desktop query and results rails span almost the entire map height.
    // They reserve horizontal space only; treating them as top and bottom
    // overlays would collapse the usable height and force a world-level zoom.
    const fullHeightRail = rect.height >= height * 0.8 && !fullWidthSheet;
    const bottomSheet = rect.bottom >= mapRect.bottom - 24 && overlapTop > 24;
    const centralDetailsSheet = overlay.classList.contains("details-drawer") && overlapTop > 24;
    // The selected-flight drawer is a lower sheet on desktop. Its right edge
    // can cross the map midpoint, but using both edges as rectangular padding
    // would leave Leaflet with an invalid (negative-width) fit area. Reserve
    // its vertical footprint below and let the route use the top map band.
    const horizontalOverlay = !fullWidthSheet && !centralDetailsSheet;
    if (horizontalOverlay) {
      if (overlapLeft < width / 2) left = Math.max(left, overlapRight + 18);
      if (overlapRight > width / 2) right = Math.max(right, width - overlapLeft + 18);
    }
    if (!fullHeightRail) {
      if (bottomSheet) {
        bottom = Math.max(bottom, height - overlapTop + 18);
      } else {
        if (overlapTop < height / 2) top = Math.max(top, overlapBottom + 18);
        if (overlapBottom > height / 2) bottom = Math.max(bottom, height - overlapTop + 18);
      }
    }
  });

  const maxHorizontal = Math.max(36, width - 36);
  const maxVertical = Math.max(36, height - 36);
  if (left + right > maxHorizontal) {
    const ratio = maxHorizontal / (left + right);
    left = Math.max(18, left * ratio);
    right = Math.max(18, maxHorizontal - left);
  }
  if (top + bottom > maxVertical) {
    const ratio = maxVertical / (top + bottom);
    top = Math.max(18, top * ratio);
    bottom = Math.max(18, maxVertical - top);
  }

  return {
    paddingTopLeft: [Math.round(left), Math.round(top)],
    paddingBottomRight: [Math.round(right), Math.round(bottom)],
  };
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

function MapController({ airport, flight, track, locateRequest, onLocationFound, onLocationError }: MapControllerProps) {
  const map = useMap();
  useEffect(() => {
    const animate = !window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    if (track?.track.path?.length) {
      const bounds = L.latLngBounds(track.track.path.map((point) => [point[1], point[2]]));
      map.fitBounds(bounds.pad(0.24), {
        animate,
        duration: 0.55,
        easeLinearity: 0.2,
        maxZoom: 9,
        ...getRouteFitPadding(map),
      });
      return;
    }
    if (flight?.latitude != null && flight.longitude != null) {
      map.flyTo([flight.latitude, flight.longitude], Math.max(map.getZoom(), 8), { duration: 0.5, animate });
      return;
    }
    if (airport?.latitude != null && airport.longitude != null) {
      // Keep the live markers interactive while the initial airport viewport
      // settles. Route and aircraft focus still use the animated path above.
      map.flyTo([airport.latitude, airport.longitude], 8, { duration: 0, animate: false });
    }
  }, [airport, flight, map, track]);

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

interface FlightMapProps {
  airport: Airport | null;
  selectedFlight: Flight | null;
  previewFlight?: Flight | null;
  track?: TrackResponse;
  theme: MapTheme;
  liveEnabled: boolean;
  liveAvailable: boolean;
  liveProbePending?: boolean;
  expanded: boolean;
  onToggleLive: () => void;
  onToggleExpanded: () => void;
  onSelectFlight: (flight: Flight) => void;
  onLiveSnapshot?: (data: LiveFlightsResponse, airportIcao: string | null) => void;
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
  selectedFlight,
  previewFlight = null,
  track,
  theme,
  liveEnabled,
  liveAvailable,
  liveProbePending = false,
  expanded,
  onToggleLive,
  onToggleExpanded,
  onSelectFlight,
  onLiveSnapshot,
}: FlightMapProps) {
  const [bounds, setBounds] = useState<Bounds | null>(null);
  const handleBounds = useCallback((next: Bounds) => {
    setBounds((current) => (boundsEqual(current, next) ? current : next));
  }, []);
  const [locateRequest, setLocateRequest] = useState(0);
  const aircraftCacheRef = useRef(new Map<string, LiveAircraft>());
  const [liveRefresh, setLiveRefresh] = useState(0);
  const [liveState, setLiveState] = useState<ProgressiveLiveState>({
    data: null,
    fetching: false,
    loadedTiles: 0,
    totalTiles: 0,
    failedTiles: 0,
    error: null,
  });
  const [livePulse, setLivePulse] = useState(0);
  const [userLocation, setUserLocation] = useState<UserLocation | null>(null);
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
    const retained = new Map<string, LiveAircraft>();
    const freshAircraft = new Set<string>();
    const coveredTiles: Bounds[] = [];
    for (const aircraft of aircraftCacheRef.current.values()) {
      if (aircraft.latitude == null || aircraft.longitude == null) continue;
      if (bounds.lamin <= aircraft.latitude && aircraft.latitude <= bounds.lamax && bounds.lomin <= aircraft.longitude && aircraft.longitude <= bounds.lomax) {
        retained.set(aircraft.icao24, aircraft);
      }
    }
    aircraftCacheRef.current = retained;
    let loadedTiles = 0;
    let failedTiles = 0;
    let latestTime: number | null = null;
    let provider: string | undefined;
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
        for (const aircraft of response.states) {
          retained.set(aircraft.icao24, aircraft);
          freshAircraft.add(aircraft.icao24);
        }
        loadedTiles += 1;
        coveredTiles.push(tile);
        latestTime = Math.max(latestTime ?? 0, response.time ?? 0) || latestTime;
        provider = response.provider || provider;
        refreshAfterSeconds = Math.max(refreshAfterSeconds, response.refresh_after_seconds ?? 20);
        const data = snapshot();
        aircraftCacheRef.current = new Map(retained);
        setLiveState({ data, fetching: true, loadedTiles, totalTiles: totalViewportTiles, failedTiles, error: null });
        setLivePulse((value) => value + 1);
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
        for (const aircraft of response.states) retained.set(aircraft.icao24, aircraft);
        latestTime = response.time ?? latestTime;
        provider = response.provider || provider;
        refreshAfterSeconds = Math.max(refreshAfterSeconds, response.refresh_after_seconds ?? 20);
        const data = snapshot();
        aircraftCacheRef.current = new Map(retained);
        setLiveState({ data, fetching: true, loadedTiles, totalTiles: totalViewportTiles, failedTiles, error: null });
        setLivePulse((value) => value + 1);
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
        if (insideCoveredTile) retained.delete(icao24);
      }
      aircraftCacheRef.current = new Map(retained);
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
  const displayedLiveStates = displayedLiveData?.states ?? [];
  // A broad viewport can contain thousands of aircraft. Keep the detailed
  // plane icons for normal views, then switch to a lightweight canvas layer so
  // zooming out does not turn every aircraft into a DOM subtree.
  const denseTraffic = displayedLiveStates.length > 750;
  const liveStatus = liveState.error || liveState.failedTiles > 0
    ? hasLiveSnapshot ? `Live refresh delayed · showing last snapshot · ${liveState.loadedTiles}/${liveState.totalTiles} sectors loaded` : "Live traffic temporarily unavailable"
    : liveState.fetching
      ? liveState.loadedTiles > 0
        ? `${displayedLiveData?.count ?? 0} aircraft · loading sector ${Math.min(liveState.loadedTiles + 1, liveState.totalTiles)}/${liveState.totalTiles}`
        : "Scanning visible airspace…"
      : liveState.loadedTiles < liveState.totalTiles
        ? `${displayedLiveData?.count ?? 0} aircraft · ${liveState.loadedTiles}/${liveState.totalTiles} sectors shown`
        : `${displayedLiveData?.count ?? 0} aircraft in view`;

  const selectedIcao24 = selectedFlight ? selectedFlight.icao24.toLowerCase() : null;
  const trackPoints = useMemo(() => {
    if (selectedIcao24 && track?.track.icao24 && track.track.icao24.toLowerCase() !== selectedIcao24) return [];
    return (track?.track.path ?? []).filter((point) => Number.isFinite(point[1]) && Number.isFinite(point[2]));
  }, [selectedIcao24, track]);
  const trackPositions = useMemo(
    () => trackPoints.map((point) => [point[1], point[2]] as MarkerPosition),
    [trackPoints],
  );
  // OpenSky returns trace points in time order. Once the trace is available,
  // use its latest point for the selected marker so the aircraft sits exactly
  // on the route instead of remaining at a stale live-feed coordinate.
  const trackLatest = useMemo(() => {
    const point = trackPoints[trackPoints.length - 1];
    if (!point) return null;
    return {
      position: [point[1], point[2]] as MarkerPosition,
      altitude: point[3],
      heading: Number.isFinite(point[4]) ? point[4] : null,
    };
  }, [trackPoints]);
  const trackEndpoints = useMemo(() => {
    if (trackPoints.length < 2) return null;
    const first = trackPoints[0];
    const last = trackPoints[trackPoints.length - 1];
    return {
      start: [first[1], first[2]] as [number, number],
      end: [last[1], last[2]] as [number, number],
      startAltitude: first[3],
      endAltitude: last[3],
    };
  }, [trackPoints]);
  const trackSegments = useMemo(() => buildAltitudeSegments(trackPoints), [trackPoints]);
  const selectedIconKind = useMemo(() => selectedFlight ? aircraftIconKind(selectedFlight) : "unknown", [selectedFlight]);
  const selectedIcon = useMemo(
    () => planeIcon(trackLatest?.heading ?? selectedFlight?.true_track ?? 0, true, selectedFlight?.on_ground === true, selectedFlight?.icao24, selectedIconKind),
    [selectedFlight?.icao24, selectedFlight?.on_ground, selectedFlight?.true_track, selectedIconKind, trackLatest?.heading],
  );
  const selectedMapPosition = trackLatest?.position ?? (
    selectedFlight?.latitude != null && selectedFlight.longitude != null
      ? [selectedFlight.latitude, selectedFlight.longitude] as MarkerPosition
      : null
  );
  const routeStartIcon = useMemo(() => routeEndpointIcon("start"), []);
  const routeEndIcon = useMemo(() => routeEndpointIcon("end"), []);
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
  return (
    <section className="map-surface" aria-label="Live flight map">
      <MapContainer center={DEFAULT_CENTER} zoom={6} zoomControl={false} preferCanvas className="leaflet-map">
        <TileLayer
          attribution='&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors'
          url="https://tile.openstreetmap.org/{z}/{x}/{y}.png"
          className={theme === "dark" ? "map-tiles-dark" : ""}
          key={theme}
          maxZoom={19}
        />
        <BoundsReporter onBounds={handleBounds} />
        <MapController
          airport={airport}
          flight={selectedFlight}
          track={track}
          locateRequest={locateRequest}
          onLocationFound={handleLocationFound}
          onLocationError={handleLocationError}
        />
        <AircraftSelectionBridge aircraft={displayedLiveStates} onSelect={onSelectFlight} />
        {trackPositions.length > 1 && <Polyline
          positions={trackPositions}
          pathOptions={{
            color: theme === "dark" ? "#020b16" : "#f4fbff",
            weight: 9,
            opacity: 0.72,
            lineCap: "round",
            lineJoin: "round",
          }}
        />}
        {trackSegments.map((segment, index) => (
          <Polyline
            key={`${segment.color}-${index}`}
            positions={segment.positions}
            pathOptions={{ color: segment.color, weight: 4, opacity: 0.96, lineCap: "round", lineJoin: "round" }}
          />
        ))}
        {trackEndpoints && <>
          <Marker position={trackEndpoints.start} icon={routeStartIcon}>
            <Popup>
              <strong>Trace start</strong><br />
              <span className="mono">{formatAltitude(trackEndpoints.startAltitude)}</span>
            </Popup>
          </Marker>
          <Marker position={trackEndpoints.end} icon={routeEndIcon}>
            <Popup>
              <strong>Latest trace point</strong><br />
              <span className="mono">{formatAltitude(trackEndpoints.endAltitude)}</span>
            </Popup>
          </Marker>
        </>}
        {displayedLiveStates.map((aircraft) => denseTraffic ? (
          <AircraftDot
            key={aircraft.icao24}
            aircraft={aircraft}
            active={aircraft.icao24 === selectedFlight?.icao24 || aircraft.icao24 === previewFlight?.icao24}
            onSelect={onSelectFlight}
            positionOverride={aircraft.icao24 === selectedFlight?.icao24 ? trackLatest?.position : undefined}
          />
        ) : (
          <AircraftMarker
            key={aircraft.icao24}
            aircraft={aircraft}
            active={aircraft.icao24 === selectedFlight?.icao24 || aircraft.icao24 === previewFlight?.icao24}
            onSelect={onSelectFlight}
            positionOverride={aircraft.icao24 === selectedFlight?.icao24 ? trackLatest?.position : undefined}
            headingOverride={aircraft.icao24 === selectedFlight?.icao24 ? trackLatest?.heading : undefined}
          />
        ))}
        {selectedMapPosition && !displayedLiveStates.some((item) => item.icao24 === selectedFlight?.icao24) && (
          <Marker position={selectedMapPosition} icon={selectedIcon} />
        )}
        {userLocation && (
          <>
            <Circle
              center={[userLocation.latitude, userLocation.longitude]}
              radius={Math.max(userLocation.accuracy, 20)}
              pathOptions={{ color: "#38bdf8", weight: 1, opacity: 0.55, fillColor: "#38bdf8", fillOpacity: 0.1 }}
            />
            <Marker position={[userLocation.latitude, userLocation.longitude]} icon={locationIcon}>
              <Popup>
                <strong>Your location</strong><br />
                <span className="mono">Accuracy ±{Math.round(userLocation.accuracy)} m</span>
              </Popup>
            </Marker>
          </>
        )}
      </MapContainer>

      <div className="map-vignette" aria-hidden="true" />
      <div className="map-grid-overlay" aria-hidden="true" />
      <div className="map-label">
        <strong>{airport ? `${airport.name} airspace` : "European airspace"}</strong>
        <span className="map-label-meta"><span className={`system-dot ${liveAvailable ? "online" : "warning"}`} /> {displayedLiveData ? `${displayedLiveData.count} aircraft tracked` : "Awaiting traffic feed"}</span>
      </div>
      <div className="map-footer" aria-label="Map data sources">
        <span className={`system-dot ${liveAvailable ? "online" : "warning"}`} />
        <strong>{displayedLiveData ? `${displayedLiveData.count} targets` : "No targets"}</strong>
        <span className="map-footer-rule" aria-hidden="true" />
        <span>ADS-B · OSM</span>
      </div>
      <div className={`live-badge ${!liveAvailable ? "offline" : !liveEnabled ? "paused" : "active"}`} aria-live="polite">
        <span className={`pulse-dot ${liveEnabled ? "active" : ""}`} />
        <span className="live-badge-label">{!liveAvailable ? "OFFLINE" : !liveEnabled ? "PAUSED" : "LIVE"}</span>
        <span className="live-badge-copy">{!liveAvailable ? "OpenSky credentials required" : !liveEnabled ? "Live traffic paused" : liveStatus}</span>
        {liveEnabled && liveState.fetching && liveState.totalTiles > 1 && <span className="live-coverage-progress" aria-hidden="true"><span style={{ transform: `scaleX(${Math.max(0.04, liveState.loadedTiles / liveState.totalTiles)})` }} /></span>}
        {liveEnabled && (liveState.error || liveState.failedTiles > 0) && <button type="button" className="live-retry" onClick={() => setLiveRefresh((value) => value + 1)}>Retry</button>}
        {livePulse > 0 && <span key={livePulse} className="live-scan-line" aria-hidden="true" />}
      </div>
      <div className="map-controls">
        <button type="button" disabled={!liveAvailable} onClick={onToggleLive} aria-label={liveEnabled ? "Pause live traffic" : "Resume live traffic"} title={liveAvailable ? (liveEnabled ? "Pause live traffic" : "Resume live traffic") : "OpenSky credentials required"}>
          {liveEnabled ? <Pause size={17} /> : <Play size={17} />}
        </button>
        <button type="button" className={userLocation ? "location-active" : ""} onClick={requestLocation} aria-label="Locate me" title={userLocation ? "Update my location" : "Locate me"}><LocateFixed size={17} /></button>
        <button type="button" onClick={onToggleExpanded} aria-label={expanded ? "Exit full map" : "Open full map"} title={expanded ? "Exit full map" : "Full map"}>
          {expanded ? <Minimize2 size={17} /> : <Maximize2 size={17} />}
        </button>
        {trackPositions.length > 1 && <span title="Track loaded"><Crosshair size={16} /></span>}
      </div>
      {locationError && <div className="location-status" role="status">{locationError}</div>}
      {trackSegments.length > 0 && <AltitudeLegend compact className="map-altitude-legend" />}
    </section>
  );
}
