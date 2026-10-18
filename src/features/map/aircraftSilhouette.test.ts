import { describe, expect, it } from "vitest";
import { aircraftSilhouette } from "./aircraftSilhouette";
import paths from "../../../data/aircraft-silhouettes/paths.json";

describe("model silhouettes", () => {
  it("distinguishes actual types and normalizes feed codes", () => {
    expect(aircraftSilhouette(" a320 ")?.id).toBe("a320");
    expect(aircraftSilhouette("B738")?.id).toBe("b738");
    expect(aircraftSilhouette("A388")?.id).toBe("a380");
    expect(aircraftSilhouette("BCS3")?.id).toBe("cs300");
    expect(aircraftSilhouette("DH8D")?.id).toBe("q400");
    expect(paths.a320).not.toBe(paths.b738);
    expect(aircraftSilhouette("A320")?.symbol).toBe("#aircraft-model-a320");
  });

  it("uses only explicit family matches and leaves unsupported types to the existing fallback", () => {
    expect(aircraftSilhouette("A20N")?.match).toBe("family");
    expect(aircraftSilhouette("B738")?.match).toBe("type");
    for (const type of [undefined, null, "", "ZZZZ", "B777", "PC24", "C172"]) {
      expect(aircraftSilhouette(type)).toBeNull();
    }
  });
});
