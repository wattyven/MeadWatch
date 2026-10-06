// Render the 1200×630 social preview image (public/og.jpg) from the running app.
//
//   npm run dev &
//   node scripts/make_og.mjs [http://localhost:5173/]

import {chromium} from 'playwright';
import {fileURLToPath} from 'node:url';

const url = process.argv[2] ?? 'http://localhost:5173/';
const browser = await chromium.launch({args: ['--use-angle=swiftshader', '--enable-unsafe-swiftshader']});
const page = await browser.newPage({viewport: {width: 1200, height: 630}, deviceScaleFactor: 1});
await page.goto(url + '#embed=1&cam=-114.5600,36.1200,9.45,60,6', {waitUntil: 'domcontentloaded'});
await page.waitForSelector('#loading.done', {timeout: 90000});
await page.waitForFunction(() => {
    const m = window.mead?.map;
    return m && m.loaded() && m.areTilesLoaded() && !m.isMoving();
}, null, {timeout: 90000, polling: 500}).catch(() => {});
await page.waitForTimeout(1500);
const level = await page.evaluate(() => window.mead.app.lastObserved.elevation.toLocaleString('en-US', {minimumFractionDigits: 1, maximumFractionDigits: 1}));
await page.addStyleTag({content: `
    .timeline, .embed-bar, .maplibregl-control-container { display: none !important; }
    .og { position: fixed; left: 36px; bottom: 34px; z-index: 50; color: #fff; font-family: Inter, system-ui, sans-serif;
          background: rgba(11, 18, 29, 0.84); border: 1px solid rgba(255,255,255,0.12); border-radius: 16px; padding: 18px 22px; }
    .og h1 { margin: 0; font-size: 44px; letter-spacing: -0.01em; }
    .og h1 span { color: #5cc8e0; }
    .og p { margin: 6px 0 0; font-size: 21px; color: #c9d3df; }
    .og b { color: #ffb4ab; }
`});
await page.evaluate(lvl => {
    const d = document.createElement('div');
    d.className = 'og';
    d.innerHTML = `<h1><span>Mead</span>Watch</h1><p>Lake Mead at <b>${lvl} ft</b>, near its all-time low. See who downstream runs short.</p>`;
    document.body.appendChild(d);
}, level);
await page.screenshot({path: fileURLToPath(new URL('../public/og.jpg', import.meta.url)), type: 'jpeg', quality: 86});
await browser.close();
console.log('wrote public/og.jpg');
