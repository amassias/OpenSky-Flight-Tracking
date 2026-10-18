import { aircraftSilhouette } from "./aircraftSilhouette";
import type { AircraftIconKind } from "../../shared/utils";

// Solid top-down silhouettes, drawn nose-up and turned to the nose-east
// convention the shared heading rotation expects.
const AIRLINER_PATH = "M12 1.4c.9 0 1.5.9 1.5 2.3v5.3l8.5 5.1v2.2l-8.5-2.5v4.5l2.2 1.7v1.8L12 20.7l-3.7 1.1v-1.8l2.2-1.7v-4.5L2 16.3v-2.2L10.5 9V3.7c0-1.4.6-2.3 1.5-2.3z";
const LIGHT_PLANE_PATH = "M12 2.2c.7 0 1.2.9 1.2 2.1v5.4l9 1.5v2.1l-9-.9v4.7l1.9 1.4v1.5L12 19.8l-3.1.9v-1.5l1.9-1.4v-4.7l-9 .9v-2.1l9-1.5V4.3c0-1.2.5-2.1 1.2-2.1z";
// Top-down rotorcraft, drawn nose-east like the plane glyph so the shared
// heading rotation points it where it is flying: main rotor blades, cabin,
// tail boom and tail rotor.
const HELICOPTER_SVG = [
  '<ellipse class="aircraft-svg-fill" cx="13.4" cy="12" rx="4.6" ry="3.1"/>',
  '<path class="aircraft-svg-fill" d="M2.6 11.2h7v1.6h-7z"/>',
  '<path class="aircraft-svg-fill" d="M2 8.8h1.5v6.4H2z"/>',
  '<path class="aircraft-svg-rotor" d="M6.2 5.2 19.8 18.8M6.2 18.8 19.8 5.2"/>',
].join("");

function aircraftIconSvg(kind: AircraftIconKind): string {
  switch (kind) {
    case "helicopter":
      return HELICOPTER_SVG;
    case "glider":
      return '<path d="M2 11.2h20v1.6H2zM11.2 12.8h1.6l1.9 8.2h-1.9l-.8-3.2-.8 3.2H9.3z"/>';
    case "balloon":
      return '<path d="M12 2a6.2 6.2 0 0 1 6.2 6.2c0 3.2-2 5.4-4.2 7.1l-.8.6h-2.4l-.8-.6c-2.2-1.7-4.2-3.9-4.2-7.1A6.2 6.2 0 0 1 12 2Zm-1.2 14h2.4v2.1h-2.4zM9.8 20h4.4v2H9.8z"/>';
    case "small":
      return `<path class="aircraft-svg-fill" transform="rotate(90 12 12)" d="${LIGHT_PLANE_PATH}"/>`;
    case "turboprop":
      return '<g transform="rotate(90 12 12)"><path d="M11 2h2v7l9 3v2l-9-1v6l3 1v2l-4-1-4 1v-2l3-1v-6l-9 1v-2l9-3z"/><path d="M6 7h1v8H6zM17 7h1v8h-1z"/><path class="aircraft-svg-stroke" d="M4 8h5m6 0h5"/></g>';
    case "regional":
      return '<g transform="rotate(90 12 12)"><path d="M12 1l1 3v6l7 5v2l-7-3v5l3 2v1l-4-1-4 1v-1l3-2v-5l-7 3v-2l7-5V4z"/><path d="M8 16h2v4H8zm6 0h2v4h-2z"/></g>';
    case "heavy":
      return '<g transform="rotate(90 12 12)"><path d="M12 1c1 0 2 1 2 3v5l9 6v2l-9-3v4l3 3v2l-5-2-5 2v-2l3-3v-4l-9 3v-2l9-6V4c0-2 1-3 2-3z"/><path d="M5 11h2v5H5zm12 0h2v5h-2z"/></g>';
    // Missing type metadata is common in the global snapshot. Keep the
    // standard plane silhouette at every zoom without claiming a model.
    case "unknown":
    default:
      return `<path class="aircraft-svg-fill" transform="rotate(90 12 12)" d="${AIRLINER_PATH}"/>`;
  }
}

export function aircraftGlyph(kind: AircraftIconKind, aircraftType?: string | null) {
  const model = aircraftSilhouette(aircraftType);
  kind = model?.kind ?? kind;
  const glyph = model
    ? `<svg viewBox="0 0 64 64" aria-hidden="true"><use href="${model.symbol}"/>${model.rotor ? `<use href="${model.rotor.symbol}" class="aircraft-model-rotor" style="transform-origin:${model.rotor.cx}px ${model.rotor.cy}px"/>` : ""}</svg>`
    : `<svg viewBox="0 0 24 24" aria-hidden="true">${aircraftIconSvg(kind)}</svg>`;
  return { model, glyph, kind };
}


/**
 * A self-contained SVG data URL for one glyph, colour and fill, so a canvas or
 * WebGL texture never depends on external <use> resolution or a zoom-time
 * download. Hollow glyphs are outlined (estimated or old positions).
 */
export function glyphImageUrl(glyph: string, color: string, hollow: boolean): string {
  const svg = new DOMParser().parseFromString(glyph.replace("<svg ", '<svg xmlns="http://www.w3.org/2000/svg" '), "image/svg+xml").documentElement;
  for (const use of svg.querySelectorAll("use")) {
    const symbol = document.querySelector(use.getAttribute("href") ?? "");
    if (!symbol) continue;
    const group = document.createElementNS("http://www.w3.org/2000/svg", "g");
    group.innerHTML = symbol.innerHTML;
    use.replaceWith(group);
  }
  svg.setAttribute("xmlns", "http://www.w3.org/2000/svg");
  svg.setAttribute("width", "64");
  svg.setAttribute("height", "64");
  svg.setAttribute("color", color);
  svg.setAttribute("fill", hollow ? "none" : "currentColor");
  if (hollow) { svg.setAttribute("stroke", "currentColor"); svg.setAttribute("stroke-width", "2.4"); }
  const style = document.createElementNS("http://www.w3.org/2000/svg", "style");
  style.textContent = (hollow ? "path,ellipse{fill:none;stroke:currentColor}" : "") + ".aircraft-svg-stroke,.aircraft-svg-rotor{fill:none;stroke:currentColor;stroke-width:1.6;stroke-linecap:round}";
  svg.prepend(style);
  return `data:image/svg+xml;charset=utf-8,${encodeURIComponent(new XMLSerializer().serializeToString(svg))}`;
}
