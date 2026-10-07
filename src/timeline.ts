import * as d3 from 'd3';
import {type AppData, type ScenarioId, sample, toT} from './data';

export const HISTORY_START = toT('2000-01-01');
const DAY = 86400000;

/** Visible time window [from, to] in ms; null = the whole record. */
export type Window = [number, number] | null;

export interface TimelineOptions {
    onScrub(t: number): void;
    /** user picked a new window on the overview strip (null = reset) */
    onWindow(w: Window): void;
}

const LINES = [
    {e: 1229, label: 'Full pool', minor: false, help: 'Full pool: the lake is full to the top of Hoover Dam’s spillway gates.'},
    {e: 1075, label: 'Tier 1 shortage', minor: false, help: 'Tier 1: first level of mandatory cuts under the 2007 rules.'},
    {e: 1050, label: 'Tier 2a · Las Vegas Intake 1', minor: false, help: 'Tier 2a: deeper cuts. Las Vegas’s highest intake pipe stops reaching water.'},
    {e: 1025, label: 'Tier 3 shortage', minor: true, help: 'Tier 3: the deepest cuts in the 2007 rules.'},
    {e: 1010, label: 'Emergency talks trigger (2027–28 rules)', minor: true, offset: true, help: 'If the forecast drops below 1,010 ft, the federal government must convene the states and tribes on further action.'},
    {e: 1000, label: 'Las Vegas Intake 2', minor: true, help: 'Las Vegas’s second intake stops reaching water.'},
    {e: 950, label: 'Hoover stops generating power', minor: false, help: 'Minimum power pool: below this, Hoover Dam’s turbines can’t run.'}
];
const Y_MIN = 940;

const SCENARIO_LABEL: Record<ScenarioId, string> = {
    min: 'Dry-year forecast',
    most: 'Most likely (6.0 maf)',
    most7: 'Most likely (7.0 maf)',
    max: 'Wet-year forecast'
};

const OVERVIEW_H = 30;

export class Timeline {
    private svg: d3.Selection<SVGSVGElement, unknown, null, undefined>;
    private x = d3.scaleUtc();
    private y = d3.scaleLinear();
    private ox = d3.scaleUtc();
    private width = 800;
    private height = 168;
    private margin = {top: 12, right: 14, bottom: 22, left: 40};
    readonly end: number;
    private t: number;
    private scenario: ScenarioId = 'most';
    private manual = false;
    private manualElev = 1038;
    private win: Window = null;
    private yMaxCur = 1235;

    constructor(private el: HTMLElement, private app: AppData, private opts: TimelineOptions) {
        this.end = Math.max(...app.forecast.scenarios.map(s => toT(s.series[s.series.length - 1].date)));
        this.t = app.lastObserved.t;
        this.svg = d3.select(el).append('svg').attr('class', 'tl-svg').attr('role', 'img')
            .attr('aria-label', 'Lake Mead elevation, observed since 2000 and forecast through 2028');
        new ResizeObserver(() => this.draw()).observe(el);
        this.draw();
    }

    /** start/end of the visible window */
    get start() {
        return this.win ? this.win[0] : HISTORY_START;
    }

    get stop() {
        return this.win ? this.win[1] : this.end;
    }

    /** Clamp and tidy a requested window; returns null for (nearly) the full record. */
    normalize(w: Window): Window {
        if (!w) return null;
        let [a, b] = w[0] <= w[1] ? w : [w[1], w[0]];
        a = Math.max(HISTORY_START, a);
        b = Math.min(this.end, b);
        if (b - a < 60 * DAY) {
            const mid = (a + b) / 2;
            a = Math.max(HISTORY_START, mid - 30 * DAY);
            b = Math.min(this.end, a + 60 * DAY);
        }
        if (a - HISTORY_START < 20 * DAY && this.end - b < 20 * DAY) return null;
        return [a, b];
    }

    set(t: number, scenario: ScenarioId, manual: boolean, manualElev: number, win: Window) {
        const winChanged = (win?.[0] ?? 0) !== (this.win?.[0] ?? 0) || (win?.[1] ?? 0) !== (this.win?.[1] ?? 0);
        const redraw = scenario !== this.scenario || manual !== this.manual || winChanged;
        this.t = t;
        this.scenario = scenario;
        this.manual = manual;
        this.manualElev = manualElev;
        this.win = win;
        if (redraw) this.draw(); else this.drawCursor();
    }

    private visibleRange(): [number, number] {
        const {app} = this;
        let hi = -Infinity, lo = Infinity;
        const a = this.start, b = this.stop;
        const scan = (s: {t: number[]; v: number[]}) => {
            for (let i = 0; i < s.t.length; i++) if (s.t[i] >= a && s.t[i] <= b) {
                if (s.v[i] > hi) hi = s.v[i];
                if (s.v[i] < lo) lo = s.v[i];
            }
            // the values at the window edges count too
            for (const t of [a, b]) if (t >= s.t[0] && t <= s.t[s.t.length - 1]) {
                const v = sample(s, t);
                hi = Math.max(hi, v);
                lo = Math.min(lo, v);
            }
        };
        scan(app.observed);
        for (const s of Object.values(app.scenarioSeries)) scan(s);
        return [lo, hi];
    }

    private draw() {
        const {app, margin: m} = this;
        this.width = Math.max(320, this.el.clientWidth);
        this.height = Math.max(150, this.el.clientHeight || 198);
        const w = this.width, h = this.height;
        const mainBottom = h - OVERVIEW_H - 6; // bottom of the main chart's x axis area
        const [, vHi] = this.visibleRange();
        // top of the scale follows the data in the window (always at least to 1,060 ft for context)
        const yMax = Math.min(1235, Math.max(1060, Math.ceil((vHi + 12) / 25) * 25));
        this.yMaxCur = yMax;
        this.x.domain([this.start, this.stop]).range([m.left, w - m.right]);
        this.y.domain([Y_MIN, yMax]).range([mainBottom - m.bottom, m.top]);
        const {x, y} = this;
        const plotH = mainBottom - m.bottom - m.top;
        const pxPerFt = plotH / (yMax - Y_MIN);
        const svg = this.svg.attr('viewBox', `0 0 ${w} ${h}`).attr('width', w).attr('height', h);
        svg.selectAll('*').remove();

        const clipId = 'tl-clip';
        svg.append('defs').append('clipPath').attr('id', clipId)
            .append('rect').attr('x', m.left).attr('y', 0).attr('width', w - m.left - m.right).attr('height', mainBottom - m.bottom);
        const plot = svg.append('g').attr('clip-path', `url(#${clipId})`);

        const today = app.lastObserved.t;
        if (today < this.stop) {
            const fx = Math.max(m.left, x(today));
            plot.append('rect').attr('class', 'tl-future')
                .attr('x', fx).attr('y', m.top).attr('width', w - m.right - fx).attr('height', plotH);
        }

        // thresholds; minor labels only where there's room
        const th = svg.append('g').attr('class', 'tl-thresholds');
        for (const l of LINES) {
            if (l.e > yMax) continue;
            const g = th.append('g');
            g.append('title').text(l.help);
            g.append('line').attr('x1', m.left).attr('x2', w - m.right).attr('y1', y(l.e)).attr('y2', y(l.e))
                .attr('class', l.e === 950 ? 'tl-th tl-th-power' : l.e === 1229 ? 'tl-th tl-th-full' : 'tl-th');
            if (l.minor && (w < 640 || pxPerFt * 10 < 9)) continue;
            // the 1,010 ft line sits too close to 1,000 ft to share the left margin
            g.append('text').attr('x', l.offset ? m.left + (w - m.left - m.right) * 0.22 : m.left + 4).attr('y', y(l.e) - 3)
                .attr('class', 'tl-th-label').text(`${d3.format(',')(l.e)} · ${l.label}`);
        }

        // axes
        const spanDays = (this.stop - this.start) / DAY;
        const fmt = spanDays > 3 * 365 ? d3.utcFormat('%Y') : spanDays > 120 ? d3.utcFormat('%b %Y') : d3.utcFormat('%b %-d');
        const ticks = spanDays > 3 * 365
            ? d3.utcYear.every(Math.max(1, Math.ceil(spanDays / 365 / Math.max(2, (w - m.left - m.right) / 52))))!
            : Math.max(2, Math.floor((w - m.left - m.right) / 90));
        svg.append('g').attr('class', 'tl-axis').attr('transform', `translate(0,${mainBottom - m.bottom})`)
            .call(d3.axisBottom(x).ticks(ticks as number).tickFormat(d => fmt(d as Date)).tickSizeOuter(0));
        svg.append('g').attr('class', 'tl-axis').attr('transform', `translate(${m.left},0)`)
            .call(d3.axisLeft(y).ticks(5).tickFormat(d => d3.format(',')(d as number)).tickSizeOuter(0));

        // forecast band (dry..wet)
        const minS = app.scenarioSeries.min, maxS = app.scenarioSeries.max;
        const bandEnd = Math.min(minS.t[minS.t.length - 1], maxS.t[maxS.t.length - 1]);
        const bandTs = [...new Set([...minS.t, ...maxS.t])].sort((a, b) => a - b).filter(t => t <= bandEnd);
        plot.append('path').attr('class', 'tl-band')
            .attr('d', d3.area<number>().x(t => x(t)).y0(t => y(sample(minS, t))).y1(t => y(sample(maxS, t))).curve(d3.curveMonotoneX)(bandTs));

        const line = d3.line<[number, number]>().x(d => x(d[0])).y(d => y(d[1])).curve(d3.curveMonotoneX);
        const compressed = spanDays > 12 * 365;
        for (const s of app.forecast.scenarios) {
            const ser = app.scenarioSeries[s.id];
            const active = s.id === this.scenario && !this.manual;
            plot.append('path').attr('class', `tl-fc tl-fc-${s.id}${active ? ' is-active' : ''}`)
                .attr('d', line(ser.t.map((t, i) => [t, ser.v[i]] as [number, number])));
            // label the dry/wet edges and the selected run (only the selected one when zoomed far out)
            if (!active && (s.id === 'most' || s.id === 'most7' || compressed)) continue;
            const lt = Math.min(ser.t[ser.t.length - 1], this.stop);
            if (lt <= Math.max(today, this.start)) continue;
            svg.append('text').attr('class', `tl-fc-label tl-fc-label-${s.id}`).attr('x', x(lt) - 4)
                .attr('y', y(sample(ser, lt)) + (s.id === 'max' ? -6 : 12)).attr('text-anchor', 'end').text(SCENARIO_LABEL[s.id]);
        }

        const obs = app.observed.t.map((t, i) => [t, app.observed.v[i]] as [number, number])
            .filter(d => d[0] >= this.start - 5 * DAY && d[0] <= this.stop + 5 * DAY);
        plot.append('path').attr('class', 'tl-obs').attr('d', d3.line<[number, number]>().x(d => x(d[0])).y(d => y(d[1]))(obs));

        const rl = app.daily.recordLow;
        const rlt = toT(rl.date);
        if (rlt >= this.start && rlt <= this.stop) {
            const g = svg.append('g').attr('class', 'tl-record').attr('transform', `translate(${x(rlt)},${y(rl.elevation)})`);
            g.append('circle').attr('r', 3.5);
            g.append('text').attr('x', -6).attr('y', 14).attr('text-anchor', 'end').text(`Record low ${rl.elevation.toFixed(2)} ft`);
        }

        if (today >= this.start && today <= this.stop) {
            svg.append('line').attr('class', 'tl-today').attr('x1', x(today)).attr('x2', x(today)).attr('y1', m.top).attr('y2', mainBottom - m.bottom);
            svg.append('text').attr('class', 'tl-today-label').attr('x', x(today) + 4).attr('y', m.top + 10).text('Forecast →');
            svg.append('text').attr('class', 'tl-today-label').attr('x', x(today) - 4).attr('y', m.top + 10).attr('text-anchor', 'end').text('← Observed');
        }

        // playhead
        const cursor = svg.append('g').attr('class', 'tl-cursor');
        cursor.append('line').attr('class', 'tl-cursor-line');
        cursor.append('circle').attr('class', 'tl-cursor-dot').attr('r', 5.5);
        const tag = cursor.append('g').attr('class', 'tl-cursor-tag');
        tag.append('rect').attr('rx', 4).attr('height', 20);
        tag.append('text').attr('y', 14);
        const ml = svg.append('g').attr('class', 'tl-manual');
        ml.append('line').attr('class', 'tl-manual-line');
        ml.append('text').attr('class', 'tl-manual-label').attr('text-anchor', 'end');

        // scrubbing on the main chart
        const overlay = svg.append('rect').attr('class', 'tl-hit')
            .attr('x', m.left).attr('y', 0).attr('width', w - m.left - m.right).attr('height', mainBottom - m.bottom);
        const scrub = (ev: PointerEvent) => {
            const [px] = d3.pointer(ev, svg.node());
            const t = +x.invert(Math.max(m.left, Math.min(w - m.right, px)));
            this.opts.onScrub(Math.round(t / DAY) * DAY + DAY / 2);
        };
        overlay.on('pointerdown', (ev: PointerEvent) => {
            (ev.target as Element).setPointerCapture(ev.pointerId);
            scrub(ev);
        }).on('pointermove', (ev: PointerEvent) => {
            if ((ev.target as Element).hasPointerCapture(ev.pointerId)) scrub(ev);
        });

        this.drawOverview(h);
        this.drawCursor();
    }

    /** Context strip with the whole record and a brush for choosing the window. */
    private drawOverview(h: number) {
        const {app, margin: m, width: w} = this;
        const top = h - OVERVIEW_H, bottom = h - 2;
        const ox = this.ox.domain([HISTORY_START, this.end]).range([m.left, w - m.right]);
        const oy = d3.scaleLinear().domain([Y_MIN, 1235]).range([bottom - 1, top + 2]);
        const g = this.svg.append('g').attr('class', 'tl-overview');
        g.append('rect').attr('class', 'tl-ov-bg').attr('x', m.left).attr('y', top).attr('width', w - m.left - m.right).attr('height', bottom - top).attr('rx', 4);
        const obs: [number, number][] = [];
        for (let i = 0; i < app.observed.t.length; i += 7) if (app.observed.t[i] >= HISTORY_START) obs.push([app.observed.t[i], app.observed.v[i]]);
        const most = app.scenarioSeries[this.scenario];
        const area = d3.area<[number, number]>().x(d => ox(d[0])).y0(bottom - 1).y1(d => oy(d[1]));
        g.append('path').attr('class', 'tl-ov-area').attr('d', area(obs));
        g.append('path').attr('class', 'tl-ov-fc').attr('d', area(most.t.map((t, i) => [t, most.v[i]] as [number, number])));
        for (const yr of [2000, 2005, 2010, 2015, 2020, 2025]) {
            const xx = ox(toT(`${yr}-01-01`));
            g.append('text').attr('class', 'tl-ov-label').attr('x', xx + 3).attr('y', top + 11).text(yr);
        }
        g.append('text').attr('class', 'tl-ov-hint').attr('x', w - m.right - 6).attr('y', top + 11).attr('text-anchor', 'end')
            .text(this.win ? '' : 'Drag here to zoom in');

        const brush = d3.brushX<unknown>().extent([[m.left, top], [w - m.right, bottom]])
            .on('end', (ev: d3.D3BrushEvent<unknown>) => {
                if (!ev.sourceEvent) return; // programmatic move
                const sel = ev.selection as [number, number] | null;
                this.opts.onWindow(sel ? this.normalize([+ox.invert(sel[0]), +ox.invert(sel[1])]) : null);
            });
        const bg = g.append('g').attr('class', 'tl-brush').call(brush);
        if (this.win) bg.call(brush.move, [ox(this.win[0]), ox(this.win[1])]);
    }

    private drawCursor() {
        const {x, y, margin: m, height: h, app} = this;
        const svg = this.svg;
        const yMax = this.yMaxCur;
        const mainBottom = h - OVERVIEW_H - 6 - m.bottom;
        const cursor = svg.select<SVGGElement>('.tl-cursor');
        const manual = svg.select<SVGGElement>('.tl-manual');
        if (this.manual) {
            cursor.attr('display', 'none');
            const e = this.manualElev;
            const yy = y(Math.max(Y_MIN, Math.min(yMax, e)));
            const off = e > yMax ? ' ↑ above chart' : e < Y_MIN ? ' ↓ below chart' : '';
            manual.attr('display', null);
            manual.select('line').attr('x1', m.left).attr('x2', this.width - m.right).attr('y1', yy).attr('y2', yy);
            manual.select('text').attr('x', this.width - m.right - 4).attr('y', yy < m.top + 14 ? yy + 13 : yy - 5)
                .text(`What-if: ${e.toFixed(1)} ft${off}`);
            return;
        }
        manual.attr('display', 'none');
        const visible = this.t >= this.start && this.t <= this.stop;
        cursor.attr('display', visible ? null : 'none');
        if (!visible) return;
        const e = this.t <= app.lastObserved.t ? sample(app.observed, this.t) : sample(app.scenarioSeries[this.scenario], this.t);
        const cx = x(this.t), cy = y(Math.min(e, yMax));
        cursor.select('.tl-cursor-line').attr('x1', cx).attr('x2', cx).attr('y1', m.top).attr('y2', mainBottom);
        cursor.select('.tl-cursor-dot').attr('cx', cx).attr('cy', cy);
        const label = `${d3.utcFormat('%b %-d, %Y')(new Date(this.t))} · ${e.toFixed(1)} ft`;
        const tag = cursor.select<SVGGElement>('.tl-cursor-tag');
        tag.select('text').text(label);
        const tw = label.length * 6.4 + 14;
        const tx = Math.min(Math.max(cx - tw / 2, m.left), this.width - m.right - tw);
        tag.attr('transform', `translate(${tx},${Math.max(0, cy - 34)})`);
        tag.select('rect').attr('width', tw);
        tag.select('text').attr('x', 7);
    }
}
