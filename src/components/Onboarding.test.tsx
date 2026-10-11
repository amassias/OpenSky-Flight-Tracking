import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import { Onboarding } from "./Onboarding";

describe("Onboarding", () => {
  it("walks through every step and finishes", async () => {
    const onClose = vi.fn();
    render(<Onboarding onClose={onClose} />);
    expect(screen.getByRole("dialog")).toBeInTheDocument();
    expect(screen.getByRole("heading", { name: "Welcome to SkyTrace" })).toBeInTheDocument();

    await userEvent.click(screen.getByRole("button", { name: "Take the tour" }));
    expect(screen.getByRole("heading", { name: "The live map" })).toBeInTheDocument();
    await userEvent.click(screen.getByRole("button", { name: "Back" }));
    expect(screen.getByRole("heading", { name: "Welcome to SkyTrace" })).toBeInTheDocument();

    await userEvent.keyboard("{ArrowRight}{ArrowRight}{ArrowRight}{ArrowRight}{ArrowRight}");
    expect(screen.getByRole("heading", { name: "Make it yours" })).toBeInTheDocument();
    expect(onClose).not.toHaveBeenCalled();
    await userEvent.click(screen.getByRole("button", { name: "Start exploring" }));
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it("can be skipped with the keyboard", async () => {
    const onClose = vi.fn();
    render(<Onboarding onClose={onClose} />);
    await userEvent.keyboard("{Escape}");
    expect(onClose).toHaveBeenCalled();
  });
});
