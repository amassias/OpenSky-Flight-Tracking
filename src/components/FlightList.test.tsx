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

describe("FlightList live board", () => {
  const live = [
    { icao24: "far001", callsign: "FAR1", status: "airborne", latitude: 52, longitude: 2, vertical_rate: 8 },
    { icao24: "near01", callsign: "NEAR1", status: "airborne", latitude: 49.01, longitude: 2.55, vertical_rate: -6, registration: "F-HABC", aircraft_type: "A359" },
    { icao24: "sos001", callsign: "SOS1", status: "airborne", latitude: 55, longitude: 9, squawk: "7700" },
  ] as Flight[];

  function renderBoard() {
    return render(<FlightList flights={live} selectedFlight={null} loading={false} hasSearched onSelect={vi.fn()} onRetry={vi.fn()} referencePoint={[49.0097, 2.5479]} />);
  }

  it("puts emergencies first, sorts the rest by distance and remembers the sort", async () => {
    window.localStorage.clear();
    const { unmount } = renderBoard();
    await userEvent.selectOptions(screen.getByRole("combobox", { name: /sort order/i }), "distance_asc");
    const order = () => screen.getAllByRole("button", { pressed: false }).map((card) => card.textContent ?? "").filter((text) => /FAR1|NEAR1|SOS1/.test(text)).map((text) => text.match(/FAR1|NEAR1|SOS1/)![0]);
    expect(order()).toEqual(["SOS1", "NEAR1", "FAR1"]);
    expect(screen.getByText(/7700 · General emergency/)).toBeInTheDocument();
    unmount();
    renderBoard();
    expect(screen.getByRole("combobox", { name: /sort order/i })).toHaveValue("distance_asc");
  });

  it("names the airframe and shows climb/descent when the operator is unknown", () => {
    renderBoard();
    expect(screen.getByText("F-HABC · A359")).toBeInTheDocument();
    expect(screen.getByLabelText("Climbing")).toBeInTheDocument();
    expect(screen.getByLabelText("Descending")).toBeInTheDocument();
  });

  it("moves between cards with the arrow keys", async () => {
    window.localStorage.clear();
    renderBoard();
    const cards = screen.getAllByRole("button").filter((element) => element.classList.contains("flight-card"));
    cards[0].focus();
    await userEvent.keyboard("{ArrowDown}");
    expect(cards[1]).toHaveFocus();
    await userEvent.keyboard("{End}");
    expect(cards[cards.length - 1]).toHaveFocus();
    await userEvent.keyboard("{ArrowUp}");
    expect(cards[cards.length - 2]).toHaveFocus();
  });
});
