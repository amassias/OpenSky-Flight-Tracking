import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

// No third party may see the visitor's IP on first load: fonts are the system stack.
describe("first load makes no Google Fonts request", () => {
  it("index.html neither links nor preconnects to Google Fonts", () => {
    expect(readFileSync("index.html", "utf8")).not.toMatch(/fonts\.(googleapis|gstatic)\.com/);
  });

  it("the CSP does not allow Google Fonts origins", () => {
    expect(readFileSync("vercel.json", "utf8")).not.toMatch(/fonts\.(googleapis|gstatic)\.com/);
  });
});
