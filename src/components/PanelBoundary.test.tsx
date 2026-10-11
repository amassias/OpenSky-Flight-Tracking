import { render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { PanelBoundary } from "./PanelBoundary";

function Broken({ fail }: { fail: boolean }) {
  if (fail) throw new Error("unexpected body");
  return <p>Panel content</p>;
}

describe("PanelBoundary", () => {
  it("keeps a failing panel from blanking the app and recovers on a new key", () => {
    vi.spyOn(console, "error").mockImplementation(() => undefined);
    const { rerender } = render(<div><p>Map</p><PanelBoundary label="flight details" resetKey="a"><Broken fail /></PanelBoundary></div>);
    expect(screen.getByText("Map")).toBeInTheDocument();
    expect(screen.getByRole("alert")).toHaveTextContent("The flight details could not be shown.");
    expect(screen.getByRole("button", { name: "Try again" })).toBeInTheDocument();

    rerender(<div><p>Map</p><PanelBoundary label="flight details" resetKey="b"><Broken fail={false} /></PanelBoundary></div>);
    expect(screen.getByText("Panel content")).toBeInTheDocument();
  });

  it("offers a reload when the whole app fails", () => {
    vi.spyOn(console, "error").mockImplementation(() => undefined);
    render(<PanelBoundary label="app" reload><Broken fail /></PanelBoundary>);
    expect(screen.getByRole("alert")).toHaveTextContent("SkyTrace hit an unexpected error.");
    expect(screen.getByRole("button", { name: "Reload SkyTrace" })).toBeInTheDocument();
  });
});
