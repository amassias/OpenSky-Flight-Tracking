import { render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { aircraftPhoto } from "./api";
import { FlightDetails } from "./components/FlightDetails";
import type { Flight } from "./types";

const photoPayload = (id: string) => ({
  photos: [{
    id,
    thumbnail: { src: `https://t.plnspttrs.net/1/${id}_t.jpg`, size: { width: 200, height: 133 } },
    thumbnail_large: { src: `https://t.plnspttrs.net/1/${id}_280.jpg`, size: { width: 420, height: 280 } },
    link: `https://www.planespotters.net/photo/${id}/f-gkxa?utm_source=api`,
    photographer: "Andy Kruse",
  }],
});

function stubFetch(byPath: Record<string, unknown>) {
  const fetchMock = vi.fn(async (input: RequestInfo | URL) => {
    const path = new URL(String(input)).pathname;
    return new Response(JSON.stringify(byPath[path] ?? { photos: [] }), { status: 200 });
  });
  vi.stubGlobal("fetch", fetchMock);
  return fetchMock;
}

afterEach(() => vi.unstubAllGlobals());

describe("aircraftPhoto", () => {
  it("uses the Mode S hex first and caches the answer", async () => {
    const fetchMock = stubFetch({ "/pub/photos/hex/aa0001": photoPayload("1") });
    const photo = await aircraftPhoto("AA0001", "F-GKXA");
    expect(photo).toMatchObject({ src: "https://t.plnspttrs.net/1/1_280.jpg", width: 420, photographer: "Andy Kruse" });
    await aircraftPhoto("aa0001", "F-GKXA");
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it("falls back to the registration when the hex has no photo", async () => {
    const fetchMock = stubFetch({ "/pub/photos/reg/F-GKXB": photoPayload("2") });
    const photo = await aircraftPhoto("aa0002", " f-gkxb ");
    expect(photo?.link).toContain("/photo/2/");
    expect(fetchMock.mock.calls.map(([url]) => new URL(String(url)).pathname)).toEqual(["/pub/photos/hex/aa0002", "/pub/photos/reg/F-GKXB"]);
  });

  it("returns null when nothing is found and rejects non-https links", async () => {
    stubFetch({ "/pub/photos/hex/aa0003": { photos: [{ ...photoPayload("3").photos[0], link: "javascript:alert(1)" }] } });
    expect(await aircraftPhoto("aa0003")).toBeNull();
    expect(await aircraftPhoto("aa0004")).toBeNull();
  });
});

describe("FlightDetails photo", () => {
  const flight = { icao24: "aa0001", callsign: "AFR12", registration: "F-GKXA", aircraft_type: "A320", status: "airborne" } as Flight;
  const props = { track: undefined, trackLoading: false, onRetryTrack: vi.fn(), onClose: vi.fn(), onShare: vi.fn() };

  it("credits the photographer and links the photo back to Planespotters", () => {
    render(<FlightDetails flight={flight} {...props} photo={{ src: "https://t.plnspttrs.net/1/1_280.jpg", width: 420, height: 280, link: "https://www.planespotters.net/photo/1/f-gkxa", photographer: "Andy Kruse" }} />);
    const image = screen.getByRole("img", { name: /F-GKXA · A320, photo by Andy Kruse/ });
    const link = image.closest("a");
    expect(link).toHaveAttribute("href", "https://www.planespotters.net/photo/1/f-gkxa");
    expect(link?.getAttribute("rel")).not.toContain("nofollow");
    expect(screen.getByText("© Andy Kruse")).toBeInTheDocument();
  });

  it("says when an airframe has no photo yet", () => {
    render(<FlightDetails flight={flight} {...props} photo={null} />);
    expect(screen.getByText("No photo of F-GKXA yet")).toBeInTheDocument();
  });
});

describe("scheduled registrations", () => {
  const props = { track: undefined, trackLoading: false, onRetryTrack: vi.fn(), onClose: vi.fn(), onShare: vi.fn() };

  it("never labels the photo with a scheduled tail, and marks it in the profile", () => {
    const flight = { icao24: "495153", callsign: "TAP1366", registration: "CS-TJT", registration_source: "schedule", aircraft_type: "A21N", status: "airborne" } as Flight;
    render(<FlightDetails flight={flight} {...props} photo={{ src: "https://t.plnspttrs.net/1/1_280.jpg", width: 420, height: 280, link: "https://www.planespotters.net/photo/1/cs-tjs", photographer: "Rafal" }} />);
    expect(screen.getByRole("img", { name: /^A21N, photo by Rafal/ })).toBeInTheDocument();
    expect(screen.queryByText("CS-TJT · A21N")).not.toBeInTheDocument();
    expect(screen.getByText("CS-TJT (scheduled)")).toBeInTheDocument();
  });
});
