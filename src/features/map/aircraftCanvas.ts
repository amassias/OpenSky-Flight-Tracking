import L from "leaflet";
import { glyphImageUrl } from "./aircraftGlyph";

export interface AircraftCanvasStyle extends L.PathOptions {
  aircraftGlyph: string;
  aircraftHeading: number;
  aircraftSize: number;
  aircraftHollow: boolean;
}

type CanvasCircle = L.CircleMarker & { _point: L.Point; _empty: () => boolean };
type CanvasInternals = { _drawing: boolean; _ctx: CanvasRenderingContext2D; _container: HTMLCanvasElement };

/** The same SVG geometry as DOM markers, rasterized once per shape/style.
 * Leaflet still owns projection, pan/zoom transforms and pointer hit testing.
 * Only its circle paint hook is replaced; no DOM per aircraft is introduced.
 */
export class AircraftCanvasRenderer extends L.Canvas {
  private glyphs = new Map<string, { image: HTMLImageElement; waiting: Set<L.CircleMarker> }>();

  onAdd(map: L.Map): this {
    super.onAdd(map);
    (this as unknown as CanvasInternals)._container.dataset.aircraftRenderer = "silhouettes";
    return this;
  }

  _updateCircle(layer: CanvasCircle) {
    const renderer = this as unknown as CanvasInternals;
    if (!renderer._drawing || layer._empty()) return;
    const options = layer.options as L.CircleMarkerOptions & AircraftCanvasStyle;
    const key = `${options.color}:${options.aircraftHollow}:${options.aircraftGlyph}`;
    let entry = this.glyphs.get(key);
    if (!entry) {
      const image = new Image();
      const waiting = new Set<L.CircleMarker>();
      entry = { image, waiting };
      this.glyphs.set(key, entry);
      image.onload = () => { for (const marker of waiting) marker.redraw(); waiting.clear(); };
      image.src = glyphImageUrl(options.aircraftGlyph, options.color ?? "#fff", options.aircraftHollow);
    }
    if (!entry.image.complete || !entry.image.naturalWidth) { entry.waiting.add(layer); return; }
    const context = renderer._ctx;
    const size = options.aircraftSize;
    context.save();
    context.translate(layer._point.x, layer._point.y);
    context.rotate((options.aircraftHeading - 90) * Math.PI / 180);
    context.globalAlpha = options.opacity ?? 1;
    context.drawImage(entry.image, -size / 2, -size / 2, size, size);
    context.restore();
  }
}
