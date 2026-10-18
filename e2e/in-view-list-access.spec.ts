import AxeBuilder from '@axe-core/playwright';
import { expect, test, type Page } from '@playwright/test';

const FIELDS = ['icao24', 'callsign', 'latitude', 'longitude', 'baro_altitude', 'geo_altitude', 'velocity', 'true_track', 'vertical_rate', 'on_ground', 'squawk', 'category', 'source', 'fix_age'];

// 1,200 aircraft over France and Germany plus 100 far away, outside any view tested here.
function snapshot(limit = Infinity) {
  const rows: unknown[][] = [];
  for (let i = 0; i < 1200; i += 1) {
    rows.push([i.toString(16).padStart(6, '0'), `SNAP${i}`, 46 + (i % 40) / 10, Math.floor(i / 40) / 10, 10000, 10000, 200, 90, 0, 0, null, 3, 'adsb', 5]);
  }
  for (let i = 0; i < 100; i += 1) {
    rows.push([(0x100000 + i).toString(16), `FAR${i}`, -30 + (i % 10) / 10, 150 + Math.floor(i / 10) / 10, 10000, 10000, 200, 90, 0, 0, null, 3, 'adsb', 5]);
  }
  const aircraft = rows.slice(0, limit);
  return { success: true, provider: 'opensky', time: Math.floor(Date.now() / 1000), count: aircraft.length, fields: FIELDS, aircraft, age_seconds: 0, refresh_after_seconds: 86 };
}

async function mockApi(page: Page, body = snapshot()) {
  await page.route('**/api/**', async route => {
    const path = new URL(route.request().url()).pathname;
    if (path === '/api/health') return route.fulfill({ json: { credentials_configured: true } });
    if (path === '/api/global-snapshot') return route.fulfill({ json: body });
    if (path === '/api/live-flights') return route.fulfill({ json: { count: 0, states: [], time: 1, provider: 'fixture' } });
    return route.fulfill({ json: path.endsWith('airports') || path === '/api/search-airports' ? [] : { success: true, flights: [], count: 0, summary: { total: 0, live_airborne: 0, live_on_ground: 0, unique_airlines: 0 } } });
  });
}

test.use({ reducedMotion: 'reduce' });

test('a dense map offers a skip link that lands on the In view list', async ({ page, isMobile }) => {
  test.skip(isMobile, 'Tab order is a keyboard (desktop) concern.');
  await mockApi(page);
  await page.goto('/?at=48,5,5');
  await expect(page.locator('.map-status')).toContainText('1200 aircraft', { timeout: 10_000 });
  const skip = page.getByRole('link', { name: /skip to the list of .* aircraft in view/i });
  await expect(skip).toHaveCount(1);
  await skip.focus();
  await page.keyboard.press('Enter');
  await expect(page.locator('.flight-list .flight-card').first()).toBeFocused();
});

test('a sparse map does not offer the dense skip link', async ({ page }) => {
  await mockApi(page, snapshot(5));
  await page.goto('/?at=48,5,5');
  await expect(page.locator('.map-status')).toContainText('5 aircraft', { timeout: 10_000 });
  await expect(page.getByRole('link', { name: /skip to the list of/i })).toHaveCount(0);
});

test('an aircraft is selected from the In view list with the keyboard only', async ({ page, isMobile }) => {
  test.skip(isMobile, 'Keyboard-only flow.');
  await mockApi(page);
  await page.goto('/?at=48,5,5');
  await expect(page.locator('.map-status')).toContainText('1200 aircraft', { timeout: 10_000 });
  await page.getByRole('link', { name: /skip to the list of/i }).focus();
  await page.keyboard.press('Enter');
  await page.keyboard.press('ArrowDown');
  const second = page.locator('.flight-list .flight-card').nth(1);
  await expect(second).toBeFocused();
  await page.keyboard.press('Enter');
  await expect(second).toHaveAttribute('aria-pressed', 'true');
});

test('the list follows the visible area when the map moves away', async ({ page }) => {
  await mockApi(page);
  await page.goto('/?at=-30,150,6');
  await expect(page.locator('.stats-row')).toContainText('100', { timeout: 10_000 });
  await expect(page.locator('.flight-list .flight-card').first()).toContainText('FAR');
});

test('a dense map including its markers has no WCAG A/AA violations', async ({ page }) => {
  await mockApi(page);
  await page.goto('/?at=48,5,5');
  await expect(page.locator('.map-status')).toContainText('1200 aircraft', { timeout: 10_000 });
  await page.waitForFunction(() => document.getAnimations().every(a => a.playState !== 'running' || a.effect?.getComputedTiming().iterations === Infinity));
  const results = await new AxeBuilder({ page }).withTags(['wcag2a', 'wcag2aa']).analyze();
  expect(results.violations.map(v => `${v.id}: ${v.nodes.map(n => n.target.join(' ')).join(', ')}`)).toEqual([]);
});
