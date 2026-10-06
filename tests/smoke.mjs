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

// ---- Shareable links, embed mode, methods, social tags
const fresh = async (hash, viewport = {width: 1400, height: 900}) => {
    const p = await browser.newPage({viewport});
    p.on('pageerror', e => problems.push(`pageerror(${hash}): ${e.message}`));
    await p.goto(url + hash, {waitUntil: 'domcontentloaded'});
    await p.waitForSelector('#loading.done', {timeout: 60000});
    await p.waitForTimeout(1500);
    return p;
};
{
    const p = await fresh('');
    await p.waitForTimeout(1200);
    check('default view keeps a clean URL', (await p.evaluate(() => location.hash)) === '', await p.evaluate(() => location.hash));
    const vector = await p.evaluate(() => !!window.mead.map.getLayer('ofm-road_motorway') && !!window.mead.map.getLayer('base-relief'));
    const ww = await p.evaluate(async () => {
        const m = window.mead.map;
        m.jumpTo({center: [-115.2, 33.6], zoom: 6.8, pitch: 0, bearing: 0});
        await new Promise(r => m.once('idle', r));
        return [...new Set(m.queryRenderedFeatures({layers: ['ww-line', 'ww-schematic']}).map(f => f.properties.id))].sort().join(',');
    });
    check('OSM-traced river reaches and all four aqueducts render', ww === 'aac,cap,coachella,cra,r1,r2,r3', ww);
    check('OpenFreeMap vector basemap + terrain relief loaded', vector);
    const tiles = await p.evaluate(() => performance.getEntriesByType('resource').map(r => r.name).filter(n => /opentopomap|tile\.openstreetmap\.org/.test(n)).length);
    check('no requests to volunteer OSM/OpenTopoMap tile servers', tiles === 0, `${tiles} requests`);
    const og = await p.evaluate(() => document.querySelector('meta[property="og:image"]').content);
    check('social preview image is an absolute URL', /^https:\/\/.+\/og\.jpg$/.test(og), og);
    await p.fill('#elev-input', '975');
    await p.press('#elev-input', 'Enter');
    await p.waitForFunction(() => location.hash.includes('level='), null, {timeout: 8000}).catch(() => {});
    const h = await p.evaluate(() => location.hash);
    check('changing the level updates the URL', h.includes('level=975'), h);
    await p.click('#share-btn');
    const link = await p.inputValue('#share-link');
    const embed = await p.inputValue('#share-embed');
    check('share dialog offers the current view as a link', link.includes('level=975') && link.startsWith('http'), link);
    check('share dialog offers iframe embed code', embed.includes('<iframe') && embed.includes('embed=1'), embed.slice(0, 80));
    await p.screenshot({path: `${out}/12-share-dialog.png`});
    await p.close();
}
{
    const p = await fresh('#level=950&rules=2007&map=satellite&region=phx&cam=-114.7600,36.0500,11.00,60,30');
    const r = await p.evaluate(() => ({
        big: document.querySelector('.m-big').textContent,
        kicker: document.querySelector('.m-kicker').textContent,
        rules: document.querySelector('.op-rules').textContent,
        map: document.querySelector('#basemap .on').dataset.v,
        region: document.querySelector('.rg-detail-head b')?.textContent,
        zoom: window.mead.map.getZoom()
    }));
    check('shared link restores level, rules, basemap, region and camera',
        r.big === '950' && r.kicker.includes('What-if') && r.rules.includes('2007') && r.map === 'satellite' && /Phoenix/.test(r.region ?? '') && Math.abs(r.zoom - 11) < 0.05,
        JSON.stringify(r));
    await p.close();
}
{
    const p = await fresh('#date=2028-06-30&fc=min');
    const r = await p.evaluate(() => ({kicker: document.querySelector('.m-kicker').textContent, date: document.querySelector('.m-date').textContent}));
    check('shared link restores a forecast date and scenario', r.kicker.includes('Probable Minimum') && r.date.startsWith('Jun 30, 2028'), JSON.stringify(r));
    await p.close();
}
{
    const p = await fresh('#embed=1', {width: 900, height: 560});
    const r = await p.evaluate(() => ({
        sides: [...document.querySelectorAll('.side, .toolbar, .brand')].every(e => getComputedStyle(e).display === 'none'),
        bar: getComputedStyle(document.querySelector('#embed-bar')).display !== 'none',
        link: document.querySelector('.eb-link')?.getAttribute('href') ?? ''
    }));
    check('embed mode hides panels and links back to the full app', r.sides && r.bar && !r.link.includes('embed=1'), JSON.stringify(r));
    await p.waitForTimeout(3000);
    await p.screenshot({path: `${out}/13-embed.png`});
    await p.close();
}
{
    const p = await fresh('#about');
    const r = await p.evaluate(() => ({open: document.querySelector('#about-dialog').open, latest: document.querySelector('[data-fill="latest"]').textContent}));
    check('#about opens the methods & sources dialog', r.open && /ft on/.test(r.latest), JSON.stringify(r));
    await p.screenshot({path: `${out}/14-about.png`});
    await p.close();
}

// ---- Downstream flows respond to the lake level
{
    const p = await fresh('');
    const today = await p.evaluate(() => [...document.querySelectorAll('.fl')].map(li => li.querySelector('.fl-name').textContent.trim() + '=' + li.querySelector('.fl-val').textContent.trim()));
    check('flows panel lists the river reaches and four aqueducts', today.length === 7, today.join(' | '));
    check('flow below Hoover uses observed USBR releases today', /Below Hoover USBR=\d\.\d\d/.test(today[0]), today[0]);
    await p.fill('#elev-input', '890');
    await p.press('#elev-input', 'Enter');
    await p.waitForTimeout(500);
    const dead = await p.evaluate(() => ({
        vals: [...document.querySelectorAll('.fl-val')].map(e => e.textContent.trim()),
        lakes: [...document.querySelectorAll('.lake small')].map(e => e.textContent),
        state: window.mead.map.getFeatureState({source: 'waterways', id: 'cap'})
    }));
    check('at dead pool every reach and canal runs dry', dead.vals.every(v => v === 'Dry') && dead.state.dry === true, dead.vals.join(','));
    check('at dead pool Lakes Mohave and Havasu are flagged', dead.lakes.every(t => /No inflow/.test(t)), dead.lakes.join(' | '));
    await p.fill('#elev-input', '1100');
    await p.press('#elev-input', 'Enter');
    await p.waitForTimeout(500);
    const cap = await p.evaluate(() => window.mead.map.getFeatureState({source: 'waterways', id: 'cap'}).scale);
    check('canal line width shrinks with shortage cuts', cap > 0.5 && cap < 1, `CAP width scale ${cap?.toFixed(2)}`);
    await p.close();
}

// ---- Terrain must not depend on canvas readback: Safari/Firefox/Brave anti-fingerprinting
// adds noise to getImageData, which used to show up as needle peaks (±256 m per red step).
{
    const p = await browser.newPage({viewport: {width: 1200, height: 800}});
    await p.addInitScript(() => {
        const patch = proto => {
            const orig = proto.getImageData;
            proto.getImageData = function (...a) {
                const img = orig.apply(this, a);
                for (let i = 0; i < img.data.length; i += 4) if (Math.random() < 0.002) img.data[i + (Math.random() * 3 | 0)] += Math.random() < 0.5 ? 1 : -1;
                return img;
            };
        };
        patch(CanvasRenderingContext2D.prototype);
        if (self.OffscreenCanvasRenderingContext2D) patch(OffscreenCanvasRenderingContext2D.prototype);
    });
    await p.goto(url + '#cam=-114.7500,36.0600,13.20,72,20', {waitUntil: 'domcontentloaded'});
    await p.waitForSelector('#loading.done', {timeout: 60000});
    await p.waitForFunction(() => { const m = window.mead?.map; return m && m.loaded() && m.areTilesLoaded() && !m.isMoving(); }, null, {timeout: 60000, polling: 500}).catch(() => {});
    const r = await p.evaluate(() => {
        const m = window.mead.map, ex = m.getTerrain()?.exaggeration ?? 1, b = m.getBounds(), N = 100, g = [];
        for (let j = 0; j < N; j++) { const row = []; for (let i = 0; i < N; i++) row.push((m.queryTerrainElevation([b.getWest() + (b.getEast() - b.getWest()) * (i + .5) / N, b.getSouth() + (b.getNorth() - b.getSouth()) * (j + .5) / N]) ?? NaN) / ex); g.push(row); }
        let worst = 0;
        for (let j = 1; j < N - 1; j++) for (let i = 1; i < N - 1; i++) { const nb = [g[j-1][i], g[j+1][i], g[j][i-1], g[j][i+1]].sort((a, b) => a - b); const d = g[j][i] - (nb[1] + nb[2]) / 2; if (Math.abs(d) > Math.abs(worst)) worst = d; }
        return Math.round(worst);
    });
    check('terrain has no needle spikes under canvas fingerprinting noise', Math.abs(r) < 600, `worst deviation ${r} m`);
    await p.screenshot({path: `${out}/15-terrain-noise.png`});
    await p.close();
}

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
