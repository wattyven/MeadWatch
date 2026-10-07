import 'maplibre-gl/dist/maplibre-gl.css';
import './style.css';
import {
    type AppData, type ScenarioId, DEAD_POOL, FULL_POOL, MIN_POWER_POOL,
    elevationAt, hooverReleaseMaf, isForecast, liveStorageAf, loadData, sample, surfaceAreaAcres, toT
} from './data';
import {
    DECLARED_TIERS, type DownstreamLake, type Flow, HOOVER_NAMEPLATE, REGIONS, type Regime, type RegionImpact, SEVERITY_STOPS,
    type Shortage, US_REGIONS, downstreamFlows, downstreamLakes, fmtAf, hooverCapacityMw, regimeLabel, regionImpacts,
    severityColor, severityLabel, shortageFor
} from './impacts';
import {loadRaster, registerTerrainProtocol} from './terrain';
import {type Basemap, type MapHandles, type ViewId, createMap} from './map';
import {type Span, Timeline} from './timeline';
import {type Camera, type UrlState, absoluteUrl, readUrl, writeUrl} from './urlState';

interface State {
    mode: 'timeline' | 'manual';
    t: number;
    scenario: ScenarioId;
    manualElev: number;
    manualRegime: Regime;
    selected: string | null;
    basemap: Basemap;
    embed: boolean;
    span: Span;
}

/** Regions whose share of a state cut is our approximation, not a published allocation */
const ESTIMATED_SPLIT = new Set(['phx', 'pinal', 'socal', 'iid', 'cvwd', 'pvid']);

const $ = <T extends HTMLElement = HTMLElement>(sel: string) => document.querySelector(sel) as T;
const nf = new Intl.NumberFormat('en-US');
const n1 = new Intl.NumberFormat('en-US', {minimumFractionDigits: 1, maximumFractionDigits: 1});
const dateFmt = new Intl.DateTimeFormat('en-US', {month: 'short', day: 'numeric', year: 'numeric', timeZone: 'UTC'});

async function main() {
    const app = await loadData();
    const base = import.meta.env.BASE_URL + 'data/';
    const floorP = loadRaster(base + 'mead_floor.png');
    registerTerrainProtocol(app.meta, floorP);
    const [wR, floorR] = await Promise.all([loadRaster(base + 'mead_w.png'), floorP]);

    const url = readUrl();
    const state: State = {
        mode: 'timeline',
        t: app.lastObserved.t,
        scenario: 'most',
        manualElev: Math.round(app.lastObserved.elevation * 2) / 2,
        manualRegime: '2027',
        selected: null,
        basemap: 'topo',
        embed: false,
        span: 'all'
    };
    applyUrl(app, state, url);
    if (state.embed) document.body.classList.add('embed');
    $('#embed-bar').hidden = !state.embed;

    const brand = $('.brand');
    new ResizeObserver(() => document.documentElement.style.setProperty('--brand-h', `${brand.offsetHeight}px`)).observe(brand);

    const mapH = await createMap($('#map'), app, wR, floorR, {camera: url.cam, basemap: state.basemap});
    const initialCam = mapH.getCamera();
    const sameCam = (a: Camera, b: Camera) => Math.abs(a.center[0] - b.center[0]) < 1e-4 && Math.abs(a.center[1] - b.center[1]) < 1e-4
        && Math.abs(a.zoom - b.zoom) < 0.01 && Math.abs(a.pitch - b.pitch) < 0.5 && Math.abs(a.bearing - b.bearing) < 0.5;
    (window as unknown as {mead: unknown}).mead = {map: mapH.map, state, app};
    setSeg('basemap', state.basemap);
    if (state.selected) mapH.selectRegion(state.selected, !url.cam);

    const urlState = (): UrlState => ({
        date: state.mode === 'timeline' && Math.abs(state.t - app.lastObserved.t) > 43200000 ? new Date(state.t).toISOString().slice(0, 10) : undefined,
        level: state.mode === 'manual' ? state.manualElev : undefined,
        rules: state.mode === 'manual' && state.manualRegime !== '2027' ? state.manualRegime : undefined,
        fc: state.scenario !== 'most' ? state.scenario : undefined,
        map: state.basemap !== 'topo' ? state.basemap : undefined,
        region: state.selected ?? undefined,
        span: state.span,
        cam: url.cam || !sameCam(mapH.getCamera(), initialCam) ? mapH.getCamera() : undefined,
        embed: state.embed || undefined
    });
    mapH.map.on('moveend', () => writeUrl(urlState()));
    window.addEventListener('hashchange', () => {
        const u = readUrl();
        applyUrl(app, state, u);
        if (u.cam) mapH.map.jumpTo(u.cam);
        mapH.setBasemap(state.basemap);
        setSeg('basemap', state.basemap);
        mapH.selectRegion(state.selected, false);
        update();
    });

    const timeline = new Timeline($('#tl-chart'), app, {
        onScrub(t) {
            stopPlay();
            state.mode = 'timeline';
            state.t = t;
            update();
        }
    });

    renderAlert(app);
    renderLegend();
    wireControls(app, state, mapH, update);
    wireDialogs(app, () => absoluteUrl({...urlState(), embed: undefined}), () => absoluteUrl({...urlState(), embed: true}));
    if (url.about) ($('#about-dialog') as HTMLDialogElement).showModal();
    mapH.onRegionClick(id => select(id));

    function select(id: string | null) {
        state.selected = state.selected === id ? null : id;
        mapH.selectRegion(state.selected);
        update();
    }

    // ---- playback
    let raf = 0;
    const playBtn = $('#play');
    function stopPlay() {
        if (!raf) return;
        cancelAnimationFrame(raf);
        raf = 0;
        playBtn.classList.remove('is-playing');
        playBtn.setAttribute('aria-label', 'Play timeline');
    }
    playBtn.addEventListener('click', () => {
        if (raf) return stopPlay();
        state.mode = 'timeline';
        if (state.t >= timeline.end - 86400000 || state.t < timeline.start) state.t = timeline.start;
        const msPerMs = (timeline.end - timeline.start) / 22000; // the whole range plays in ~22 s
        playBtn.classList.add('is-playing');
        playBtn.setAttribute('aria-label', 'Pause timeline');
        let last = performance.now();
        const step = (now: number) => {
            const dt = Math.min(64, now - last);
            last = now;
            state.t += dt * msPerMs;
            if (state.t >= timeline.end) {
                state.t = timeline.end;
                update();
                return stopPlay();
            }
            update();
            raf = requestAnimationFrame(step);
        };
        raf = requestAnimationFrame(step);
    });
    $('#today').addEventListener('click', () => {
        stopPlay();
        state.mode = 'timeline';
        state.t = app.lastObserved.t;
        update();
    });

    function update() {
        const d = derive(app, state);
        mapH.setLevel(d.elevation);
        mapH.updateImpacts(d.impacts);
        mapH.updateFlows(d.flows);
        timeline.set(state.t, state.scenario, state.mode === 'manual', d.elevation, state.span);
        renderMetrics(app, state, d);
        renderImpacts(app, state, d, select);
        if (state.embed) renderEmbedBar(d, absoluteUrl({...urlState(), embed: undefined}));
        syncControls(state, d.elevation);
        writeUrl(urlState());
    }

    update();
    $('#loading').classList.add('done');
}

function applyUrl(app: AppData, s: State, u: UrlState) {
    if (u.fc) s.scenario = u.fc;
    if (u.rules) s.manualRegime = u.rules;
    if (u.map) s.basemap = u.map;
    s.span = u.span ?? 'all';
    s.embed = !!u.embed;
    s.selected = u.region && REGIONS.some(r => r.id === u.region) ? u.region : null;
    if (u.level !== undefined) {
        s.mode = 'manual';
        s.manualElev = Math.max(870, Math.min(FULL_POOL, u.level));
    } else {
        s.mode = 'timeline';
        s.t = u.date ? Math.max(app.observed.t[0], Math.min(toT(u.date), lastForecastT(app))) : app.lastObserved.t;
        if (s.span === 'recent' && s.t < toT('2021-10-01')) s.span = 'all';
    }
}

function lastForecastT(app: AppData) {
    return Math.max(...Object.values(app.scenarioSeries).map(x => x.t[x.t.length - 1]));
}

function renderEmbedBar(d: Derived, fullUrl: string) {
    $('#embed-bar').innerHTML = `
        <div class="eb-main">
            <span class="eb-brand">MeadWatch</span>
            <span class="eb-elev">${n1.format(d.elevation)} ft</span>
            <span class="eb-sub">${d.source} · ${d.dateLabel.split(' · ')[0]} · ${d.shortage.tier}</span>
        </div>
        <a class="eb-link" href="${fullUrl}" target="_blank" rel="noopener">Open full app ↗</a>`;
}

let toastTimer = 0;
function toast(msg: string) {
    const el = $('#toast');
    el.textContent = msg;
    el.classList.add('show');
    clearTimeout(toastTimer);
    toastTimer = window.setTimeout(() => el.classList.remove('show'), 2200);
}

function wireDialogs(app: AppData, link: () => string, embedLink: () => string) {
    const share = $('#share-dialog') as HTMLDialogElement;
    const about = $('#about-dialog') as HTMLDialogElement;
    $('#share-btn').addEventListener('click', () => {
        $<HTMLInputElement>('#share-link').value = link();
        $<HTMLTextAreaElement>('#share-embed').value =
            `<iframe src="${embedLink()}" width="100%" height="560" style="border:0;border-radius:12px" title="MeadWatch: Lake Mead drought explorer" loading="lazy" allowfullscreen></iframe>`;
        share.showModal();
    });
    share.querySelectorAll<HTMLButtonElement>('[data-copy]').forEach(b => b.addEventListener('click', async () => {
        const field = $<HTMLInputElement>('#' + b.dataset.copy);
        try {
            await navigator.clipboard.writeText(field.value);
            toast(b.dataset.copy === 'share-link' ? 'Link copied' : 'Embed code copied');
        } catch {
            field.select();
            toast('Press Ctrl/⌘+C to copy');
        }
    }));
    const fill = (k: string, v: string) => about.querySelectorAll(`[data-fill="${k}"]`).forEach(e => (e.textContent = v));
    fill('latest', `${n1.format(app.lastObserved.elevation)} ft on ${dateFmt.format(new Date(app.lastObserved.t))}`);
    fill('fetched', dateFmt.format(new Date(app.daily.fetched)));
    fill('scenarios', app.forecast.scenarios.map(x => `${x.label}${x.detail ? `, ${x.detail}` : ''} (${x.study})`).join('; '));
    $('#about-btn').addEventListener('click', () => about.showModal());
    for (const dlg of [share, about]) {
        dlg.addEventListener('click', e => { if (e.target === dlg) dlg.close(); });
    }
}

interface Derived {
    elevation: number;
    source: string;
    dateLabel: string;
    opYear: number | null;
    jan1: number;
    declared: boolean;
    shortage: Shortage;
    impacts: RegionImpact[];
    flows: Flow[];
    lakes: DownstreamLake[];
}

function derive(app: AppData, s: State): Derived {
    if (s.mode === 'manual') {
        const shortage = shortageFor(s.manualRegime, s.manualElev);
        return {
            elevation: s.manualElev, source: 'What-if level', dateLabel: 'Hypothetical lake level',
            opYear: null, jan1: s.manualElev, declared: false, shortage, impacts: regionImpacts(s.manualElev, shortage),
            flows: downstreamFlows(s.manualElev, shortage, null),
            lakes: downstreamLakes(s.manualElev, null, null, false)
        };
    }
    const elevation = elevationAt(app, s.t, s.scenario);
    const year = new Date(s.t).getUTCFullYear();
    const regime: Regime = year >= 2027 ? '2027' : year >= 2008 ? '2007' : 'pre2007';
    const jan1 = elevationAt(app, Date.UTC(year - 1, 11, 31, 12), s.scenario);
    let lookaheadMin = Infinity;
    for (let k = 0; k <= 12; k++) lookaheadMin = Math.min(lookaheadMin, elevationAt(app, s.t + k * 30.4 * 86400000, s.scenario));
    const declared = regime === '2007' ? DECLARED_TIERS[year] : undefined;
    const shortage = shortageFor(regime, jan1, {declaredTier: declared, lookaheadMin});
    const scen = app.forecast.scenarios.find(x => x.id === s.scenario)!;
    const fc = isForecast(app, s.t);
    return {
        elevation,
        source: fc ? `Forecast · ${scen.label}${scen.detail ? ` (${scen.detail.replace(' Powell release', '')})` : ''}` : 'Observed · USBR',
        dateLabel: dateFmt.format(new Date(s.t)) + (fc ? ` · ${scen.study} 24-Month Study` : ''),
        opYear: year, jan1, declared: !!declared, shortage, impacts: regionImpacts(elevation, shortage),
        flows: downstreamFlows(elevation, shortage, hooverReleaseMaf(app, s.t, s.scenario)),
        lakes: fc ? downstreamLakes(elevation, null, null, false)
            : downstreamLakes(elevation, app.mohave.t.length ? sample(app.mohave, s.t) : null, app.havasu.t.length ? sample(app.havasu, s.t) : null, true)
    };
}

// ---------------------------------------------------------------------------
// Rendering

function renderAlert(app: AppData) {
    const rl = app.daily.recordLow;
    const lo = app.lastObserved;
    $('#alert').innerHTML = `
        <span class="pulse" aria-hidden="true"></span>
        <span><b>Record low:</b> ${n1.format(rl.elevation)} ft on ${dateFmt.format(new Date(toT(rl.date)))}.
        Latest reading ${n1.format(lo.elevation)} ft (${dateFmt.format(new Date(lo.t))}).</span>`;
}

function renderLegend() {
    const sev = SEVERITY_STOPS.map(([v, c]) => `<span class="sev-chip" style="--c:${c}">${severityLabel(v)}</span>`).join('');
    $('#legend').innerHTML = `
        <div class="lg-row"><span class="lg-swatch water"></span>Water (shade = depth)</div>
        <div class="lg-row"><span class="lg-swatch bed"></span>Exposed lakebed (bands every 10 ft)</div>
        <div class="lg-row"><span class="lg-swatch shore"></span>Full-pool shoreline, 1,229 ft</div>
        <div class="lg-row"><span class="lg-swatch th"></span>Shoreline at Tier 1 · intakes · power · dead pool</div>
        <div class="lg-row"><span class="lg-swatch river"></span>Colorado River &amp; canals (OpenStreetMap)</div>
        <div class="lg-row"><span class="lg-swatch aq"></span>Buried aqueduct (approximate route)</div>
        <div class="lg-sev">${sev}</div>
        <div class="lg-note">Region colour = scheduled reduction in Colorado River water, or physical supply risk</div>`;
}

function stat(label: string, value: string, sub = '', bar: number | null = null, tone = '') {
    return `<div class="stat ${tone}">
        <dt>${label}</dt>
        <dd><span class="v">${value}</span>${sub ? `<span class="s">${sub}</span>` : ''}</dd>
        ${bar !== null ? `<div class="bar"><i style="width:${Math.max(0, Math.min(100, bar * 100)).toFixed(1)}%"></i></div>` : ''}
    </div>`;
}

function renderMetrics(app: AppData, s: State, d: Derived) {
    const h = d.elevation;
    const live = liveStorageAf(app, h), liveFull = liveStorageAf(app, FULL_POOL);
    const area = surfaceAreaAcres(app, h), areaFull = surfaceAreaAcres(app, FULL_POOL);
    const mw = hooverCapacityMw(h);
    const aboveMin = h - MIN_POWER_POOL, aboveDead = h - DEAD_POOL;
    const intakes = [1050, 1000, 860].filter(e => h > e + 5).length;
    const rl = app.daily.recordLow.elevation;
    const vsRecord = h - rl;
    const sh = d.shortage;
    const cuts = [['AZ', sh.az], ['CA', sh.ca], ['NV', sh.nv], ['MX', sh.mx]] as const;

    $('#metrics-body').innerHTML = `
        <div class="m-kicker ${d.source.startsWith('Forecast') ? 'fc' : d.source.startsWith('What') ? 'wi' : ''}">${d.source}</div>
        <div class="m-elev"><span class="m-big">${nf.format(Math.round(h * 10) / 10)}</span><span class="m-unit">ft</span></div>
        <div class="m-date">${d.dateLabel}</div>
        <div class="m-delta"><b>${n1.format(FULL_POOL - h)} ft</b> below full pool ·
            ${vsRecord < 0 ? `<b class="neg">${n1.format(-vsRecord)} ft below</b> the record low` : `${n1.format(vsRecord)} ft above the record low`}</div>
        <div class="m-grid">
            ${gauge(h)}
            <dl class="stats">
                ${stat('Live storage', `${(live / 1e6).toFixed(2)} MAF`, `${Math.round(live / liveFull * 100)}% of full`, live / liveFull)}
                ${stat('Surface area', `${nf.format(Math.round(area / 100) * 100)} ac`, `${Math.round(area / areaFull * 100)}% of full`, area / areaFull)}
                ${stat('Hoover Dam capacity <span class="est">est.</span>', `≈${nf.format(Math.round(mw / 10) * 10)} MW`, `${Math.round(mw / HOOVER_NAMEPLATE * 100)}% of 2,080 MW`, mw / HOOVER_NAMEPLATE, mw === 0 ? 'bad' : mw / HOOVER_NAMEPLATE < 0.6 ? 'warn' : '')}
                ${stat('Above min. power pool', aboveMin > 0 ? `${n1.format(aboveMin)} ft` : 'Below', '950 ft: turbines stop', null, aboveMin < 0 ? 'bad' : aboveMin < 60 ? 'warn' : '')}
                ${stat('Above dead pool', aboveDead > 0 ? `${n1.format(aboveDead)} ft` : 'Dead pool', '895 ft: no release downstream', null, aboveDead < 0 ? 'bad' : aboveDead < 80 ? 'warn' : '')}
                ${stat('SNWA intakes in water', `${intakes} of 3`, 'Las Vegas supply', null, intakes < 2 ? 'bad' : intakes < 3 ? 'warn' : '')}
            </dl>
        </div>
        <div class="op-card">
            <div class="op-head">
                <span>${d.opYear ? `${d.opYear} operating year` : 'Rules applied to this level'}</span>
                <span class="op-tier">${sh.tier}</span>
            </div>
            <div class="op-rules">${regimeLabel[sh.regime]}${d.declared ? ` · ${sh.tier === 'Normal' ? 'condition' : 'tier'} declared by Reclamation for ${d.opYear}`
                : d.opYear && sh.regime === '2007' ? ` · from ${n1.format(d.jan1)} ft on Jan 1` : ''}</div>
            <div class="op-cuts">${cuts.map(([k, v]) => `<div><span>${k}</span><b>${v === null ? '—' : v === 0 ? '0' : '−' + fmtAf(v)}</b></div>`).join('')}</div>
            <div class="op-unit">Scheduled reductions, acre-feet per year${sh.mx === null ? ' · Mexico: IBWC Minute 334, not modeled' : ''}</div>
            ${sh.consult ? `<div class="op-consult">${sh.consult}</div>` : ''}
        </div>`;
}

function gauge(h: number) {
    const top = 1240, bot = 860, H = 206, W = 74;
    const y = (e: number) => 8 + (top - Math.max(bot, Math.min(top, e))) / (top - bot) * (H - 16);
    const marks: [number, string, string][] = [
        [1229, 'Full', 'limit'], [1075, 'Tier 1', 'policy'], [1050, 'Intake 1', 'infra'], [1025, 'Tier 3', 'policy'],
        [1000, 'Intake 2', 'infra'], [950, 'Power', 'power'], [895, 'Dead', 'limit']
    ];
    return `<svg class="gauge" viewBox="0 0 ${W} ${H}" role="img" aria-label="Water level gauge: ${n1.format(h)} feet">
        <defs><linearGradient id="gw" x1="0" y1="0" x2="0" y2="1">
            <stop offset="0" stop-color="#6cc6d6"/><stop offset="1" stop-color="#0b3d6e"/></linearGradient></defs>
        <rect x="6" y="${y(top)}" width="18" height="${y(bot) - y(top)}" rx="4" class="g-tube"/>
        <rect x="6" y="${y(1229)}" width="18" height="${y(h) - y(1229)}" class="g-ring"/>
        <rect x="6" y="${y(h)}" width="18" height="${y(bot) - y(h)}" rx="0" fill="url(#gw)"/>
        ${marks.map(([e, l, k]) => `<line x1="3" x2="27" y1="${y(e)}" y2="${y(e)}" class="g-mark ${k}"/>
            <text x="31" y="${y(e) + 3.5}" class="g-label ${k}">${l}</text>`).join('')}
        <path d="M27 ${y(h)} l6 -4 v8z" class="g-ptr"/>
    </svg>`;
}

function renderImpacts(app: AppData, s: State, d: Derived, select: (id: string | null) => void) {
    const byId = new Map(d.impacts.map(i => [i.id, i]));
    const popAll = US_REGIONS.reduce((a, r) => a + r.population, 0);
    const acAll = US_REGIONS.reduce((a, r) => a + r.acres, 0);
    const hit = US_REGIONS.filter(r => byId.get(r.id)!.waterAffected);
    const popHit = hit.reduce((a, r) => a + r.population, 0);
    const acHit = hit.reduce((a, r) => a + r.acres, 0);
    const powerLoss = 1 - hooverCapacityMw(d.elevation) / HOOVER_NAMEPLATE;

    const sorted = [...REGIONS].sort((a, b) => (byId.get(b.id)!.severity ?? -1) - (byId.get(a.id)!.severity ?? -1));
    const sel = s.selected ? REGIONS.find(r => r.id === s.selected) : null;
    const selImp = sel ? byId.get(sel.id)! : null;

    $('#impacts-body').innerHTML = `
        <h2>Who depends on Lake Mead</h2>
        <p class="sub">≈${(popAll / 1e6).toFixed(0)} million people and ≈${(acAll / 1e6).toFixed(2)} million irrigated acres in Arizona,
            California and Nevada, plus Mexico. Basin-wide, the Colorado River serves ~40 million people and ~5 million acres.</p>
        <div class="kpis">
            <div><b>${(popHit / 1e6).toFixed(1)}M</b><span>people facing water cuts or supply risk</span></div>
            <div><b>${acHit >= 1e6 ? (acHit / 1e6).toFixed(2) + 'M' : nf.format(Math.round(acHit / 1000)) + 'k'}</b><span>irrigated acres facing cuts</span></div>
            <div><b>${Math.round(powerLoss * 100)}%</b><span>of Hoover capacity lost</span></div>
        </div>
        ${flowSection(d)}
        <ul class="regions">
            ${sorted.map(r => {
                const imp = byId.get(r.id)!;
                const col = severityColor(imp.severity);
                const kind = r.kind === 'farm' ? 'Farms' : r.kind === 'city' ? 'Cities' : r.kind === 'intl' ? 'Mexico' : 'Cities + farms';
                return `<li><button class="rg ${s.selected === r.id ? 'is-sel' : ''}" data-id="${r.id}" style="--c:${col}">
                    <span class="rg-dot"></span>
                    <span class="rg-main">
                        <span class="rg-name">${r.short}<span class="rg-kind">${kind}</span><span class="rg-sev">${severityLabel(imp.severity)}</span></span>
                        <span class="rg-status">${imp.status}${ESTIMATED_SPLIT.has(r.id) && (imp.cutAf ?? 0) > 0 ? ' <span class="est">est.</span>' : ''}</span>
                        <span class="rg-meta">${r.population ? `${fmtPeople(r.population)} people` : ''}${r.population && r.acres ? ' · ' : ''}${r.acres ? `${nf.format(r.acres)} acres` : ''}</span>
                    </span>
                    <span class="rg-bar"><i style="height:${Math.round((imp.severity ?? 0) * 100)}%"></i></span>
                </button></li>`;
            }).join('')}
        </ul>
        <p class="est-note"><span class="est">est.</span> = our split of a state-level cut, not an official allocation. <button class="btn-link" data-about>Methods</button></p>
        ${sel && selImp ? `<div class="rg-detail" style="--c:${severityColor(selImp.severity)}">
            <div class="rg-detail-head"><b>${sel.name}</b><button class="btn-link" data-close>Close</button></div>
            <p>${sel.blurb}</p>
            <dl>
                <dt>Dependence</dt><dd>${sel.dependence}</dd>
                ${sel.hooverShare ? `<dt>Hydropower</dt><dd>${sel.hooverShare}. At this level Hoover has lost ~${Math.round((selImp.powerLossFrac ?? 0) * 100)}% of its capacity.</dd>` : ''}
                ${selImp.physical ? `<dt>Infrastructure</dt><dd>${selImp.physical}</dd>` : ''}
                <dt>How this is estimated</dt><dd>${sel.basis}</dd>
            </dl>
        </div>` : ''}`;

    $('#impacts-body').querySelectorAll<HTMLButtonElement>('.rg').forEach(b => b.addEventListener('click', () => select(b.dataset.id!)));
    $('#impacts-body').querySelector('[data-close]')?.addEventListener('click', () => select(null));
    $('#impacts-body').querySelector('[data-about]')?.addEventListener('click', () => ($('#about-dialog') as HTMLDialogElement).showModal());
    void app;
}

function flowSection(d: Derived) {
    const r1 = d.flows.find(f => f.id === 'r1')!;
    const note = d.flows[0].note;
    const row = (f: Flow) => {
        const pct = Math.round(f.ratio * 100);
        const tone = f.dry ? 'bad' : f.ratio < 0.7 ? 'warn' : '';
        return `<li class="fl ${tone}">
            <span class="fl-name">${f.short}${f.observed ? ' <span class="obs">USBR</span>' : ' <span class="est">est.</span>'}</span>
            <span class="fl-val">${f.dry ? 'Dry' : `${f.maf.toFixed(2)} <small>MAF/yr</small>`}</span>
            <span class="fl-bar"><i style="width:${Math.min(100, pct)}%"></i></span>
            <span class="fl-pct">${f.dry ? '0%' : `${pct}%`}</span>
        </li>`;
    };
    return `<section class="flows" aria-label="Downstream river and canal flows">
        <h3>River &amp; canal flows <span class="sub2">vs. normal (pre-shortage) deliveries</span></h3>
        <ul>${d.flows.map(row).join('')}</ul>
        ${note ? `<p class="fl-note bad">${note}</p>` : r1.observed
            ? `<p class="fl-note">Hoover release over the past year: ${r1.maf.toFixed(2)} MAF (USBR${d.source.startsWith('Forecast') ? ' + 24-Month Study' : ''}). Canal flows are scheduled deliveries after cuts.</p>`
            : `<p class="fl-note">Scheduled deliveries after this level’s cuts; actual releases also reflect voluntary conservation.</p>`}
        <div class="lakes">${d.lakes.map(l => `<div class="lake ${l.status.startsWith('No inflow') ? 'bad' : ''}">
            <b>${l.name}</b> <span>${l.elevation !== null ? `${n1.format(l.elevation)} ft` : `normal ${l.range[0]}–${l.range[1]} ft`}</span>
            <small>${l.dam} · ${l.status}</small></div>`).join('')}</div>
    </section>`;
}

function fmtPeople(n: number) {
    return n >= 1e6 ? `${(n / 1e6).toFixed(1)}M` : `${Math.round(n / 1000)}k`;
}

// ---------------------------------------------------------------------------
// Controls

function setSeg(id: string, v: string) {
    document.querySelectorAll<HTMLButtonElement>(`#${id} button`).forEach(b => {
        const on = b.dataset.v === v;
        b.classList.toggle('on', on);
        if (b.hasAttribute('role')) b.setAttribute('aria-checked', String(on));
    });
}

function syncControls(s: State, elevation: number) {
    setSeg('mode', s.mode);
    setSeg('regime', s.manualRegime);
    setSeg('span', s.span);
    const sel = $<HTMLSelectElement>('#scenario');
    if (sel.value !== s.scenario) sel.value = s.scenario;
    $('#regime').hidden = s.mode !== 'manual';
    $('#scenario-field').classList.toggle('dim', s.mode === 'manual');
    const slider = $<HTMLInputElement>('#elev-slider');
    const input = $<HTMLInputElement>('#elev-input');
    const v = (Math.round(elevation * 10) / 10).toFixed(1);
    if (document.activeElement !== slider) slider.value = v;
    if (document.activeElement !== input) input.value = v;
    document.body.classList.toggle('is-manual', s.mode === 'manual');
}

function wireControls(app: AppData, s: State, m: MapHandles, update: () => void) {
    document.querySelectorAll<HTMLButtonElement>('#basemap button').forEach(b => b.addEventListener('click', () => {
        s.basemap = b.dataset.v as Basemap;
        setSeg('basemap', s.basemap);
        m.setBasemap(s.basemap);
        update();
    }));
    document.querySelectorAll<HTMLButtonElement>('#views button').forEach(b => b.addEventListener('click', () => m.setView(b.dataset.v as ViewId)));
    $<HTMLInputElement>('#terrain').addEventListener('change', e => m.setTerrain((e.target as HTMLInputElement).checked));
    $<HTMLInputElement>('#ghost').addEventListener('change', e => m.water.setGhost((e.target as HTMLInputElement).checked));

    document.querySelectorAll<HTMLButtonElement>('#mode button').forEach(b => b.addEventListener('click', () => {
        const v = b.dataset.v as State['mode'];
        if (v === 'manual' && s.mode !== 'manual') s.manualElev = Math.round(elevationAt(app, s.t, s.scenario) * 2) / 2;
        s.mode = v;
        update();
    }));
    document.querySelectorAll<HTMLButtonElement>('#span button').forEach(b => b.addEventListener('click', () => {
        s.span = b.dataset.v as Span;
        update();
    }));
    document.querySelectorAll<HTMLButtonElement>('#regime button').forEach(b => b.addEventListener('click', () => {
        s.manualRegime = b.dataset.v as Regime;
        update();
    }));
    $<HTMLSelectElement>('#scenario').addEventListener('change', e => {
        s.scenario = (e.target as HTMLSelectElement).value as ScenarioId;
        if (s.mode === 'manual') s.mode = 'timeline';
        if (s.t <= app.lastObserved.t) s.t = toT('2027-12-31');
        update();
    });
    const setManual = (v: number) => {
        if (!Number.isFinite(v)) return;
        s.mode = 'manual';
        s.manualElev = Math.max(870, Math.min(FULL_POOL, v));
        update();
    };
    $<HTMLInputElement>('#elev-slider').addEventListener('input', e => setManual(parseFloat((e.target as HTMLInputElement).value)));
    const input = $<HTMLInputElement>('#elev-input');
    input.addEventListener('change', () => setManual(parseFloat(input.value)));
    input.addEventListener('keydown', e => {
        if (e.key === 'Enter') setManual(parseFloat(input.value));
    });

    const setCollapsed = (btn: HTMLButtonElement, collapsed: boolean) => {
        btn.closest('.side')!.classList.toggle('collapsed', collapsed);
        btn.setAttribute('aria-expanded', String(!collapsed));
        btn.textContent = collapsed ? '+' : '–';
    };
    document.querySelectorAll<HTMLButtonElement>('.side .collapse').forEach(btn =>
        btn.addEventListener('click', () => setCollapsed(btn, !btn.closest('.side')!.classList.contains('collapsed'))));

    // phones: a tab bar shows one panel at a time
    const tabs = [...document.querySelectorAll<HTMLButtonElement>('#mtabs button')];
    tabs.forEach(tab => tab.addEventListener('click', () => {
        const open = tab.getAttribute('aria-pressed') !== 'true';
        for (const t of tabs) {
            const on = open && t === tab;
            t.setAttribute('aria-pressed', String(on));
            $(`#${t.dataset.p}`).classList.toggle('m-open', on);
        }
    }));
}

main().catch(err => {
    console.error(err);
    $('#loading').innerHTML = `<p class="err">Could not start: ${String(err?.message ?? err)}</p>`;
});
