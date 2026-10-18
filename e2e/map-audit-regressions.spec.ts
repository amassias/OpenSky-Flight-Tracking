import { expect, test } from '@playwright/test';

// Behaviour at the browser/API seam: map coordinates and feed state after the migration.
test('shows aircraft on both sides of the date line and sends valid provider boxes', async ({ page }) => {
  const boxes: URLSearchParams[] = [];
  await page.route('**/api/**', route => {
    const url = new URL(route.request().url());
    if (url.pathname === '/api/health') return route.fulfill({ json: { live_available: true } });
    if (url.pathname === '/api/live-flights') {
      boxes.push(url.searchParams);
      const now = Math.floor(Date.now() / 1000);
      const states = [179.8, -179.8].map((longitude, i) => ({ icao24: `abc00${i}`, callsign: `PACIFIC${i}`, latitude: 0, longitude,
        time_position: now, last_contact: now, on_ground: false, velocity: 0, true_track: 90 }))
        .filter(item => item.longitude >= Number(url.searchParams.get('lomin')) && item.longitude <= Number(url.searchParams.get('lomax')));
      return route.fulfill({ json: { success: true, time: now, states, count: states.length } });
    }
    return route.fulfill({ json: [] });
  });
  await page.goto('/?at=0,179.99,10');
  await expect(page.locator('.aircraft-marker')).toHaveCount(2);
  // Panning into a repeated world must preserve both aircraft and a reloadable link.
  await page.evaluate(() => {
    (window as unknown as { __skytraceMap: { jumpTo(options: { center: [number, number] }): void } }).__skytraceMap.jumpTo({ center: [539.99, 0] });
  });
  await expect.poll(() => new URL(page.url()).searchParams.get('at')?.split(',')[1]).toBe('179.990');
  await expect(page.locator('.aircraft-marker')).toHaveCount(2);
  for (const box of boxes) {
    expect(Number(box.get('lomin'))).toBeGreaterThanOrEqual(-180);
    expect(Number(box.get('lomax'))).toBeLessThanOrEqual(180);
    expect(Number(box.get('lomin'))).toBeLessThan(Number(box.get('lomax')));
  }
});

test('a degraded local feed stays labelled Delayed until a fresh answer recovers it', async ({ page }) => {
  let degraded = true;
  await page.route('**/api/**', route => {
    const path = new URL(route.request().url()).pathname;
    if (path === '/api/health') return route.fulfill({ json: { live_available: true } });
    if (path === '/api/live-flights') {
      const time = Math.floor(Date.now() / 1000) - (degraded ? 90 : 0);
      return route.fulfill({ json: { success: true, degraded, time, states: [{ icao24: 'abc001', callsign: 'LOCAL1',
        latitude: 48.85, longitude: 2.35, time_position: time, last_contact: time, on_ground: false, velocity: 0 }], count: 1 } });
    }
    return route.fulfill({ json: [] });
  });
  await page.goto('/?at=48.85,2.35,11');
  await expect(page.locator('.aircraft-marker')).toHaveCount(1);
  await expect(page.getByLabel('Connection status')).toContainText('Delayed');
  await expect(page.locator('.map-status strong')).toHaveText('Delayed');
  degraded = false;
  await page.getByRole('button', { name: 'Zoom in', exact: true }).click();
  await expect(page.getByLabel('Connection status')).toContainText('Live');
  await expect(page.locator('.map-status strong')).toHaveText('Live');
});


test('shared map links restore fractional zoom and the closest supported zoom', async ({ page }) => {
  await page.route('**/api/**', route => route.fulfill({ json: route.request().url().includes('/health') ? { live_available: true } : [] }));
  for (const zoom of [8.25, 1.5, 19]) {
    await page.goto(`/?at=48.85,2.35,${zoom}`);
    await expect.poll(() => page.evaluate(() => {
      const map = (window as unknown as { __skytraceMap?: { getZoom(): number } }).__skytraceMap;
      return map ? map.getZoom() + 1 : null;
    })).toBe(zoom);
  }
});
