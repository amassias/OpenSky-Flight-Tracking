import { expect, test } from '@playwright/test';

const airport = { icao: 'LFPG', iata: 'CDG', name: 'Paris Charles de Gaulle', latitude: 49, longitude: 2.5 };

test('restores a visited viewport while its refresh is in flight', async ({ page, isMobile }) => {
  test.skip(isMobile, 'Wheel zoom is not available in mobile WebKit.');
  let phase: 'initial' | 'wide' | 'return' = 'initial';
  await page.route('**/api/**', async route => {
    const path = new URL(route.request().url()).pathname;
    if (path === '/api/health') return route.fulfill({ json: { credentials_configured: true } });
    if (path === '/api/live-flights') {
      if (phase === 'return') await new Promise(resolve => setTimeout(resolve, 1_200));
      const states = phase === 'initial'
        ? Array.from({ length: 50 }, (_, i) => ({ icao24: i.toString(16).padStart(6, '0'), callsign: `TEST${i}`, latitude: 48.8 + i / 1000, longitude: 2.3 + i / 1000, true_track: 90 }))
        : phase === 'wide'
          ? [{ icao24: 'ffffff', callsign: 'WIDE', latitude: 52, longitude: 7, true_track: 90 }]
          : [];
      return route.fulfill({ json: { count: states.length, states, time: 1, provider: 'fixture' } });
    }
    return route.fulfill({ json: path === '/api/search-airports' || path === '/api/airports' ? [airport] : { success: true, flights: [], count: 0, summary: { total: 0, live_airborne: 0, live_on_ground: 0, unique_airlines: 0 } } });
  });

  await page.goto('/');
  await expect(page.locator('.aircraft-marker')).toHaveCount(50, { timeout: 5_000 });
  phase = 'wide';
  await page.locator('.leaflet-map').hover();
  await page.mouse.wheel(0, -480);
  await expect(page.locator('.aircraft-marker')).toHaveCount(1, { timeout: 5_000 });
  phase = 'return';
  await page.mouse.wheel(0, 480);
  await expect(page.locator('.aircraft-marker')).toHaveCount(50, { timeout: 1_000 });
});
