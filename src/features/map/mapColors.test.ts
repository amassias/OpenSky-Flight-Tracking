import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { mapColors, resetMapColors } from "./mapColors";

// The theme stylesheet is the only place a map colour is written down. These
// tests give the page a theme and check the map reads exactly that.
describe("mapColors", () => {
  let style: HTMLStyleElement;
  beforeEach(() => {
    resetMapColors();
    style = document.createElement("style");
    style.textContent = `
      :root { --aircraft: #111111; --aircraft-ground: #222222; --accent: #333333; --halo: #444444; --danger: #555555; }
      .theme-light { --aircraft: #aaaaaa; --accent: #cccccc; }
    `;
    document.head.append(style);
  });
  afterEach(() => { style.remove(); resetMapColors(); });

  it("reads the dark theme from the root tokens", () => {
    expect(mapColors("dark")).toEqual({ aircraft: "#111111", ground: "#222222", accent: "#333333", halo: "#444444", danger: "#555555" });
  });

  it("reads the light theme overrides and inherits the rest", () => {
    expect(mapColors("light")).toEqual({ aircraft: "#aaaaaa", ground: "#222222", accent: "#cccccc", halo: "#444444", danger: "#555555" });
  });
});
