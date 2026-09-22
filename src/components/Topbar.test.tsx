import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { Topbar } from "./Topbar";

function renderTopbar(onCommandChange = vi.fn()) {
  render(<Topbar healthPending={false} health={{ success: true, credentials_configured: true } as never} theme="dark"
    onToggleTheme={vi.fn()} onToggleControls={vi.fn()} commandValue="" onCommandChange={onCommandChange} onCommandSubmit={vi.fn()} />);
  return screen.getByRole("textbox", { name: /search airport, flight or callsign/i });
}

describe("Topbar", () => {
  it("focuses the command search with Ctrl+K and /", () => {
    const input = renderTopbar();
    fireEvent.keyDown(window, { key: "k", ctrlKey: true });
    expect(input).toHaveFocus();
    input.blur();
    fireEvent.keyDown(document.body, { key: "/" });
    expect(input).toHaveFocus();
  });

  it("clears and leaves the command search on Escape", () => {
    const onChange = vi.fn();
    const input = renderTopbar(onChange);
    input.focus();
    fireEvent.keyDown(input, { key: "Escape" });
    expect(onChange).toHaveBeenCalledWith("");
    expect(input).not.toHaveFocus();
  });

  it("names the channel after the real feed state", () => {
    renderTopbar();
    expect(screen.getByText("AIRSPACE / LIVE")).toBeInTheDocument();
  });
});
