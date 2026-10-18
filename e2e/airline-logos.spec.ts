import { expect, test } from '@playwright/test';

test('local ICAO logo survives selection and zoom on desktop and mobile', async ({ page }, info) => {
  const errors: string[] = [];
  page.on('pageerror', error => errors.push(error.message));
  const now = Math.floor(Date.now() / 1000);
  const aircraft = { icao24: 'aa0011', callsign: 'ADB9876', airline_code: 'ADB', aircraft_type: 'A124', latitude: 48.46, longitude: 2.2, true_track: 90, time_position: now, last_contact: now, on_ground: false, velocity: 0, baro_altitude: 5000 };
  const secondary = { ...aircraft, icao24: 'aa0012', callsign: 'RBG9876', airline_code: 'RBG', longitude: 2.25 };
  await page.route('**/api/**', route => {
    const url = new URL(route.request().url());
    const body = url.pathname === '/api/health' ? { live_available: true }
      : url.pathname === '/api/live-flights' ? { states: [aircraft, secondary], count: 2, time: now }
      : url.pathname === '/api/track' ? { track: { icao24: url.searchParams.get('icao24'), path: [] } }
      : url.pathname === '/api/flight-info' ? { success: true, ...(url.searchParams.get('icao24') === secondary.icao24 ? secondary : aircraft) }
      : { success: true, configurations: [], track: { path: [] }, airframe: {}, history: [], sources: [] };
    return route.fulfill({ json: body });
  });
  await page.route('https://api.planespotters.net/**', route => route.fulfill({ json: { photos: [] } }));
  // The basemap asks for tiles at the zoom it shows; OpenStreetMap itself is not needed.
  const tileZooms = new Set<number>();
  await page.route('https://tile.openstreetmap.org/**', route => { tileZooms.add(Number(new URL(route.request().url()).pathname.split('/')[1])); return route.abort(); });
  await page.goto('/?at=48.46,2.2,10');
  await expect(page.locator('[data-icao24="aa0011"]')).toHaveCount(1);
  await page.getByRole('button', { name: 'Dismiss map hints' }).click();
  await page.locator('[data-icao24="aa0012"]').dispatchEvent('mousedown');
  const secondaryLogo = page.locator('.aircraft-marker-selected .airline-logo');
  await expect(secondaryLogo).toHaveAttribute('src', '/airline-logos/operators/RBG.svg');
  await expect.poll(() => secondaryLogo.evaluate(el => (el as HTMLImageElement).naturalWidth)).toBeGreaterThan(0);
  await page.locator('[data-icao24="aa0011"]').dispatchEvent('mousedown');
  const logo = page.locator('.aircraft-marker-wrap:has(.aircraft-marker.active) .airline-logo');
  await expect(logo).toHaveAttribute('src', '/airline-logos/operators/ADB.png');
  await expect(logo).toHaveCSS('width', '20px');
  await expect.poll(() => logo.evaluate(el => (el as HTMLImageElement).naturalWidth)).toBeGreaterThan(0);
  await page.getByRole('button', { name: 'Hide panels', exact: true }).click();
  for (const [button, zoom] of [['Zoom out', 9], ['Zoom out', 8], ['Zoom in', 9], ['Zoom in', 10]] as const) {
    await page.getByRole('button', { name: button, exact: true }).click();
    await expect.poll(() => tileZooms.has(zoom)).toBe(true);
    await expect(page.locator('.flight-map.map-camera-moving')).toHaveCount(0);
    await expect(logo).toHaveAttribute('src', '/airline-logos/operators/ADB.png');
    await expect.poll(() => logo.evaluate(el => (el as HTMLImageElement).naturalWidth)).toBeGreaterThan(0);
  }
  await page.screenshot({ path: info.outputPath('local-airline-logo.png'), animations: 'disabled' });
  expect(errors).toEqual([]);
});
