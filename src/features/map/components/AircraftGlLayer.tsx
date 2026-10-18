import { useEffect, useRef } from "react";
import L from "leaflet";
import { useMap } from "react-leaflet";
import type { Map as GlMap, GeoJSONSource } from "maplibre-gl";
import type { Flight, LiveAircraft, MapTheme } from "../../../shared/types";
import { liveAircraftToFlight } from "../../../shared/utils";
import { subscribeToFrame } from "../aircraftMotion";
import { glyphImageUrl } from "../aircraftGlyph";
import { AircraftFrames, updateIntervalMs, webglAvailable, type DrawnAircraft } from "../aircraftLayer";

/** Texture size of one silhouette; displayed scaled to its `size` in CSS pixels. */
const IMAGE_PIXELS = 64;
/** Pointer distance, in CSS pixels, within which an aircraft is picked. */
const PICK_RADIUS = 14;
const PANE = "aircraft-gl";

interface AircraftGlLayerProps {
  aircraft: readonly LiveAircraft[];
  theme: MapTheme;
  previewId: string | null;
  /** The selected aircraft keeps its detailed DOM marker. */
  excludeId: string | null;
  /** Focus-labelled aircraft keep their detailed DOM markers too. */
  excludeIds?: ReadonlySet<string>;
  onSelect: (flight: Flight) => void;
  onHover: (aircraft: LiveAircraft, pointer: { x: number; y: number }) => void;
  onLeave: (icao24: string) => void;
  /** WebGL or the library could not start: the caller falls back to its canvas layer. */
  onUnavailable: () => void;
}

/**
 * Draws every aircraft with MapLibre GL (ADR 0009, prototype #12) as one symbol
 * layer on a transparent canvas kept in step with the Leaflet camera. Leaflet
 * still owns the basemap, gestures and the detailed markers; this layer owns
 * the thousands of silhouettes. The whole source is replaced each tick with
 * `setData`, which measured cheaper than incremental updates when every
 * aircraft moves.
 */
export function AircraftGlLayer({ aircraft, theme, previewId, excludeId, excludeIds, onSelect, onHover, onLeave, onUnavailable }: AircraftGlLayerProps) {
  const map = useMap();
  const frames = useRef(new AircraftFrames());
  const live = useRef({ aircraft, theme, previewId, excludeId, excludeIds, onSelect, onHover, onLeave, onUnavailable });
  live.current = { aircraft, theme, previewId, excludeId, excludeIds, onSelect, onHover, onLeave, onUnavailable };
  const refresh = useRef<(() => void) | null>(null);

  useEffect(() => {
    frames.current.setAircraft(aircraft);
    refresh.current?.();
  }, [aircraft]);
  useEffect(() => { refresh.current?.(); }, [theme, previewId, excludeId, excludeIds]);

  useEffect(() => {
    let cancelled = false;
    let glMap: GlMap | null = null;
    const cleanups: Array<() => void> = [];
    if (!webglAvailable()) { live.current.onUnavailable(); return; }

    const pane = map.getPane(PANE) ?? map.createPane(PANE);
    pane.style.zIndex = "450";
    pane.style.pointerEvents = "none";
    const host = L.DomUtil.create("div", "aircraft-gl", pane);
    host.setAttribute("aria-hidden", "true");
    host.dataset.aircraftDrawn = "0";
    const size = map.getSize();
    host.style.width = `${size.x}px`;
    host.style.height = `${size.y}px`;
    cleanups.push(() => host.remove());

    import("maplibre-gl").then(({ default: maplibregl }) => {
      if (cancelled) return;
      let created: GlMap;
      try {
        created = new maplibregl.Map({
          container: host, style: { version: 8, sources: {}, layers: [] }, interactive: false, attributionControl: false,
          fadeDuration: 0, renderWorldCopies: false, center: [map.getCenter().lng, map.getCenter().lat], zoom: map.getZoom() - 1,
        });
      } catch {
        live.current.onUnavailable();
        return;
      }
      glMap = created;
      created.on("error", (event) => { if (/webgl/i.test(String(event.error?.message))) live.current.onUnavailable(); });
      created.getCanvas().dataset.aircraftRenderer = "maplibre-gl";
      created.getCanvas().removeAttribute("tabindex");

      // Leaflet zoom z is MapLibre zoom z - 1 (256 px against 512 px tiles).
      const sync = () => {
        const origin = map.containerPointToLayerPoint([0, 0]);
        L.DomUtil.setPosition(host, origin);
        const next = map.getSize();
        if (host.clientWidth !== next.x || host.clientHeight !== next.y) {
          host.style.width = `${next.x}px`;
          host.style.height = `${next.y}px`;
          created.resize();
        }
        const center = map.getCenter();
        created.jumpTo({ center: [center.lng, center.lat], zoom: map.getZoom() - 1 });
      };
      const animateZoom = (event: L.ZoomAnimEvent) => {
        created.easeTo({ center: [event.center.lng, event.center.lat], zoom: event.zoom - 1, duration: 250, easing: (t) => t });
      };
      map.on("move zoom viewreset resize moveend zoomend", sync);
      map.on("zoomanim", animateZoom);
      cleanups.push(() => { map.off("move zoom viewreset resize moveend zoomend", sync); map.off("zoomanim", animateZoom); });

      const ready = new Set<string>();
      const loading = new Set<string>();
      const iconKey = (item: DrawnAircraft) => `${item.shape}|${item.color}|${item.hollow ? 1 : 0}`;
      const loadIcon = (item: DrawnAircraft, key: string) => {
        if (loading.has(key)) return;
        loading.add(key);
        const image = new Image();
        image.onload = () => {
          if (cancelled) return;
          const canvas = document.createElement("canvas");
          canvas.width = canvas.height = IMAGE_PIXELS;
          const context = canvas.getContext("2d");
          if (!context) return;
          context.drawImage(image, 0, 0, IMAGE_PIXELS, IMAGE_PIXELS);
          created.addImage(key, context.getImageData(0, 0, IMAGE_PIXELS, IMAGE_PIXELS), { pixelRatio: 1 });
          ready.add(key);
        };
        image.src = glyphImageUrl(item.glyph, item.color, item.hollow);
      };

      let drawn: DrawnAircraft[] = [];
      let lastUpdate = 0;
      let source: GeoJSONSource | null = null;
      const update = (now = Date.now() / 1000) => {
        if (!source) return;
        const { theme: currentTheme, previewId: preview, excludeId: excluded, excludeIds: excludedMore } = live.current;
        drawn = frames.current.frame(now, { theme: currentTheme, previewId: preview, excludeId: excluded, excludeIds: excludedMore });
        const features: GeoJSON.Feature[] = [];
        const shown: DrawnAircraft[] = [];
        for (const item of drawn) {
          const key = iconKey(item);
          if (!ready.has(key)) { loadIcon(item, key); continue; }
          shown.push(item);
          features.push({ type: "Feature", properties: { icon: key, rot: item.rotation, scale: item.size / IMAGE_PIXELS, opacity: item.opacity },
            geometry: { type: "Point", coordinates: [item.lng, item.lat] } });
        }
        drawn = shown;
        lastUpdate = now * 1000;
        source.setData({ type: "FeatureCollection", features });
        host.dataset.aircraftDrawn = String(features.length);
      };
      refresh.current = () => update();

      created.on("load", () => {
        if (cancelled) return;
        created.addSource("aircraft", { type: "geojson", data: { type: "FeatureCollection", features: [] } });
        created.addLayer({
          id: "aircraft", type: "symbol", source: "aircraft",
          layout: {
            "icon-image": ["get", "icon"], "icon-size": ["get", "scale"], "icon-rotate": ["get", "rot"],
            "icon-rotation-alignment": "map", "icon-allow-overlap": true, "icon-ignore-placement": true,
          },
          paint: { "icon-opacity": ["get", "opacity"] },
        });
        source = created.getSource("aircraft") as GeoJSONSource;
        sync();
        frames.current.setAircraft(live.current.aircraft);
        update();
      });
      cleanups.push(subscribeToFrame((now) => {
        // 10 Hz at most (the prototype shows it halves the cost of 20 Hz), slower when the view is too wide for motion to show.
        if (now * 1000 - lastUpdate < updateIntervalMs(map.getZoom(), map.getCenter().lat)) return;
        update(now);
      }));

      // Picking projects the drawn aircraft rather than asking WebGL, so it
      // costs one pass over the list per pointer event and works the same on touch.
      const pick = (point: L.Point): DrawnAircraft | null => {
        let best: DrawnAircraft | null = null;
        let bestDistance = PICK_RADIUS * PICK_RADIUS;
        // Cheap degree-box rejection first; projecting 10,000 aircraft per pointer event would not be.
        const around = map.containerPointToLatLng(point);
        const tolerance = (PICK_RADIUS * 1.5 * 360) / (256 * 2 ** map.getZoom());
        for (const item of drawn) {
          if (Math.abs(item.lat - around.lat) > tolerance || Math.abs(item.lng - around.lng) > tolerance) continue;
          const at = map.latLngToContainerPoint([item.lat, item.lng]);
          const distance = (at.x - point.x) ** 2 + (at.y - point.y) ** 2;
          if (distance <= bestDistance) { best = item; bestDistance = distance; }
        }
        return best;
      };
      const byId = () => new Map(live.current.aircraft.map(item => [item.icao24, item]));
      const container = map.getContainer();
      let hovered: string | null = null;
      const onClick = (event: L.LeafletMouseEvent) => {
        const hit = pick(event.containerPoint);
        const item = hit && byId().get(hit.id);
        if (item) live.current.onSelect(liveAircraftToFlight(item));
      };
      let lastMove = 0;
      const onMove = (event: L.LeafletMouseEvent) => {
        if (performance.now() - lastMove < 50) return;
        lastMove = performance.now();
        const hit = pick(event.containerPoint);
        container.classList.toggle("aircraft-gl-hover", Boolean(hit));
        if (hit?.id === hovered) return;
        if (hovered) live.current.onLeave(hovered);
        hovered = hit?.id ?? null;
        const item = hit && byId().get(hit.id);
        if (item && window.matchMedia("(hover: hover) and (pointer: fine)").matches) {
          live.current.onHover(item, { x: event.originalEvent.clientX, y: event.originalEvent.clientY });
        }
      };
      map.on("click", onClick);
      map.on("mousemove", onMove);
      cleanups.push(() => { map.off("click", onClick); map.off("mousemove", onMove); container.classList.remove("aircraft-gl-hover"); });
    }).catch(() => { if (!cancelled) live.current.onUnavailable(); });

    return () => {
      cancelled = true;
      refresh.current = null;
      for (const cleanup of cleanups.reverse()) cleanup();
      glMap?.remove();
    };
  }, [map]);

  return null;
}
