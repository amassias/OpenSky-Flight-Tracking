// Renderer bench. Query: ?mode=maplibre-setdata|maplibre-update|deck&n=10000&fps=20
import maplibregl from "maplibre-gl";
import "maplibre-gl/dist/maplibre-gl.css";
import { MapboxOverlay } from "@deck.gl/mapbox";
import { IconLayer } from "@deck.gl/layers";
import { createFleet, advance, toGeoJSON } from "../fleet.js";

const q = new URLSearchParams(location.search);
const mode = q.get("mode") || "maplibre-setdata";
const n = Number(q.get("n") || 10000);
const updateHz = Number(q.get("fps") || 20); // data update rate (spec: 10 to 30)
const speedup = Number(q.get("speedup") || 1);
const hud = document.getElementById("hud");

// Plane silhouette drawn once to a canvas, used as sdf-less image by both renderers.
function planeCanvas(size = 64) {
  const c = document.createElement("canvas");
  c.width = c.height = size;
  const g = c.getContext("2d");
  g.fillStyle = "#fff";
  g.beginPath();
  const s = size / 64;
  const pts = [[32, 2], [36, 24], [62, 38], [62, 44], [36, 38], [35, 54], [42, 60], [42, 62], [32, 59], [22, 62], [22, 60], [29, 54], [28, 38], [2, 44], [2, 38], [28, 24]];
  pts.forEach(([x, y], i) => (i ? g.lineTo(x * s, y * s) : g.moveTo(x * s, y * s)));
  g.closePath();
  g.fill();
  return c;
}
const canvas = planeCanvas();

const fleet = createFleet(n, 1);
const style = { version: 8, sources: {}, layers: [{ id: "bg", type: "background", paint: { "background-color": "#0b1620" } }] };
const map = new maplibregl.Map({ container: "map", style, center: [10, 45], zoom: 3.5, attributionControl: false, fadeDuration: 0 });

const stats = { frames: [], updates: [], mode, n, updateHz };
window.__bench = stats;
let setup = () => {};
let push = () => {};

if (mode.startsWith("maplibre")) {
  setup = () => {
    map.addImage("plane", canvas.getContext("2d").getImageData(0, 0, 64, 64), { sdf: true });
    const data = toGeoJSON(fleet);
    data.features.forEach((f, i) => (f.id = i));
    map.addSource("ac", { type: "geojson", data });
    map.addLayer({
      id: "ac", type: "symbol", source: "ac",
      layout: { "icon-image": "plane", "icon-size": 0.4, "icon-rotate": ["get", "heading"], "icon-rotation-alignment": "map", "icon-allow-overlap": true, "icon-ignore-placement": true },
      paint: { "icon-color": ["interpolate", ["linear"], ["get", "alt"], 0, "#f5a524", 6000, "#4cc9f0", 12000, "#c77dff"] },
    });
  };
  const src = () => map.getSource("ac");
  push = mode === "maplibre-update"
    ? () => src().updateData({ update: fleet.map((f, i) => ({ id: i, newGeometry: { type: "Point", coordinates: [f.lon, f.lat] } })) })
    : () => { const d = toGeoJSON(fleet); d.features.forEach((f, i) => (f.id = i)); src().setData(d); };
} else {
  const overlay = new MapboxOverlay({ interleaved: false, layers: [] });
  setup = () => map.addControl(overlay);
  const img = canvas;
  let version = 0;
  push = () => {
    version++;
    overlay.setProps({
      layers: [new IconLayer({
        id: "ac", data: fleet, getPosition: (f) => [f.lon, f.lat], getAngle: (f) => -f.heading,
        iconAtlas: img, iconMapping: { plane: { x: 0, y: 0, width: 64, height: 64, mask: true } }, getIcon: () => "plane",
        getColor: (f) => (f.alt < 6000 ? [245, 165, 36] : f.alt < 9000 ? [76, 201, 240] : [199, 125, 255]),
        getSize: 20, sizeUnits: "pixels", updateTriggers: { getPosition: version, getAngle: 0 },
        parameters: { depthCompare: "always" },
      })],
    });
  };
}

map.on("load", () => {
  setup();
  const gl = map.getCanvas().getContext("webgl2") || map.getCanvas().getContext("webgl");
  const dbg = gl && gl.getExtension("WEBGL_debug_renderer_info");
  stats.gpu = dbg ? gl.getParameter(dbg.UNMASKED_RENDERER_WEBGL) : "unknown";
  let last = performance.now(), lastUpd = last, prev = last, t0 = last;
  const tick = (now) => {
    stats.frames.push(now - prev);
    prev = now;
    if (now - lastUpd >= 1000 / updateHz) {
      const dt = ((now - lastUpd) / 1000) * speedup;
      lastUpd = now;
      const a = performance.now();
      advance(fleet, dt);
      push();
      stats.updates.push(performance.now() - a);
    }
    // continuous interaction: slow pan + zoom oscillation
    const t = (now - t0) / 1000;
    map.jumpTo({ center: [10 + 30 * Math.sin(t / 6), 45 + 10 * Math.cos(t / 5)], zoom: 3.5 + 1.2 * Math.sin(t / 4) });
    if (Math.floor(t) !== stats._s) {
      stats._s = Math.floor(t);
      hud.textContent = `${mode} n=${n} frames=${stats.frames.length}`;
    }
    requestAnimationFrame(tick);
  };
  requestAnimationFrame(tick);
  stats.ready = true;
});
