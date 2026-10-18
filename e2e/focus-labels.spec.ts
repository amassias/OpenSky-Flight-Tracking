import { expect, test, type Page } from '@playwright/test';

// Focus labels (issue #25): on a dense view only the selected aircraft, emergency squawks and the
// roughly 15 aircraft nearest the map centre carry a label; the rest stay readable as silhouettes.

const FIELDS = ['icao24', 'callsign', 'latitude', 'longitude', 'baro_altitude', 'geo_altitude', 'velocity', 'true_track', 'vertical_rate', 'on_ground', 'squawk', 'category', 'source', 'fix_age'];
const now = Math.floor(Date.now() / 1000);

test.use({ viewport: { width: 1100, height: 760 } });

/**
 * 900 aircraft packed into a block east of the centre, 16 well-spaced aircraft around the centre
 * (one exactly at the centre) and two emergencies far from it.
 */
function traffic() {
  const rows: unknown[][] = [];
  const row = (icao24: string, callsign: string, lat: number, lon: number, squawk: string) =>
    rows.push([icao24, callsign, lat, lon, 10000, 10000, 200, 90, 0, 0, squawk, 3, 'adsb', 5]);
  for (let i = 0; i < 900; i += 1) row((0xa00000 + i).toString(16), `DENSE${i}`, 48 - 0.12 + Math.floor(i / 30) * 0.008, 5.9 + (i % 30) * 0.01, '1000');
  for (let i = 0; i < 16; i += 1) row((0xc00000 + i).toString(16), `NEAR${i}`, 48 + ((i % 8) - 3) * 0.065, 5 + Math.floor(i / 8) * 0.3, '1000');
  row('b00001', 'MAYDAY1', 48.3, 4.3, '7700');
  row('b00002', 'HIJACK2', 47.7, 5.9, '7500');
  return rows;
}

async function mockApi(page: Page) {
  const rows = traffic();
  const live = rows.map(row => ({ ...Object.fromEntries(FIELDS.map((field, index) => [field, row[index]])), time_position: now, last_contact: now }));
  await page.route('**/api/**', route => {
    const path = new URL(route.request().url()).pathname;
    if (path === '/api/health') return route.fulfill({ json: { credentials_configured: true } });
    if (path === '/api/global-snapshot') return route.fulfill({ json: { success: true, provider: 'opensky', time: now, count: rows.length, fields: FIELDS, aircraft: rows, age_seconds: 0, refresh_after_seconds: 86 } });
    if (path === '/api/live-flights') return route.fulfill({ json: { states: live, count: live.length, time: now } });
    if (path === '/api/track') return route.fulfill({ json: { track: { icao24: 'a00000', path: [] } } });
    if (path === '/api/flight-info') return route.fulfill({ json: { success: true, icao24: 'a00000', callsign: 'DENSE0' } });
    return route.fulfill({ json: path.endsWith('airports') ? [] : { success: true, flights: [], count: 0 } });
  });
  await page.route('https://api.planespotters.net/**', route => route.fulfill({ json: { photos: [] } }));
}

const labels = (page: Page) => page.locator('.aircraft-label');
const labelTexts = async (page: Page) => (await labels(page).locator('b').allTextContents()).sort();
const drawn = async (page: Page) => Number(await page.locator('.flight-map').getAttribute('data-aircraft-drawn') ?? 0);

async function openDense(page: Page, view: string) {
  await mockApi(page);
  await page.goto(`/?at=${view}`);
  await expect(page.locator('.flight-map')).toHaveCount(1, { timeout: 15_000 });
  await expect.poll(() => drawn(page), { timeout: 15_000 }).toBeGreaterThan(400);
  await page.waitForTimeout(600);
}

test('a dense view labels only emergencies and the 15 aircraft nearest the centre', async ({ page }) => {
  await openDense(page, '48,5,9');
  const texts = await labelTexts(page);
  expect(texts).toContain('MAYDAY1');
  expect(texts).toContain('HIJACK2');
  expect(texts.filter(text => text.startsWith('NEAR'))).toHaveLength(15);
  expect(texts.filter(text => text.startsWith('DENSE'))).toHaveLength(0);
  expect(texts).toHaveLength(17);
});

test('unlabelled aircraft are still drawn as silhouettes on the map', async ({ page }) => {
  await openDense(page, '48,5,9');
  // 918 aircraft in view, 17 of them labelled (and so drawn as detailed markers instead).
  await expect.poll(() => drawn(page)).toBe(901);
  await expect(page.locator('.flight-map')).toBeVisible();
});

test('zoomed out, only emergencies keep a label', async ({ page }) => {
  await openDense(page, '48,5,6');
  expect(await labelTexts(page)).toEqual(['HIJACK2', 'MAYDAY1']);
});

test('the selected aircraft label is never hidden by another label', async ({ page }) => {
  await openDense(page, '48,5,9');
  const box = (await page.locator('.flight-map').boundingBox())!;
  await page.mouse.click(box.x + box.width / 2, box.y + box.height / 2);
  await expect(page.locator('.aircraft-marker.active')).toHaveCount(1, { timeout: 10_000 });
  const selected = page.locator('.aircraft-marker-selected .aircraft-label');
  await expect(selected).toBeVisible();
  await page.waitForTimeout(300);
  const selectedBox = (await selected.boundingBox())!;
  const others = page.locator('.aircraft-marker-wrap:not(.aircraft-marker-selected) .aircraft-label');
  for (const other of await others.all()) {
    const otherBox = await other.boundingBox();
    if (!otherBox) continue;
    const overlap = selectedBox.x < otherBox.x + otherBox.width && selectedBox.x + selectedBox.width > otherBox.x
      && selectedBox.y < otherBox.y + otherBox.height && selectedBox.y + selectedBox.height > otherBox.y;
    expect(overlap, 'another label overlaps the selected label').toBe(false);
  }
});
