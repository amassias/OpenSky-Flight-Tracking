import { expect, test, type Page } from '@playwright/test';

// Issue #24: everything the map did on Leaflet works on MapLibre GL, and Leaflet is gone.

const airport = { icao: 'LFPG', iata: 'CDG', name: 'Paris Charles de Gaulle', display_name: 'Paris Charles de Gaulle (CDG)', country: 'FR', latitude: 49.0097, longitude: 2.5479 };
const now = Math.floor(Date.now() / 1000);
const aircraft = { icao24: '39abcd', callsign: 'AFR123', latitude: 49.1, longitude: 2.7, baro_altitude: 8400, velocity: 220, true_track: 72, on_ground: false, time_position: now, last_contact: now };

type DevMap = { queryRenderedFeatures(options: { layers: string[] }): Array<{ properties: Record<string, unknown> }>; project(lngLat: [number, number]): { x: number; y: number } };

async function mockApi(page: Page) {
  await page.route('https://api.planespotters.net/**', route => route.fulfill({ json: { photos: [] } }));
  await page.route('**/api/**', route => {
    const path = new URL(route.request().url()).pathname;
    if (path === '/api/health') return route.fulfill({ json: { success: true, credentials_configured: true } });
    if (path === '/api/map-airports' || path === '/api/airports' || path === '/api/search-airports') return route.fulfill({ json: [airport] });
    if (path === '/api/live-flights') return route.fulfill({ json: { success: true, time: now, count: 1, states: [aircraft] } });
    if (path === '/api/track') {
      // Climbing, so the trace changes altitude colour along its length.
      return route.fulfill({ json: { success: true, path_count: 3, track: { icao24: '39abcd', path: [[now - 2000, 49.0, 2.55, 300, 60, false], [now - 1000, 49.05, 2.62, 5000, 70, false], [now - 10, 49.09, 2.69, 11000, 72, false]] } } });
    }
    if (path === '/api/flight-info') return route.fulfill({ json: { success: true, icao24: '39abcd', callsign: 'AFR123', departure_airport: 'LFPG', arrival_airport: 'EGLL' } });
    return route.fulfill({ json: { success: true, flights: [], count: 0 } });
  });
}

const renderedColors = (page: Page, layer: string) => page.evaluate(name => {
  const map = (window as unknown as { __skytraceMap: DevMap }).__skytraceMap;
  return [...new Set(map.queryRenderedFeatures({ layers: [name] }).map(feature => String(feature.properties.color)))];
}, layer);

test('the map is MapLibre GL and no Leaflet is on the page', async ({ page }) => {
  const requested: string[] = [];
  page.on('request', request => requested.push(request.url()));
  await mockApi(page);
  await page.goto('/?at=49,2.5,9');
  await expect(page.locator('.flight-map.maplibregl-map')).toHaveCount(1);
  await expect(page.locator('canvas[data-aircraft-renderer="maplibre-gl"]')).toHaveCount(1);
  await expect(page.locator('.leaflet-container, [class*="leaflet-"]')).toHaveCount(0);
  expect(requested.filter(url => /leaflet/i.test(url))).toEqual([]);
});

test('the selected aircraft draws its altitude trace in the colours of the legend', async ({ page }) => {
  await mockApi(page);
  await page.goto('/?at=49.05,2.6,10');
  await page.locator('.aircraft-marker-wrap').first().dispatchEvent('click');
  await expect(page.locator('.flight-map')).toHaveAttribute('data-map-overlays', /trace/);
  // The trace is revealed over about 1.5 s; two altitude bands mean two colours.
  await expect.poll(async () => (await renderedColors(page, 'trace-line')).length, { timeout: 10_000 }).toBeGreaterThan(1);
  await expect(page.locator('.route-endpoint-start')).toHaveCount(1);
});

test('the visitor location is drawn as a dot with its accuracy circle', async ({ page, context }) => {
  await context.grantPermissions(['geolocation']);
  await context.setGeolocation({ latitude: 49.2, longitude: 2.6, accuracy: 4000 });
  await mockApi(page);
  await page.goto('/?at=49.2,2.6,9');
  await page.getByRole('button', { name: 'Locate me', exact: true }).click();
  await expect(page.locator('.flight-map')).toHaveAttribute('data-map-overlays', /user-location/);
  await expect.poll(async () => (await renderedColors(page, 'accuracy-fill')).length).toBeGreaterThan(0);
  await expect(page.locator('.user-location-marker')).toHaveCount(1);
});

test('an airport marker names itself on hover and on keyboard focus, and opens the airport', async ({ page, isMobile }) => {
  await mockApi(page);
  await page.goto('/?at=49,2.5,10');
  const pin = page.getByRole('button', { name: 'CDG', exact: true });
  await expect(pin).toBeVisible();
  await pin.focus();
  await expect(page.locator('.map-tooltip')).toBeVisible();
  await expect(page.locator('.map-tooltip')).toContainText('Paris Charles de Gaulle');
  if (!isMobile) {
    await page.locator('.flight-map').hover({ position: { x: 20, y: 200 } });
    await page.locator('.airport-pin-wrap').hover();
    await expect(page.locator('.map-tooltip')).toContainText('Arrivals & departures');
  }
  await pin.press('Enter');
  await expect(page.getByRole('heading', { name: /CDG Paris/ })).toBeVisible();
});

test('the dashed heading line explains itself when hovered', async ({ page, isMobile }) => {
  test.skip(isMobile, 'Hover needs a mouse.');
  await mockApi(page);
  await page.goto('/?at=49.1,2.7,10');
  await page.locator('.aircraft-marker-wrap').first().dispatchEvent('click');
  await expect(page.locator('.flight-map')).toHaveAttribute('data-map-overlays', /heading-projection|future-path/);
  const box = (await page.locator('.flight-map').boundingBox())!;
  const point = await page.evaluate(() => (window as unknown as { __skytraceMap: DevMap }).__skytraceMap.project([2.7, 49.1]));
  // The line leaves the aircraft along its track (east-north-east): a few pixels along it is on the line.
  await page.mouse.move(box.x + point.x - 200, box.y + point.y + 100);
  await page.mouse.move(box.x + point.x + 60, box.y + point.y - 20, { steps: 8 });
  await expect(page.locator('.map-tooltip')).toContainText(/Estimated (heading|direct line)/);
});

test('map controls stay above airport clusters and other map markers', async ({ page }) => {
  await mockApi(page);
  await page.goto('/?at=49,2.5,9');
  await expect(page.locator('.flight-map.maplibregl-map')).toHaveCount(1);
  const buttons = page.locator('.map-controls button');
  await expect(buttons.first()).toBeVisible();

  // Put a marker (airport clusters are z-index 600) exactly on every control.
  await page.evaluate(() => {
    const container = document.querySelector('.maplibregl-canvas-container')!;
    document.querySelectorAll('.map-controls button').forEach(button => {
      const box = button.getBoundingClientRect();
      const marker = document.createElement('div');
      marker.className = 'maplibregl-marker airport-cluster-wrap probe-marker';
      marker.style.cssText = `position:fixed;left:${box.x}px;top:${box.y}px;width:${box.width}px;height:${box.height}px;z-index:600`;
      container.appendChild(marker);
    });
  });

  const covered = await page.evaluate(() => [...document.querySelectorAll('.map-controls button')].filter(button => {
    const box = button.getBoundingClientRect();
    const top = document.elementFromPoint(box.x + box.width / 2, box.y + box.height / 2);
    return !(top === button || button.contains(top));
  }).map(button => button.getAttribute('aria-label')));
  expect(covered).toEqual([]);
});
