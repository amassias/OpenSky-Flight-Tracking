import { expect, test, type Page } from '@playwright/test';

const airport = { icao: 'LFPG', iata: 'CDG', name: 'Paris Charles de Gaulle', latitude: 49, longitude: 2.5 };
const FIELDS = ['icao24', 'callsign', 'latitude', 'longitude', 'baro_altitude', 'geo_altitude', 'velocity', 'true_track', 'vertical_rate', 'on_ground', 'squawk', 'category', 'source', 'fix_age'];

function rows(count: number, prefix: string) {
  return Array.from({ length: count }, (_, i) => [(0x400000 + i).toString(16), `${prefix}${i}`, 46 + (i % 40) / 10, Math.floor(i / 40) / 10, 10000, 10000, 200, 90, 0, 0, null, 3, 'adsb', 5]);
}

function snapshot(extra: Record<string, unknown> = {}) {
  const aircraft = rows(300, 'SNAP');
  return { success: true, provider: 'opensky', time: Math.floor(Date.now() / 1000), count: aircraft.length, fields: FIELDS, aircraft, age_seconds: 0, refresh_after_seconds: 86, ...extra };
}

function localCell(index: number) {
  return { success: true, provider: 'adsb.fi', time: Math.floor(Date.now() / 1000), count: 5, states: Array.from({ length: 5 }, (_, i) => ({
    icao24: `c${index}${i}`.padEnd(6, '0'), callsign: `LOC${index}${i}`, latitude: 47 + index * 0.01, longitude: 1 + i * 0.01, baro_altitude: 9000, geo_altitude: 9000,
    velocity: 200, true_track: 90, vertical_rate: 0, on_ground: false, squawk: null, category: 3, time_position: Math.floor(Date.now() / 1000) - 3, data_source: 'adsb.fi',
  })) };
}

interface Mode { snapshot: () => { status: number; json: unknown } | 'abort'; cells: 'ok' | 'fail' }

async function mockApi(page: Page, mode: Mode, calls: string[] = []) {
  let cell = 0;
  await page.route('**/api/**', async route => {
    const path = new URL(route.request().url()).pathname;
    calls.push(path);
    if (path === '/api/health') return route.fulfill({ json: { credentials_configured: true } });
    if (path === '/api/global-snapshot') {
      const answer = mode.snapshot();
      return answer === 'abort' ? route.abort('connectionrefused') : route.fulfill({ status: answer.status, json: answer.json });
    }
    if (path === '/api/live-flights') {
      return mode.cells === 'ok' ? route.fulfill({ json: localCell(cell++) }) : route.fulfill({ status: 503, json: { success: false, error: 'down' } });
    }
    return route.fulfill({ json: path === '/api/search-airports' || path === '/api/airports' || path === '/api/map-airports' ? [airport] : { success: true, flights: [], count: 0, summary: { total: 0, live_airborne: 0, live_on_ground: 0, unique_airlines: 0 } } });
  });
}

test('a delayed OpenSky keeps the snapshot on the map labelled with its age', async ({ page }) => {
  await mockApi(page, { snapshot: () => ({ status: 200, json: snapshot({ degraded: true, degraded_reason: 'provider', age_seconds: 40, notice: 'Live refresh delayed. Snapshot from 40 s ago.' }) }), cells: 'fail' });
  await page.goto('/?at=48,5,5');
  const status = page.locator('.map-status');
  await expect(status).toContainText('300 aircraft', { timeout: 10_000 });
  await expect(status).toContainText(/snapshot from (4\d|5\d) s ago/);
  await expect(status).toContainText('OpenSky is not answering');
  await expect(status).not.toContainText('Zoom out');
});

test('an exhausted credit budget is named as the quota', async ({ page }) => {
  await mockApi(page, { snapshot: () => ({ status: 200, json: snapshot({ degraded: true, degraded_reason: 'quota', age_seconds: 600 }) }), cells: 'fail' });
  await page.goto('/?at=48,5,5');
  const status = page.locator('.map-status');
  await expect(status).toContainText('300 aircraft', { timeout: 10_000 });
  await expect(status).toContainText('snapshot from');
  await expect(status).toContainText('OpenSky credit budget reached');
});

test('when the snapshot is unavailable a wide view falls back to a few local cells', async ({ page }) => {
  const calls: string[] = [];
  await mockApi(page, { snapshot: () => ({ status: 503, json: { success: false, error: 'OpenSky down' } }), cells: 'ok' }, calls);
  await page.goto('/?at=48,5,5');
  const status = page.locator('.map-status');
  await expect(status).toContainText('reduced coverage', { timeout: 10_000 });
  await expect(status).toContainText('OpenSky is not answering');
  const cells = calls.filter(path => path === '/api/live-flights').length;
  expect(cells).toBeGreaterThan(1);
  // At most four cells per attempt at the snapshot, never the old 24 to 36 tiles.
  expect(cells).toBeLessThanOrEqual(4 * calls.filter(path => path === '/api/global-snapshot').length);
});

test('the last snapshot is never erased when the backend becomes unreachable', async ({ page }) => {
  let down = false;
  await mockApi(page, { snapshot: () => (down ? 'abort' : { status: 200, json: snapshot() }), cells: 'fail' });
  await page.goto('/?at=48,5,5');
  const status = page.locator('.map-status');
  await expect(status).toContainText('300 aircraft', { timeout: 10_000 });
  down = true;
  await page.getByRole('button', { name: 'Zoom out' }).click();
  await expect(status).toContainText('snapshot from', { timeout: 10_000 });
  await expect(status).toContainText('SkyTrace cannot be reached');
  await expect(status).toContainText('300 aircraft');
});

test('the empty list names the real cause instead of telling the visitor to zoom out', async ({ page }) => {
  await mockApi(page, { snapshot: () => ({ status: 429, json: { success: false, error: 'OpenSky daily credit budget used up.' } }), cells: 'fail' });
  await page.goto('/?at=48,5,5');
  const panel = page.locator('#flight-results');
  await expect(panel).toContainText('OpenSky credit budget reached', { timeout: 10_000 });
  await expect(panel).not.toContainText('Zoom out or move the map');
});
