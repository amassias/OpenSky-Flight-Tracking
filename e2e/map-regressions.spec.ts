import { expect, test, type Page } from '@playwright/test';

const airport = { icao: 'LFPG', iata: 'CDG', name: 'Paris Charles de Gaulle', latitude: 49, longitude: 2.5 };
let returnWideViewport = false;
let returnDenseViewport = false;
test.beforeEach(async ({ page }) => {
  returnWideViewport = false;
  returnDenseViewport = false;
  await page.route('**/api/**', async route => {
    const path = new URL(route.request().url()).pathname;
    const body = path === '/api/health' ? { credentials_configured: true }
      : path === '/api/live-flights' ? (() => {
        // The second request is the zoomed-out viewport in this regression
        // fixture. Returning a distinct aircraft proves that moveend caused a
        // fresh query instead of keeping the first viewport's snapshot.
        const wideViewport = returnWideViewport || returnDenseViewport;
        const count = returnDenseViewport ? 900 : wideViewport ? 301 : 300;
        return { count, states: Array.from({length: count}, (_, i) => ({ icao24: i.toString(16).padStart(6, '0'), callsign: `TEST${i}`, latitude: returnWideViewport && i === 300 ? 51 : 48.8 + i / 1000, longitude: returnWideViewport && i === 300 ? 5 : 2.3 + i / 1000, true_track: 90 })) };
      })()
      : [airport];
    await route.fulfill({ json: body });
  });
  await page.goto('/');
});

/**
 * CI's software-rendered WebKit sometimes never reports a stable box for the
 * map controls under 300 markers. What matters is that no marker covers a
 * control: hit-test its centre explicitly, then click without that wait.
 */
async function clickUncovered(page: Page, name: string) {
  const control = page.getByRole('button', {name, exact: true});
  await expect(control).toBeVisible();
  // Retried, because the controls slide for 0.3 s when the panels toggle.
  await expect.poll(async () => {
    const box = await control.boundingBox();
    if (!box) return null;
    return page.evaluate(({x, y}) => document.elementFromPoint(x, y)?.closest('button')?.getAttribute('aria-label'), {x: box.x + box.width / 2, y: box.y + box.height / 2});
  }).toBe(name);
  await control.click({force: true});
}

test('map controls remain clickable and map resizes in full map', async ({page}, testInfo) => {
  await expect(page.locator('.aircraft-marker')).toHaveCount(300);
  await page.screenshot({path: testInfo.outputPath('map.png')});
  await clickUncovered(page, 'Hide panels');
  await expect(page.locator('.app')).toHaveClass(/map-expanded/);
  await page.screenshot({path: testInfo.outputPath('full-map.png')});
  await clickUncovered(page, 'Pause live traffic');
  await expect(page.getByText('Live traffic paused')).toBeVisible();
  await clickUncovered(page, 'Show panels');
});

test('clock does not rewrite aircraft DOM', async ({page}) => {
  await expect(page.locator('.aircraft-marker')).toHaveCount(300);
  await page.waitForTimeout(1200);
  const mutations = await page.evaluate(async () => {
    let count = 0;
    const observer = new MutationObserver(items => { count += items.length; });
    observer.observe(document.querySelector('.aircraft-marker-wrap')!.parentElement!, {subtree:true, childList:true, attributes:true});
    await new Promise(resolve => setTimeout(resolve, 2200));
    observer.disconnect();
    return count;
  });
  console.log(`Aircraft DOM mutations over 2.2s: ${mutations}`);
  expect(mutations).toBe(0);
});

test('refreshes the live viewport after zooming out', async ({page, isMobile}) => {
  test.skip(isMobile, 'Wheel zoom is not available in mobile WebKit.');
  await expect(page.locator('.aircraft-marker')).toHaveCount(300);
  await page.locator('.flight-map').hover();
  returnWideViewport = true;
  await page.mouse.wheel(0, 1900);
  await expect(page.locator('.aircraft-marker')).toHaveCount(301);
  await expect(page.locator('.map-status')).toContainText('301 aircraft');
});

test('uses the canvas layer for a dense live viewport', async ({page, isMobile}) => {
  test.skip(isMobile, 'Wheel zoom is not available in mobile WebKit.');
  await expect(page.locator('.aircraft-marker')).toHaveCount(300);
  returnDenseViewport = true;
  await page.locator('.flight-map').hover();
  await page.mouse.wheel(0, 1100);
  await expect(page.locator('canvas[data-aircraft-renderer="maplibre-gl"]')).toHaveCount(1);
  await expect(page.locator('.map-status')).toContainText('900 aircraft');
  await expect(page.locator('.aircraft-marker')).toHaveCount(0);
});

test('keeps the last live snapshot when a zoom refresh fails', async ({page, isMobile}) => {
  test.skip(isMobile, 'Wheel zoom is not available in mobile WebKit.');
  await expect(page.locator('.aircraft-marker')).toHaveCount(300);
  await page.unroute('**/api/**');
  await page.route('**/api/live-flights**', route => route.fulfill({
    status: 502,
    contentType: 'application/json',
    body: JSON.stringify({ success: false, error: 'upstream timeout' }),
  }));

  // Zoom out around the aircraft themselves: the wider view asks for traffic again, and that request fails.
  const target = (await page.locator('.aircraft-marker').first().boundingBox())!;
  await page.mouse.move(target.x + target.width / 2, target.y + target.height / 2);
  await page.mouse.wheel(0, 1100);
  await expect(page.locator('.map-status')).toContainText(/snapshot from \d+ s ago/);
  await expect(page.locator('.map-status')).not.toContainText('Your search is preserved');
  await expect(page.locator('.aircraft-marker')).toHaveCount(300);
});

test('keeps labels sparse and gives the selected aircraft priority in busy traffic', async ({ page }) => {
  await expect(page.locator('.aircraft-marker')).toHaveCount(300);
  expect(await page.locator('.aircraft-label').count()).toBeLessThan(30);
  await page.getByRole("combobox", { name: "Search flights and airports" }).fill("TEST32");
  await page.getByRole("option", { name: /TEST32/ }).click();
  const selected = page.locator('.aircraft-marker-selected .aircraft-label');
  await expect(selected).toHaveCount(1);
  await expect(selected).toBeVisible();
  await expect(selected.locator('b')).toHaveText('TEST32');
  expect(await page.locator('.aircraft-label').count()).toBeLessThan(30);
  await page.getByRole('button', { name: 'Close flight details', exact: true }).click();
  await expect(selected).toHaveCount(0);
});

test('keeps dense traffic on canvas and a single selected label on every device', async ({ page }) => {
  returnDenseViewport = true;
  await page.reload();
  await expect(page.locator('.map-status')).toContainText('900 aircraft');
  await expect(page.locator('canvas[data-aircraft-renderer="maplibre-gl"]')).toHaveCount(1);
  await expect(page.locator('.aircraft-label')).toHaveCount(0);
  await page.getByRole('combobox', { name: 'Search flights and airports' }).fill('TEST32');
  await page.getByRole('option', { name: /TEST32/ }).first().click();
  await expect(page.locator('.aircraft-label')).toHaveCount(1);
  await expect(page.locator('.aircraft-label')).toBeVisible();
  await expect(page.locator('.aircraft-marker')).toHaveCount(1);
  await expect(page.locator('canvas[data-aircraft-renderer="maplibre-gl"]')).toHaveCount(1);
});
