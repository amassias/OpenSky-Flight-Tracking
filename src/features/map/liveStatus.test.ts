import { describe, expect, it } from "vitest";
import { ApiError } from "../../shared/api";
import { causeFromError, describeLiveStatus, listEmptyMessage, snapshotAgeSeconds } from "./liveStatus";

describe("causeFromError", () => {
  it("reads a rate limit as the quota", () => {
    expect(causeFromError(new ApiError("limit", 429))).toBe("quota");
  });
  it("reads an upstream failure as the provider", () => {
    expect(causeFromError(new ApiError("down", 503))).toBe("provider");
    expect(causeFromError(new ApiError("bad gateway", 502))).toBe("provider");
  });
  it("reads a network failure or our own server error as the backend", () => {
    expect(causeFromError(new TypeError("Failed to fetch"))).toBe("backend");
    expect(causeFromError(new ApiError("boom", 500))).toBe("backend");
  });
});

describe("describeLiveStatus", () => {
  it("is plain when nothing is wrong", () => {
    expect(describeLiveStatus({ count: 120, cause: null, ageSeconds: 4, reducedCoverage: false })).toBe("120 aircraft");
  });
  it("labels a kept snapshot with its age and the cause", () => {
    expect(describeLiveStatus({ count: 9000, cause: "provider", ageSeconds: 40, reducedCoverage: false }))
      .toBe("9000 aircraft · snapshot from 40 s ago · OpenSky is not answering");
    expect(describeLiveStatus({ count: 9000, cause: "quota", ageSeconds: 95, reducedCoverage: false }))
      .toContain("OpenSky credit budget reached");
    expect(describeLiveStatus({ count: 9000, cause: "backend", ageSeconds: 12, reducedCoverage: false }))
      .toContain("SkyTrace cannot be reached");
  });
  it("says coverage is reduced when only local cells answered", () => {
    expect(describeLiveStatus({ count: 300, cause: "quota", ageSeconds: 12, reducedCoverage: true }))
      .toContain("reduced coverage");
  });
  it("names the cause when there is nothing to show", () => {
    expect(describeLiveStatus({ count: 0, cause: "quota", ageSeconds: null, reducedCoverage: false }))
      .toBe("Live traffic unavailable · OpenSky credit budget reached");
  });
});

describe("listEmptyMessage", () => {
  it("only suggests zooming out when nothing is wrong", () => {
    expect(listEmptyMessage(null)).toContain("Zoom out");
    expect(listEmptyMessage("provider")).not.toContain("Zoom out");
    expect(listEmptyMessage("provider")).toContain("OpenSky is not answering");
    expect(listEmptyMessage("backend")).toContain("SkyTrace cannot be reached");
  });
});

describe("snapshotAgeSeconds", () => {
  it("counts from the absolute time of the snapshot, not from when this browser received it", () => {
    // A CDN served this answer 50 s after the snapshot was taken; the age shown now is 50 s + 10 s later.
    expect(snapshotAgeSeconds({ time: 1_000, receivedAt: 1_050_000 }, 1_060_000)).toBe(60);
  });
  it("falls back to the receipt time when the answer carries no snapshot time", () => {
    expect(snapshotAgeSeconds({ time: null, receivedAt: 1_000_000 }, 1_012_000)).toBe(12);
  });
  it("never goes negative when the clocks disagree", () => {
    expect(snapshotAgeSeconds({ time: 2_000, receivedAt: 1_000_000 }, 1_000_000)).toBe(0);
  });
});
