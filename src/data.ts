// Data loading and the elevation/storage relationships derived from it.

export interface DailyData {
    source: string;
    url: string;
    fetched: string;
    recordLow: {date: string; elevation: number};
    recordHigh: {date: string; elevation: number};
    firstDate: string;
    rows: [string, number, number | null, number | null][];
}

export interface ForecastPoint {
    date: string;
    elevationFt: number;
    storageKaf: number;
    hooverCapacityMw?: number;
}

export interface Scenario {
    id: ScenarioId;
    label: string;
    study: string;
    url: string;
    note: string;
    series: ForecastPoint[];
}

export type ScenarioId = 'most' | 'min' | 'max';

export interface ForecastData {
    source: string;
    url: string;
    scenarios: Scenario[];
    pointForecasts: {date: string; elevationFt: number; label: string; url: string}[];
}

export interface BathyMeta {
    z: number;
    px0: number;
    py0: number;
    width: number;
    height: number;
    bounds: [number, number, number, number];
    wEncoding: {offsetFt: number; scale: number; none: number};
    fullPoolFt: number;
    /** [elevation ft, surface area acres, total volume acre-feet] */
    curve: [number, number, number][];
}

export interface Series {
    t: number[];
    v: number[];
}

export interface AppData {
    daily: DailyData;
    forecast: ForecastData;
    meta: BathyMeta;
    regions: GeoJSON.FeatureCollection;
    observed: Series;
    lastObserved: {date: string; t: number; elevation: number; storage: number};
    scenarioSeries: Record<ScenarioId, Series>;
    /** USBR live storage / bathymetry-derived live storage at the latest observation */
    storageCalibration: number;
}

const DAY = 86400000;
export const toT = (d: string) => Date.parse(d + 'T12:00:00Z');
export const fromT = (t: number) => new Date(t).toISOString().slice(0, 10);

async function json<T>(url: string): Promise<T> {
    const res = await fetch(url);
    if (!res.ok) throw new Error(`${url}: HTTP ${res.status}`);
    return res.json() as Promise<T>;
}

export async function loadData(): Promise<AppData> {
    const base = import.meta.env.BASE_URL + 'data/';
    const [daily, forecast, meta, regions] = await Promise.all([
        json<DailyData>(base + 'mead_daily.json'),
        json<ForecastData>(base + 'forecast.json'),
        json<BathyMeta>(base + 'mead_meta.json'),
        json<GeoJSON.FeatureCollection>(base + 'regions.geojson')
    ]);

    const observed: Series = {t: [], v: []};
    for (const [d, e] of daily.rows) {
        observed.t.push(toT(d));
        observed.v.push(e);
    }
    const last = daily.rows[daily.rows.length - 1];
    const lastObserved = {date: last[0], t: toT(last[0]), elevation: last[1], storage: last[2] ?? NaN};

    // Forecast series start from today's observation and continue with the
    // study's month-end values after it.
    const scenarioSeries = {} as Record<ScenarioId, Series>;
    for (const s of forecast.scenarios) {
        const t = [lastObserved.t];
        const v = [lastObserved.elevation];
        for (const p of s.series) {
            const pt = toT(p.date);
            if (pt > lastObserved.t + 5 * DAY) {
                t.push(pt);
                v.push(p.elevationFt);
            }
        }
        scenarioSeries[s.id] = {t, v};
    }

    const app: AppData = {
        daily, forecast, meta, regions, observed, lastObserved, scenarioSeries, storageCalibration: 1
    };
    const derived = rawLiveStorageAf(app, lastObserved.elevation);
    if (Number.isFinite(lastObserved.storage) && derived > 0) app.storageCalibration = lastObserved.storage / derived;
    return app;
}

/** Linear interpolation of a time series; clamps at the ends. */
export function sample(s: Series, t: number): number {
    const {t: ts, v} = s;
    if (t <= ts[0]) return v[0];
    if (t >= ts[ts.length - 1]) return v[v.length - 1];
    let lo = 0, hi = ts.length - 1;
    while (hi - lo > 1) {
        const mid = (lo + hi) >> 1;
        if (ts[mid] <= t) lo = mid; else hi = mid;
    }
    const f = (t - ts[lo]) / (ts[hi] - ts[lo]);
    return v[lo] + f * (v[hi] - v[lo]);
}

export function elevationAt(app: AppData, t: number, scenario: ScenarioId): number {
    if (t <= app.lastObserved.t) return sample(app.observed, t);
    return sample(app.scenarioSeries[scenario], t);
}

export function isForecast(app: AppData, t: number) {
    return t > app.lastObserved.t;
}

function curveAt(app: AppData, h: number, col: 1 | 2): number {
    const c = app.meta.curve;
    if (h <= c[0][0]) return c[0][col] * Math.max(0, (h - 860) / (c[0][0] - 860 || 1));
    if (h >= c[c.length - 1][0]) return c[c.length - 1][col];
    const i = Math.floor(h - c[0][0]);
    const a = c[i], b = c[Math.min(i + 1, c.length - 1)];
    const f = (h - a[0]) / ((b[0] - a[0]) || 1);
    return a[col] + f * (b[col] - a[col]);
}

export const DEAD_POOL = 895;
export const MIN_POWER_POOL = 950;
export const FULL_POOL = 1229;

function rawLiveStorageAf(app: AppData, h: number) {
    return Math.max(0, curveAt(app, h, 2) - curveAt(app, DEAD_POOL, 2));
}

/** Live storage above dead pool (895 ft), acre-feet, calibrated to USBR's reported storage. */
export function liveStorageAf(app: AppData, h: number) {
    return rawLiveStorageAf(app, h) * app.storageCalibration;
}

export function surfaceAreaAcres(app: AppData, h: number) {
    return curveAt(app, h, 1);
}
