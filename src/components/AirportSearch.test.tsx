import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import { api } from "../api";
import type { Airport } from "../types";
import { AirportSearch } from "./AirportSearch";

const airport = { icao: "LFPG", iata: "CDG", name: "Paris Charles de Gaulle", country: "FR", region: "Paris" } as Airport;
function setup(selected: Airport | null = null) {
  const onSelect = vi.fn();
  const onClear = vi.fn();
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  render(<QueryClientProvider client={client}><AirportSearch selected={selected} popular={[airport]} recent={[]} favorites={[]} onSelect={onSelect} onClear={onClear} onToggleFavorite={vi.fn()} /></QueryClientProvider>);
  return { onSelect, onClear };
}

describe("AirportSearch", () => {
  it("distinguishes connection failure from an empty result and retries the same query", async () => {
    const search = vi.spyOn(api, "searchAirports").mockRejectedValueOnce(new Error("Offline")).mockResolvedValue([airport]);
    const { onSelect } = setup();
    await userEvent.type(screen.getByRole("combobox", { name: "Airport" }), "Paris");
    expect(screen.queryByText(/No airport found/)).not.toBeInTheDocument();
    expect(await screen.findByRole("alert")).toHaveTextContent("could not connect");
    expect(screen.queryByText(/No airport found/)).not.toBeInTheDocument();
    await userEvent.click(screen.getByRole("button", { name: "Retry airport search" }));
    await userEvent.click(await screen.findByRole("button", { name: /CDG Paris Charles/ }));
    expect(onSelect).toHaveBeenCalledWith(airport);
    expect(search.mock.calls.map((call) => call[0])).toEqual(["Paris", "Paris"]);
  });

  it("returns focus to the airport input after clearing so keyboard selection works", async () => {
    vi.spyOn(api, "searchAirports").mockResolvedValue([airport]);
    const { onSelect, onClear } = setup(airport);
    await userEvent.click(screen.getByRole("button", { name: "Clear airport" }));
    expect(screen.getByRole("combobox", { name: "Airport" })).toHaveFocus();
    expect(onClear).toHaveBeenCalledOnce();
    await userEvent.keyboard("{Enter}");
    expect(onSelect).toHaveBeenCalledWith(airport);
  });

  it("shows a true empty result only after the search completes", async () => {
    vi.spyOn(api, "searchAirports").mockResolvedValue([]);
    setup();
    await userEvent.type(screen.getByRole("combobox", { name: "Airport" }), "zz");
    await waitFor(() => expect(screen.getByText(/No airport found/)).toBeInTheDocument());
    expect(screen.queryByRole("alert")).not.toBeInTheDocument();
  });
});
