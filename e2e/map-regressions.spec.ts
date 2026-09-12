import { expect, test } from '@playwright/test';

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
        return { count, states: Array.from({length: count}, (_, i) => ({ icao24: i.toString(16).padStart(6, '0'), callsign: `TEST${i}`, latitude: wideViewport && i === 300 ? 52 : 48.8 + i / 1000, longitude: wideViewport && i === 300 ? 7 : 2.3 + i / 1000, true_track: 90 })) };
      })()
      : [airport];
    await route.fulfill({ json: body });
  });
  await page.goto('/');
});

test('map controls remain clickable and map resizes in full map', async ({page}, testInfo) => {
  await expect(page.locator('.aircraft-marker')).toHaveCount(300);
  await page.screenshot({path: testInfo.outputPath('map.png')});
  await page.getByRole('button', {name: 'Open full map', exact: true}).click({timeout: 3000});
  await expect(page.locator('.app')).toHaveClass(/map-expanded/);
  await page.screenshot({path: testInfo.outputPath('full-map.png')});
  await page.getByRole('button', {name: 'Pause live traffic'}).click();
  await expect(page.getByText('Live traffic paused')).toBeVisible();
  await page.getByRole('button', {name: 'Exit full map'}).click();
});

test('clock does not rewrite aircraft DOM', async ({page}) => {
  await expect(page.locator('.aircraft-marker')).toHaveCount(300);
  await page.waitForTimeout(1200);
  const mutations = await page.evaluate(async () => {
    let count = 0;
    const observer = new MutationObserver(items => { count += items.length; });
    observer.observe(document.querySelector('.leaflet-marker-pane')!, {subtree:true, childList:true, attributes:true});
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
  await page.locator('.leaflet-map').hover();
  returnWideViewport = true;
  await page.mouse.wheel(0, -480);
  await expect(page.locator('.aircraft-marker')).toHaveCount(301);
  await expect(page.locator('.live-badge')).toContainText('301 aircraft in view');
});

test('uses the canvas layer for a dense live viewport', async ({page, isMobile}) => {
  test.skip(isMobile, 'Wheel zoom is not available in mobile WebKit.');
  await expect(page.locator('.aircraft-marker')).toHaveCount(300);
  returnDenseViewport = true;
  await page.locator('.leaflet-map').hover();
  await page.mouse.wheel(0, 280);
  await expect(page.locator('.leaflet-overlay-pane canvas')).toHaveCount(1);
  await expect(page.locator('.map-label-meta')).toContainText('900 aircraft tracked');
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

  await page.locator('.leaflet-map').hover();
  await page.mouse.wheel(0, -280);
  await expect(page.locator('.live-badge')).toContainText('Live refresh delayed · showing last snapshot');
  await expect(page.locator('.live-badge')).not.toContainText('Your search is preserved');
  await expect(page.locator('.aircraft-marker')).toHaveCount(300);
});
