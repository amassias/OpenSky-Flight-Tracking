import { fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import { setUnits } from "../units";
import type { TrackPoint } from "../types";
import { AltitudeChart } from "./AltitudeChart";
const fix = (time: string, altitude: number | null): TrackPoint => [Date.parse(time) / 1000, 49, 2, altitude, 90, false];
afterEach(() => setUnits("aviation"));
describe("altitude inspection", () => {
  it("dates each UTC label when a track crosses midnight and preserves keyboard inspection of missing observations", async () => {
    const { container } = render(<AltitudeChart points={[fix("2026-10-13T23:50:00Z", 1000), fix("2026-10-14T00:00:00Z", null), fix("2026-10-14T00:10:00Z", 2000)]} />);
    expect(container.querySelector(".chart-time-axis")?.textContent).toContain("13 Oct 23:50");
    expect(container.querySelector(".chart-time-axis")?.textContent).toContain("14 Oct 00:10");
    const slider = screen.getByRole("slider", { name: "Inspect altitude point" });
    fireEvent.change(slider, { target: { value: "1" } });
    expect(slider).toHaveAttribute("aria-valuetext", expect.stringContaining("No altitude"));
  });
  it("formats metric values and retains the native slider's accessible observation value", () => {
    setUnits("metric");
    render(<AltitudeChart points={[fix("2026-10-14T10:00:00Z", 1000), fix("2026-10-14T10:10:00Z", 2000)]} />);
    expect(screen.getByRole("slider")).toHaveAttribute("aria-valuetext", expect.stringContaining("2,000 m"));
    expect(screen.getByRole("img")).toHaveAccessibleName("Altitude from 1,000 m to 2,000 m");
  });
});
