// Build public/data/regions.geojson: the areas that depend on Lake Mead, the
// aqueducts that carry its water, and point features (dams, intakes).
//
//   node scripts/build_regions.mjs
//
// Municipal service areas are unions of US Census county boundaries (us-atlas,
// 1:10m). Irrigation districts and aqueduct alignments are hand-traced,
// simplified outlines -- schematic, good to a few km, not survey boundaries.
// Rivers and canals are built separately by scripts/build_waterways.mjs.

import {readFile, writeFile} from 'node:fs/promises';
import {feature} from 'topojson-client';
import {union} from '@turf/union';
import {bboxClip} from '@turf/bbox-clip';
import {simplify} from '@turf/simplify';
import {featureCollection, polygon, lineString, point} from '@turf/helpers';

const topo = JSON.parse(await readFile(new URL('../node_modules/us-atlas/counties-10m.json', import.meta.url)));
const counties = feature(topo, topo.objects.counties).features;
const byFips = new Map(counties.map(f => [String(f.id).padStart(5, '0'), f]));

function countyUnion(list) {
    const parts = list.map(([fips, clip]) => {
        const f = byFips.get(fips);
        if (!f) throw new Error(`missing county ${fips}`);
        return clip ? bboxClip(f, clip) : f;
    });
    const merged = parts.length === 1 ? parts[0] : union(featureCollection(parts));
    return simplify(merged, {tolerance: 0.004, highQuality: true}).geometry;
}

// [lon, lat] rings, closed automatically.
const ring = pts => [[...pts, pts[0]]];

const regions = [
    {
        id: 'socal',
        geometry: countyUnion([
            ['06037'], ['06059'], ['06073'], ['06111'],
            // Western Riverside / SW San Bernardino = Inland Empire part of MWD
            ['06065', [-118, 33.3, -116.85, 34.1]],
            ['06071', [-118, 33.8, -116.95, 34.32]]
        ])
    },
    {id: 'phx', geometry: countyUnion([['04013'], ['04019']])},
    {
        id: 'lv',
        geometry: {type: 'Polygon', coordinates: ring([
            [-115.40, 36.30], [-115.27, 36.36], [-115.08, 36.33], [-114.93, 36.22], [-114.90, 36.10],
            [-114.96, 36.00], [-115.08, 35.94], [-115.25, 35.96], [-115.38, 36.07]
        ])}
    },
    {
        id: 'pinal',
        geometry: {type: 'Polygon', coordinates: ring([
            [-112.10, 33.08], [-111.85, 33.12], [-111.58, 33.10], [-111.42, 32.92], [-111.40, 32.75],
            [-111.58, 32.62], [-111.85, 32.66], [-112.05, 32.78], [-112.15, 32.95]
        ])}
    },
    {
        id: 'yuma',
        geometry: {type: 'Polygon', coordinates: ring([
            [-114.82, 32.76], [-114.75, 32.86], [-114.60, 32.86], [-114.45, 32.78], [-114.25, 32.80],
            [-114.00, 32.80], [-113.85, 32.74], [-114.00, 32.66], [-114.35, 32.67], [-114.52, 32.60],
            [-114.70, 32.45], [-114.81, 32.50]
        ])}
    },
    {
        id: 'crit',
        geometry: {type: 'Polygon', coordinates: ring([
            [-114.42, 34.17], [-114.22, 34.14], [-114.20, 34.00], [-114.32, 33.86], [-114.50, 33.84],
            [-114.55, 33.97]
        ])}
    },
    {
        id: 'pvid',
        geometry: {type: 'Polygon', coordinates: ring([
            [-114.76, 33.74], [-114.62, 33.76], [-114.52, 33.70], [-114.50, 33.52], [-114.56, 33.40],
            [-114.68, 33.42], [-114.74, 33.55]
        ])}
    },
    {
        id: 'iid',
        geometry: {type: 'Polygon', coordinates: ring([
            [-115.80, 32.71], [-115.55, 32.69], [-115.32, 32.69], [-115.25, 32.85], [-115.30, 33.03],
            [-115.42, 33.22], [-115.53, 33.27], [-115.62, 33.15], [-115.72, 33.08], [-115.82, 32.95],
            [-115.86, 32.82]
        ])}
    },
    {
        id: 'cvwd',
        geometry: {type: 'Polygon', coordinates: ring([
            [-116.56, 33.88], [-116.40, 33.95], [-116.22, 33.85], [-116.08, 33.72], [-115.96, 33.56],
            [-116.00, 33.45], [-116.12, 33.48], [-116.25, 33.62], [-116.42, 33.73], [-116.58, 33.80]
        ])}
    },
    {
        id: 'mexico',
        geometry: {type: 'Polygon', coordinates: ring([
            [-115.62, 32.66], [-115.20, 32.68], [-114.81, 32.50], [-114.80, 32.20], [-115.05, 31.95],
            [-115.35, 31.95], [-115.55, 32.15], [-115.66, 32.40]
        ])}
    }
];

// River and canal alignments come from OpenStreetMap via scripts/build_waterways.mjs;
// only the short SNWA intake pipeline is drawn here.
const aqueducts = [
    {
        id: 'snwa', name: 'SNWA intake pipelines', to: 'lv',
        coords: [[-114.79, 36.075], [-114.88, 36.06], [-114.97, 36.07], [-115.08, 36.12]]
    }
];

const points = [
    {id: 'hoover', kind: 'dam', name: 'Hoover Dam', coords: [-114.7377, 36.0161]},
    {id: 'davis', kind: 'dam', name: 'Davis Dam', coords: [-114.5710, 35.1970]},
    {id: 'parker', kind: 'dam', name: 'Parker Dam', coords: [-114.1397, 34.2961]},
    {id: 'imperial', kind: 'dam', name: 'Imperial Dam', coords: [-114.4650, 32.8830]},
    {id: 'intakes', kind: 'intake', name: 'SNWA Intakes 1–3', coords: [-114.7930, 36.0760]},
    {id: 'wilmer', kind: 'intake', name: 'CAP Mark Wilmer Pumping Plant', coords: [-114.1300, 34.3020]},
    {id: 'whitsett', kind: 'intake', name: 'MWD Whitsett Intake', coords: [-114.1560, 34.3170]}
];

const basinLabels = [
    {name: 'Boulder Basin', coords: [-114.76, 36.07]},
    {name: 'Virgin Basin', coords: [-114.36, 36.13]},
    {name: 'Overton Arm', coords: [-114.40, 36.38]},
    {name: 'Gregg Basin', coords: [-114.13, 36.06]},
    {name: 'Las Vegas Bay', coords: [-114.89, 36.12]}
];

const features = [
    ...regions.map(r => ({type: 'Feature', properties: {layer: 'region', id: r.id}, geometry: r.geometry})),
    ...aqueducts.map(a => lineString(a.coords, {layer: 'aqueduct', id: a.id, name: a.name, to: a.to})),
    ...points.map(p => point(p.coords, {layer: 'poi', id: p.id, kind: p.kind, name: p.name})),
    ...basinLabels.map(b => point(b.coords, {layer: 'basin', name: b.name}))
];

await writeFile(new URL('../public/data/regions.geojson', import.meta.url), JSON.stringify(featureCollection(features)));
console.log(`wrote ${features.length} features`);
