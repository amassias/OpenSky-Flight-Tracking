import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

// Issue #24: MapLibre GL is the only map engine (ADR 0010).
describe("map dependencies", () => {
  const manifest = JSON.parse(readFileSync(resolve(process.cwd(), "package.json"), "utf8")) as {
    dependencies: Record<string, string>; devDependencies: Record<string, string>;
  };

  it("ships no Leaflet, in any dependency group", () => {
    const names = [...Object.keys(manifest.dependencies), ...Object.keys(manifest.devDependencies)];
    expect(names.filter((name) => /leaflet/i.test(name))).toEqual([]);
  });

  it("draws the map with MapLibre GL", () => {
    expect(manifest.dependencies["maplibre-gl"]).toBeDefined();
  });
});
