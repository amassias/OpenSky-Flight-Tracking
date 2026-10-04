import { render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { Topbar } from "./Topbar";

function renderTopbar() {
  render(<Topbar healthPending={false} health={{ success: true, credentials_configured: true } as never} theme="dark"
    onToggleTheme={vi.fn()} onToggleControls={vi.fn()} />);
}

describe("Topbar", () => {
  it("leaves airport search to the dedicated panel", () => {
    renderTopbar();
    expect(screen.queryByRole("search")).not.toBeInTheDocument();
  });

  it("names the channel after the real feed state", () => {
    renderTopbar();
    expect(screen.getByText("Live")).toBeInTheDocument();
  });
});
