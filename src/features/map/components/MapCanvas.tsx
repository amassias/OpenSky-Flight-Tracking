import { useEffect, useRef, useState, type ReactNode } from "react";
import type { Map as GlMap } from "maplibre-gl";
import type { MapTheme } from "../../../shared/types";
import { webglAvailable } from "../aircraftLayer";
import { basemapPaint } from "../basemap";
import { toGlZoom } from "../mapCamera";
import { loadMapLibre, MapContext, type MapHandle } from "../mapHandle";

const ATTRIBUTION = '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> | <a href="https://opensky-network.org">OpenSky</a>, <a href="https://adsb.fi">adsb.fi</a>, <a href="https://adsb.lol">adsb.lol</a>';
const DEFAULT_CENTER: [number, number] = [48.5, 2.2];

interface MapCanvasProps {
  theme: MapTheme;
  /** Where the camera opens, as [latitude, longitude] and the shared zoom scale. */
  initialView?: { center: [number, number]; zoom: number };
  /** WebGL or the library could not start: the map cannot be drawn. */
  onUnavailable: () => void;
  onReady?: (handle: MapHandle | null) => void;
  children?: ReactNode;
}

/**
 * The map (ADR 0010): MapLibre GL with a raster basemap. It loads as its own chunk
 * after the first paint, and its layers, markers and controls mount as children
 * once the style is ready.
 */
export function MapCanvas({ theme, initialView, onUnavailable, onReady, children }: MapCanvasProps) {
  const container = useRef<HTMLDivElement>(null);
  const [handle, setHandle] = useState<MapHandle | null>(null);
  const latest = useRef({ theme, initialView, onUnavailable, onReady });
  latest.current = { theme, initialView, onUnavailable, onReady };

  useEffect(() => {
    const host = container.current;
    if (!host) return;
    let cancelled = false;
    let created: GlMap | null = null;
    if (!webglAvailable()) { latest.current.onUnavailable(); return; }

    loadMapLibre().then((gl) => {
      if (cancelled) return;
      try {
        const view = latest.current.initialView;
        created = new gl.Map({
          container: host,
          style: {
            version: 8,
            sources: { osm: { type: "raster", tiles: ["https://tile.openstreetmap.org/{z}/{x}/{y}.png"], tileSize: 256, maxzoom: 19, attribution: ATTRIBUTION } },
            layers: [{ id: "basemap", type: "raster", source: "osm", paint: basemapPaint(latest.current.theme) }],
          },
          center: [(view?.center ?? DEFAULT_CENTER)[1], (view?.center ?? DEFAULT_CENTER)[0]],
          zoom: toGlZoom(view?.zoom ?? 6),
          minZoom: toGlZoom(1),
          maxZoom: toGlZoom(19),
          dragRotate: false,
          pitchWithRotate: false,
          touchPitch: false,
          fadeDuration: 0,
          attributionControl: false,
        });
      } catch {
        latest.current.onUnavailable();
        return;
      }
      const map = created;
      map.touchZoomRotate.disableRotation();
      map.addControl(new gl.AttributionControl({ compact: false }), "bottom-right");
      map.getCanvas().dataset.aircraftRenderer = "maplibre-gl";
      map.on("error", (event) => { if (/webgl/i.test(String(event.error?.message))) latest.current.onUnavailable(); });
      map.once("load", () => {
        if (cancelled) return;
        // Development builds expose the map so a browser test can switch a layer off to measure it.
        if (import.meta.env.DEV) (window as unknown as { __skytraceMap?: GlMap }).__skytraceMap = map;
        const next = { map, gl };
        setHandle(next);
        latest.current.onReady?.(next);
      });
    }).catch(() => { if (!cancelled) latest.current.onUnavailable(); });

    return () => {
      cancelled = true;
      setHandle(null);
      latest.current.onReady?.(null);
      created?.remove();
      created = null;
    };
  }, []);

  useEffect(() => {
    if (!handle) return;
    for (const [name, value] of Object.entries(basemapPaint(theme))) handle.map.setPaintProperty("basemap", name, value);
  }, [handle, theme]);

  // The map follows its container when a panel slides or the window changes size.
  useEffect(() => {
    const host = container.current;
    if (!handle || !host) return;
    const observer = new ResizeObserver(() => handle.map.resize());
    observer.observe(host);
    return () => observer.disconnect();
  }, [handle]);

  return (
    <div ref={container} className="flight-map">
      {handle && <MapContext.Provider value={handle}>{children}</MapContext.Provider>}
    </div>
  );
}
