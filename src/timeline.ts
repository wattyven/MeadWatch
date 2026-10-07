import * as d3 from 'd3';
import {type AppData, type ScenarioId, sample, toT} from './data';

export const HISTORY_START = toT('2000-01-01');
export const RECENT_START = toT('2021-10-01');
export type Span = 'all' | 'recent';

export interface TimelineOptions {
    onScrub(t: number): void;
}

const LINES = [
    {e: 1229, label: 'Full pool', minor: false},
    {e: 1075, label: 'Tier 1', minor: false},
    {e: 1050, label: 'Tier 2a · SNWA Intake 1', minor: false},
    {e: 1025, label: 'Tier 3', minor: true},
    {e: 1010, label: '2027–28 consultation trigger', minor: true, offset: true},
    {e: 1000, label: 'SNWA Intake 2', minor: true},
    {e: 950, label: 'Hoover minimum power pool', minor: false}
];
const Y_MIN = 940;
const Y_MAX: Record<Span, number> = {all: 1235, recent: 1100};

const SCENARIO_LABEL: Record<ScenarioId, string> = {
    min: 'Probable min',
    most: 'Most probable (6.0 maf)',
    most7: 'Most probable (7.0 maf)',
    max: 'Probable max'
};

export class Timeline {
    private svg: d3.Selection<SVGSVGElement, unknown, null, undefined>;
    private x = d3.scaleUtc();
    private y = d3.scaleLinear();
    private width = 800;
    private height = 168;
    private margin = {top: 12, right: 14, bottom: 22, left: 40};
    readonly end: number;
    private t: number;
    private scenario: ScenarioId = 'most';
    private manual = false;
    private manualElev = 1038;
    private span: Span = 'all';

    constructor(private el: HTMLElement, private app: AppData, private opts: TimelineOptions) {
        this.end = Math.max(...app.forecast.scenarios.map(s => toT(s.series[s.series.length - 1].date)));
        this.t = app.lastObserved.t;
        this.svg = d3.select(el).append('svg').attr('class', 'tl-svg').attr('role', 'img')
            .attr('aria-label', 'Lake Mead elevation, observed since 2000 and forecast through 2028');
        new ResizeObserver(() => this.draw()).observe(el);
        this.draw();
    }

    get start() {
        return this.span === 'all' ? HISTORY_START : RECENT_START;
    }

    set(t: number, scenario: ScenarioId, manual: boolean, manualElev: number, span: Span) {
        const redraw = scenario !== this.scenario || manual !== this.manual || span !== this.span;
        this.t = t;
        this.scenario = scenario;
        this.manual = manual;
        this.manualElev = manualElev;
        this.span = span;
        if (redraw) this.draw(); else this.drawCursor();
    }

    private draw() {
        const {app, margin: m} = this;
        this.width = Math.max(320, this.el.clientWidth);
        this.height = Math.max(120, this.el.clientHeight || 168);
        const w = this.width, h = this.height;
        const yMax = Y_MAX[this.span];
        this.x.domain([this.start, this.end]).range([m.left, w - m.right]);
        this.y.domain([Y_MIN, yMax]).range([h - m.bottom, m.top]);
        const {x, y} = this;
        const svg = this.svg.attr('viewBox', `0 0 ${w} ${h}`).attr('width', w).attr('height', h);
        svg.selectAll('*').remove();

        const today = app.lastObserved.t;
        svg.append('rect').attr('class', 'tl-future')
            .attr('x', x(today)).attr('y', m.top).attr('width', x(this.end) - x(today)).attr('height', h - m.top - m.bottom);

        // thresholds; on the compressed long view only the main ones get labels
        const th = svg.append('g').attr('class', 'tl-thresholds');
        for (const l of LINES) {
            if (l.e > yMax) continue;
            th.append('line').attr('x1', m.left).attr('x2', w - m.right).attr('y1', y(l.e)).attr('y2', y(l.e))
                .attr('class', l.e === 950 ? 'tl-th tl-th-power' : l.e === 1229 ? 'tl-th tl-th-full' : 'tl-th');
            if (l.minor && (w < 640 || this.span === 'all')) continue;
            // the 1,010 ft line sits too close to 1,000 ft to share the left margin
            th.append('text').attr('x', l.offset ? x(this.start + (this.end - this.start) * 0.2) : m.left + 4).attr('y', y(l.e) - 3)
                .attr('class', 'tl-th-label').text(`${d3.format(',')(l.e)} · ${l.label}`);
        }

        // axes
        const yearsAll = d3.utcYear.every(1)!.range(new Date(this.start), new Date(this.end));
        const every = Math.max(1, Math.ceil(yearsAll.length / Math.max(2, (w - m.left - m.right) / 52)));
        const years = yearsAll.filter(d => d.getUTCFullYear() % every === 0);
        svg.append('g').attr('class', 'tl-axis').attr('transform', `translate(0,${h - m.bottom})`)
            .call(d3.axisBottom(x).tickValues(years).tickFormat(d => d3.utcFormat('%Y')(d as Date)).tickSizeOuter(0));
        svg.append('g').attr('class', 'tl-axis').attr('transform', `translate(${m.left},0)`)
            .call(d3.axisLeft(y).ticks(5).tickFormat(d => d3.format(',')(d as number)).tickSizeOuter(0));

        // forecast band (min..max)
        const minS = app.scenarioSeries.min, maxS = app.scenarioSeries.max;
        const bandTs = [...new Set([...minS.t, ...maxS.t])].sort((a, b) => a - b).filter(t => t <= Math.min(minS.t[minS.t.length - 1], maxS.t[maxS.t.length - 1]));
        svg.append('path').attr('class', 'tl-band')
            .attr('d', d3.area<number>().x(t => x(t)).y0(t => y(sample(minS, t))).y1(t => y(sample(maxS, t))).curve(d3.curveMonotoneX)(bandTs));

        const line = d3.line<[number, number]>().x(d => x(d[0])).y(d => y(d[1])).curve(d3.curveMonotoneX);
        for (const s of app.forecast.scenarios) {
            const ser = app.scenarioSeries[s.id];
            const active = s.id === this.scenario && !this.manual;
            svg.append('path').attr('class', `tl-fc tl-fc-${s.id}${active ? ' is-active' : ''}`)
                .attr('d', line(ser.t.map((t, i) => [t, ser.v[i]] as [number, number])));
            // label the range edges and the selected run (only the selected one on the compressed long view)
            if (!active && (s.id === 'most' || s.id === 'most7' || this.span === 'all')) continue;
            const lt = ser.t[ser.t.length - 1], lv = ser.v[ser.v.length - 1];
            svg.append('text').attr('class', `tl-fc-label tl-fc-label-${s.id}`).attr('x', x(lt) - 4)
                .attr('y', y(lv) + (s.id === 'max' ? -6 : 12)).attr('text-anchor', 'end').text(SCENARIO_LABEL[s.id]);
        }

        const obs = app.observed.t.map((t, i) => [t, app.observed.v[i]] as [number, number]).filter(d => d[0] >= this.start);
        svg.append('path').attr('class', 'tl-obs').attr('d', d3.line<[number, number]>().x(d => x(d[0])).y(d => y(d[1]))(obs));

        for (const p of app.forecast.pointForecasts) {
            svg.append('path').attr('class', 'tl-point').attr('d', d3.symbol(d3.symbolDiamond, 42)())
                .attr('transform', `translate(${x(toT(p.date))},${y(p.elevationFt)})`)
                .append('title').text(`${p.label}: ${p.elevationFt.toFixed(2)} ft`);
        }

        const rl = app.daily.recordLow;
        const g = svg.append('g').attr('class', 'tl-record').attr('transform', `translate(${x(toT(rl.date))},${y(rl.elevation)})`);
        g.append('circle').attr('r', 3.5);
        g.append('text').attr('x', -6).attr('y', 14).attr('text-anchor', 'end').text(`Record low ${rl.elevation.toFixed(2)} ft`);

        svg.append('line').attr('class', 'tl-today').attr('x1', x(today)).attr('x2', x(today)).attr('y1', m.top).attr('y2', h - m.bottom);
        svg.append('text').attr('class', 'tl-today-label').attr('x', x(today) + 4).attr('y', m.top + 10).text('Forecast →');
        svg.append('text').attr('class', 'tl-today-label').attr('x', x(today) - 4).attr('y', m.top + 10).attr('text-anchor', 'end').text('← Observed');

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

        // scrubbing
        const overlay = svg.append('rect').attr('class', 'tl-hit')
            .attr('x', m.left).attr('y', 0).attr('width', w - m.left - m.right).attr('height', h);
        const scrub = (ev: PointerEvent) => {
            const [px] = d3.pointer(ev, svg.node());
            const t = +x.invert(Math.max(m.left, Math.min(w - m.right, px)));
            this.opts.onScrub(Math.round(t / 86400000) * 86400000 + 43200000);
        };
        overlay.on('pointerdown', (ev: PointerEvent) => {
            (ev.target as Element).setPointerCapture(ev.pointerId);
            scrub(ev);
        }).on('pointermove', (ev: PointerEvent) => {
            if ((ev.target as Element).hasPointerCapture(ev.pointerId)) scrub(ev);
        });
        this.drawCursor();
    }

    private drawCursor() {
        const {x, y, margin: m, height: h, app} = this;
        const svg = this.svg;
        const yMax = Y_MAX[this.span];
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
        const visible = this.t >= this.start;
        cursor.attr('display', visible ? null : 'none');
        if (!visible) return;
        const e = this.t <= app.lastObserved.t ? sample(app.observed, this.t) : sample(app.scenarioSeries[this.scenario], this.t);
        const cx = x(this.t), cy = y(e);
        cursor.select('.tl-cursor-line').attr('x1', cx).attr('x2', cx).attr('y1', m.top).attr('y2', h - m.bottom);
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
