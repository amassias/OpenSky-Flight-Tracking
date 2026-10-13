import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { afterEach, expect, it, vi } from "vitest";
import { GlobalAlerts } from "./GlobalAlerts";

const now = Math.floor(Date.now() / 1000);
const aircraft = { icao24: "abc123", callsign: "TEST1", airline_name: "Test Airline", squawk: "7700", emergency: "general", latitude: 49, longitude: 2 };
const snapshot = { success: true, states: [aircraft], time: now, provider: "adsb.lol", status: "fresh", retry_after_seconds: 60 };
afterEach(() => vi.unstubAllGlobals());
function setup(body = snapshot, status = 200) {
  const fetch = vi.fn(async () => new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json" } }));
  vi.stubGlobal("fetch", fetch);
  const onSelect = vi.fn();
  render(<QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}><GlobalAlerts onSelect={onSelect} /></QueryClientProvider>);
  return { fetch, onSelect };
}
it("opens a fresh global signal and explains the code", async () => {
  const { onSelect } = setup();
  await userEvent.click(await screen.findByRole("button", { name: /TEST1/ }));
  expect(onSelect).toHaveBeenCalledWith(expect.objectContaining({ callsign: "TEST1" }));
  expect(screen.getByText(/Latest snapshot/)).toBeVisible();
  await userEvent.click(screen.getByText("What do these codes mean?"));
  expect(screen.getByText(/reason is not transmitted/)).toBeVisible();
});
it("keeps delayed observations distinct and prevents selection as live", async () => {
  setup({ ...snapshot, status: "delayed", time: now - 100 });
  expect(await screen.findByRole("button", { name: /TEST1/ })).toBeDisabled();
  expect(screen.getByText("Updates delayed")).toBeVisible();
  expect(screen.getByText(/not a current emergency report/)).toBeVisible();
});
it("hides an expired observation even if returned by a cache", async () => {
  setup({ ...snapshot, time: now - 301 });
  expect(await screen.findByText("Worldwide signals unavailable")).toBeVisible();
  expect(screen.queryByRole("button", { name: /TEST1/ })).not.toBeInTheDocument();
});
it("does not present an outage as no emergencies and recovers on retry", async () => {
  const { fetch } = setup({ error: "Receiver feed timed out." } as unknown as typeof snapshot, 503);
  expect(await screen.findByText("Receiver feed timed out.")).toBeVisible();
  expect(screen.queryByText(/No emergency squawks/)).not.toBeInTheDocument();
  fetch.mockImplementation(async () => new Response(JSON.stringify(snapshot), { headers: { "Content-Type": "application/json" } }));
  await userEvent.click(screen.getByRole("button", { name: "Retry" }));
  expect(await screen.findByRole("button", { name: /TEST1/ })).toBeEnabled();
});
it("an old empty snapshot says current status is unknown", async () => {
  setup({ ...snapshot, status: "delayed", states: [], time: now - 100 });
  expect(await screen.findByText(/Current status is unknown/)).toBeVisible();
});
