import { expect, test, type Page } from '@playwright/test';

// The aircraft layer (issue #23, ADR 0009): every aircraft of a dense view is drawn by one
// WebGL layer of the map itself, which follows pan and zoom, survives theme switches and stays selectable.

const FIELDS = ['icao24', 'callsign', 'latitude', 'longitude', 'baro_altitude', 'geo_altitude', 'velocity', 'true_track', 'vertical_rate', 'on_ground', 'squawk', 'category', 'source', 'fix_age'];
const now = Math.floor(Date.now() / 1000);

/** 800 aircraft stacked at the view centre, so they stay in view through the pan and zoom below. */
function closeFeed() {
  const states = Array.from({ length: 800 }, (_, i) => ({ icao24: (0xc00000 + i).toString(16), callsign: `STACK${i}`, latitude: 48, longitude: 5 }))
    .map(item => ({ true_track: 90, velocity: 0, baro_altitude: 9000, on_ground: false, time_position: now, last_contact: now, ...item }));
  return { states, count: states.length, time: now };
}

/** 10,000 aircraft spread over western Europe. */
function snapshot() {
  const rows: unknown[][] = [];
  for (let i = 0; i < 10_000; i += 1) {
    rows.push([i.toString(16).padStart(6, '0'), `SNAP${i}`, 40 + (i % 100) * 0.16, -8 + Math.floor(i / 100) * 0.28, 10000, 10000, 200, 90, 0, 0, null, 3, 'adsb', 5]);
  }
  return { success: true, provider: 'opensky', time: now, count: rows.length, fields: FIELDS, aircraft: rows, age_seconds: 0, refresh_after_seconds: 86 };
}

async function mockApi(page: Page) {
  await page.route('**/api/**', route => {
    const path = new URL(route.request().url()).pathname;
    if (path === '/api/health') return route.fulfill({ json: { credentials_configured: true } });
    if (path === '/api/global-snapshot') return route.fulfill({ json: snapshot() });
    if (path === '/api/live-flights') return route.fulfill({ json: closeFeed() });
    if (path === '/api/track') return route.fulfill({ json: { track: { icao24: 'c00000', path: [] } } });
    if (path === '/api/flight-info') return route.fulfill({ json: { success: true, icao24: 'c00000', callsign: 'STACK0' } });
    return route.fulfill({ json: path.endsWith('airports') ? [] : { success: true, flights: [], count: 0 } });
  });
  await page.route('https://api.planespotters.net/**', route => route.fulfill({ json: { photos: [] } }));
}

const layer = (page: Page) => page.locator('.flight-map');
/** The map exposes itself in development builds so a test can switch the aircraft layer off to measure it. */
const setAircraftLayerVisible = (page: Page, visible: boolean) => page.evaluate(show => {
  (window as unknown as { __skytraceMap: { setLayoutProperty(layer: string, name: string, value: string): void } }).__skytraceMap
    .setLayoutProperty('aircraft', 'visibility', show ? 'visible' : 'none');
}, visible);
const drawn = async (page: Page) => Number(await layer(page).getAttribute('data-aircraft-drawn') ?? 0);

/**
 * Where, in page coordinates, the WebGL layer paints within `window`: the centroid of the
 * pixels that differ between a screenshot with and without the layer.
 */
async function paintedCentroid(page: Page, window: { x: number; y: number; size: number }) {
  await page.waitForTimeout(350); // two source updates
  const withLayer = await page.screenshot();
  await setAircraftLayerVisible(page, false);
  await page.waitForTimeout(100);
  const without = await page.screenshot();
  await setAircraftLayerVisible(page, true);
  return page.evaluate(async ({ a, b, window }) => {
    const decode = async (base64: string) => {
      const bytes = Uint8Array.from(atob(base64), c => c.charCodeAt(0));
      const bitmap = await createImageBitmap(new Blob([bytes], { type: 'image/png' }));
      const canvas = document.createElement('canvas');
      canvas.width = bitmap.width; canvas.height = bitmap.height;
      const context = canvas.getContext('2d')!;
      context.drawImage(bitmap, 0, 0);
      return { data: context.getImageData(0, 0, bitmap.width, bitmap.height), scale: bitmap.width / document.documentElement.clientWidth };
    };
    const [one, two] = [await decode(a), await decode(b)];
    const s = one.scale;
    let count = 0, sx = 0, sy = 0;
    for (let y = Math.max(0, Math.floor((window.y - window.size) * s)); y < (window.y + window.size) * s; y += 1) {
      for (let x = Math.max(0, Math.floor((window.x - window.size) * s)); x < (window.x + window.size) * s; x += 1) {
        const i = (y * one.data.width + x) * 4;
        if (Math.abs(one.data.data[i] - two.data.data[i]) + Math.abs(one.data.data[i + 1] - two.data.data[i + 1]) + Math.abs(one.data.data[i + 2] - two.data.data[i + 2]) > 40) { count += 1; sx += x / s; sy += y / s; }
      }
    }
    return { count, x: count ? sx / count : NaN, y: count ? sy / count : NaN };
  }, { a: withLayer.toString('base64'), b: without.toString('base64'), window });
}

async function mapCenter(page: Page) {
  const box = (await page.locator('.flight-map').boundingBox())!;
  return { x: box.x + box.width / 2, y: box.y + box.height / 2, box };
}

test('draws all 10,000 aircraft of the snapshot with no density sampling', async ({ page }) => {
  await mockApi(page);
  await page.goto('/?at=48,5,4');
  await expect(layer(page)).toHaveCount(1, { timeout: 15_000 });
  await expect(page.locator('.map-status')).toContainText('10000 aircraft', { timeout: 15_000 });
  await expect.poll(() => drawn(page), { timeout: 15_000 }).toBeGreaterThan(9_900);
  await expect(page.locator('canvas[data-aircraft-renderer="maplibre-gl"]')).toHaveCount(1);
  await expect(page.locator('.aircraft-marker')).toHaveCount(0);
});

/** Where, in page coordinates, the map puts the stacked aircraft (48 N, 5 E) once the camera has stopped. */
async function stackPoint(page: Page) {
  await expect(page.locator('.flight-map.map-camera-moving')).toHaveCount(0);
  const box = (await page.locator('.flight-map').boundingBox())!;
  const point = await page.evaluate(() => (window as unknown as { __skytraceMap: { project(lngLat: [number, number]): { x: number; y: number } } }).__skytraceMap.project([5, 48]));
  return { x: box.x + point.x, y: box.y + point.y };
}

test('the aircraft stay on their geographic position while the map pans and zooms', async ({ page, isMobile }) => {
  test.skip(isMobile, 'Mouse dragging is not available in mobile WebKit.');
  await mockApi(page);
  await page.goto('/?at=48,5,9');
  await expect.poll(() => drawn(page), { timeout: 15_000 }).toBe(800);
  const { x, y } = await mapCenter(page);

  const start = await paintedCentroid(page, { x, y, size: 40 });
  expect(start.count).toBeGreaterThan(20);
  expect(Math.hypot(start.x - x, start.y - y)).toBeLessThan(8);

  await page.mouse.move(x - 150, y + 100);
  await page.mouse.down();
  await page.mouse.move(x - 100, y + 125, { steps: 8 });
  await page.mouse.up();
  // The drag glides on after release; wait for the camera to stop, then ask the map where the stack is.
  const afterPan = await stackPoint(page);
  expect(Math.hypot(afterPan.x - x, afterPan.y - y)).toBeGreaterThan(20);
  const panned = await paintedCentroid(page, { ...afterPan, size: 40 });
  expect(panned.count).toBeGreaterThan(20);
  expect(Math.hypot(panned.x - afterPan.x, panned.y - afterPan.y)).toBeLessThan(8);

  await page.getByRole('button', { name: 'Zoom in', exact: true }).click();
  await expect.poll(() => new URL(page.url()).searchParams.get('at')?.split(',')[2]).toBe('10');
  const afterZoom = await stackPoint(page);
  // One zoom level doubles the distance from the centre.
  expect(Math.hypot(afterZoom.x - (x + 2 * (afterPan.x - x)), afterZoom.y - (y + 2 * (afterPan.y - y)))).toBeLessThan(3);
  const zoomed = await paintedCentroid(page, { ...afterZoom, size: 40 });
  expect(zoomed.count).toBeGreaterThan(20);
  expect(Math.hypot(zoomed.x - afterZoom.x, zoomed.y - afterZoom.y)).toBeLessThan(8);
});

test('selecting an aircraft on the WebGL layer opens its details', async ({ page }) => {
  await mockApi(page);
  await page.goto('/?at=48,5,9');
  await expect.poll(() => drawn(page), { timeout: 15_000 }).toBe(800);
  const { x, y } = await mapCenter(page);
  await page.waitForTimeout(300);
  await page.mouse.click(x, y);
  await expect(page.getByRole('button', { name: 'Close flight details', exact: true })).toBeVisible();
  await expect(page.locator('.aircraft-marker.active')).toHaveCount(1);
  // The selected aircraft leaves the WebGL layer for its detailed marker.
  await expect.poll(() => drawn(page)).toBe(799);
});

test('hovering an aircraft on the WebGL layer previews it, and leaving hides the preview', async ({ page, isMobile }) => {
  test.skip(isMobile, 'Hover needs a mouse.');
  await mockApi(page);
  await page.goto('/?at=48,5,9');
  await expect.poll(() => drawn(page), { timeout: 15_000 }).toBe(800);
  const { x, y } = await mapCenter(page);
  await page.mouse.move(x - 300, y - 200);
  await expect(page.locator('.aircraft-hover-preview')).toHaveCount(0);
  await page.mouse.move(x, y, { steps: 6 });
  await expect(page.locator('.aircraft-hover-preview')).toBeVisible();
  await page.mouse.move(x - 300, y - 200, { steps: 6 });
  await expect(page.locator('.aircraft-hover-preview')).toHaveCount(0);
});

test('the layer survives a theme switch', async ({ page }) => {
  await mockApi(page);
  await page.goto('/?at=48,5,9');
  await expect.poll(() => drawn(page), { timeout: 15_000 }).toBe(800);
  const { x, y, box } = await mapCenter(page);
  await page.mouse.click(box.x + 60, box.y + box.height - 160);
  const before = await page.locator('.app').getAttribute('class');
  await page.keyboard.press('t');
  await expect(page.locator('.app')).not.toHaveAttribute('class', before ?? '');
  await expect(layer(page)).toHaveCount(1);
  await expect.poll(() => drawn(page)).toBe(800);
  const after = await paintedCentroid(page, { x, y, size: 40 });
  expect(after.count).toBeGreaterThan(20);
});
