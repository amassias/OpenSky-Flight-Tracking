import { describe, expect, it } from "vitest";
import { cabinShortLabel, cabinSummary, cabinTone, checkedAgo, distinctSeatMapUrl } from "./cabin";

describe("cabin presentation", () => {
  it("maps every published class name to a tone, flexible cabins first", () => {
    expect(cabinTone("Flexible Business / Economy")).toBe("flexible");
    expect(cabinTone("Premium Economy")).toBe("premium");
    expect(cabinTone("First")).toBe("first");
    expect(cabinTone("Business")).toBe("business");
    expect(cabinTone("Economy")).toBe("economy");
    expect(cabinTone("Something new")).toBe("other");
    expect(cabinShortLabel("Flexible Business / Economy")).toBe("Flex");
    expect(cabinShortLabel("Something new")).toBe("Something new");
  });

  it("expresses the age of a check", () => {
    const now = new Date("2026-10-14T12:00:00Z");
    expect(checkedAgo("2026-10-14", now)).toBe("Checked today");
    expect(checkedAgo("2026-10-13", now)).toBe("Checked yesterday");
    expect(checkedAgo("2026-10-04", now)).toBe("Checked 10 days ago");
    expect(checkedAgo("2026-05-14", now)).toBe("Checked 5 months ago");
    expect(checkedAgo("2023-10-14", now)).toBe("Checked 3 years ago");
    expect(checkedAgo("garbage", now)).toBe("Checked garbage");
  });

  it("hides a seat-map link that only repeats the source", () => {
    const source = { name: "easyJet", url: "https://a.example/x", checked_at: "2026-10-13" };
    expect(distinctSeatMapUrl({ seat_map_url: "https://a.example/x", source })).toBeNull();
    expect(distinctSeatMapUrl({ seat_map_url: "https://b.example/y", source })).toBe("https://b.example/y");
  });

  it("summarises cabins", () => {
    expect(cabinSummary({ classes: [{ name: "Economy", seats: 180 }] })).toBe("Economy");
    expect(cabinSummary({ classes: [{ name: "Business", seats: 30 }, { name: "Economy", seats: 200 }] })).toBe("2 cabins");
  });
});
