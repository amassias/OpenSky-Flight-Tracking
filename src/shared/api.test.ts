import { afterEach, describe, expect, it, vi } from "vitest";
import { api } from "./api";

afterEach(() => vi.unstubAllGlobals());

describe("api.track", () => {
  it("always returns a track object, even when the body lacks one", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => new Response(JSON.stringify({ success: true }), { headers: { "Content-Type": "application/json" } })));
    const response = await api.track("39abcd");
    expect(response.track).toEqual({});
    expect(response.track.path ?? []).toEqual([]);
  });
});

describe("api.airframeHistory", () => {
  it("fills the collections a partial body leaves out", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => new Response(JSON.stringify({ success: true }), { headers: { "Content-Type": "application/json" } })));
    const response = await api.airframeHistory("39abcd");
    expect(response.airframe).toEqual({});
    expect(response.history).toEqual([]);
    expect(response.registry).toBeNull();
  });
});

describe("api list answers", () => {
  it("read a non-array body as an empty list", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => new Response(JSON.stringify({ success: true }), { headers: { "Content-Type": "application/json" } })));
    expect(await api.searchAirports("CDG")).toEqual([]);
    expect((await api.liveFlights({ lamin: 48, lomin: 2, lamax: 49, lomax: 3 }, undefined, true)).states).toEqual([]);
  });
});
