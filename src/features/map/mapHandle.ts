import { createContext, useContext } from "react";
import type { Map as GlMap } from "maplibre-gl";

export const loadMapLibre = () => import("maplibre-gl").then((module) => module.default);
export type MapLibre = Awaited<ReturnType<typeof loadMapLibre>>;

/** The live map and the library that made it, shared with every layer drawn on it. */
export interface MapHandle {
  map: GlMap;
  gl: MapLibre;
}

export const MapContext = createContext<MapHandle | null>(null);

export function useMapHandle(): MapHandle {
  const handle = useContext(MapContext);
  if (!handle) throw new Error("useMapHandle must be used inside a MapCanvas");
  return handle;
}
