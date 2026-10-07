// Trace the Colorado River below Hoover Dam and the major aqueducts on the
// actual OpenStreetMap waterway geometry, so the overlays sit exactly on the
// rivers and canals drawn by the basemap.
//
//   node scripts/build_waterways.mjs
//
// OSM splits canals into many short, often unnamed pieces, so each conveyance
// is found by routing: every river/canal segment from z12 OpenFreeMap vector
// tiles along a rough guide line becomes a graph edge, and the cheapest path
// from intake to terminus is taken, with cost growing with distance from the
// guide. Gaps (reservoirs with no mapped centreline, siphons, unmapped tunnel
// portals) may be bridged; those pieces are flagged `gap` in the output.
// Writes public/data/waterways.geojson.

import {mkdir, readFile, writeFile} from 'node:fs/promises';
import {existsSync} from 'node:fs';
import {VectorTile} from '@mapbox/vector-tile';
import Pbf from 'pbf';
import {simplify} from '@turf/simplify';
import {lineString} from '@turf/helpers';

const CACHE = new URL('../.cache/vt/', import.meta.url);
const Z = 12;
// z12 tiles generalise short or wiggly pieces away; long gaps are re-checked at full detail.
const Z_DETAIL = 14;
const REFINE_GAP_KM = 2;

// Rough guide lines (lon, lat). Only used to steer the routing.
const ROUTES = [
    {
        id: 'river', name: 'Colorado River', classes: ['river'], corridor: 1, maxGapKm: 40, guideKm: 6, gapCost: 12,
        guide: [[-114.738, 36.014], [-114.74, 35.85], [-114.67, 35.50], [-114.571, 35.197], [-114.58, 34.99],
            [-114.60, 34.84], [-114.49, 34.72], [-114.36, 34.50], [-114.14, 34.296], [-114.29, 34.15],
            [-114.52, 33.95], [-114.53, 33.61], [-114.56, 33.50], [-114.62, 33.42], [-114.69, 33.33],
            [-114.675, 33.20], [-114.69, 33.08], [-114.50, 32.97], [-114.465, 32.883],
            [-114.62, 32.73], [-114.72, 32.715], [-114.80, 32.50]]
    },
    {
        id: 'cap', name: 'Central Arizona Project', classes: ['canal'], corridor: 2, maxGapKm: 8, guideKm: 3, gapCost: 5,
        guide: [[-114.13, 34.30], [-113.95, 34.08], [-113.62, 33.86], [-113.25, 33.70], [-112.75, 33.72],
            [-112.27, 33.85], [-112.00, 33.75], [-111.80, 33.60], [-111.70, 33.40], [-111.60, 33.15],
            [-111.45, 32.90], [-111.25, 32.60], [-111.10, 32.30], [-111.05, 32.05]]
    },
    {
        id: 'aac', name: 'All-American Canal', classes: ['canal'], corridor: 1, maxGapKm: 3, guideKm: 3, gapCost: 5,
        guide: [[-114.47, 32.88], [-114.62, 32.74], [-114.85, 32.70], [-115.10, 32.68], [-115.35, 32.70], [-115.60, 32.71]]
    },
    {
        id: 'coachella', name: 'Coachella Canal', classes: ['canal'], corridor: 2, maxGapKm: 3, guideKm: 3, gapCost: 5,
        guide: [[-115.00, 32.70], [-115.08, 32.90], [-115.22, 33.10], [-115.45, 33.32], [-115.75, 33.50],
            [-116.00, 33.62], [-116.18, 33.72]]
    }
];

// The Colorado River Aqueduct is almost entirely buried conduit and tunnel, which
// OSM's waterway layer doesn't carry, so it is drawn schematically through its
// intake, pumping plants and the San Jacinto Tunnel to Lake Mathews.
const CRA_SCHEMATIC = [
    [-114.1556, 34.3167], // Whitsett Intake, Lake Havasu
    [-114.2440, 34.2930], // Gene pumping plant
    [-114.5200, 34.2050],
    [-114.8300, 34.1650],
    [-115.1204, 34.1366], // Iron Mountain pumping plant
    [-115.4030, 33.9100], // Pinto Wash siphon
    [-115.4520, 33.8148], // Eagle Mountain pumping plant
    [-115.6372, 33.7036], // Hayfield pumping plant
    [-115.9500, 33.7450],
    [-116.2200, 33.8150],
    [-116.4500, 33.8900],
    [-116.6400, 33.9300], // Whitewater
    [-116.8100, 33.9250], // Cabazon, San Jacinto Tunnel east portal
    [-117.0300, 33.8300], // west portal
    [-117.2500, 33.8500],
    [-117.4573, 33.8530]  // Lake Mathews
];

// ---------------------------------------------------------------- geometry
const R = 6371.0088;
const rad = d => d * Math.PI / 180;
function km(a, b) {
    const dLat = rad(b[1] - a[1]), dLon = rad(b[0] - a[0]);
    const h = Math.sin(dLat / 2) ** 2 + Math.cos(rad(a[1])) * Math.cos(rad(b[1])) * Math.sin(dLon / 2) ** 2;
    return 2 * R * Math.asin(Math.sqrt(h));
}
function distToSegKm(p, a, b) {
    // local equirectangular projection is plenty at these scales
    const k = Math.cos(rad(p[1]));
    const ax = (a[0] - p[0]) * k, ay = a[1] - p[1], bx = (b[0] - p[0]) * k, by = b[1] - p[1];
    const dx = bx - ax, dy = by - ay;
    const t = Math.max(0, Math.min(1, -(ax * dx + ay * dy) / ((dx * dx + dy * dy) || 1e-18)));
    const x = ax + t * dx, y = ay + t * dy;
    return Math.hypot(x, y) * 111.195;
}
function distToGuideKm(p, guide) {
    let d = Infinity;
    for (let i = 1; i < guide.length; i++) d = Math.min(d, distToSegKm(p, guide[i - 1], guide[i]));
    return d;
}
const tileOf = (lon, lat, z) => {
    const n = 2 ** z;
    return [Math.floor((lon + 180) / 360 * n), Math.floor((1 - Math.asinh(Math.tan(rad(lat))) / Math.PI) / 2 * n)];
};

// ---------------------------------------------------------------- tiles
async function tileTemplate() {
    const tj = await (await fetch('https://tiles.openfreemap.org/planet')).json();
    return tj.tiles[0];
}

/** Cache folder per OpenFreeMap planet build, so a newer build is fetched fresh. */
function cacheDir(tpl) {
    const build = tpl.match(/planet\/([^/]+)\//)?.[1] ?? 'current';
    return new URL(`${build}/`, CACHE);
}

async function getTile(tpl, x, y, z = Z) {
    const dir = cacheDir(tpl);
    await mkdir(dir, {recursive: true});
    const f = new URL(`${z}-${x}-${y}.pbf`, dir);
    if (existsSync(f)) return new Uint8Array(await readFile(f));
    const url = tpl.replace('{z}', z).replace('{x}', x).replace('{y}', y);
    for (let attempt = 0; attempt < 3; attempt++) {
        const res = await fetch(url);
        if (res.ok) {
            const buf = new Uint8Array(await res.arrayBuffer());
            await writeFile(f, buf);
            return buf;
        }
        await new Promise(r => setTimeout(r, 1000 * (attempt + 1)));
    }
    throw new Error(`tile ${z}/${x}/${y} failed`);
}

function corridorTiles(guide, width) {
    const set = new Set();
    for (let i = 1; i < guide.length; i++) {
        const steps = Math.ceil(km(guide[i - 1], guide[i]) / 2);
        for (let s = 0; s <= steps; s++) {
            const t = s / steps;
            const [x, y] = tileOf(guide[i - 1][0] + t * (guide[i][0] - guide[i - 1][0]), guide[i - 1][1] + t * (guide[i][1] - guide[i - 1][1]), Z);
            for (let dx = -width; dx <= width; dx++) for (let dy = -width; dy <= width; dy++) set.add(`${x + dx}/${y + dy}`);
        }
    }
    return [...set].map(k => k.split('/').map(Number));
}

async function collectLines(tpl, tiles, classes, z = Z) {
    const lines = [];
    let done = 0;
    const queue = [...tiles];
    async function worker() {
        while (queue.length) {
            const [x, y] = queue.pop();
            const vt = new VectorTile(new Pbf(await getTile(tpl, x, y, z)));
            const layer = vt.layers.waterway;
            for (let i = 0; layer && i < layer.length; i++) {
                const f = layer.feature(i);
                if (!classes.includes(f.properties.class)) continue;
                const gj = f.toGeoJSON(x, y, z);
                const parts = gj.geometry.type === 'LineString' ? [gj.geometry.coordinates] : gj.geometry.coordinates;
                for (const p of parts) lines.push({coords: p, name: f.properties.name ?? '', tunnel: f.properties.brunnel === 'tunnel'});
            }
            if (++done % 50 === 0) process.stdout.write(`  ${done}/${tiles.length} tiles\r`);
        }
    }
    await Promise.all(Array.from({length: 8}, worker));
    return lines;
}

// ---------------------------------------------------------------- routing
function route(lines, guide, {maxGapKm, guideKm, gapCost}, preferName) {
    const nodes = new Map(); // key -> {p, edges: [[to, cost, len, gap]]}
    const key = p => `${p[0].toFixed(5)},${p[1].toFixed(5)}`;
    const node = p => {
        const k = key(p);
        if (!nodes.has(k)) nodes.set(k, {k, p, edges: []});
        return nodes.get(k);
    };
    const weight = (a, b, name) => {
        const mid = [(a[0] + b[0]) / 2, (a[1] + b[1]) / 2];
        const d = distToGuideKm(mid, guide);
        const named = preferName && preferName.test(name) ? 0.6 : 1;
        return km(a, b) * (1 + (d / guideKm) ** 2) * named;
    };
    for (const l of lines) {
        for (let i = 1; i < l.coords.length; i++) {
            const a = node(l.coords[i - 1]), b = node(l.coords[i]);
            if (a === b) continue;
            const w = weight(a.p, b.p, l.name), len = km(a.p, b.p);
            a.edges.push([b, w, len, false]);
            b.edges.push([a, w, len, false]);
        }
    }
    // Bridge gaps: line ends to any node within maxGapKm, at a premium.
    const cell = maxGapKm / 111;
    const grid = new Map();
    const gk = (x, y) => `${Math.floor(x / cell)},${Math.floor(y / cell)}`;
    for (const n of nodes.values()) {
        const k = gk(n.p[0], n.p[1]);
        if (!grid.has(k)) grid.set(k, []);
        grid.get(k).push(n);
    }
    // Decide which nodes are line ends before adding any links, so the result
    // doesn't depend on the order nodes are visited.
    const ends = [...nodes.values()].filter(n => n.edges.length === 1);
    for (const n of ends) {
        const cx = Math.floor(n.p[0] / cell), cy = Math.floor(n.p[1] / cell);
        for (let dx = -1; dx <= 1; dx++) for (let dy = -1; dy <= 1; dy++) {
            for (const m of grid.get(`${cx + dx},${cy + dy}`) ?? []) {
                if (m === n || m === n.edges[0][0]) continue;
                const len = km(n.p, m.p);
                if (len > maxGapKm) continue;
                // Pieces cut at tile edges meet within metres: join those as ordinary waterway.
                const seam = len < 0.06;
                const w = seam ? weight(n.p, m.p, '') : weight(n.p, m.p, '') * gapCost + 0.5;
                n.edges.push([m, w, len, !seam]);
                m.edges.push([n, w, len, !seam]);
            }
        }
    }
    const nearest = p => {
        let best = null, bd = Infinity;
        for (const n of nodes.values()) {
            const d = km(n.p, p);
            if (d < bd) { bd = d; best = n; }
        }
        return [best, bd];
    };
    const [start, ds] = nearest(guide[0]);
    const [end, de] = nearest(guide[guide.length - 1]);
    if (process.env.DEBUG) {
        for (const allowGap of [false, true]) {
            const seen = new Set([start.k]);
            const stack = [start];
            let minLat = start.p[1];
            while (stack.length) {
                const n = stack.pop();
                minLat = Math.min(minLat, n.p[1]);
                for (const [m, , , gap] of n.edges) if ((allowGap || !gap) && !seen.has(m.k)) { seen.add(m.k); stack.push(m); }
            }
            console.log(`  debug: ${allowGap ? 'with gaps' : 'seams only'}: reach ${seen.size}/${nodes.size} nodes, south to ${minLat.toFixed(3)}; end reachable: ${seen.has(end.k)}`);
        }
    }

    // Dijkstra with a binary heap
    const dist = new Map([[start.k, 0]]), prev = new Map();
    const heap = [[0, start]];
    const push = item => {
        heap.push(item);
        let i = heap.length - 1;
        while (i > 0) {
            const p = (i - 1) >> 1;
            if (heap[p][0] <= heap[i][0]) break;
            [heap[p], heap[i]] = [heap[i], heap[p]];
            i = p;
        }
    };
    const pop = () => {
        const top = heap[0], last = heap.pop();
        if (heap.length) {
            heap[0] = last;
            let i = 0;
            for (;;) {
                const l = 2 * i + 1, r = l + 1;
                let m = i;
                if (l < heap.length && heap[l][0] < heap[m][0]) m = l;
                if (r < heap.length && heap[r][0] < heap[m][0]) m = r;
                if (m === i) break;
                [heap[m], heap[i]] = [heap[i], heap[m]];
                i = m;
            }
        }
        return top;
    };
    while (heap.length) {
        const [d, n] = pop();
        if (n === end) break;
        if (d > (dist.get(n.k) ?? Infinity)) continue;
        for (const [m, w, , gap] of n.edges) {
            const nd = d + w;
            if (nd < (dist.get(m.k) ?? Infinity)) {
                dist.set(m.k, nd);
                prev.set(m.k, [n, gap]);
                push([nd, m]);
            }
        }
    }
    if (!prev.has(end.k)) throw new Error('no path found');
    // Walk back, splitting into real and gap pieces.
    const pieces = [];
    let cur = end, piece = {gap: false, coords: [end.p]};
    while (cur !== start) {
        const [p, gap] = prev.get(cur.k);
        if (gap !== piece.gap) {
            pieces.push(piece);
            piece = {gap, coords: [cur.p]};
        }
        piece.coords.push(p.p);
        cur = p;
    }
    pieces.push(piece);
    const out = pieces.filter(pc => pc.coords.length > 1).map(pc => ({gap: pc.gap, coords: pc.coords.reverse()})).reverse();
    return {pieces: out, snap: [ds, de]};
}

// The river is split into reaches between the points where water leaves it:
// r1 Hoover Dam → Parker Dam (CAP and the Colorado River Aqueduct draw from Lake Havasu),
// r2 Parker Dam → Imperial Dam (All-American Canal and Gila diversions),
// r3 below Imperial Dam → Yuma and the border at Morelos Dam.
const PARKER_LAT = 34.296, IMPERIAL_LAT = 32.883;
const REACH_NAMES = {r1: 'Colorado River: Hoover Dam to Parker Dam', r2: 'Colorado River: Parker Dam to Imperial Dam', r3: 'Colorado River: below Imperial Dam'};
function reachOf(lat) {
    return lat >= PARKER_LAT ? 'r1' : lat >= IMPERIAL_LAT ? 'r2' : 'r3';
}
function splitReaches(coords) {
    const out = [];
    let cur = reachOf(coords[0][1]), acc = [coords[0]];
    for (let i = 1; i < coords.length; i++) {
        const r = reachOf(coords[i][1]);
        acc.push(coords[i]);
        if (r !== cur) {
            out.push([cur, acc]);
            acc = [coords[i]];
            cur = r;
        }
    }
    out.push([cur, acc]);
    return out;
}

// ---------------------------------------------------------------- main
const tpl = await tileTemplate();
const features = [];
for (const r of ROUTES) {
    const tiles = corridorTiles(r.guide, r.corridor);
    console.log(`${r.id}: ${tiles.length} tiles`);
    const lines = await collectLines(tpl, tiles, r.classes);
    const preferName = new RegExp(r.id === 'river' ? 'Colorado' : r.name.split(' ')[0], 'i');
    let pieces, snap;
    try {
        ({pieces, snap} = route(lines, r.guide, r, preferName));
        // Re-check long bridged gaps against full-detail tiles; keep them only if OSM has no line there.
        const long = pieces.filter(pc => pc.gap && pc.coords.slice(1).reduce((a, p, i) => a + km(pc.coords[i], p), 0) > REFINE_GAP_KM);
        if (long.length) {
            const extra = new Set();
            for (const pc of long) {
                const lons = pc.coords.map(c => c[0]), lats = pc.coords.map(c => c[1]);
                const pad = 0.02;
                const [ax, ay] = tileOf(Math.min(...lons) - pad, Math.max(...lats) + pad, Z_DETAIL);
                const [bx, by] = tileOf(Math.max(...lons) + pad, Math.min(...lats) - pad, Z_DETAIL);
                for (let x = ax; x <= bx; x++) for (let y = ay; y <= by; y++) extra.add(`${x}/${y}`);
            }
            const detail = await collectLines(tpl, [...extra].map(k => k.split('/').map(Number)), r.classes, Z_DETAIL);
            console.log(`  ${r.id}: re-checking ${long.length} gap(s) > ${REFINE_GAP_KM} km with ${extra.size} z${Z_DETAIL} tiles`);
            ({pieces, snap} = route([...lines, ...detail], r.guide, r, preferName));
        }
    } catch (e) {
        console.log(`  ${r.id}: ${e.message} (${lines.length} line pieces collected)`);
        continue;
    }
    let real = 0, gaps = 0;
    for (const pc of pieces) {
        const len = pc.coords.slice(1).reduce((a, p, i) => a + km(pc.coords[i], p), 0);
        if (pc.gap) gaps += len; else real += len;
        const parts = r.id === 'river' ? splitReaches(pc.coords) : [[r.id, pc.coords]];
        for (const [id, coords] of parts) {
            if (coords.length < 2) continue;
            const line = simplify(lineString(coords), {tolerance: 0.00008, highQuality: true});
            features.push({...line, properties: {layer: 'waterway', id, kind: r.id === 'river' ? 'river' : 'canal', name: REACH_NAMES[id] ?? r.name, gap: pc.gap, schematic: false}});
        }
    }
    console.log(`  ${r.id}: ${real.toFixed(0)} km on mapped waterways, ${gaps.toFixed(1)} km bridged; snapped ${snap.map(v => v.toFixed(2)).join('/')} km from guide ends`);
}
features.push({...lineString(CRA_SCHEMATIC), properties: {layer: 'waterway', id: 'cra', kind: 'canal', name: 'Colorado River Aqueduct', gap: false, schematic: true}});
await writeFile(new URL('../public/data/waterways.geojson', import.meta.url),
    JSON.stringify({type: 'FeatureCollection', features}, (k, v) => typeof v === 'number' ? Math.round(v * 1e5) / 1e5 : v));
console.log('wrote public/data/waterways.geojson');
