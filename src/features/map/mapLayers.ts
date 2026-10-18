import { useEffect } from "react";
import type { GeoJSONSource, LayerSpecification, Map as GlMap } from "maplibre-gl";
import type { MapHandle } from "./mapHandle";

/** Bottom to top. A layer is inserted below the first layer already drawn that is listed after it. */
const LAYER_ORDER = [
  "accuracy-fill", "accuracy-line", "trails",
  "trace-halo", "trace-line", "trace-head",
  "projection-hit", "projection-future", "projection-heading",
  "aircraft",
];

export function addLayerInOrder(map: GlMap, layer: LayerSpecification) {
  const later = LAYER_ORDER.slice(LAYER_ORDER.indexOf(layer.id) + 1);
  map.addLayer(layer, later.find((id) => map.getLayer(id)));
}

export const emptyCollection = (): GeoJSON.FeatureCollection => ({ type: "FeatureCollection", features: [] });

/**
 * A GeoJSON source with its layers, kept for as long as the caller is mounted. The data
 * is replaced whenever `data` changes. Layers must be listed in LAYER_ORDER.
 */
export function useGeoJsonLayers(handle: MapHandle, sourceId: string, layers: LayerSpecification[], data: GeoJSON.FeatureCollection) {
  const { map } = handle;
  useEffect(() => {
    map.addSource(sourceId, { type: "geojson", data: emptyCollection() });
    for (const layer of layers) addLayerInOrder(map, layer);
    return () => {
      try {
        for (const layer of layers) if (map.getLayer(layer.id)) map.removeLayer(layer.id);
        if (map.getSource(sourceId)) map.removeSource(sourceId);
      } catch { /* the map was removed first */ }
    };
    // The layer specifications are constants of the caller.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [map, sourceId]);
  useEffect(() => {
    (map.getSource(sourceId) as GeoJSONSource | undefined)?.setData(data);
  }, [map, sourceId, data]);
}

/**
 * Says what the map is drawing on its container (`data-map-overlays`), so the state of
 * layers that live in a canvas can be read by tests and assistive tooling.
 */
export function useOverlayToken(handle: MapHandle, token: string, active: boolean) {
  const { map } = handle;
  useEffect(() => {
    if (!active) return;
    const container = map.getContainer();
    const tokens = (container.dataset.mapOverlays ?? "").split(" ").filter(Boolean);
    container.dataset.mapOverlays = [...new Set([...tokens, token])].join(" ");
    return () => {
      const rest = (container.dataset.mapOverlays ?? "").split(" ").filter((item) => item && item !== token);
      if (rest.length) container.dataset.mapOverlays = rest.join(" ");
      else delete container.dataset.mapOverlays;
    };
  }, [map, token, active]);
}
