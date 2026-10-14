import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import { WatchList } from "./WatchList";
import type { LiveAircraft } from "../types";

const inView = { icao24: "39abcd", callsign: "AFR123", baro_altitude: 10_000, on_ground: false } as LiveAircraft;

describe("WatchList", () => {
  it("explains how to add an aircraft when empty", () => {
    render(<WatchList entries={[]} live={[]} onOpen={vi.fn()} onRemove={vi.fn()} />);
    expect(screen.getByText(/Press the bookmark/)).toBeInTheDocument();
  });

  it("says which watched aircraft are in view and opens them", async () => {
    const onOpen = vi.fn();
    render(<WatchList entries={[{ icao24: "39abcd", label: "AFR123" }, { icao24: "aaaaaa", label: "N1" }]} live={[inView]} onOpen={onOpen} onRemove={vi.fn()} />);
    expect(screen.getByText(/^In view/)).toBeInTheDocument();
    expect(screen.getByText("Not in the current map view")).toBeInTheDocument();
    await userEvent.click(screen.getByRole("button", { name: /^AFR123/ }));
    expect(onOpen).toHaveBeenCalledWith({ icao24: "39abcd", label: "AFR123" }, inView);
  });

  it("removes an entry from its own button", async () => {
    const onRemove = vi.fn();
    render(<WatchList entries={[{ icao24: "aaaaaa", label: "N1" }]} live={[]} onOpen={vi.fn()} onRemove={onRemove} />);
    await userEvent.click(screen.getByRole("button", { name: "Stop watching N1" }));
    expect(onRemove).toHaveBeenCalledOnce();
  });
});
