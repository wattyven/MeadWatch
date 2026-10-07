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
check('downstream senior users flagged when releases are limited', /at risk|limited/i.test(yumaStatus), yumaStatus);
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

// Timeline scrubbing below uses a 2021-10 → 2028-08 window, typed into the From/To boxes.
await page.fill('#win-from', '2021-10');
await page.fill('#win-to', '2028-08');
await page.$eval('#win-to', el => el.dispatchEvent(new Event('change', {bubbles: true})));
await page.waitForTimeout(400);
check('typing a From/To window zooms the timeline', await page.evaluate(() => !document.querySelector('#win-reset').disabled && /from=2021-10-01/.test(location.hash)), await page.evaluate(() => location.hash));

// Timeline scrub into the forecast (dry scenario).
await page.selectOption('#scenario', 'min');
const box = await page.locator('.tl-hit').boundingBox();
await page.mouse.click(box.x + box.width * 0.97, box.y + box.height / 2);
await page.waitForTimeout(500);
const kicker = await page.textContent('.m-kicker');
check('scrubbing past today shows the forecast', /forecast/i.test(kicker), kicker);
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
    const cibola = await p.evaluate(async () => {
        const d = await (await fetch(new URL('data/waterways.geojson', location.href))).json();
        let n = 0;
        for (const f of d.features) if (f.properties.kind === 'river' && !f.properties.gap) for (const [, la] of f.geometry.coordinates) if (la > 33.33 && la < 33.43) n++;
        return n;
    });
    const labels = await p.evaluate(async () => {
        const m = window.mead.map;
        m.jumpTo({center: [-114.5, 33.4], zoom: 6, pitch: 0, bearing: 0});
        await new Promise(r => m.once('idle', r));
        const inRing = (pt, r) => { let c = false; for (let i = 0, j = r.length - 1; i < r.length; j = i++) { const [xi, yi] = r[i], [xj, yj] = r[j]; if ((yi > pt[1]) !== (yj > pt[1]) && pt[0] < (xj - xi) * (pt[1] - yi) / (yj - yi) + xi) c = !c; } return c; };
        const inGeom = (pt, g) => (g.type === 'Polygon' ? [g.coordinates] : g.coordinates).some(poly => inRing(pt, poly[0]) && !poly.slice(1).some(h => inRing(pt, h)));
        const regions = window.mead.app.regions.features.filter(f => f.properties.layer === 'region');
        const bad = [];
        const seen = new Set();
        for (const f of m.querySourceFeatures('labels')) {
            const pt = f.geometry.coordinates, rid = f.properties.rid, key = rid + f.properties.name;
            if (seen.has(key)) continue;
            seen.add(key);
            const hits = regions.filter(r => inGeom(pt, r.geometry)).map(r => r.properties.id);
            if (!hits.includes(rid) || hits.length > 1) bad.push(`${f.properties.name}→${hits.join('+') || 'none'}`);
        }
        return {n: seen.size, bad};
    });
    check('every region label sits on its own shaded area only', labels.n >= 11 && labels.bad.length === 0, `${labels.n} labels; ${labels.bad.join(', ') || 'all inside their own area'}`);
    check('river is drawn continuously through the Cibola reach', cibola > 10, `${cibola} vertices between 33.33°N and 33.43°N`);
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
    check('shared link restores a forecast date and scenario', /dry year/i.test(r.kicker) && r.date.startsWith('Jun 30, 2028'), JSON.stringify(r));
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

// ---- Long history and consistent forecasts
{
    const p = await fresh('');
    const order = await p.evaluate(() => {
        const S = Object.fromEntries(window.mead.app.forecast.scenarios.map(s => [s.id, new Map(s.series.map(q => [q.date, q.elevationFt]))]));
        const bad = [];
        for (const [d, m6] of S.most) {
            const m7 = S.most7.get(d), lo = S.min.get(d), hi = S.max.get(d);
            if (lo !== undefined && m6 < lo - 0.5) bad.push(`${d} most<min`);
            if (hi !== undefined && m7 > hi + 0.5) bad.push(`${d} most7>max`);
            if (m7 !== undefined && m6 > m7 + 0.5) bad.push(`${d} most>most7`);
        }
        return {n: S.most.size, bad, studies: window.mead.app.forecast.scenarios.map(s => s.id + ':' + s.study).join(',')};
    });
    check('forecast runs are consistent: min ≤ most probable (6.0) ≤ (7.0) ≤ max', order.n > 20 && order.bad.length === 0, `${order.n} months; ${order.bad.slice(0, 3).join(' ') || 'no violations'}; ${order.studies}`);
    const box2 = await p.locator('.tl-hit').boundingBox();
    await p.mouse.click(box2.x + box2.width * 0.01, box2.y + box2.height / 2);
    await p.waitForTimeout(400);
    const early = await p.evaluate(() => ({date: document.querySelector('.m-date').textContent, elev: parseFloat(document.querySelector('.m-big').textContent.replace(/,/g, '')), rules: document.querySelector('.op-rules').textContent}));
    check('timeline reaches back to 2000 (lake near 1,200 ft)', /2000/.test(early.date) && early.elev > 1190, `${early.date} → ${early.elev} ft`);
    check('pre-2008 years show pre-2007 operations', /Pre-2007/.test(early.rules), early.rules);
    await p.close();
}
{
    const p = await fresh('#date=2027-08-31&fc=most7&from=2021-10-01&to=2028-08-31');
    const r = await p.evaluate(() => ({sel: document.querySelector('#scenario').value, kicker: document.querySelector('.m-kicker').textContent, from: document.querySelector('#win-from').value}));
    check('shared link restores the 7.0 maf scenario and the time window', r.sel === 'most7' && /7\.0/.test(r.kicker) && r.from === '2021-10', JSON.stringify(r));
    // drag on the overview strip to choose a window, then reset
    const svgBox = await p.locator('.tl-svg').boundingBox();
    await p.click('#win-reset');
    await p.waitForTimeout(300);
    const oy = svgBox.y + svgBox.height - 15;
    await p.mouse.move(svgBox.x + svgBox.width * 0.55, oy);
    await p.mouse.down();
    await p.mouse.move(svgBox.x + svgBox.width * 0.7, oy, {steps: 6});
    await p.mouse.move(svgBox.x + svgBox.width * 0.8, oy, {steps: 6});
    await p.mouse.up();
    await p.waitForTimeout(500);
    const brushed = await p.evaluate(() => ({from: document.querySelector('#win-from').value, to: document.querySelector('#win-to').value, reset: !document.querySelector('#win-reset').disabled}));
    check('dragging on the overview strip selects a time window', brushed.reset && brushed.from > '2012' && brushed.to < '2025', JSON.stringify(brushed));
    await p.click('#win-reset');
    await p.waitForTimeout(400);
    const reset = await p.evaluate(() => ({from: document.querySelector('#win-from').value, to: document.querySelector('#win-to').value, hash: location.hash}));
    check('Reset view returns to the whole 2000–2028 timeline', reset.from === '2000-01' && reset.to === '2028-08' && !/from=/.test(reset.hash), JSON.stringify(reset));
    await p.close();
}

// ---- Laptop-sized screen: a selected region is in view; legend can be hidden
{
    const p = await fresh('', {width: 1440, height: 900});
    await p.click('.rg[data-id="socal"]');
    await p.waitForTimeout(900);
    const r = await p.evaluate(() => {
        const panel = document.querySelector('#impacts').getBoundingClientRect();
        const card = document.querySelector('.rg-detail')?.getBoundingClientRect();
        return {card: !!card, top: card && Math.round(card.top), inView: !!card && card.top >= panel.top && card.top + 120 <= panel.bottom,
            flowsClosed: !document.querySelector('.flows').open, howtoClosed: !document.querySelector('.howto').open};
    });
    check('on a 1440×900 screen the selected region’s card is visible without scrolling', r.card && r.inView, JSON.stringify(r));
    check('on a laptop-height screen the flows and how-to sections start collapsed', r.flowsClosed && r.howtoClosed);
    await p.screenshot({path: `${out}/18-laptop-selected.png`});
    await p.click('[data-hide-legend]');
    const hidden = await p.evaluate(() => ({legend: document.querySelector('#legend').hidden, box: document.querySelector('#legend-toggle').checked}));
    await p.click('#legend-toggle');
    const shown = await p.evaluate(() => !document.querySelector('#legend').hidden);
    check('legend can be hidden and shown again', hidden.legend && !hidden.box && shown, JSON.stringify({hidden, shown}));
    check('“Show full lake” setting is gone', await p.evaluate(() => !document.querySelector('#ghost')));
    await p.close();
}

// ---- Guide, glossary and term tooltips
{
    const p = await fresh('');
    const hint = await p.evaluate(() => !document.querySelector('#guide-hint').hidden);
    check('first visit shows a pointer to the guide', hint);
    const t = p.locator('#metrics .term[data-term="live-storage"]');
    await t.hover();
    await p.waitForTimeout(200);
    const tip = await p.evaluate(() => ({shown: !document.querySelector('#term-tip').hidden, text: document.querySelector('#term-tip').textContent}));
    check('hovering a term shows its plain-language definition', tip.shown && /released downstream/.test(tip.text), tip.text.slice(0, 70));
    await t.click();
    await p.waitForTimeout(300);
    const gl = await p.evaluate(() => ({open: document.querySelector('#guide-dialog').open, hl: document.querySelector('.gl-entry.hl')?.id, tab: document.querySelector('#guide-glossary').hidden === false}));
    check('clicking a term opens its glossary entry', gl.open && gl.tab && gl.hl === 'gl-live-storage', JSON.stringify(gl));
    await p.fill('#glossary-search', 'dead pool');
    const hits = await p.evaluate(() => [...document.querySelectorAll('.gl-entry')].filter(e => !e.hidden).map(e => e.id));
    check('glossary search filters entries', hits.includes('gl-dead-pool') && hits.length < 8, hits.join(','));
    const unknown = await p.evaluate(() => {
        const ids = new Set([...document.querySelectorAll('.gl-entry')].map(e => e.id.slice(3)));
        return [...document.querySelectorAll('[data-term]')].map(e => e.dataset.term).filter(id => !ids.has(id));
    });
    check('every underlined term has a glossary entry', unknown.length === 0, unknown.join(','));
    await p.screenshot({path: `${out}/16-glossary.png`});
    await p.click('#guide-dialog .dlg-head button');
    await p.click('#help-btn');
    await p.waitForTimeout(200);
    await p.screenshot({path: `${out}/17-guide.png`});
    await p.close();
}

// ---- Downstream flows respond to the lake level
{
    const p = await fresh('');
    const today = await p.evaluate(() => [...document.querySelectorAll('.fl')].map(li => li.querySelector('.fl-name').textContent.trim() + '=' + li.querySelector('.fl-val').textContent.trim()));
    check('flows panel lists the river reaches and four aqueducts', today.length === 7, today.join(' | '));
    check('flow below Hoover uses observed USBR releases today', /below Hoover Dam USBR=\d\.\d\d/.test(today[0]), today[0]);
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
