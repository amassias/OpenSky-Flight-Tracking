import { expect, test } from '@playwright/test';
import AxeBuilder from '@axe-core/playwright';

const airport = {icao:'LFPG',iata:'CDG',name:'Paris Charles de Gaulle',display_name:'Paris Charles de Gaulle',latitude:49,longitude:2.5,timezone:'Europe/Paris'};
const flight = {icao24:'abc123',callsign:'TST123',latitude:32,longitude:-102,baro_altitude:5000,velocity:200,on_ground:false};
test.beforeEach(async ({page}) => {
  await page.route('https://api.planespotters.net/**',route=>route.fulfill({json:{photos:[]}}));
  await page.route('**/api/**',route=> {
    const url=new URL(route.request().url());
    const now=Math.floor(Date.now()/1000);
    const payload=url.pathname==='/api/health'?{live_available:true,credentials_configured:true}
      : ['/api/airports','/api/map-airports','/api/search-airports'].includes(url.pathname)?[airport]
      : url.pathname==='/api/live-flights'?{success:true,states:[],time:now,count:0}
      : url.pathname==='/api/callsign-lookup'?{success:true,found:true,aircraft:flight}
      : url.pathname==='/api/flight-info'?{success:true,...flight,departure_airport:'LFPG',arrival_airport:'EGLL'}
      : url.pathname==='/api/emergencies'?{success:true,states:[],time:now,status:'fresh'}
      : {success:true,available:false,airframe:{},history:[],sources:[]};
    return route.fulfill({json:payload});
  });
  await page.goto('/');
});

test('explicitly selecting the home airport recentres after an off-map aircraft', async ({page}) => {
  const search=page.getByRole('combobox',{name:'Search flights and airports'});
  await search.fill('TST123');
  await page.getByRole('option',{name:/TST123/}).click();
  await expect(page.getByRole('heading',{name:'TST123'})).toBeVisible();
  await page.getByRole('button',{name:'Close flight details'}).click();
  // The Paris pin leaves the rendered viewport while the camera is in Texas.
  await expect(page.getByRole('button',{name:'CDG',exact:true})).not.toBeVisible();
  await search.fill('CDG');
  await page.getByRole('option',{name:/Paris Charles de Gaulle/}).click();
  await expect(page.getByRole('button',{name:'CDG',exact:true})).toBeVisible();
  await expect(page.getByRole('heading',{name:/CDG Paris/})).toBeVisible();
});

test('readable alerts fit tablet and 200 percent text size without horizontal overflow', async ({page}) => {
  await page.setViewportSize({width:768,height:1024});
  const open=page.getByRole('button',{name:'Open traffic panel'});
  if(await open.isVisible()) await open.click();
  await page.getByRole('tab',{name:'Alerts',exact:true}).click();
  await page.evaluate(()=>document.documentElement.style.fontSize='200%');
  await expect(page.getByRole('heading',{name:'Worldwide emergency signals'})).toBeVisible();
  expect(await page.evaluate(()=>document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
  expect((await new AxeBuilder({page}).include('.global-alerts').withTags(['wcag2a','wcag2aa','wcag21aa']).analyze()).violations).toEqual([]);
});

test('reduced motion preserves keyboard feedback without spatial tab travel', async ({page}) => {
  await page.emulateMedia({reducedMotion:'reduce'});
  const open=page.getByRole('button',{name:'Open traffic panel'});
  if(await open.isVisible()) await open.click();
  await page.getByRole('tab',{name:/In view/}).focus();
  await page.keyboard.press('End');
  await expect(page.getByRole('tab',{name:'Alerts',exact:true})).toBeFocused();
  await expect(page.getByRole('heading',{name:'Worldwide emergency signals'})).toBeVisible();
  await expect.poll(()=>page.locator('.tab-thumb').evaluate(element=>getComputedStyle(element).transform)).toBe('none');
});
