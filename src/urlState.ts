// Shareable state in the URL hash, e.g.
//   #level=950&rules=2027&cam=-114.52,36.00,9.35,62,8
//   #date=2028-06-30&fc=min&map=satellite&region=phx
// Defaults are omitted so the plain URL stays clean.

import type {ScenarioId} from './data';
import type {Regime} from './impacts';
import {BASEMAPS, type Basemap} from './basemap';

export interface Camera {
    center: [number, number];
    zoom: number;
    pitch: number;
    bearing: number;
}

export interface UrlState {
    date?: string;
    level?: number;
    rules?: Regime;
    fc?: ScenarioId;
    cam?: Camera;
    map?: Basemap;
    region?: string;
    embed?: boolean;
    about?: boolean;
}

const SCENARIOS: ScenarioId[] = ['most', 'min', 'max'];

export function readUrl(hash = location.hash): UrlState {
    const p = new URLSearchParams(hash.replace(/^#/, ''));
    const out: UrlState = {};
    const date = p.get('date');
    if (date && /^\d{4}-\d{2}-\d{2}$/.test(date)) out.date = date;
    const level = parseFloat(p.get('level') ?? '');
    if (Number.isFinite(level)) out.level = level;
    const rules = p.get('rules');
    if (rules === '2007' || rules === '2027') out.rules = rules;
    const fc = p.get('fc') as ScenarioId | null;
    if (fc && SCENARIOS.includes(fc)) out.fc = fc;
    const cam = (p.get('cam') ?? '').split(',').map(Number);
    if (cam.length === 5 && cam.every(Number.isFinite)) {
        out.cam = {center: [cam[0], cam[1]], zoom: cam[2], pitch: cam[3], bearing: cam[4]};
    }
    const map = p.get('map') as Basemap | null;
    if (map && BASEMAPS.includes(map)) out.map = map;
    const region = p.get('region');
    if (region && /^[a-z]+$/.test(region)) out.region = region;
    if (p.get('embed') === '1') out.embed = true;
    if (p.has('about')) out.about = true;
    return out;
}

export function toHash(s: UrlState): string {
    const p = new URLSearchParams();
    if (s.level !== undefined) p.set('level', String(Math.round(s.level * 10) / 10));
    else if (s.date) p.set('date', s.date);
    if (s.rules) p.set('rules', s.rules);
    if (s.fc) p.set('fc', s.fc);
    if (s.map) p.set('map', s.map);
    if (s.region) p.set('region', s.region);
    if (s.cam) {
        const c = s.cam;
        p.set('cam', [c.center[0].toFixed(4), c.center[1].toFixed(4), c.zoom.toFixed(2), Math.round(c.pitch), Math.round(c.bearing)].join(','));
    }
    if (s.embed) p.set('embed', '1');
    const str = p.toString().replace(/%2C/g, ',');
    return str ? '#' + str : '';
}

let pending = 0;
/** Replace the current URL (no history entry), throttled. */
export function writeUrl(s: UrlState) {
    clearTimeout(pending);
    pending = window.setTimeout(() => {
        const hash = toHash(s);
        if (hash !== location.hash && !(hash === '' && location.hash === '')) {
            history.replaceState(null, '', location.pathname + location.search + hash);
        }
    }, 250);
}

export function absoluteUrl(s: UrlState) {
    return location.origin + location.pathname + toHash(s);
}
