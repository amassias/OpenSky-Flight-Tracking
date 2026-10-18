import { useEffect, useRef } from "react";
import type { GeoJSONSource, MapMouseEvent } from "maplibre-gl";
import type { Flight, LiveAircraft, MapTheme } from "../../../shared/types";
import { liveAircraftToFlight } from "../../../shared/utils";
import { subscribeToFrame } from "../aircraftMotion";
import { glyphImageUrl } from "../aircraftGlyph";
import { AircraftFrames, updateIntervalMs, type DrawnAircraft } from "../aircraftLayer";
import { fromGlZoom } from "../mapCamera";
import { LAYERS, addLayerInOrder, emptyCollection } from "../mapLayers";
import { useMapHandle } from "../mapHandle";

/** Texture size of one silhouette; displayed scaled to its `size` in CSS pixels. */
const IMAGE_PIXELS = 64;
/** Pointer distance, in CSS pixels, within which an aircraft is picked. */
const PICK_RADIUS = 14;

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
}

/**
 * Draws every aircraft of a dense view as one symbol layer of the map itself
 * (ADR 0009, prototype #12). The whole source is replaced each tick with
 * `setData`, which measured cheaper than incremental updates when every aircraft
 * moves. Hover and click are resolved from the drawn list, so touch and mouse
 * behave the same.
 */
export function AircraftGlLayer({ aircraft, theme, previewId, excludeId, excludeIds, onSelect, onHover, onLeave }: AircraftGlLayerProps) {
  const { map } = useMapHandle();
  const frames = useRef(new AircraftFrames());
  const live = useRef({ aircraft, theme, previewId, excludeId, excludeIds, onSelect, onHover, onLeave });
  live.current = { aircraft, theme, previewId, excludeId, excludeIds, onSelect, onHover, onLeave };
  const refresh = useRef<(() => void) | null>(null);

  useEffect(() => {
    frames.current.setAircraft(aircraft);
    refresh.current?.();
  }, [aircraft]);
  useEffect(() => { refresh.current?.(); }, [theme, previewId, excludeId, excludeIds]);

  useEffect(() => {
    let cancelled = false;
    const container = map.getContainer();
    const cleanups: Array<() => void> = [];
    container.dataset.aircraftDrawn = "0";

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
        map.addImage(key, context.getImageData(0, 0, IMAGE_PIXELS, IMAGE_PIXELS), { pixelRatio: 1 });
        ready.add(key);
      };
      image.src = glyphImageUrl(item.glyph, item.color, item.hollow);
    };

    map.addSource("aircraft", { type: "geojson", data: emptyCollection() });
    addLayerInOrder(map, {
      id: LAYERS.aircraft, type: "symbol", source: "aircraft",
      layout: {
        "icon-image": ["get", "icon"], "icon-size": ["get", "scale"], "icon-rotate": ["get", "rot"],
        "icon-rotation-alignment": "map", "icon-allow-overlap": true, "icon-ignore-placement": true,
      },
      paint: { "icon-opacity": ["get", "opacity"] },
    });
    const source = map.getSource("aircraft") as GeoJSONSource;

    let drawn: DrawnAircraft[] = [];
    let lastUpdate = 0;
    const update = (now = Date.now() / 1000) => {
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
      container.dataset.aircraftDrawn = String(features.length);
    };
    refresh.current = () => update();
    frames.current.setAircraft(live.current.aircraft);
    update();
    cleanups.push(subscribeToFrame((now) => {
      // 10 Hz at most (the prototype shows it halves the cost of 20 Hz), slower when the view is too wide for motion to show.
      if (now * 1000 - lastUpdate < updateIntervalMs(fromGlZoom(map.getZoom()), map.getCenter().lat)) return;
      update(now);
    }));

    // Picking projects the drawn aircraft rather than asking WebGL, so it
    // costs one pass over the list per pointer event and works the same on touch.
    const pick = (point: { x: number; y: number }): DrawnAircraft | null => {
      let best: DrawnAircraft | null = null;
      let bestDistance = PICK_RADIUS * PICK_RADIUS;
      // Cheap degree-box rejection first; projecting 10,000 aircraft per pointer event would not be.
      const around = map.unproject([point.x, point.y]);
      const tolerance = (PICK_RADIUS * 1.5 * 360) / (256 * 2 ** fromGlZoom(map.getZoom()));
      for (const item of drawn) {
        if (Math.abs(item.lat - around.lat) > tolerance || Math.abs(((item.lng - around.lng + 540) % 360) - 180) > tolerance) continue;
        const at = map.project([item.lng, item.lat]);
        const distance = (at.x - point.x) ** 2 + (at.y - point.y) ** 2;
        if (distance <= bestDistance) { best = item; bestDistance = distance; }
      }
      return best;
    };
    const byId = () => new Map(live.current.aircraft.map(item => [item.icao24, item]));
    // A DOM marker (airport, selected aircraft) answers its own clicks.
    const overMarker = (event: MapMouseEvent) => event.originalEvent.target instanceof Element && Boolean(event.originalEvent.target.closest(".maplibregl-marker"));
    let hovered: string | null = null;
    const onClick = (event: MapMouseEvent) => {
      if (overMarker(event)) return;
      const hit = pick(event.point);
      const item = hit && byId().get(hit.id);
      if (item) live.current.onSelect(liveAircraftToFlight(item));
    };
    // At most one pick per 50 ms, but the last pointer position always gets its turn.
    let lastMove = 0;
    let latestMove: MapMouseEvent | null = null;
    let moveTimer: ReturnType<typeof setTimeout> | undefined;
    const onMove = (event: MapMouseEvent) => {
      const wait = 50 - (performance.now() - lastMove);
      if (wait > 0) {
        latestMove = event;
        moveTimer ??= setTimeout(() => { moveTimer = undefined; if (latestMove) pointerMoved(latestMove); }, wait);
        return;
      }
      pointerMoved(event);
    };
    const pointerMoved = (event: MapMouseEvent) => {
      lastMove = performance.now();
      latestMove = null;
      const hit = overMarker(event) ? null : pick(event.point);
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
    cleanups.push(() => { map.off("click", onClick); map.off("mousemove", onMove); clearTimeout(moveTimer); container.classList.remove("aircraft-gl-hover"); });

    return () => {
      cancelled = true;
      refresh.current = null;
      for (const cleanup of cleanups.reverse()) cleanup();
      try {
        if (map.getLayer(LAYERS.aircraft)) map.removeLayer(LAYERS.aircraft);
        if (map.getSource("aircraft")) map.removeSource("aircraft");
        for (const key of ready) map.removeImage(key);
      } catch { /* the map was removed first */ }
      container.dataset.aircraftDrawn = "0";
    };
  }, [map]);

  return null;
}
