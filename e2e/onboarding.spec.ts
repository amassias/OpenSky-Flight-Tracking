import { expect, test } from "@playwright/test";

// This spec is about the first visit, so it opts out of the shared "already seen" state.
test.use({ storageState: { cookies: [], origins: [] } });

test.beforeEach(async ({ page }) => {
  await page.route("**/api/**", (route) => {
    const path = new URL(route.request().url()).pathname;
    if (path === "/api/health") return route.fulfill({ json: { credentials_configured: true } });
    if (path === "/api/live-flights") return route.fulfill({ json: { count: 0, states: [], time: 1 } });
    return route.fulfill({ json: path.endsWith("airports") || path === "/api/search-airports" ? [] : { success: true } });
  });
});

test("a first visit opens no dialog, shows one dismissible hint, and the tour stays behind the help icon", async ({ page }) => {
  await page.goto("/");
  const hint = page.getByRole("status").filter({ hasText: "Tap an aircraft" });
  await expect(hint).toBeVisible();
  await expect(page.getByRole("dialog")).toHaveCount(0);

  await hint.getByRole("button", { name: "Dismiss hint" }).click();
  await expect(hint).toHaveCount(0);
  await page.reload();
  await expect(page.getByRole("status").filter({ hasText: "Tap an aircraft" })).toHaveCount(0);
  await expect(page.getByRole("dialog")).toHaveCount(0);

  await page.getByRole("button", { name: "Show the tour" }).click();
  const tour = page.getByRole("dialog");
  await expect(tour.getByRole("heading", { name: "Welcome to SkyTrace" })).toBeVisible();
  await tour.getByRole("button", { name: "Take the tour" }).click();
  await expect(tour.getByRole("heading", { name: "The live map" })).toBeVisible();
  await tour.getByRole("button", { name: "Skip the tour" }).click();
  await expect(tour).toHaveCount(0);
});

test("on a phone the hint does not overlap the status banner or the map controls", async ({ page, isMobile }) => {
  test.skip(!isMobile, "Phone layout only.");
  await page.goto("/");
  const hint = page.locator(".map-hint");
  await expect(hint).toBeVisible();
  const boxes = await page.locator(".map-hint, .map-status, .map-controls > *:visible, .traffic-reopen, .map-altitude-legend:visible").evaluateAll((els) =>
    els.map((el) => { const r = el.getBoundingClientRect(); return { name: el.className, top: r.top, bottom: r.bottom, left: r.left, right: r.right }; }));
  const mine = boxes.find((b) => String(b.name).includes("map-hint"))!;
  for (const other of boxes.filter((b) => b !== mine)) {
    const overlap = mine.left < other.right && other.left < mine.right && mine.top < other.bottom && other.top < mine.bottom;
    expect(overlap, `hint overlaps ${other.name}`).toBe(false);
  }
});
