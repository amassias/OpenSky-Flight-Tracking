import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import { FlightList } from "./FlightList";
import type { Flight } from "../types";

const flights = [
  { icao24: "aaa111", callsign: "AFR1", airline_name: "Air France", status: "airborne" },
  { icao24: "bbb222", callsign: "EZY2", airline_name: "easyJet", status: "airborne" },
] as Flight[];

function renderList() {
  return render(<FlightList flights={flights} selectedFlight={null} loading={false} hasSearched onSelect={vi.fn()} onRetry={vi.fn()} />);
}

describe("FlightList", () => {
  it("shows how many flights a filter keeps and clears it", async () => {
    renderList();
    await userEvent.type(screen.getByRole("textbox", { name: /filter flights/i }), "AFR");
    expect(screen.getByText("1 of 2 shown")).toBeInTheDocument();
    await userEvent.click(screen.getByRole("button", { name: "Clear" }));
    expect(screen.queryByText(/of 2 shown/)).not.toBeInTheDocument();
    expect(screen.getByText("EZY2")).toBeInTheDocument();
  });

  it("offers a way out of an empty filter result", async () => {
    renderList();
    await userEvent.type(screen.getByRole("textbox", { name: /filter flights/i }), "zzz");
    await userEvent.click(screen.getByRole("button", { name: "Clear filters" }));
    expect(screen.getByText("AFR1")).toBeInTheDocument();
  });
});
