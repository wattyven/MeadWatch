// Fetch Lake Mead daily observations from the Bureau of Reclamation hydrodata
// service and write public/data/mead_daily.json.
//
//   node scripts/fetch_levels.mjs
//
// Site 921 = Lake Mead (Hoover Dam). Datatypes: 49 pool elevation (ft),
// 17 storage (acre-feet, live), 42 total release (cfs).
// The service does not send CORS headers, so the browser app reads the
// snapshot this script writes rather than calling USBR directly.

import {writeFile} from 'node:fs/promises';

const BASE = 'https://www.usbr.gov/uc/water/hydrodata/reservoir_data/921/csv';
const KEEP_FROM = '2019-01-01';

async function series(datatype) {
    const res = await fetch(`${BASE}/${datatype}.csv`);
    if (!res.ok) throw new Error(`USBR ${datatype}: HTTP ${res.status}`);
    const text = await res.text();
    const out = new Map();
    for (const line of text.trim().split('\n').slice(1)) {
        const [date, value] = line.split(',');
        const v = parseFloat(value);
        if (date && Number.isFinite(v)) out.set(date, v);
    }
    return out;
}

const [elev, storage, release] = await Promise.all([series(49), series(17), series(42)]);

// Record low since the lake first filled (the reservoir filled in the late 1930s).
let recordLow = {date: '', elevation: Infinity};
for (const [date, v] of elev) {
    if (date >= '1940-01-01' && v < recordLow.elevation) recordLow = {date, elevation: v};
}
let recordHigh = {date: '', elevation: -Infinity};
for (const [date, v] of elev) {
    if (v > recordHigh.elevation) recordHigh = {date, elevation: v};
}

const dates = [...elev.keys()].filter(d => d >= KEEP_FROM).sort();
const rows = dates.map(d => [
    d,
    Math.round(elev.get(d) * 100) / 100,
    storage.has(d) ? Math.round(storage.get(d)) : null,
    release.has(d) ? Math.round(release.get(d)) : null
]);

const out = {
    source: 'U.S. Bureau of Reclamation, Lake Mead (site 921) daily hydrodata',
    url: 'https://www.usbr.gov/uc/water/hydrodata/reservoir_data/site_map.html',
    fetched: new Date().toISOString(),
    columns: ['date', 'elevationFt', 'liveStorageAf', 'releaseCfs'],
    recordLow,
    recordHigh,
    firstDate: [...elev.keys()].sort()[0],
    rows
};

await writeFile(new URL('../public/data/mead_daily.json', import.meta.url), JSON.stringify(out));
const last = rows[rows.length - 1];
console.log(`wrote ${rows.length} days, latest ${last[0]} = ${last[1]} ft; record low ${recordLow.elevation} ft on ${recordLow.date}`);
