import { useEffect, useState, useSyncExternalStore } from "react";
import { useQuery } from "@tanstack/react-query";
import { aircraftPhoto } from "../api";
import { AircraftHoverStore } from "../aircraftHover";
import { aircraftModel } from "../aircraftIdentity";
import { flightLevelText, speedText, useUnits } from "../units";

export function AircraftHoverPreview({ store }: { store: AircraftHoverStore }) {
  const hovered = useSyncExternalStore(store.subscribe, store.getSnapshot, store.getSnapshot);
  const units = useUnits();
  const aircraft = hovered?.aircraft;
  const photoKey = aircraft ? `${aircraft.icao24}:${aircraft.registration ?? ""}` : "";
  const [readyKey, setReadyKey] = useState("");
  const [failedImage, setFailedImage] = useState("");

  useEffect(() => {
    if (!photoKey) return;
    const timer = window.setTimeout(() => setReadyKey(photoKey), 180);
    return () => window.clearTimeout(timer);
  }, [photoKey]);

  const photo = useQuery({
    queryKey: ["aircraft-photo", aircraft?.icao24, aircraft?.registration ?? null],
    queryFn: ({ signal }) => aircraftPhoto(aircraft!.icao24, aircraft!.registration, signal),
    enabled: Boolean(aircraft && readyKey === photoKey),
    staleTime: 24 * 60 * 60_000,
    gcTime: 30 * 60_000,
    retry: false,
  });

  if (!hovered || !aircraft) return null;
  const { x, y, width, height } = hovered;
  const left = Math.max(hovered.insetLeft, Math.min(x - 126, width - hovered.insetRight - 252));
  const above = y >= 270 || height - y < 270;
  const position = above ? { left, bottom: Math.max(12, height - y + 20) } : { left, top: y + 22 };
  const callsign = aircraft.callsign || aircraft.registration || aircraft.icao24.toUpperCase();
  const model = aircraftModel(aircraft.aircraft_type) ?? aircraft.aircraft_description ?? aircraft.aircraft_type;
  const altitude = aircraft.baro_altitude ?? aircraft.geo_altitude;
  const availablePhoto = photo.data && failedImage !== photo.data.src ? photo.data : null;

  return <aside className="aircraft-hover-preview" style={position} aria-label={`${callsign} preview`}
    onMouseEnter={store.cancelHide} onMouseLeave={() => store.hideLater(aircraft.icao24)}>
    <div className="aircraft-hover-heading"><strong>{callsign}</strong>{aircraft.registration && callsign !== aircraft.registration && <span>{aircraft.registration}</span>}</div>
    {model && <div className="aircraft-hover-model">{model}</div>}
    {availablePhoto && <figure className="aircraft-hover-photo">
      <a href={availablePhoto.link} target="_blank" rel="noopener noreferrer" aria-label={`Open photo of ${callsign} on ${availablePhoto.source ?? "Planespotters.net"}`}>
        <img src={availablePhoto.src} width={availablePhoto.width} height={availablePhoto.height}
          alt={`${availablePhoto.source === "Wikimedia Commons" ? `Aircraft matching ${aircraft.registration ?? callsign}` : `${callsign} aircraft`}, photo by ${availablePhoto.photographer}`}
          onError={() => setFailedImage(availablePhoto.src)} />
      </a>
      <figcaption>
        <span>{availablePhoto.attribution ?? `© ${availablePhoto.photographer}`}</span>
        <a href={availablePhoto.link} target="_blank" rel="noopener noreferrer">{availablePhoto.source ?? "Planespotters.net"}</a>
        {availablePhoto.licenseName && <span>{availablePhoto.licenseUrl
          ? <a href={availablePhoto.licenseUrl} target="_blank" rel="noopener noreferrer">{availablePhoto.licenseName}</a>
          : availablePhoto.licenseName}</span>}
        {availablePhoto.source === "Wikimedia Commons" && <span>Registration match</span>}
      </figcaption>
    </figure>}
    <div className="aircraft-hover-facts">
      {aircraft.on_ground ? <span>On the ground</span> : <>
        {altitude != null && <span>{flightLevelText(altitude, units)}</span>}
        {aircraft.velocity != null && <span>{speedText(aircraft.velocity, units)}</span>}
      </>}
    </div>
  </aside>;
}
