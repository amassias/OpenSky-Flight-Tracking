// Synthetic fleet for the renderer benchmark. Throwaway prototype code.
const M_PER_DEG = 111320;

function rng(seed) {
  let s = seed >>> 0 || 1;
  return () => {
    s = (s + 0x6d2b79f5) >>> 0;
    let t = s;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

// Traffic is clustered (North America, Europe, East Asia) like the real sky.
const CLUSTERS = [
  [-95, 38, 25, 10, 0.4],
  [10, 49, 14, 6, 0.35],
  [115, 32, 15, 9, 0.25],
];

export function createFleet(count, seed = 1) {
  const r = rng(seed);
  const fleet = [];
  for (let i = 0; i < count; i++) {
    let k = r();
    let c = CLUSTERS[CLUSTERS.length - 1];
    for (const cl of CLUSTERS) {
      if ((k -= cl[4]) < 0) { c = cl; break; }
    }
    fleet.push({
      id: i.toString(16).padStart(6, "0"),
      lon: c[0] + (r() - 0.5) * 2 * c[2],
      lat: Math.max(-80, Math.min(80, c[1] + (r() - 0.5) * 2 * c[3])),
      heading: r() * 360,
      speed: 80 + r() * 200,
      alt: r() * 12000,
    });
  }
  return fleet;
}

export function advance(fleet, dt) {
  for (const f of fleet) {
    const d = (f.speed * dt) / M_PER_DEG;
    const h = (f.heading * Math.PI) / 180;
    const cos = Math.max(0.05, Math.cos((f.lat * Math.PI) / 180));
    f.lat += d * Math.cos(h);
    f.lon += (d * Math.sin(h)) / cos;
    if (f.lat > 85) { f.lat = 85; f.heading = (180 - f.heading + 360) % 360; }
    if (f.lat < -85) { f.lat = -85; f.heading = (180 - f.heading + 360) % 360; }
    if (f.lon > 180) f.lon -= 360;
    if (f.lon < -180) f.lon += 360;
  }
}

export function toGeoJSON(fleet) {
  return {
    type: "FeatureCollection",
    features: fleet.map((f) => ({
      type: "Feature",
      id: undefined,
      geometry: { type: "Point", coordinates: [f.lon, f.lat] },
      properties: { id: f.id, heading: f.heading, alt: f.alt },
    })),
  };
}
