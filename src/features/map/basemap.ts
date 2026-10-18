import type { RasterLayerSpecification } from "maplibre-gl";
import type { MapTheme } from "../../shared/types";

/**
 * The OpenStreetMap raster tiles, restyled to the quiet grey of the chrome. MapLibre
 * has no CSS filter for one layer, so the dark map is the same tiles inverted:
 * brightness runs from the light end to the dark end, and the grey saturation drops out.
 */
export function basemapPaint(theme: MapTheme): NonNullable<RasterLayerSpecification["paint"]> {
  return theme === "dark"
    ? { "raster-saturation": -1, "raster-contrast": 0.08, "raster-brightness-min": 0.72, "raster-brightness-max": 0, "raster-fade-duration": 0 }
    : { "raster-saturation": -1, "raster-contrast": -0.08, "raster-brightness-min": 0, "raster-brightness-max": 1, "raster-fade-duration": 0 };
}
