import { useEffect, useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import L from "leaflet";
import { MapContainer, Marker, Polyline, Popup, TileLayer, useMap, useMapEvents } from "react-leaflet";
import { Crosshair, LocateFixed, Maximize2, Minimize2, Pause, Play } from "lucide-react";
import { api, readableApiError } from "../api";
import type { Airport, Bounds, Flight, MapTheme, TrackResponse } from "../types";
import { formatAltitude, formatSpeed } from "../utils";

const DEFAULT_CENTER: [number, number] = [48.5, 2.2];

function planeIcon(heading = 0, active = false, onGround = false) {
  return L.divIcon({
    className: "aircraft-marker-wrap",
    html: `<span class="aircraft-marker ${active ? "active" : ""} ${onGround ? "ground" : ""}" style="--heading:${Number.isFinite(heading) ? heading : 0}deg"><svg viewBox="0 0 24 24" aria-hidden="true"><path d="M21 16v-2l-8-5V3.5A1.5 1.5 0 0 0 11.5 2 1.5 1.5 0 0 0 10 3.5V9l-8 5v2l8-2.5V19l-2 1.5V22l3.5-1 3.5 1v-1.5L13 19v-5.5l8 2.5z"/></svg></span>`,
    iconSize: [30, 30],
    iconAnchor: [15, 15],
  });
}

interface BoundsReporterProps { onBounds: (bounds: Bounds) => void }
function BoundsReporter({ onBounds }: BoundsReporterProps) {
  const map = useMapEvents({
    moveend: report,
    zoomend: report,
  });

  function report() {
    const bounds = map.getBounds();
    onBounds({ lamin: bounds.getSouth(), lomin: bounds.getWest(), lamax: bounds.getNorth(), lomax: bounds.getEast() });
  }

  useEffect(() => {
    const bounds = map.getBounds();
    onBounds({ lamin: bounds.getSouth(), lomin: bounds.getWest(), lamax: bounds.getNorth(), lomax: bounds.getEast() });
  }, [map, onBounds]);
  return null;
}

interface MapControllerProps {
  airport: Airport | null;
  flight: Flight | null;
  track?: TrackResponse;
  locateRequest: number;
}

function MapController({ airport, flight, track, locateRequest }: MapControllerProps) {
  const map = useMap();
  useEffect(() => {
    if (track?.track.path?.length) {
      const bounds = L.latLngBounds(track.track.path.map((point) => [point[1], point[2]]));
      map.fitBounds(bounds.pad(0.18), { animate: true });
      return;
    }
    if (flight?.latitude != null && flight.longitude != null) {
      map.flyTo([flight.latitude, flight.longitude], Math.max(map.getZoom(), 8), { duration: 0.8 });
      return;
    }
    if (airport?.latitude != null && airport.longitude != null) {
      map.flyTo([airport.latitude, airport.longitude], 8, { duration: 0.8 });
    }
  }, [airport, flight, map, track]);

  useEffect(() => {
    if (!locateRequest) return;
    map.locate({ setView: true, maxZoom: 11, enableHighAccuracy: true });
  }, [locateRequest, map]);
  return null;
}

interface FlightMapProps {
  airport: Airport | null;
  selectedFlight: Flight | null;
  track?: TrackResponse;
  theme: MapTheme;
  liveEnabled: boolean;
  liveAvailable: boolean;
  expanded: boolean;
  onToggleLive: () => void;
  onToggleExpanded: () => void;
  onSelectFlight: (flight: Flight) => void;
}

export function FlightMap({
  airport,
  selectedFlight,
  track,
  theme,
  liveEnabled,
  liveAvailable,
  expanded,
  onToggleLive,
  onToggleExpanded,
  onSelectFlight,
}: FlightMapProps) {
  const [bounds, setBounds] = useState<Bounds | null>(null);
  const [locateRequest, setLocateRequest] = useState(0);
  const area = bounds ? Math.abs(bounds.lamax - bounds.lamin) * Math.abs(bounds.lomax - bounds.lomin) : Infinity;
  const liveQuery = useQuery({
    queryKey: ["live-flights", bounds],
    queryFn: () => api.liveFlights(bounds!),
    enabled: liveEnabled && bounds !== null && area <= 350,
    refetchInterval: liveEnabled ? 15_000 : false,
    retry: false,
  });

  const trackPositions = useMemo(
    () => (track?.track.path ?? []).map((point) => [point[1], point[2]] as [number, number]),
    [track],
  );
  const selectedIcon = useMemo(
    () => planeIcon(selectedFlight?.true_track ?? 0, true, selectedFlight?.on_ground === true),
    [selectedFlight?.on_ground, selectedFlight?.true_track],
  );
  return (
    <section className="map-surface" aria-label="Live flight map">
      <MapContainer center={DEFAULT_CENTER} zoom={6} zoomControl={false} preferCanvas className="leaflet-map">
        <TileLayer
          key={theme}
          attribution='&copy; OpenStreetMap contributors &copy; CARTO'
          url={theme === "dark"
            ? "https://{s}.basemaps.cartocdn.com/dark_all/{z}/{x}/{y}{r}.png"
            : "https://{s}.basemaps.cartocdn.com/light_all/{z}/{x}/{y}{r}.png"}
        />
        <BoundsReporter onBounds={setBounds} />
        <MapController airport={airport} flight={selectedFlight} track={track} locateRequest={locateRequest} />
        {trackPositions.length > 1 && <Polyline positions={trackPositions} pathOptions={{ color: "#7ff4c9", weight: 4, opacity: 0.88 }} />}
        {liveQuery.data?.states.map((aircraft) => (
          aircraft.latitude != null && aircraft.longitude != null ? (
            <Marker
              key={aircraft.icao24}
              position={[aircraft.latitude, aircraft.longitude]}
              icon={planeIcon(aircraft.true_track ?? 0, aircraft.icao24 === selectedFlight?.icao24, aircraft.on_ground === true)}
              eventHandlers={{ click: () => onSelectFlight({ ...aircraft, status: aircraft.on_ground ? "on_ground" : "airborne", primary_time: 0, airline_name: "Live traffic" }) }}
            >
              <Popup>
                <strong className="mono">{aircraft.callsign || aircraft.icao24.toUpperCase()}</strong><br />
                {formatAltitude(aircraft.baro_altitude)} · {formatSpeed(aircraft.velocity)}
              </Popup>
            </Marker>
          ) : null
        ))}
        {selectedFlight?.latitude != null && selectedFlight.longitude != null && !liveQuery.data?.states.some((item) => item.icao24 === selectedFlight.icao24) && (
          <Marker position={[selectedFlight.latitude, selectedFlight.longitude]} icon={selectedIcon} />
        )}
      </MapContainer>

      <div className="map-vignette" aria-hidden="true" />
      <div className="map-grid-overlay" aria-hidden="true" />
      <div className="map-label">
        <span className="eyebrow">Live viewport</span>
        <strong>{airport ? `${airport.name} airspace` : "European airspace"}</strong>
      </div>
      <div className="live-badge" aria-live="polite">
        <span className={`pulse-dot ${liveEnabled ? "active" : ""}`} />
        {!liveAvailable ? "OpenSky credentials required" : area > 350 ? "Zoom in for live traffic" : liveQuery.isError ? readableApiError(liveQuery.error) : liveEnabled ? `${liveQuery.data?.count ?? 0} aircraft in view` : "Live traffic paused"}
      </div>
      <div className="map-controls">
        <button type="button" disabled={!liveAvailable} onClick={onToggleLive} aria-label={liveEnabled ? "Pause live traffic" : "Resume live traffic"} title={liveAvailable ? (liveEnabled ? "Pause live traffic" : "Resume live traffic") : "OpenSky credentials required"}>
          {liveEnabled ? <Pause size={17} /> : <Play size={17} />}
        </button>
        <button type="button" onClick={() => setLocateRequest((value) => value + 1)} aria-label="Locate me" title="Locate me"><LocateFixed size={17} /></button>
        <button type="button" onClick={onToggleExpanded} aria-label={expanded ? "Exit full map" : "Open full map"} title={expanded ? "Exit full map" : "Full map"}>
          {expanded ? <Minimize2 size={17} /> : <Maximize2 size={17} />}
        </button>
        {trackPositions.length > 1 && <span title="Track loaded"><Crosshair size={16} /></span>}
      </div>
    </section>
  );
}
