import { expect, test, type Page } from '@playwright/test';

const airport = { icao: 'LFPG', iata: 'CDG', name: 'Paris Charles de Gaulle', latitude: 49, longitude: 2.5 };
const FIELDS = ['icao24', 'callsign', 'latitude', 'longitude', 'baro_altitude', 'geo_altitude', 'velocity', 'true_track', 'vertical_rate', 'on_ground', 'squawk', 'category', 'source', 'fix_age'];

// 2,000 aircraft over France and Germany plus 400 on the other side of the world.
function snapshot() {
  const rows: unknown[][] = [];
  for (let i = 0; i < 2000; i += 1) {
    rows.push([i.toString(16).padStart(6, '0'), `SNAP${i}`, 46 + (i % 40) / 10, 0 + Math.floor(i / 40) / 10, 10000, 10000, 200, 90, 0, 0, null, 3, 'adsb', 5]);
  }
  for (let i = 0; i < 400; i += 1) {
    rows.push([(0x100000 + i).toString(16), `FAR${i}`, -30 + (i % 20) / 10, 150 + Math.floor(i / 20) / 10, 10000, 10000, 200, 90, 0, 0, null, 3, 'adsb', 5]);
  }
  return { success: true, provider: 'opensky', time: Math.floor(Date.now() / 1000), count: rows.length, fields: FIELDS, aircraft: rows, age_seconds: 0, refresh_after_seconds: 86 };
}

async function mockApi(page: Page, calls: string[]) {
  await page.route('**/api/**', async route => {
    const path = new URL(route.request().url()).pathname;
    calls.push(path);
    if (path === '/api/health') return route.fulfill({ json: { credentials_configured: true } });
    if (path === '/api/global-snapshot') return route.fulfill({ json: snapshot() });
    if (path === '/api/live-flights') return route.fulfill({ json: { count: 0, states: [], time: 1, provider: 'fixture' } });
    return route.fulfill({ json: path === '/api/search-airports' || path === '/api/airports' || path === '/api/map-airports' ? [airport] : { success: true, flights: [], count: 0, summary: { total: 0, live_airborne: 0, live_on_ground: 0, unique_airlines: 0 } } });
  });
}

test('a wide view shows every aircraft of the snapshot that is in view', async ({ page }) => {
  const calls: string[] = [];
  await mockApi(page, calls);
  await page.goto('/?at=48,5,5');
  await expect(page.locator('.map-status')).toContainText('2000 aircraft', { timeout: 10_000 });
  expect(calls).toContain('/api/global-snapshot');
  expect(calls).not.toContain('/api/live-flights');
});

test('the snapshot is not fetched at close zoom', async ({ page }) => {
  const calls: string[] = [];
  await mockApi(page, calls);
  await page.goto('/?at=49,2.5,11');
  await expect.poll(() => calls.includes('/api/live-flights'), { timeout: 10_000 }).toBe(true);
  await page.waitForTimeout(500);
  expect(calls).not.toContain('/api/global-snapshot');
});

test('close zoom refreshes the Local feed every 5 to 10 seconds', async ({ page }) => {
  test.setTimeout(45_000);
  const stamps: number[] = [];
  await mockApi(page, []);
  await page.route('**/api/live-flights**', async route => {
    stamps.push(Date.now());
    const now = Math.floor(Date.now() / 1000);
    const states = [{ icao24: 'abc123', callsign: 'LOCAL1', latitude: 49, longitude: 2.5, baro_altitude: 3000, velocity: 100, true_track: 90, on_ground: false, time_position: now, data_source: 'live-nearby' }];
    await route.fulfill({ json: { count: 1, states, time: now, provider: 'adsb.fi', refresh_after_seconds: 8 } });
  });
  await page.goto('/?at=49,2.5,11');
  // Tiles of one round are requested together: count rounds, not requests.
  const rounds = () => stamps.filter((time, index) => index === 0 || time - stamps[index - 1] > 2_000);
  await expect.poll(() => rounds().length, { timeout: 35_000 }).toBeGreaterThanOrEqual(3);
  const starts = rounds();
  for (const [index, time] of starts.slice(1, 3).entries()) {
    const gap = (time - starts[index]) / 1000;
    expect(gap).toBeGreaterThanOrEqual(5);
    expect(gap).toBeLessThanOrEqual(10.5);
  }
});

test('the map credits OpenSky, adsb.fi and adsb.lol', async ({ page }) => {
  await mockApi(page, []);
  await page.goto('/');
  const credits = page.locator('.maplibregl-ctrl-attrib');
  await expect(credits).toContainText('OpenSky');
  await expect(credits).toContainText('adsb.fi');
  await expect(credits).toContainText('adsb.lol');
});
