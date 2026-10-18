import test from "node:test";
import assert from "node:assert/strict";
import { createFleet, advance, toGeoJSON } from "./fleet.js";

test("creates the requested number of aircraft with unique ids, deterministically", () => {
  const a = createFleet(10000, 1);
  const b = createFleet(10000, 1);
  assert.equal(a.length, 10000);
  assert.equal(new Set(a.map((f) => f.id)).size, 10000);
  assert.deepEqual(a[1234], b[1234]);
});

test("an aircraft heading east at 250 m/s moves about 0.0225 degrees of longitude in 10 s at the equator", () => {
  const fleet = [{ id: "x", lon: 0, lat: 0, heading: 90, speed: 250 }];
  advance(fleet, 10);
  // 2500 m / 111_320 m per degree = 0.02246
  assert.ok(Math.abs(fleet[0].lon - 0.02246) < 0.0005);
  assert.ok(Math.abs(fleet[0].lat) < 0.0005);
});

test("longitude wraps at the antimeridian and latitude stays in range", () => {
  const fleet = [{ id: "x", lon: 179.99, lat: 0, heading: 90, speed: 250 }];
  advance(fleet, 10);
  assert.ok(fleet[0].lon < -179);
  const p = [{ id: "y", lon: 0, lat: 85, heading: 0, speed: 250 }];
  advance(p, 3600);
  assert.ok(p[0].lat <= 85 && p[0].lat >= -85);
});

test("GeoJSON export has one point feature per aircraft with heading and altitude band", () => {
  const fc = toGeoJSON([{ id: "a", lon: 1, lat: 2, heading: 45, speed: 200, alt: 11000 }]);
  assert.equal(fc.features.length, 1);
  assert.deepEqual(fc.features[0].geometry.coordinates, [1, 2]);
  assert.equal(fc.features[0].properties.heading, 45);
});
