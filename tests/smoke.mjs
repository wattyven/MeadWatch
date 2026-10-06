// End-to-end smoke test: drives the running app in headless Chromium,
// checks the key behaviours and saves screenshots.
//
//   npm run dev            (in another terminal)
//   node tests/smoke.mjs [url] [outDir]

import {chromium} from 'playwright';
import {mkdir} from 'node:fs/promises';

const url = process.argv[2] ?? 'http://localhost:5173/';
const out = process.argv[3] ?? 'tests/screenshots';
await mkdir(out, {recursive: true});

const browser = await chromium.launch({args: ['--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist']});
const page = await browser.newPage({viewport: {width: 1600, height: 1000}, deviceScaleFactor: 1});
const problems = [];
page.on('pageerror', e => problems.push(`pageerror: ${e.message}`));
page.on('console', m => { if (m.type() === 'error') problems.push(`console: ${m.text()}`); });
// ERR_ABORTED = MapLibre cancelling tiles that scrolled out of view; not a failure.
page.on('requestfailed', r => { if (r.failure()?.errorText !== 'net::ERR_ABORTED') problems.push(`requestfailed: ${r.url()} ${r.failure()?.errorText}`); });
page.on('response', r => { if (r.status() >= 400) problems.push(`HTTP ${r.status()}: ${r.url()}`); });

const results = [];
const check = (name, ok, detail = '') => { results.push({name, ok, detail}); console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${detail ? '  — ' + detail : ''}`); };

async function settle(timeout = 60000) {
    await page.waitForFunction(() => {
        const m = window.mead?.map;
        return m && m.loaded() && m.areTilesLoaded() && !m.isMoving();
    }, null, {timeout, polling: 500}).catch(() => {});
    await page.waitForTimeout(800);
}

const t0 = Date.now();
await page.goto(url, {waitUntil: 'domcontentloaded'});
await page.waitForSelector('#loading.done', {timeout: 60000});
check('app boots and hides loader', true, `${((Date.now() - t0) / 1000).toFixed(1)}s`);
await settle();
await page.screenshot({path: `${out}/01-default.png`});

const headline = await page.textContent('.m-big');
check('metrics show latest observed elevation', /^1,0\d\d(\.\d)?$/.test(headline.trim()), headline.trim());

// Terrain under the lake should be the USGS lake floor, not the flat 1,220 ft water
// surface baked into the global DEM.
const terrain = await page.evaluate(() => {
    const m = window.mead.map;
    const ex = m.getTerrain()?.exaggeration ?? 1;
    const deep = m.queryTerrainElevation([-114.745, 36.04]);   // Boulder Basin, near the dam
    const land = m.queryTerrainElevation([-114.83, 36.0]);     // River Mountains
    return {deepFt: deep / ex * 3.28084, landFt: land / ex * 3.28084, ex};
});
check('terrain uses lake-floor bathymetry in Boulder Basin', terrain.deepFt < 1000, `${terrain.deepFt.toFixed(0)} ft (exaggeration ${terrain.ex})`);
check('terrain outside lake is ordinary land', terrain.landFt > 1500, `${terrain.landFt.toFixed(0)} ft`);

// What-if: full pool.
await page.fill('#elev-input', '1229');
await page.press('#elev-input', 'Enter');
await page.waitForTimeout(600);
const fullStorage = await page.textContent('.stat:nth-child(1) .v');
check('what-if 1,229 ft shows ~26 MAF live storage', /^2[4-8]\.\d\d MAF$/.test(fullStorage), fullStorage);
const tierFull = await page.textContent('.op-tier');
check('manual mode applies 2027-28 rules by default', tierFull.includes('Shortage'), tierFull);
await settle(20000);
await page.screenshot({path: `${out}/02-full-pool.png`});

// What-if: below minimum power pool.
await page.fill('#elev-input', '940');
await page.press('#elev-input', 'Enter');
await page.waitForTimeout(600);
const hoover = await page.textContent('.stat:nth-child(3) .v');
check('below 950 ft Hoover capacity drops to zero', hoover.includes('0 MW'), hoover);
const yumaStatus = await page.locator('.rg[data-id="yuma"] .rg-status').textContent();
check('downstream senior users flagged when releases are constrained', /constrained/i.test(yumaStatus), yumaStatus);
await settle(20000);
await page.screenshot({path: `${out}/03-940ft.png`});

// 2007 rules toggle.
await page.fill('#elev-input', '1060');
await page.press('#elev-input', 'Enter');
await page.click('#regime button[data-v="2007"]');
await page.waitForTimeout(300);
const tier2007 = await page.textContent('.op-tier');
check('2007 rules at 1,060 ft give Tier 1', tier2007 === 'Tier 1', tier2007);
const azCut = await page.textContent('.op-cuts div:nth-child(1) b');
check('Tier 1 Arizona reduction is 512k AF', azCut === '−512k', azCut);

// Slider drives the level too.
await page.$eval('#elev-slider', el => { el.value = '1100'; el.dispatchEvent(new Event('input', {bubbles: true})); });
await page.waitForTimeout(300);
check('slider sets the water level', (await page.textContent('.m-big')).trim() === '1,100', await page.textContent('.m-big'));

// Timeline scrub into the forecast (dry scenario).
await page.selectOption('#scenario', 'min');
const box = await page.locator('.tl-hit').boundingBox();
await page.mouse.click(box.x + box.width * 0.97, box.y + box.height / 2);
await page.waitForTimeout(500);
const kicker = await page.textContent('.m-kicker');
check('scrubbing past today shows the forecast', kicker.includes('Forecast'), kicker);
const fcElev = parseFloat((await page.textContent('.m-big')).replace(/,/g, ''));
check('probable-minimum 2028 level is below 1,000 ft', fcElev < 1000, String(fcElev));
await settle(20000);
await page.screenshot({path: `${out}/04-forecast-min-2028.png`});

// Scrub into the past: 2022 should be under the 2007 rules.
await page.mouse.click(box.x + box.width * 0.18, box.y + box.height / 2);
await page.waitForTimeout(400);
const rules2022 = await page.textContent('.op-rules');
check('2022 operating year uses 2007 guidelines', rules2022.includes('2007'), rules2022.slice(0, 60));
// Mid-2023 (≈25% along the 2021-10 → 2028-08 axis): Reclamation declared Tier 2a.
await page.mouse.click(box.x + box.width * 0.246, box.y + box.height / 2);
await page.waitForTimeout(300);
const tier2023 = await page.textContent('.op-tier');
check('2023 shows the declared Tier 2a', tier2023 === 'Tier 2a', `${await page.textContent('.m-date')} → ${tier2023}`);


// Play button advances time.
await page.click('#today');
const before = await page.textContent('.m-date');
await page.click('#play');
await page.waitForTimeout(1500);
await page.click('#play');
const after = await page.textContent('.m-date');
check('play animates the timeline', before !== after, `${before} → ${after}`);

// Region selection from the list.
await page.click('#today');
await page.click('.rg[data-id="phx"]');
await page.waitForSelector('.rg-detail');
check('selecting a region opens its detail card', true, (await page.textContent('.rg-detail-head b')).trim());
await settle(30000);
await page.screenshot({path: `${out}/05-region-phoenix.png`});

// Camera presets and basemaps.
await page.click('.rg-detail [data-close]');
await page.click('#views button[data-v="region"]');
await page.waitForTimeout(3000);
await settle(30000);
await page.screenshot({path: `${out}/06-downstream.png`});
await page.click('#views button[data-v="dam"]');
await page.waitForTimeout(3000);
await settle(30000);
await page.screenshot({path: `${out}/07-hoover-dam.png`});
await page.click('#basemap button[data-v="satellite"]');
await settle(30000);
await page.screenshot({path: `${out}/08-satellite.png`});

// What-if line stays inside the chart even above its range.
await page.fill('#elev-input', '1229');
await page.press('#elev-input', 'Enter');
await page.waitForTimeout(300);
const inside = await page.evaluate(() => {
    const l = document.querySelector('.tl-manual-line').getBoundingClientRect();
    const c = document.querySelector('.tl-chart').getBoundingClientRect();
    return l.top >= c.top - 1 && l.bottom <= c.bottom + 1;
});
check('what-if line stays within the timeline chart', inside);
const rulesHidden = await page.evaluate(() => { document.querySelector('#today').click(); return getComputedStyle(document.querySelector('#regime')).display === 'none'; });
check('rules toggle hidden in timeline mode', rulesHidden);

// Phone layout (fresh load so the narrow-screen defaults apply).
const phone = await browser.newPage({viewport: {width: 400, height: 860}, deviceScaleFactor: 2});
phone.on('pageerror', e => problems.push(`pageerror(phone): ${e.message}`));
await phone.goto(url, {waitUntil: 'domcontentloaded'});
await phone.waitForSelector('#loading.done', {timeout: 60000});
await phone.waitForTimeout(6000);
await phone.screenshot({path: `${out}/09-mobile.png`});
const overflow = await phone.evaluate(() => document.documentElement.scrollWidth > window.innerWidth);
check('no horizontal overflow at 400px', !overflow);
const hiddenAtStart = await phone.evaluate(() => [...document.querySelectorAll('.side')].every(p => getComputedStyle(p).display === 'none'));
check('side panels start hidden behind tabs on phones', hiddenAtStart);
await phone.click('#mtabs button[data-p="impacts"]');
await phone.waitForTimeout(400);
await phone.screenshot({path: `${out}/10-mobile-impacts.png`});
await phone.click('#mtabs button[data-p="metrics"]');
await phone.waitForTimeout(400);
const oneOpen = await phone.evaluate(() => getComputedStyle(document.querySelector('#metrics')).display !== 'none' && getComputedStyle(document.querySelector('#impacts')).display === 'none');
check('phone tabs switch between panels', oneOpen);
await phone.screenshot({path: `${out}/11-mobile-metrics.png`});

const relevant = problems.filter(p => !/favicon/.test(p));
check('no page errors or failed requests', relevant.length === 0, relevant.slice(0, 5).join(' | '));

await browser.close();
const failed = results.filter(r => !r.ok).length;
console.log(`\n${results.length - failed}/${results.length} checks passed; screenshots in ${out}/`);
process.exit(failed ? 1 : 0);
