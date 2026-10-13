import { expect, test } from '@playwright/test';
import AxeBuilder from '@axe-core/playwright';

const airports = [
  { icao: 'EGLL', iata: 'LHR', name: 'Heathrow', display_name: 'Heathrow', country: 'GB', region: 'London', latitude: 51.47, longitude: -0.45 },
  { icao: 'LPPT', iata: 'LIS', name: 'Lisbon', display_name: 'Lisbon', country: 'PT', region: 'Lisbon', latitude: 38.77, longitude: -9.13 },
];

test.beforeEach(async ({ page }) => {
  await page.route('https://api.planespotters.net/**', route => route.fulfill({ json: { photos: [] } }));
  await page.route('**/api/**', route => {
    const url = new URL(route.request().url());
    const now = Math.floor(Date.now() / 1000);
    const flight = { icao24: '406a02', callsign: 'BAW52T', registration: 'G-EUYS', latitude: 48.6, longitude: -3, on_ground: false, baro_altitude: 11000, squawk: '2021', emergency: 'none' };
    const body = url.pathname === '/api/health' ? { success: true, credentials_configured: true }
      : url.pathname === '/api/live-flights' ? { success: true, states: [], count: 0, time: now }
      : url.pathname === '/api/emergencies' ? { success: true, states: [{ ...flight, squawk: '7700', emergency: 'general' }], count: 1, time: now, provider: 'adsb.lol' }
      : url.pathname === '/api/callsign-lookup' ? { success: true, found: true, aircraft: flight }
      : url.pathname === '/api/flight-info' ? { success: true, ...flight, departure_airport: 'EGLL', arrival_airport: 'LPPT' }
      : url.pathname === '/api/track' ? { success: true, path_count: 2, track: { icao24: '406a02', callsign: 'BAW52T', path: [[now-300, 48.5,-2.8,12000,200,false],[now-10,48.6,-3,11000,200,false]], emergency_events: [{code:'7700',callsign:'BAW52T',first_seen:now-200,last_seen:now-160,ended_at:now-100}] } }
      : ['/api/airports','/api/map-airports'].includes(url.pathname) ? airports
      : url.pathname === '/api/search-airports' ? airports.filter(airport => airport.icao === url.searchParams.get('q'))
      : { success: true, found: false, airframe: {}, history: [], linked_icao24: [], sources: [] };
    return route.fulfill({ json: body });
  });
  await page.goto('/');
});

test('finds a live callsign outside the viewport and shows its previously observed emergency', async ({page}) => {
  await page.getByRole('combobox', {name:'Search flights and airports'}).fill('BAW52T');
  await page.getByRole('option', {name:/BAW52T/}).click();
  await expect(page.getByRole('heading', {name:'BAW52T'})).toBeVisible();
  const events = page.getByRole('region', {name:'Flight alerts and events'});
  await expect(events).toContainText('7700 · General emergency');
  await expect(events).toContainText('signal changed at');
  await expect(events).toContainText('Source: adsb.lol / readsb');
  await expect(page.getByText('Diverted · reported by FlightAware')).not.toBeVisible();
});

test('lists worldwide emergency signals on demand and handles unavailable data', async ({page}, testInfo) => {
  const open = page.getByRole('button',{name:'Open traffic panel'});
  if (await open.isVisible()) await open.click();
  await page.getByRole('tab',{name:'Alerts',exact:true}).click();
  await expect(page.getByRole('heading',{name:'Worldwide emergency signals'})).toBeVisible();
  await expect(page.locator('.global-alert-row')).toContainText('BAW52T');
  await expect(page.locator('.global-alert-row')).toContainText('7700');
  await expect(page.getByRole('tab', {name:'Alerts',exact:true})).toHaveAttribute('aria-selected','true');
  expect((await new AxeBuilder({page}).include('.global-alerts').withTags(['wcag2a','wcag2aa','wcag21aa']).analyze()).violations).toEqual([]);
  await page.screenshot({path:testInfo.outputPath('global-alerts.png')});
  await page.locator('.global-alert-row').click();
  await expect(page.getByRole('heading',{name:'BAW52T'})).toBeVisible();
  await page.getByRole('button',{name:'Close flight details'}).click();
  await page.route('**/api/emergencies',route=>route.fulfill({status:503,json:{error:'Global emergency feed is temporarily unavailable.'}}));
  await page.reload();
  if (await open.isVisible()) await open.click();
  await page.getByRole('tab',{name:'Alerts',exact:true}).click();
  await expect(page.getByText('Global emergency feed is temporarily unavailable.')).toBeVisible();
  await expect(page.getByText(/No emergency squawks reported/)).not.toBeVisible();
});

test('shows a provider diversion only for the matching flight instance', async ({page}) => {
  await page.route('**/api/flight-info**',route=>route.fulfill({json:{success:true,icao24:'406a02',callsign:'BAW52T',on_ground:false,latitude:48.6,longitude:-3,flightaware:{provider:'FlightAware',atc_ident:'BAW52T',diverted:true,status:'En route / Diverted',actual_out:new Date(Date.now()-3600_000).toISOString()}}}));
  await page.goto('/?icao24=406a02');
  await expect(page.getByText('Diverted · reported by FlightAware')).toBeVisible();
});

test('labels a landing away from the planned destination as an estimate', async ({page}) => {
  const now=Math.floor(Date.now()/1000);
  await page.route('**/api/flight-info**',route=>route.fulfill({json:{success:true,icao24:'406a02',callsign:'BAW52T',on_ground:true,latitude:51.47,longitude:-0.45,departure_airport:'EGLL',arrival_airport:'LPPT'}}));
  await page.route('**/api/track**',route=>route.fulfill({json:{success:true,path_count:3,track:{icao24:'406a02',callsign:'BAW52T',path:[[now-400,51.5,-0.4,2000,90,false],[now-150,51.47,-0.45,0,90,true],[now-10,51.47,-0.45,0,90,true]]}}}));
  await page.goto('/?icao24=406a02');
  await expect(page.getByText('Possible return to origin · ADS-B estimate')).toBeVisible();
  await expect(page.getByText(/This does not confirm a diversion/)).toBeVisible();
});
