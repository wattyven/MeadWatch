// Render the README screenshots (docs/*.png) from the running app.
//
//   npm run dev &
//   node scripts/make_screenshots.mjs [http://localhost:5173/]

import {chromium} from 'playwright';
import {fileURLToPath} from 'node:url';

const url = process.argv[2] ?? 'http://localhost:5173/';
const SHOTS = [
    {file: 'overview.png', hash: ''},
    {file: 'hoover-dam.png', hash: '#cam=-114.7750,36.0400,12.10,66,38'},
    {file: 'forecast-2028.png', hash: '#date=2028-06-30&fc=min&from=2021-10-01&to=2028-08-31'},
    {file: 'downstream.png', hash: '#cam=-115.6000,33.9000,6.40,30,0'}
];

const browser = await chromium.launch({args: ['--use-angle=swiftshader', '--enable-unsafe-swiftshader']});
for (const shot of SHOTS) {
    const page = await browser.newPage({viewport: {width: 1600, height: 1000}, deviceScaleFactor: 1});
    // returning visitor: no first-visit guide banner in the screenshots
    await page.addInitScript(() => localStorage.setItem('mw-guide-seen', '1'));
    await page.goto(url + shot.hash, {waitUntil: 'domcontentloaded'});
    await page.waitForSelector('#loading.done', {timeout: 90000});
    await page.waitForFunction(() => {
        const m = window.mead?.map;
        return m && m.loaded() && m.areTilesLoaded() && !m.isMoving();
    }, null, {timeout: 90000, polling: 500}).catch(() => {});
    await page.waitForTimeout(1500);
    await page.screenshot({path: fileURLToPath(new URL(`../docs/${shot.file}`, import.meta.url))});
    await page.close();
    console.log('wrote docs/' + shot.file);
}
await browser.close();
