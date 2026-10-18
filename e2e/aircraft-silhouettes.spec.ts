import { expect, test, type Page } from '@playwright/test';

const now = Math.floor(Date.now() / 1000);
const aircraft = [
  { icao24: 'aa0001', callsign: 'MODEL1', aircraft_type: 'A320', latitude: 48.64, longitude: 2.08, true_track: 0 },
  { icao24: 'aa0002', callsign: 'MODEL2', aircraft_type: 'B738', latitude: 48.64, longitude: 2.32, true_track: 90, squawk: '7700' },
  { icao24: 'aa0003', callsign: 'MODEL3', aircraft_type: 'A388', latitude: 48.46, longitude: 2.08, true_track: 180, on_ground: true },
  { icao24: 'aa0004', callsign: 'MODEL4', aircraft_type: 'EC35', latitude: 48.46, longitude: 2.32, true_track: 270 },
  { icao24: 'aa0005', callsign: 'MODEL5', aircraft_type: 'ZZZZ', latitude: 48.28, longitude: 2.08, true_track: 45 },
  { icao24: 'aa0006', callsign: 'MODEL6', latitude: 48.28, longitude: 2.32, true_track: 45, time_position: now - 80 },
].map(item => ({ time_position: now, last_contact: now, on_ground: false, velocity: 0, baro_altitude: 5000, ...item }));

async function mockFeed(page: Page, dense = false) {
  await page.route('**/api/**', route => {
    const url = new URL(route.request().url());
    const states = dense ? Array.from({ length: 900 }, (_, i) => ({ ...aircraft[0], icao24: i.toString(16).padStart(6, '0'), callsign: `DENSE${i}`, latitude: 48.3 + (i % 30) / 100, longitude: 2.1 + Math.floor(i / 30) / 100 })) : aircraft;
    const body = url.pathname === '/api/health' ? { live_available: true }
      : url.pathname === '/api/live-flights' ? { states, count: states.length, time: now }
      : url.pathname === '/api/track' ? { track: { icao24: url.searchParams.get('icao24'), path: [] } }
      : url.pathname === '/api/flight-info' ? { success: true, icao24: url.searchParams.get('icao24'), callsign: url.searchParams.get('callsign') }
      : [];
    return route.fulfill({ json: body });
  });
  await page.route('https://api.planespotters.net/**', route => route.fulfill({ json: { photos: [] } }));
}

test('renders model sprites, headings, fallback and map states in both themes', async ({ page }, info) => {
  await page.emulateMedia({ reducedMotion: 'reduce' });
  const errors: string[] = [];
  const modelDownloads: string[] = [];
  page.on('pageerror', error => errors.push(error.message));
  page.on('request', request => { if (/\.glb|raw\.githubusercontent/.test(request.url())) modelDownloads.push(request.url()); });
  await mockFeed(page);
  await page.goto('/?at=48.46,2.2,10');
  await expect(page.locator('.aircraft-marker')).toHaveCount(6);
  for (const [hex, id, heading] of [['aa0001', 'a320', '0deg'], ['aa0002', 'b738', '90deg'], ['aa0003', 'a380', '180deg'], ['aa0004', 'heli', '270deg']]) {
    const marker = page.locator(`[data-icao24="${hex}"]`);
    await expect(marker).toHaveAttribute('data-aircraft-model', id);
    await expect(marker.locator('use').first()).toHaveAttribute('href', `#aircraft-model-${id}`);
    expect(await marker.evaluate(el => (el as HTMLElement).style.getPropertyValue('--heading'))).toBe(heading);
    expect(await marker.locator('use').first().evaluate(el => (el as SVGGraphicsElement).getBBox().width)).toBeGreaterThan(20);
  }
  await expect(page.locator('[data-icao24="aa0002"]')).toHaveClass(/emergency/);
  await expect(page.locator('[data-icao24="aa0003"]')).toHaveClass(/ground/);
  await expect(page.locator('[data-icao24="aa0005"] svg')).toHaveAttribute('viewBox', '0 0 24 24');
  await expect(page.locator('[data-icao24="aa0006"] svg')).toHaveAttribute('viewBox', '0 0 24 24');
  await expect(page.locator('.aircraft-marker-wrap').filter({ has: page.locator('[data-icao24="aa0006"]') })).toHaveAttribute('data-freshness', 'delayed');
  await expect(page.locator('.aircraft-model-rotor')).toHaveCSS('animation-name', 'none');
  await page.emulateMedia({ reducedMotion: 'no-preference' });
  await expect(page.locator('.aircraft-model-rotor')).toHaveCSS('animation-name', 'helicopter-rotor');
  await page.emulateMedia({ reducedMotion: 'reduce' });

  await page.getByRole('button', { name: 'Hide panels', exact: true }).click();
  for (const theme of ['dark', 'light']) {
    if (!await page.locator('.app').evaluate((el, theme) => el.classList.contains(`theme-${theme}`), theme)) {
      await page.locator('.leaflet-container').click({ position: { x: 10, y: 100 } });
      await page.keyboard.press('t');
    }
    await expect(page.locator('.app')).toHaveClass(new RegExp(`theme-${theme}`));
    // Wait for native theme snapshots and panel transitions before visual QA.
    await page.evaluate(async () => {
      await new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve)));
      await Promise.all(document.getAnimations().filter(animation => animation.effect?.getComputedTiming().iterations !== Infinity).map(animation => animation.finished.catch(() => {})));
    });
    await page.screenshot({ path: info.outputPath(`silhouettes-${theme}.png`), animations: 'disabled' });
    const normal = await page.locator('[data-icao24="aa0001"]').evaluate(el => getComputedStyle(el).color);
    const ground = await page.locator('[data-icao24="aa0003"]').evaluate(el => getComputedStyle(el).color);
    expect(normal).not.toBe(ground);
  }
  await page.locator('[data-icao24="aa0001"]').dispatchEvent('mousedown');
  await expect(page.locator('.aircraft-marker.active[data-aircraft-model="a320"]')).toHaveCount(1);
  expect(modelDownloads).toEqual([]);
  expect(errors).toEqual([]);
});

test('retains one detailed selected model among 900 canvas aircraft', async ({ page }) => {
  await mockFeed(page, true);
  await page.goto('/?at=48.46,2.2,10');
  await expect(page.locator('.map-status')).toContainText('900 aircraft');
  await expect(page.locator('.aircraft-model')).toHaveCount(0);
  await expect(page.locator('.leaflet-overlay-pane canvas')).toHaveCount(1);
  await page.getByRole('combobox', { name: 'Search flights and airports' }).fill('DENSE32');
  await page.getByRole('option', { name: /DENSE32/ }).first().click();
  await expect(page.locator('.aircraft-marker')).toHaveCount(1);
  await expect(page.locator('.aircraft-marker[data-aircraft-model="a320"]')).toHaveCount(1);
});

test('preserves silhouettes through dense zoom and a less detailed feed', async ({ page }) => {
  let wide = false;
  await mockFeed(page);
  await page.route('**/api/live-flights**', route => {
    const known = aircraft.map(({ aircraft_type: type, ...item }) => wide ? item : { ...item, aircraft_type: type });
    const extra = wide ? Array.from({ length: 1000 }, (_, i) => ({ ...aircraft[0], icao24: (0xbb0000 + i).toString(16), latitude: 47.8 + (i % 32) * .045, longitude: 1 + Math.floor(i / 32) * .075 })) : [];
    return route.fulfill({ json: { time: now, states: [...known, ...extra], count: known.length + extra.length } });
  });
  await page.goto('/?at=48.46,2.2,10');
  await expect(page.locator('[data-icao24="aa0001"]')).toHaveAttribute('data-aircraft-model', 'a320');
  await page.getByRole('button', { name: 'Hide panels', exact: true }).click();
  wide = true;
  for (const zoom of [9, 8, 7]) {
    await page.getByRole('button', { name: 'Zoom out', exact: true }).click();
    await expect.poll(() => new URL(page.url()).searchParams.get('at')?.split(',')[2]).toBe(String(zoom));
  }
  const canvas = page.locator('canvas[data-aircraft-renderer="silhouettes"]');
  await expect(canvas).toHaveCount(1);
  await expect.poll(() => canvas.evaluate(el => {
    const canvas = el as HTMLCanvasElement;
    const pixels = canvas.getContext('2d')!.getImageData(0, 0, canvas.width, canvas.height).data;
    let painted = 0;
    for (let i = 3; i < pixels.length; i += 4) if (pixels[i]) painted++;
    return painted;
  })).toBeGreaterThan(500);
  for (const zoom of [8, 9, 10]) {
    await page.getByRole('button', { name: 'Zoom in', exact: true }).click();
    await expect.poll(() => new URL(page.url()).searchParams.get('at')?.split(',')[2]).toBe(String(zoom));
  }
  const restored = page.locator('[data-icao24="aa0001"]');
  await expect(restored).toHaveAttribute('data-aircraft-model', 'a320');
  expect(await restored.locator('use').first().evaluate(el => (el as SVGGraphicsElement).getBBox().width)).toBeGreaterThan(20);
});
