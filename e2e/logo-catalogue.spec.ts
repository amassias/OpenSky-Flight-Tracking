import { expect, test } from '@playwright/test';
const codes = ['SWA', 'CLX', 'TVS', 'ITY', 'TKJ', 'UPS'];
test('current operator logos decode and excluded placeholders use the badge', async ({ page }) => {
  const now = Math.floor(Date.now()/1000);
  const flights = codes.map((code,i) => ({icao24:`abc12${i}`,callsign:`${code}123`,aircraft_type:'B738',latitude:48.5+i*.005,longitude:2.2+i*.005,baro_altitude:10000,velocity:200,on_ground:false,time_position:now}));
  await page.route('**/api/**',route => {
    const path = new URL(route.request().url()).pathname;
    const body = path === '/api/live-flights' ? {states:flights,time:now,count:flights.length} : path === '/api/health' ? {live_available:true} : {success:true,configurations:[],track:{path:[]},airframe:{},history:[],sources:[]};
    return route.fulfill({json:body});
  });
  await page.route('https://api.planespotters.net/**',r=>r.fulfill({json:{photos:[]}}));
  await page.route('https://images.kiwi.com/**',r=>r.fulfill({contentType:'image/png',body:Buffer.from('iVBORw0KGgoAAAANSUhEUgAAABQAAAAUCAIAAAAC64paAAAALElEQVR4nGNkCN3NQC5gIlsnw6hmkgET6VoQYFQziYCJVA3IYFQziYCiAAMAccQBOL5InQcAAAAASUVORK5CYII=','base64')}));
  await page.goto('/?at=48.5,2.2,12');
  for (let i=0;i<codes.length;i++) {
    const marker = page.locator(`[data-icao24="abc12${i}"]`).first();
    await marker.dispatchEvent('mousedown');
    const wrapper=page.locator('.aircraft-marker-wrap').filter({has:page.locator(`[data-icao24="abc12${i}"]`)});
    if (codes[i] === 'UPS') {
      await expect(wrapper.locator('.airline-logo')).toHaveCount(0);
      await expect(wrapper.locator('.airline-badge')).toHaveText('UPS');
    } else {
      const logo=wrapper.locator('.airline-logo');
      await expect(logo).toBeVisible();
      await expect.poll(()=>logo.evaluate((el:HTMLImageElement)=>el.complete && el.naturalWidth>0)).toBe(true);
      const expected=['/airline-logos/WN.png','/airline-logos/CV.svg','/airline-logos/QS.svg','https://images.kiwi.com/airlines/64x64/AZ.png','https://images.kiwi.com/airlines/64x64/VF.png'][i];
      await expect(logo).toHaveAttribute('src',expected);
    }
  }
});
