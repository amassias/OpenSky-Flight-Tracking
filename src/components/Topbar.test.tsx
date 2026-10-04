import { render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { Topbar } from "./Topbar";

function renderTopbar(props: Partial<React.ComponentProps<typeof Topbar>> = {}) {
  render(<Topbar healthPending={false} health={{ success: true, credentials_configured: true } as never} theme="dark"
    onToggleTheme={vi.fn()} {...props} />);
}

describe("Topbar", () => {
  it("hosts the global search in its centre", () => {
    renderTopbar({ search: <div role="search">Global search</div> });
    expect(screen.getByRole("search")).toBeInTheDocument();
  });

  it("names the channel after the real feed state", () => {
    renderTopbar();
    expect(screen.getByText("Live")).toBeInTheDocument();
  });

  it("says when only recorded history is available", () => {
    renderTopbar({ health: { success: true, credentials_configured: false, live_available: false } as never });
    expect(screen.getByText("History only")).toBeInTheDocument();
  });
});
