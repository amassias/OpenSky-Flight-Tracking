import { expect, test } from '@playwright/test';

const airport = { icao: 'LFPG', iata: 'CDG', name: 'Paris Charles de Gaulle', latitude: 49, longitude: 2.5 };
test.beforeEach(async ({ page }) => {
  await page.route('**/api/**', async route => {
    const path = new URL(route.request().url()).pathname;
    const body = path === '/api/health' ? { credentials_configured: true }
      : path === '/api/live-flights' ? { count: 300, states: Array.from({length: 300}, (_, i) => ({ icao24: i.toString(16).padStart(6, '0'), callsign: `TEST${i}`, latitude: 48.8 + i / 1000, longitude: 2.3 + i / 1000, true_track: 90 })) }
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
