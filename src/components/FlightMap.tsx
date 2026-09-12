import { memo, useCallback, useEffect, useMemo, useRef, useState } from "react";
import { keepPreviousData, useQuery } from "@tanstack/react-query";
import L from "leaflet";
import { Circle, CircleMarker, MapContainer, Marker, Polyline, Popup, TileLayer, useMap } from "react-leaflet";
import { Crosshair, LocateFixed, Maximize2, Minimize2, Pause, Play } from "lucide-react";
import { api } from "../api";
import type { Airport, Bounds, Flight, LiveAircraft, LiveFlightsResponse, MapTheme, TrackResponse } from "../types";
import { altitudeColor, boundsEqual, formatAltitude, formatSpeed, quantizeBounds } from "../utils";
import { AltitudeLegend } from "./AltitudeLegend";

const DEFAULT_CENTER: [number, number] = [48.5, 2.2];

function planeIcon(heading = 0, active = false, onGround = false, icao24?: string) {
  return L.divIcon({
    className: "aircraft-marker-wrap",
    html: `<span class="aircraft-marker ${active ? "active" : ""} ${onGround ? "ground" : ""}"${icao24 ? ` data-icao24="${icao24}"` : ""} style="--heading:${Number.isFinite(heading) ? heading : 0}deg"><svg viewBox="0 0 24 24" aria-hidden="true"><path d="M21 16v-2l-8-5V3.5A1.5 1.5 0 0 0 11.5 2 1.5 1.5 0 0 0 10 3.5V9l-8 5v2l8-2.5V19l-2 1.5V22l3.5-1 3.5 1v-1.5L13 19v-5.5l8 2.5z"/></svg></span>`,
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

  useEffect(() => {
    const container = map.getContainer();
    const selectFromEvent = (event: Event) => {
      const target = event.target;
      if (!(target instanceof HTMLElement)) return;
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
    container.addEventListener("mousedown", selectFromEvent, true);
    container.addEventListener("click", selectFromEvent, true);
    return () => {
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

function areMarkersEqual(
  previous: { aircraft: LiveAircraft; active: boolean; onSelect: (flight: Flight) => void },
  next: { aircraft: LiveAircraft; active: boolean; onSelect: (flight: Flight) => void },
) {
  if (previous.active !== next.active || previous.onSelect !== next.onSelect) return false;
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
    && a.velocity === b.velocity;
}

const AircraftMarker = memo(function AircraftMarker({ aircraft, active, onSelect }: {
  aircraft: LiveAircraft; active: boolean; onSelect: (flight: Flight) => void;
}) {
  const icon = useMemo(() => planeIcon(aircraft.true_track ?? 0, active, aircraft.on_ground === true, aircraft.icao24), [aircraft.icao24, aircraft.true_track, aircraft.on_ground, active]);
  const position = useMemo<[number, number]>(() => [aircraft.latitude ?? 0, aircraft.longitude ?? 0], [aircraft.latitude, aircraft.longitude]);
  // Read through a ref so the handler identity never changes, which keeps
  // Leaflet from detaching and re-attaching listeners on every refresh.
  const aircraftRef = useRef(aircraft);
  aircraftRef.current = aircraft;
  const markerRef = useRef<L.Marker | null>(null);
  const selectAircraft = useCallback(() => {
    const current = aircraftRef.current;
    onSelect(liveAircraftToFlight(current));
  }, [onSelect]);
  const eventHandlers = useMemo(() => ({ click: selectAircraft }), [selectAircraft]);
  useEffect(() => {
    // Firefox can swallow Leaflet's delegated click while a map pan is still
    // settling. Listening on the marker element itself keeps aircraft
    // selection responsive during that short transition.
    let element: HTMLElement | null = null;
    let timer: ReturnType<typeof setTimeout> | undefined;
    let attempts = 0;
    const bind = () => {
      element = markerRef.current?.getElement() ?? null;
      if (element) {
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
      element?.removeEventListener("click", selectAircraft, true);
    };
  }, [selectAircraft]);
  if (aircraft.latitude == null || aircraft.longitude == null) return null;
  return <Marker ref={markerRef} position={position} icon={icon} eventHandlers={eventHandlers}>
    <Popup><strong className="mono">{aircraft.callsign || aircraft.icao24.toUpperCase()}</strong><br />{formatAltitude(aircraft.baro_altitude)} · {formatSpeed(aircraft.velocity)}</Popup>
  </Marker>;
}, areMarkersEqual);

const AircraftDot = memo(function AircraftDot({ aircraft, active, onSelect }: {
  aircraft: LiveAircraft; active: boolean; onSelect: (flight: Flight) => void;
}) {
  const position = useMemo<[number, number]>(() => [aircraft.latitude ?? 0, aircraft.longitude ?? 0], [aircraft.latitude, aircraft.longitude]);
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
  if (aircraft.latitude == null || aircraft.longitude == null) return null;
  return <CircleMarker center={position} radius={active ? 5 : 3} pathOptions={pathOptions} eventHandlers={eventHandlers}>
    <Popup><strong className="mono">{aircraft.callsign || aircraft.icao24.toUpperCase()}</strong><br />{formatAltitude(aircraft.baro_altitude)} · {formatSpeed(aircraft.velocity)}</Popup>
  </CircleMarker>;
}, areMarkersEqual);

interface BoundsReporterProps { onBounds: (bounds: Bounds) => void }
function BoundsReporter({ onBounds }: BoundsReporterProps) {
  const map = useMap();
  useEffect(() => {
    let timer: ReturnType<typeof setTimeout>;
    function report() {
      clearTimeout(timer);
      clearTimeout(initialTimer);
      timer = setTimeout(() => {
        const bounds = map.getBounds();
        onBounds(quantizeBounds({
          lamin: Math.max(-90, bounds.getSouth()),
          lomin: bounds.getWest(),
          lamax: Math.min(90, bounds.getNorth()),
          lomax: bounds.getEast(),
        }));
      }, 250);
    }
    map.on("moveend", report);
    const initialTimer = setTimeout(report, 1_000);
    // MapController may immediately fly to the selected airport. Waiting one
    // settle window avoids fetching the throwaway default viewport first.
    const observer = new ResizeObserver(() => map.invalidateSize({ pan: false }));
    observer.observe(map.getContainer());
    return () => { clearTimeout(timer); clearTimeout(initialTimer); map.off("moveend", report); observer.disconnect(); };
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
      map.fitBounds(bounds.pad(0.18), { animate, maxZoom: 12 });
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
  expanded: boolean;
  onToggleLive: () => void;
  onToggleExpanded: () => void;
  onSelectFlight: (flight: Flight) => void;
  onLiveSnapshot?: (data: LiveFlightsResponse, airportIcao: string | null) => void;
}

export function FlightMap({
  airport,
  selectedFlight,
  previewFlight = null,
  track,
  theme,
  liveEnabled,
  liveAvailable,
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
  const [lastLiveData, setLastLiveData] = useState<LiveFlightsResponse | null>(null);
  const [livePulse, setLivePulse] = useState(0);
  const [userLocation, setUserLocation] = useState<UserLocation | null>(null);
  const [locationError, setLocationError] = useState<string | null>(null);
  const airportIcaoRef = useRef<string | null>(airport?.icao ?? null);
  useEffect(() => {
    airportIcaoRef.current = airport?.icao ?? null;
  }, [airport?.icao]);
  const liveQuery = useQuery({
    queryKey: ["live-flights", bounds],
    queryFn: ({ signal }) => api.liveFlights(bounds!, signal),
    placeholderData: keepPreviousData,
    staleTime: 15_000,
    gcTime: 60_000,
    // The API filters the provider response to the viewport. Let it handle
    // wide bounds too, otherwise a zoom-out silently freezes the last box.
    enabled: liveAvailable && liveEnabled && bounds !== null,
    // The backend returns a provider-aware cadence. OpenSky's free quota is
    // credit based (wide boxes cost more), while the public ADS-B fallback can
    // safely refresh faster. Keeping this decision server-side prevents a
    // zoomed-out map from accidentally polling an expensive box every 20s.
    refetchInterval: (query) => {
      if (!liveEnabled) return false;
      const seconds = query.state.data?.refresh_after_seconds;
      return Math.max(20_000, (seconds ?? 20) * 1_000);
    },
    retry: 1,
    retryDelay: 1_500,
  });

  useEffect(() => {
    if (!liveQuery.data || liveQuery.data.degraded || liveQuery.isPlaceholderData) return;
    setLastLiveData(liveQuery.data);
    setLivePulse((value) => value + 1);
    onLiveSnapshot?.(liveQuery.data, airportIcaoRef.current);
  }, [liveQuery.data, liveQuery.isPlaceholderData, onLiveSnapshot]);

  const degradedLiveData = liveQuery.data?.degraded ? liveQuery.data : null;
  const displayedLiveData = degradedLiveData && lastLiveData
    ? (degradedLiveData.states.length >= lastLiveData.states.length ? degradedLiveData : lastLiveData)
    : (liveQuery.data ?? lastLiveData);
  const hasLiveSnapshot = Boolean(
    lastLiveData
      || (liveQuery.data && (!liveQuery.data.degraded || liveQuery.data.states.length > 0)),
  );
  const displayedLiveStates = displayedLiveData?.states ?? [];
  // A broad viewport can contain thousands of aircraft. Keep the detailed
  // plane icons for normal views, then switch to a lightweight canvas layer so
  // zooming out does not turn every aircraft into a DOM subtree.
  const denseTraffic = displayedLiveStates.length > 750;
  const liveStatus = liveQuery.isError || liveQuery.data?.degraded
    ? hasLiveSnapshot ? "Live refresh delayed · showing last snapshot" : liveQuery.data?.notice ?? "Live traffic temporarily unavailable"
    : liveQuery.isPending
      ? "Loading live traffic…"
      : liveQuery.isFetching
        ? "Updating live traffic…"
        : `${displayedLiveData?.count ?? 0} aircraft in view`;

  const trackPositions = useMemo(
    () => (track?.track.path ?? [])
      .filter((point) => Number.isFinite(point[1]) && Number.isFinite(point[2]))
      .map((point) => [point[1], point[2]] as [number, number]),
    [track],
  );
  const trackSegments = useMemo(() => buildAltitudeSegments(track?.track.path ?? []), [track]);
  const selectedIcon = useMemo(
    () => planeIcon(selectedFlight?.true_track ?? 0, true, selectedFlight?.on_ground === true),
    [selectedFlight?.on_ground, selectedFlight?.true_track],
  );
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
        {trackSegments.map((segment, index) => (
          <Polyline key={`${segment.color}-${index}`} positions={segment.positions} pathOptions={{ color: segment.color, weight: 4, opacity: 0.9 }} />
        ))}
        {displayedLiveStates.map((aircraft) => denseTraffic ? (
          <AircraftDot key={aircraft.icao24} aircraft={aircraft} active={aircraft.icao24 === selectedFlight?.icao24 || aircraft.icao24 === previewFlight?.icao24} onSelect={onSelectFlight} />
        ) : (
          <AircraftMarker key={aircraft.icao24} aircraft={aircraft} active={aircraft.icao24 === selectedFlight?.icao24 || aircraft.icao24 === previewFlight?.icao24} onSelect={onSelectFlight} />
        ))}
        {selectedFlight?.latitude != null && selectedFlight.longitude != null && !displayedLiveStates.some((item) => item.icao24 === selectedFlight.icao24) && (
          <Marker position={[selectedFlight.latitude, selectedFlight.longitude]} icon={selectedIcon} />
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
        {liveEnabled && (liveQuery.isError || liveQuery.data?.degraded) && <button type="button" className="live-retry" onClick={() => void liveQuery.refetch()}>Retry</button>}
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
