import { expect, test } from '@playwright/test';
import AxeBuilder from '@axe-core/playwright';
import { readFileSync } from 'node:fs';
const catalogue = JSON.parse(readFileSync(new URL('../data/cabin-configurations.json', import.meta.url), 'utf8'));
const config = catalogue.find((c: { id: string }) => c.id === 'af-a359-292');
test.use({ reducedMotion: 'reduce' });

async function fixture(page: import('@playwright/test').Page, mode: 'ready' | 'empty' | 'error') {
  let unavailable = mode === 'error';
  const now = Math.floor(Date.now() / 1000);
  const day = Math.floor(now / 86400) * 86400;
  const flight = { icao24: 'abc123', callsign: 'AFR123', aircraft_type: 'A359', latitude: 48.5, longitude: 2.2, baro_altitude: 10000, velocity: 210, on_ground: false, time_position: now };
  await page.route('https://api.planespotters.net/**', r => r.fulfill({ json: { photos: [] } }));
  await page.route('**/api/**', async route => {
    const path = new URL(route.request().url()).pathname;
    if (path === '/api/aircraft-enrichment') {
      if (unavailable) return route.fulfill({ status: 503, json: { error: 'unavailable' } });
      return route.fulfill({ json: { success: true, operator_code: 'AFR', aircraft_type: 'A359', match_level: 'operator_type', configurations: mode === 'empty' ? [] : [config] } });
    }
    const body = path === '/api/health' ? { live_available: true }
      : path === '/api/live-flights' ? { states: [flight], count: 1, time: now }
      : path === '/api/track' ? { track: { icao24: 'abc123', path: [[day-600,48.5,2.2,9000,90,false],[day,48.5,2.2,null,90,false],[now,48.5,2.2,10000,90,false]] } }
      : path === '/api/flight-info' ? { success: true, ...flight }
      : { success: true, airframe: {}, history: [], sources: [] };
    return route.fulfill({ json: body });
  });
  await page.goto('/?at=48.5,2.2,10');
  await page.locator('[data-icao24="abc123"]').first().click();
  return () => { unavailable = false; };
}
async function audit(page: import('@playwright/test').Page) {
  await page.waitForFunction(() => document.getAnimations().every(a => a.playState !== 'running' || a.effect?.getComputedTiming().iterations === Infinity));
  const results = await new AxeBuilder({ page }).exclude('.leaflet-pane').exclude('.leaflet-control-container').withTags(['wcag2a', 'wcag2aa']).analyze();
  expect(results.violations.map(v => `${v.id}: ${v.nodes.map(n => n.target.join(' ')).join(', ')}`)).toEqual([]);
}
for (const theme of ['light', 'dark'] as const) {
  for (const width of [375, 768, 1440]) {
    test(`${theme} cabin and midnight graph at ${width}px`, async ({ page }, info) => {
      test.skip(info.project.name === 'webkit-mobile' && width !== 375, 'Desktop browser covers tablet and wide layout.');
      await page.setViewportSize({ width, height: 1000 });
      await page.emulateMedia({ colorScheme: theme });
      await fixture(page, 'ready');
      const cabin = page.getByRole('region', { name: 'Cabin configurations' });
      await expect(cabin.getByRole('heading', { name: 'Business' })).toBeVisible();
      const inventory = cabin.locator('.cabin-inventory-toggle');
      await expect(inventory).not.toHaveAttribute('open', '');
      await expect(cabin.locator('.cabin-seat-grid').first()).not.toBeVisible();
      if (width <= 900) await page.getByRole('button', { name: 'Expand details' }).click();
      await cabin.scrollIntoViewIfNeeded();
      await page.screenshot({ path: info.outputPath('compact-cabin.png') });
      const toggle = inventory.locator('summary');
      await toggle.focus(); await page.keyboard.press('Enter');
      await expect(inventory).toHaveAttribute('open', '');
      await expect(inventory.locator('.cabin-seat')).toHaveCount(292);
      await audit(page);
      await toggle.press('Enter');
      const chart = page.locator('.altitude-profile');
      await chart.locator('..').evaluate(el => { if (el instanceof HTMLDetailsElement) el.open = true; });
      await chart.scrollIntoViewIfNeeded();
      await expect(chart.locator('.chart-time-axis')).toContainText(new Date((Math.floor(Date.now()/86400000)*86400-600)*1000).toLocaleDateString('en-GB', {day:'2-digit',month:'short',timeZone:'UTC'}));
      const slider = page.getByRole('slider', { name: 'Inspect altitude point' });
      await slider.focus(); await slider.press('Home');
      await expect(slider).toHaveValue('0');
      await slider.press('ArrowRight');
      await expect(slider).toHaveAttribute('aria-valuetext', /No altitude/);
      await page.evaluate(() => { document.documentElement.style.fontSize = '200%'; });
      expect(await page.getByRole('complementary', { name: 'Selected flight details' }).evaluate(el => el.scrollWidth <= el.clientWidth)).toBe(true);
      await audit(page);
      await chart.scrollIntoViewIfNeeded();
      await page.screenshot({ path: info.outputPath('large-text-graph.png') });
    });
  }
}
for (const mode of ['empty', 'error'] as const) test(`${mode} cabin state is accessible: failures say so, missing data leaves no section`, async ({ page }) => {
  const recover = await fixture(page, mode);
  if (mode === 'error') {
    await expect(page.getByText('Cabin configurations could not be loaded.')).toBeVisible();
    await audit(page);
    recover();
    await page.getByRole('button', {name: 'Retry cabin'}).click();
    await expect(page.getByRole('heading', {name: 'Business'})).toBeVisible();
  } else {
    // No published configuration: the section is simply absent.
    await expect(page.getByRole('complementary', { name: 'Selected flight details' })).toBeVisible();
    await expect(page.getByRole('region', { name: 'Cabin configurations' })).toHaveCount(0);
    await expect(page.getByText(/No published configuration/)).toHaveCount(0);
  }
  await audit(page);
});
