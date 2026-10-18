import { afterEach, describe, expect, it } from "vitest";
import { altitudeText, distanceText, flightLevelText, getUnits, setUnits, speedText, verticalRateText } from "./units";
import { formatAltitude, formatSpeed } from "./utils";

afterEach(() => setUnits("aviation"));

describe("units", () => {
  it("formats aviation units by default", () => {
    expect(altitudeText(11_277)).toBe("36,998 ft");
    expect(speedText(250)).toBe("486 kt");
    expect(flightLevelText(11_277)).toBe("FL370");
    expect(flightLevelText(300)).toBe("1,000 ft");
    expect(verticalRateText(9)).toBe("+1,750 ft/min");
    expect(verticalRateText(-8)).toBe("−1,550 ft/min");
    expect(distanceText(18.52)).toBe("10 NM");
  });

  it("switches every shared formatter to metric", () => {
    setUnits("metric");
    expect(getUnits()).toBe("metric");
    expect(formatAltitude(11_277)).toBe("11,277 m");
    expect(formatSpeed(250)).toBe("900 km/h");
    expect(verticalRateText(-8)).toBe("−8 m/s");
    expect(distanceText(42)).toBe("42 km");
  });

  it("remembers the choice between visits", () => {
    setUnits("metric");
    expect(window.localStorage.getItem("skytrace-units")).toBe("metric");
  });
});
