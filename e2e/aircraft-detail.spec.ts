import { expect, test } from '@playwright/test';
import { readFileSync } from 'node:fs';
const catalogue: { operators: string[]; aircraft_type: string }[] = JSON.parse(readFileSync(new URL('../data/cabin-configurations.json', import.meta.url), 'utf8'));

const NOW = Math.floor(Date.now() / 1000);
const flights = [
  { icao24: 'abc123', callsign: 'AFR123', airline_name: 'Air France', aircraft_type: 'A359', registration: 'F-HTYA', latitude: 48.5, longitude: 2.2, velocity: 210, true_track: 90, on_ground: false, time_position: NOW, baro_altitude: 10000 },
  { icao24: 'abc124', callsign: 'EZY456', aircraft_type: 'A320', latitude: 48.51, longitude: 2.21, velocity: 180, true_track: 45, on_ground: false, time_position: NOW, baro_altitude: 8500 },
  { icao24: 'abc125', callsign: 'HELI1', aircraft_type: 'H125', latitude: 48.49, longitude: 2.18, velocity: 50, true_track: 30, on_ground: false, time_position: NOW },
  { icao24: 'abc126', callsign: 'HELI2', aircraft_type: 'H125', latitude: 48.48, longitude: 2.22, velocity: 0, true_track: 30, on_ground: true, time_position: NOW },
];

test.beforeEach(async ({ page }) => {
  await page.route('**/api/**', async route => {
    const url = new URL(route.request().url());
    const path = url.pathname;
    if (path === '/api/flight-info') {
      await new Promise(resolve => setTimeout(resolve, 1200));
      return route.fulfill({ json: { success: true, icao24: url.searchParams.get('icao24'), callsign: url.searchParams.get('callsign'), aircraft_owner: 'Delayed profile' } }).catch(() => {});
    }
    const body = path === '/api/health' ? { live_available: true }
      : path === '/api/live-flights' ? { states: flights, count: flights.length, time: NOW }
      : path === '/api/flight-route' ? { success: true, callsign: url.searchParams.get('callsign'), route_source: 'callsign', departure_airport: 'LFPG', arrival_airport: 'EGLL', departure_latitude: 49, departure_longitude: 2.5, arrival_latitude: 51.47, arrival_longitude: -0.45 }
      : path === '/api/aircraft-enrichment' ? { success: true, operator_code: url.searchParams.get('operator'), aircraft_type: url.searchParams.get('type'), match_level: 'operator_type', configurations: catalogue.filter(c => c.operators.includes(url.searchParams.get('operator')!) && c.aircraft_type === url.searchParams.get('type')) }
      : path === '/api/track' ? { track: { icao24: url.searchParams.get('icao24'), path: [] } }
      : path === '/api/aircraft-history' ? { success: true, airframe: {}, history: [], sources: [] }
      : [];
    await route.fulfill({ json: body });
  });
  await page.route('https://api.planespotters.net/**', route => route.fulfill({ json: { photos: [] } }));
  // A real PNG avoids engine-dependent decoding of SVG served at a .png URL.
  await page.route('https://images.kiwi.com/**', route => route.fulfill({ contentType: 'image/png', body: Buffer.from('iVBORw0KGgoAAAANSUhEUgAAABQAAAAUCAIAAAAC64paAAAALElEQVR4nGNkCN3NQC5gIlsnw6hmkgET6VoQYFQziYCJVA3IYFQziYCiAAMAccQBOL5InQcAAAAASUVORK5CYII=', 'base64') }));
});

test('opens immediately, estimates the route, shows sourced variants and survives fast reselection', async ({ page }, info) => {
  const errors: string[] = []; page.on('pageerror', error => errors.push(error.message));
  await page.goto('/?at=48.5,2.2,10');
  const marker = page.locator('[data-icao24="abc123"]').first();
  await marker.waitFor();
  const elapsed = await marker.evaluate(element => new Promise<number>(resolve => {
    const started = performance.now();
    const observer = new MutationObserver(() => {
      if (document.querySelector('.details-heading h2')?.textContent !== 'AFR123') return;
      observer.disconnect();
      window.clearTimeout(timeout);
      resolve(performance.now() - started);
    });
    observer.observe(document.body, { childList: true, subtree: true, characterData: true });
    const timeout = window.setTimeout(() => { observer.disconnect(); resolve(Infinity); }, 2_000);
    element.dispatchEvent(new MouseEvent('mousedown', { bubbles: true }));
  }));
  console.log(`Selection to detail DOM: ${elapsed.toFixed(1)} ms`);
  expect(elapsed).toBeLessThan(200);
  await expect(page.locator('.route-source-note')).toContainText('estimated progress');
  await expect(page.locator('.route-progress')).toBeVisible();
  await expect(page.getByText('Progress unavailable')).toHaveCount(0);
  await expect(page.locator('.estimated-future-path')).toHaveCount(1);
  await expect(page.locator('.heading-projection')).toHaveCount(0);
  await expect(page.getByRole('region', { name: 'Cabin configurations' })).toContainText('324 seats');
  await page.getByText('292 seats', { exact: false }).click();
  await expect(page.getByText('USB-A and USB-C in all cabins')).toBeVisible();
  await expect(page.getByText('Configuration of this aircraft', { exact: true })).toHaveCount(0);
  const cabin = page.locator('.cabin-variant[open]').first();
  await expect(cabin.locator('.cabin-seat')).toHaveCount(292);
  await expect(cabin.locator('.cabin-class-heading')).toContainText(['Business48 seats', 'Premium Economy32 seats', 'Economy212 seats']);
  await expect(cabin.locator('.cabin-map-link')).toHaveAttribute('href', 'https://wwws.airfrance.fr/information/prepare/nos-avions/a350');
  if (info.project.name === 'webkit-mobile') await page.getByRole('button', {name: 'Expand details'}).click();
  await cabin.scrollIntoViewIfNeeded();
  await page.screenshot({ path: info.outputPath('aircraft-cabin.png') });
  expect(await cabin.locator('.cabin-seat-grid').first().evaluate(el => el.scrollWidth <= el.clientWidth)).toBe(true);
  await page.locator('[data-icao24="abc124"]').first().dispatchEvent('mousedown');
  await expect(page.locator('.details-heading h2')).toHaveText('EZY456');
  await expect(page.locator('.cabin-variant summary').filter({hasText:'180 seats'})).toBeVisible();
  await expect(page.getByText('292 seats', { exact: false })).toHaveCount(0);
  await page.waitForTimeout(1400);
  await expect(page.locator('.details-heading h2')).toHaveText('EZY456');
  expect(errors).toEqual([]);
});

test('reveals labels with zoom, hides failed logos, and animates only flying rotors', async ({ page }) => {
  await page.goto('/?at=48.5,2.2,7');
  await expect(page.locator('.aircraft-marker')).toHaveCount(4);
  await expect(page.locator('.aircraft-label')).toHaveCount(0);
  for (let zoom = 8; zoom <= 12; zoom++) {
    await page.getByRole('button', { name: 'Zoom in', exact: true }).click({ force: true });
    await page.waitForTimeout(300);
    await expect(page.locator('.aircraft-label').first()).toBeVisible();
    if (zoom < 10) await expect(page.locator('.airline-logo')).toHaveCount(0);
  }
  await expect(page.locator('.label-level-3 i').first()).toBeVisible();
  // Collision avoidance can hide ordinary labels on a small screen; the
  // selected aircraft keeps its label and logo. Select after zooming so the
  // mobile sheet does not cover the zoom controls during this check.
  await page.locator('[data-icao24="abc123"]').first().dispatchEvent('mousedown');
  await expect(page.locator('.aircraft-marker-wrap').filter({ has: page.locator('[data-icao24="abc123"]') }).locator('.airline-logo').first()).toBeVisible();
  const airRotor = page.locator('[data-icao24="abc125"] .aircraft-svg-rotor');
  const groundRotor = page.locator('[data-icao24="abc126"] .aircraft-svg-rotor');
  await expect(airRotor).toHaveCSS('animation-name', 'helicopter-rotor');
  await expect(groundRotor).toHaveCSS('animation-name', 'none');
  await page.emulateMedia({ reducedMotion: 'reduce' });
  await expect(airRotor).toHaveCSS('animation-name', 'none');
  const logo = page.locator('.airline-logo').first();
  const count = await page.locator('.airline-logo').count();
  await logo.dispatchEvent('error');
  await expect(page.locator('.airline-logo')).toHaveCount(count - 1);
});

test('shows one sourced photo preview on hover without requesting photos for a brief pass', async ({ page }, info) => {
  test.skip(info.project.name === 'webkit-mobile', 'Hover preview requires a mouse or trackpad');
  let photoRequests = 0;
  await page.route('https://api.planespotters.net/pub/photos/hex/abc123', async route => {
    photoRequests++;
    await route.fulfill({ json: { photos: [{
      thumbnail_large: { src: 'https://t.plnspttrs.net/1/aircraft_280.jpg', size: { width: 420, height: 280 } },
      link: 'https://www.planespotters.net/photo/123/example', photographer: 'Jane Spotter',
    }] } });
  });
  await page.route('https://t.plnspttrs.net/1/aircraft_280.jpg', route => route.fulfill({
    contentType: 'image/svg+xml',
    body: '<svg xmlns="http://www.w3.org/2000/svg" width="420" height="280"><rect width="420" height="280" fill="#4689be"/><path fill="white" d="m50 140 310-25-15 20-295 25z"/></svg>',
  }));
  await page.goto('/?at=48.5,2.2,10');
  const marker = page.locator('[data-icao24="abc123"]').first();
  await marker.evaluate(element => {
    element.dispatchEvent(new MouseEvent('mouseover', { bubbles: true, clientX: 500, clientY: 300 }));
    element.dispatchEvent(new MouseEvent('mouseout', { bubbles: true, clientX: 20, clientY: 20 }));
  });
  await page.waitForTimeout(220);
  expect(photoRequests).toBe(0);

  await marker.dispatchEvent('mouseover', { clientX: 500, clientY: 300 });
  const preview = page.getByLabel('AFR123 preview');
  expect(await preview.isVisible()).toBe(true);
  await expect(preview).toContainText('Airbus A350-900');
  await expect(preview.getByRole('img', { name: /photo by Jane Spotter/ })).toBeVisible();
  await expect(preview).toContainText('© Jane Spotter');
  await expect(preview.getByRole('link', { name: 'Planespotters.net', exact: true })).toHaveAttribute('href', 'https://www.planespotters.net/photo/123/example');
  await page.screenshot({ path: info.outputPath('aircraft-hover-photo.png') });
  await page.locator('[data-icao24="abc124"]').first().dispatchEvent('mouseover', { clientX: 550, clientY: 350 });
  await expect(page.getByLabel('EZY456 preview')).toBeVisible();
  await expect(page.locator('.aircraft-hover-photo')).toHaveCount(0);
  await page.locator('[data-icao24="abc124"]').first().dispatchEvent('mousedown');
  await expect(page.locator('.aircraft-hover-preview')).toHaveCount(0);
});

test('credits the Commons license when the primary photo source is unavailable', async ({ page }, info) => {
  test.skip(info.project.name === 'webkit-mobile', 'Hover preview requires a mouse or trackpad');
  await page.route('https://api.planespotters.net/**', route => route.fulfill({ status: 403, json: { error: 'Unavailable' } }));
  await page.route('https://commons.wikimedia.org/w/api.php**', route => route.fulfill({ json: { query: { pages: {
    1: { index: 1, title: 'File:Airbus A350 F-HTYA.jpg', imageinfo: [{
      thumburl: 'https://thumb.wikimedia.org/aircraft.jpg', thumbwidth: 420, thumbheight: 280,
      descriptionurl: 'https://commons.wikimedia.org/wiki/File:Airbus_A350_F-HTYA.jpg',
      extmetadata: { Artist: { value: '<b>Jane Spotter</b>' }, LicenseShortName: { value: 'CC BY-SA 4.0' }, LicenseUrl: { value: 'https://creativecommons.org/licenses/by-sa/4.0' } },
    }] },
  } } } }));
  await page.route('https://thumb.wikimedia.org/aircraft.jpg', route => route.fulfill({
    contentType: 'image/svg+xml', body: '<svg xmlns="http://www.w3.org/2000/svg" width="420" height="280"><rect width="420" height="280" fill="#4689be"/></svg>',
  }));
  await page.goto('/?at=48.5,2.2,10');
  await page.locator('[data-icao24="abc123"]').first().hover();
  const preview = page.getByLabel('AFR123 preview');
  await expect(preview.getByRole('img', { name: /Aircraft matching F-HTYA, photo by Jane Spotter/ })).toBeVisible();
  await expect(preview.getByRole('link', { name: 'Wikimedia Commons', exact: true })).toHaveAttribute('href', 'https://commons.wikimedia.org/wiki/File:Airbus_A350_F-HTYA.jpg');
  await expect(preview.getByRole('link', { name: 'CC BY-SA 4.0' })).toHaveAttribute('href', 'https://creativecommons.org/licenses/by-sa/4.0');
  await expect(preview).toContainText('Registration match');
});
