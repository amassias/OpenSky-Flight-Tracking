import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";
import { OmniSearch } from "./OmniSearch";
import { looksLikeRegistration } from "../airframe";
import type { Airport, LiveAircraft } from "../types";

const airport: Airport = { icao: "LFPG", iata: "CDG", name: "Paris Charles de Gaulle", display_name: "Paris Charles de Gaulle (CDG)", country: "FR", region: "Île-de-France", latitude: 49, longitude: 2.5 };
const aircraft = [
  { icao24: "39abcd", callsign: "AFR123", airline_name: "Air France", registration: "F-HABC", aircraft_type: "A359" },
  { icao24: "400001", callsign: "BAW9", airline_name: "British Airways", registration: "G-EUUU", aircraft_type: "A320" },
] as LiveAircraft[];

afterEach(() => vi.unstubAllGlobals());

function renderSearch(props: Partial<React.ComponentProps<typeof OmniSearch>> = {}) {
  vi.stubGlobal("fetch", vi.fn(async () => new Response(JSON.stringify([airport]), { headers: { "Content-Type": "application/json" } })));
  const onSelectAircraft = vi.fn();
  const onSelectAirport = vi.fn();
  render(
    <QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}>
      <OmniSearch aircraft={aircraft} recent={[]} popular={[airport]} onSelectAircraft={onSelectAircraft} onSelectAirport={onSelectAirport} {...props} />
    </QueryClientProvider>,
  );
  return { onSelectAircraft, onSelectAirport, input: screen.getByRole("combobox", { name: /search flights and airports/i }) };
}

describe("OmniSearch", () => {
  it("finds aircraft on the map by callsign, registration or type and selects one with Enter", async () => {
    const { input, onSelectAircraft } = renderSearch();
    await userEvent.type(input, "f-ha");
    expect(await screen.findByRole("option", { name: /AFR123/ })).toBeInTheDocument();
    expect(screen.queryByRole("option", { name: /BAW9/ })).not.toBeInTheDocument();
    await userEvent.keyboard("{Enter}");
    expect(onSelectAircraft).toHaveBeenCalledWith(aircraft[0]);
  });

  it("looks airports up in the same field", async () => {
    const { input, onSelectAirport } = renderSearch();
    await userEvent.type(input, "paris");
    await userEvent.click(await screen.findByRole("option", { name: /Paris Charles de Gaulle/ }));
    expect(onSelectAirport).toHaveBeenCalledWith(airport);
  });

  it("suggests airports before anything is typed and says what the aircraft search covers", async () => {
    const { input } = renderSearch();
    await userEvent.click(input);
    expect(await screen.findByRole("option", { name: /Paris Charles de Gaulle/ })).toBeInTheDocument();
    expect(screen.getByText(/Callsigns search the aircraft on the map/i)).toBeInTheDocument();
  });

  it("explains an empty result instead of staying silent", async () => {
    const { input } = renderSearch({ aircraft: [] });
    vi.stubGlobal("fetch", vi.fn(async () => new Response("[]", { headers: { "Content-Type": "application/json" } })));
    await userEvent.type(input, "zzzz");
    expect(await screen.findByText(/No aircraft in view or airport matches/)).toBeInTheDocument();
  });

  it("recognises what can name one airframe and leaves callsigns alone", () => {
    for (const value of ["F-HBXA", "g-euuu", "N283VA", "N1", "3986e0", "OE-LQG"]) expect(looksLikeRegistration(value)).toBe(true);
    for (const value of ["AFR123", "paris", "BAW9", "A320", "F-", ""]) expect(looksLikeRegistration(value)).toBe(false);
  });

  it("looks a registration up even when the aircraft is not on the map", async () => {
    const onSelectAirframe = vi.fn();
    const fetchMock = vi.fn(async (input: RequestInfo | URL) => {
      const url = new URL(String(input));
      if (url.pathname === "/api/aircraft-lookup") {
        return new Response(JSON.stringify({ success: true, icao24: "3986e0", registration: "F-HBXA", registry: { owner: "Air France HOP", type: "EMB-170 STD" } }), { headers: { "Content-Type": "application/json" } });
      }
      return new Response("[]", { headers: { "Content-Type": "application/json" } });
    });
    const { input } = renderSearch({ aircraft: [], onSelectAirframe });
    vi.stubGlobal("fetch", fetchMock);
    await userEvent.type(input, "F-HBXA");
    const option = await screen.findByRole("option", { name: /F-HBXA/ });
    expect(option).toHaveTextContent("Air France HOP");
    expect(screen.getByText("Airframe by registration")).toBeInTheDocument();
    await userEvent.click(option);
    expect(onSelectAirframe).toHaveBeenCalledWith("3986e0", "F-HBXA", { owner: "Air France HOP", type: "EMB-170 STD" });
    expect(fetchMock.mock.calls.some(([url]) => String(url).includes("callsign"))).toBe(false);
  });
});
