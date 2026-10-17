import { expect, test } from '@playwright/test';
import AxeBuilder from '@axe-core/playwright';
const airport={icao:'LFPG',iata:'CDG',name:'Charles de Gaulle',display_name:'Charles de Gaulle',latitude:49.01,longitude:2.55};
test.beforeEach(async ({page})=>{
  await page.route('https://api.planespotters.net/**',route=>route.fulfill({json:{photos:[]}}));
  await page.route('**/api/**',route=>{
    const path=new URL(route.request().url()).pathname, now=Math.floor(Date.now()/1000);
    const flight={icao24:'3949eb',callsign:'AFR531',registration:'F-GSPL',latitude:49,longitude:2.5,baro_altitude:3000,velocity:150,on_ground:false,time_position:now,last_contact:now};
    const body=path==='/api/health'?{live_available:true,credentials_configured:true}
      : ['/api/airports','/api/map-airports','/api/search-airports'].includes(path)?[airport]
      : path==='/api/live-flights'?{success:true,states:[flight],count:1,time:now}
      : path==='/api/flight-info'?{success:true,...flight,departure_airport:'SCEL',arrival_airport:'LFPG',departure_airport_name:'Santiago',arrival_airport_name:'Paris',route_source:'flightaware',flightaware:{provider:'FlightAware',queried_ident:'AFR531',registration:'F-GSPL',actual_out:new Date(Date.now()-3600_000).toISOString(),status:'En route',matches_current_flight:true}}
      : path==='/api/track'?{success:true,path_count:10000,track:{icao24:'3949eb',callsign:'AFR531',path:Array.from({length:10000},(_,i)=>[now-10000+i,49,2.5,i===4321?12000:1000+i/10,90,false])}}
      : {success:true,found:false,airframe:{},history:[],sources:[]};
    return route.fulfill({json:body});
  });
  await page.goto('/?icao24=3949eb');
});

test('shows the matching operational route and a dated position',async ({page})=>{
  await expect(page.getByText('Santiago',{exact:true})).toBeVisible();
  await expect(page.locator('.route-source-note').getByRole('link', { name: /FlightAware/ })).toBeVisible();
  await expect(page.locator('.position-observation')).toContainText('UTC');
  await expect(page.getByText('Usual route · unconfirmed')).not.toBeVisible();
});

test('a 10000 point trace stays compact and can be inspected by keyboard',async ({page})=>{
  const slider=page.getByRole('slider',{name:'Inspect altitude point'});
  await expect(slider).toHaveAttribute('max','9999');
  expect(await page.locator('.altitude-chart *').count()).toBeLessThan(25);
  await slider.focus();
  await page.keyboard.press('Home');
  await expect(slider).toHaveValue('0');
  await expect(page.locator('.altitude-hover-readout')).toContainText('UTC · Altitude');
  await page.keyboard.press('ArrowRight');
  await expect(slider).toHaveValue('1');
  expect((await new AxeBuilder({page}).include('.altitude-profile').withTags(['wcag2a','wcag2aa','wcag21aa']).analyze()).violations).toEqual([]);
});

test('reading mode expands the mobile sheet and restores the map without losing selection',async ({page,isMobile})=>{
  test.skip(!isMobile,'Phone reading mode.');
  const drawer=page.locator('.details-drawer');
  await expect(page.getByRole('heading',{name:'AFR531'})).toBeVisible();
  const initial=await drawer.evaluate(element=>element.getBoundingClientRect().height);
  const expand=page.getByRole('button',{name:'Expand details',exact:true});
  await expand.click();
  await expect(page.locator('.map-surface')).toHaveAttribute('inert','');
  await expect(page.getByRole('button',{name:'Show map',exact:true})).toHaveAttribute('aria-expanded','true');
  await expect.poll(()=>drawer.evaluate(element=>element.getBoundingClientRect().height)).toBeGreaterThan(initial*1.5);
  await page.getByRole('slider',{name:'Inspect altitude point'}).focus();
  await page.keyboard.press('Home');
  await page.getByRole('button',{name:'Show map',exact:true}).click();
  await expect(page.getByRole('button',{name:'Expand details',exact:true})).toBeFocused();
  await expect(page.getByRole('heading',{name:'AFR531'})).toBeVisible();
  await expect(page.locator('.map-surface')).not.toHaveAttribute('inert','');
  await expect(page.getByRole('button',{name:'Follow selected aircraft'})).toBeVisible();
});

test('a delayed position is shown as an observation rather than a current fix',async ({page})=>{
  await page.route('**/api/live-flights**',route=>route.fulfill({json:{success:true,states:[],time:Math.floor(Date.now()/1000),count:0}}));
  await page.route('**/api/flight-info**',route=>route.fulfill({json:{success:true,icao24:'3949eb',callsign:'AFR531',latitude:49,longitude:2.5,baro_altitude:3000,time_position:Math.floor(Date.now()/1000)-180,last_contact:Math.floor(Date.now()/1000)-180}}));
  await page.reload();
  await expect(page.locator('.position-observation')).toContainText('Position delayed');
});

test('a shared flight URL survives a slow lookup and retry',async ({page})=>{
  let release:()=>void=()=>{};
  const gate=new Promise<void>(resolve=>{release=resolve;});
  await page.route('**/api/flight-info**',async route=>{
    await gate;
    return route.fulfill({status:503,json:{error:'Receiver lookup delayed.'}});
  });
  await page.goto('/?icao24=3949eb');
  await expect(page.getByText('Opening shared aircraft…')).toBeVisible();
  await expect(page).toHaveURL(/icao24=3949eb/);
  release();
  await expect(page.getByText('Shared aircraft unavailable')).toBeVisible();
  await page.route('**/api/flight-info**',route=>route.fulfill({json:{success:true,icao24:'3949eb',callsign:'AFR531',latitude:49,longitude:2.5}}));
  await page.getByRole('button',{name:'Retry aircraft',exact:true}).click();
  await expect(page.getByRole('heading',{name:'AFR531'})).toBeVisible();
  await expect(page).toHaveURL(/icao24=3949eb/);
});

test('trace refresh keeps the point inspector focused and the previous observations on failure',async ({page})=>{
  await page.clock.install();
  await page.reload();
  await page.bringToFront();
  const slider=page.getByRole('slider',{name:'Inspect altitude point'});
  await expect(slider).toHaveAttribute('max','9999');
  await slider.focus();
  await page.keyboard.press('Home');
  await page.route('**/api/track**',route=>route.fulfill({status:503,json:{error:'Trace delayed.'}}));
  await page.clock.fastForward(91_000);
  await expect(page.getByText('Updates delayed')).toBeVisible();
  await expect(slider).toBeFocused();
  await expect(slider).toHaveValue('0');
  await expect(page.locator('.chart-skeleton')).not.toBeVisible();
});
