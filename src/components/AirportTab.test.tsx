import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { render, screen, within } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { AirportTab } from "./AirportTab";
import type { Airport } from "../types";

const airport = (index: number): Airport => ({
  icao: `KZZ${index}`, iata: `Z${index}A`, name: `Test Field ${index}`, display_name: `Test Field ${index}`,
  country: "US", region: "", latitude: 40, longitude: -100,
} as Airport);

function renderTab(favorites: Airport[], recent: Airport[]) {
  render(
    <QueryClientProvider client={new QueryClient()}>
    <AirportTab selected={null} popular={[]} recent={recent} favorites={favorites} date="2026-10-10" mode="departure" view="live"
      onDateChange={vi.fn()} onModeChange={vi.fn()} onViewChange={vi.fn()} onSelect={vi.fn()} onClear={vi.fn()} onToggleFavorite={vi.fn()}
      selectedIcao24={null} liveAircraft={[]} onSelectFlight={vi.fn()} onPreviewFlight={vi.fn()} heading={null}>{null}</AirportTab>
    </QueryClientProvider>,
  );
}

describe("AirportTab shortcuts", () => {
  it("lists every saved favourite and keeps recent airports that are not favourites", () => {
    const favorites = Array.from({ length: 8 }, (_, index) => airport(index));
    renderTab(favorites, [airport(9), airport(0)]);
    const shortcuts = document.querySelector(".airport-shortcuts")!;
    for (const saved of favorites) expect(within(shortcuts as HTMLElement).getByText(saved.name)).toBeInTheDocument();
    expect(screen.getByRole("heading", { name: "Recent" })).toBeInTheDocument();
    expect(screen.getAllByText("Test Field 0")).toHaveLength(1);
    expect(screen.getByText("Test Field 9")).toBeInTheDocument();
  });
});
