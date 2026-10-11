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

test("a first visit shows the tour once, and it can be replayed", async ({ page }) => {
  await page.goto("/");
  const tour = page.getByRole("dialog");
  await expect(tour.getByRole("heading", { name: "Welcome to SkyTrace" })).toBeVisible();
  await tour.getByRole("button", { name: "Take the tour" }).click();
  await expect(tour.getByRole("heading", { name: "The live map" })).toBeVisible();
  await tour.getByRole("button", { name: "Skip the tour" }).click();
  await expect(tour).toHaveCount(0);

  await page.reload();
  await expect(page.getByRole("dialog")).toHaveCount(0);

  await page.getByRole("button", { name: "Show the tour" }).click();
  await expect(page.getByRole("dialog")).toBeVisible();
});
