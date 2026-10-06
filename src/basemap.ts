// Basemap from OpenFreeMap (free OpenStreetMap vector tiles, no API key and no
// view limits), combined with a hypsometric tint and hillshade computed in the
// browser from the same terrain tiles that drive the 3D view. Nothing here
// depends on the volunteer-run OSM or OpenTopoMap raster tile servers.

import type {ExpressionSpecification, LayerSpecification, SourceSpecification, StyleSpecification} from 'maplibre-gl';

export type Basemap = 'topo' | 'streets' | 'satellite';
export const BASEMAPS: Basemap[] = ['topo', 'streets', 'satellite'];

const STYLE_URL = 'https://tiles.openfreemap.org/styles/liberty';

export interface VectorBase {
    sprite?: StyleSpecification['sprite'];
    sources: Record<string, SourceSpecification>;
    /** fills/lines drawn under the app's overlays */
    under: LayerSpecification[];
    /** labels and icons drawn above the app's overlays */
    labels: LayerSpecification[];
}

// Land-cover fills only make sense on the "Streets" look; on Topo the tint does that job.
const STREET_ONLY = /^(park|park_outline|landuse_|landcover_)/;
const DROP = new Set(['background', 'natural_earth', 'building-3d']);

export async function loadVectorBase(): Promise<VectorBase> {
    try {
        const ctrl = new AbortController();
        const timer = setTimeout(() => ctrl.abort(), 8000);
        const style = await (await fetch(STYLE_URL, {signal: ctrl.signal})).json() as StyleSpecification;
        clearTimeout(timer);
        const sources: Record<string, SourceSpecification> = {};
        for (const [id, src] of Object.entries(style.sources)) if (id !== 'ne2_shaded') sources[id] = src;
        const under: LayerSpecification[] = [];
        const labels: LayerSpecification[] = [];
        for (const l of style.layers) {
            if (DROP.has(l.id)) continue;
            const layer = {...l, id: `ofm-${l.id}`} as LayerSpecification;
            (layer.type === 'symbol' ? labels : under).push(layer);
        }
        return {sprite: style.sprite, sources, under, labels};
    } catch (err) {
        console.warn('OpenFreeMap style unavailable; continuing with terrain-only basemap', err);
        return {sources: {}, under: [], labels: []};
    }
}

/** Hypsometric tint (metres) tuned for the Mojave/Sonoran deserts: muted, warm, low contrast. */
export const RELIEF_COLORS: ExpressionSpecification = [
    'interpolate', ['linear'], ['elevation'],
    -80, '#c6d8bd',
    0, '#d5dfbe',
    150, '#e2e2bf',
    400, '#e7dbb6',
    700, '#dcc7a0',
    1000, '#cfb48e',
    1400, '#c2a383',
    1900, '#b3977f',
    2500, '#a99686',
    3200, '#dcd8d3'
];

export function basemapVisibility(base: VectorBase, b: Basemap) {
    const out: [string, 'visible' | 'none'][] = [
        ['base-relief', b === 'topo' ? 'visible' : 'none'],
        ['base-satellite', b === 'satellite' ? 'visible' : 'none']
    ];
    for (const l of base.under) {
        const orig = l.id.replace(/^ofm-/, '');
        if (STREET_ONLY.test(orig)) out.push([l.id, b === 'streets' ? 'visible' : 'none']);
    }
    return out;
}

export function isRoadLayer(id: string) {
    return /^ofm-(road|bridge|tunnel)_/.test(id);
}
