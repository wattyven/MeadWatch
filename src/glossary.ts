// Plain-language definitions for every technical term in the interface, the
// "How to use" guide, and the hover/tap tooltips on underlined terms.

export interface Term {
    id: string;
    term: string;
    /** also known as (searchable) */
    aka?: string;
    def: string;
}

export const GLOSSARY: Term[] = [
    {id: 'acre-foot', term: 'Acre-foot (AF)', def: 'The amount of water that would cover one acre (about a football field) one foot deep: roughly 326,000 gallons, or what two to three U.S. households use in a year. Western water is measured in acre-feet.'},
    {id: 'maf', term: 'MAF', aka: 'million acre-feet, MAF/yr', def: 'Million acre-feet. Lake Mead holds about 26 MAF when full. "MAF/yr" is a yearly flow: how much water moves through a river or canal in a year.'},
    {id: 'elevation', term: 'Lake elevation', aka: 'level, ft', def: 'The height of the lake’s surface in feet above sea level. This is how Reclamation reports Lake Mead’s level, and every threshold in MeadWatch is an elevation.'},
    {id: 'full-pool', term: 'Full pool (1,229 ft)', def: 'Lake Mead’s highest normal level, full to the top of Hoover Dam’s spillway gates. The lake last came close in 1983 and 1999.'},
    {id: 'live-storage', term: 'Water in storage (live storage)', aka: 'live storage, storage', def: 'Water held in the lake above dead pool: the part that can actually be released downstream. MeadWatch shows it in MAF and as a share of what a full lake holds.'},
    {id: 'surface-area', term: 'Surface area', def: 'How much ground the lake covers, in acres. It shrinks faster than the level falls in the shallow arms, like the Overton Arm.'},
    {id: 'dead-pool', term: 'Dead pool (895 ft)', def: 'The level of Hoover Dam’s lowest outlets. Below it, water can’t flow out of the lake at all, so nothing reaches Arizona, California or Mexico, even though water remains in the lake.'},
    {id: 'min-power-pool', term: 'Minimum power pool (950 ft)', aka: 'power shut-off', def: 'Below about 950 ft, Hoover Dam’s turbines can’t run safely, so the dam stops generating electricity and releases are squeezed through smaller outlets.'},
    {id: 'hoover-capacity', term: 'Hoover power capacity', aka: 'MW, megawatts', def: 'How much electricity Hoover Dam can produce at once, in megawatts (MW). It falls as the lake drops, because shallower water pushes the turbines with less force. The dam’s full rating is 2,080 MW. MeadWatch’s figure is an estimate.'},
    {id: 'snwa-intakes', term: 'Las Vegas intakes', aka: 'SNWA, Southern Nevada Water Authority', def: 'The Southern Nevada Water Authority draws about 90% of Las Vegas’s water through three intake pipes in Lake Mead. Intake 1 is at 1,050 ft and Intake 2 at 1,000 ft. Intake 3, the “third straw” at 860 ft, plus a pumping station keep water flowing down to about 875 ft.'},
    {id: 'bathtub-ring', term: 'Exposed lakebed (“bathtub ring”)', aka: 'bathtub ring', def: 'Ground that used to be under water. On the canyon walls it shows as a pale mineral band. MeadWatch draws it white, banded every 10 ft, so you can see how far the water has fallen.'},
    {id: 'bathymetry', term: 'Lake-floor survey (bathymetry)', aka: 'bathymetry', def: 'A map of the lake bottom’s shape. MeadWatch uses a 2001 sonar survey by the USGS and Reclamation, so the drained canyons you see are real, not guessed.'},
    {id: 'shortage-tier', term: 'Shortage tier', aka: 'Tier 0, Tier 1, Tier 2a, Tier 2b, Tier 3, Normal', def: 'Under the 2007 rules, the lower the lake is projected to be on January 1, the deeper that year’s cuts: Tier 0 (below 1,090 ft), Tier 1 (1,075), Tier 2a (1,050), Tier 2b (1,045) and Tier 3 (1,025). “Normal” means no shortage.'},
    {id: 'shortage-condition', term: 'Shortage Condition (2027–28)', def: 'Under the 2027–28 Operating Guidelines, a single yearly cut of 1.25 MAF: 760,000 AF for Arizona, 440,000 AF for California and 50,000 AF for Nevada. It replaces the tiers.'},
    {id: 'rules', term: 'Operating rules', aka: 'rules, guidelines', def: 'The agreements that decide who gets cut, and by how much, when Lake Mead is low. MeadWatch uses the rules in force each year: none before 2008, the 2007 Interim Guidelines with the 2019 Drought Contingency Plan through 2026, and the 2027–28 Operating Guidelines after that.'},
    {id: 'interim-guidelines', term: '2007 Interim Guidelines', def: 'Federal rules adopted in 2007 for sharing shortages among Arizona, Nevada and California and for coordinating Lake Powell with Lake Mead. They governed through 2026.'},
    {id: 'dcp', term: 'Drought Contingency Plan (DCP)', def: 'A 2019 agreement in which Arizona, Nevada, California and (separately) Mexico agreed to leave extra water in Lake Mead as it falls. It added “Tier 0” and cuts for California below 1,045 ft.'},
    {id: 'operating-guidelines', term: '2027–28 Operating Guidelines', def: 'Short-term rules adopted in August 2026, after the 2007 Guidelines expired, while longer-term rules are negotiated. They set a flat Shortage Condition and an emergency consultation trigger at 1,010 ft.'},
    {id: 'pre2007', term: 'Pre-2007 operations', def: 'Before 2008 there was no formal schedule for Lower Basin shortages. Lake Mead stayed high enough that none was ever declared.'},
    {id: 'consultation', term: 'Consultation trigger', aka: 'emergency talks, 1,010 ft', def: 'If Reclamation’s most-likely forecast shows Lake Mead falling below 1,010 ft within 12 months, the Interior Department must convene the seven states and the tribes to agree further action.'},
    {id: 'operating-year', term: 'Operating year', def: 'The calendar year (January–December) that a shortage condition applies to. It is set the summer before, from Reclamation’s August forecast of the January 1 level, so a year’s tier can differ from where the lake actually ends up.'},
    {id: 'forecast', term: '24-Month Study (forecast)', aka: 'forecast, projection, 24-month study', def: 'Reclamation’s monthly forecast of Lake Mead and Lake Powell for the next two years. It is the official basis for operating the river.'},
    {id: 'most-likely', term: 'Most likely forecast', aka: 'most probable', def: 'Reclamation’s “Most Probable” forecast, assuming a typical (median) year of rain and snowmelt. MeadWatch shows two versions, which differ in how much water is released from Lake Powell upstream: 6.0 or 7.0 MAF in water year 2027.'},
    {id: 'dry-forecast', term: 'Dry-year forecast', aka: 'probable minimum', def: 'Reclamation’s “Probable Minimum”: a dry scenario that conditions are expected to beat about 9 years in 10.'},
    {id: 'wet-forecast', term: 'Wet-year forecast', aka: 'probable maximum', def: 'Reclamation’s “Probable Maximum”: a wet scenario that conditions are expected to fall short of about 9 years in 10. Roughly 80% of outcomes fall between the dry and wet forecasts.'},
    {id: 'powell-release', term: 'Lake Powell release', aka: 'Glen Canyon Dam, maf Powell release', def: 'Water released from Lake Powell through Glen Canyon Dam, upstream of the Grand Canyon. It is most of what flows into Lake Mead, so cuts there drain Mead faster.'},
    {id: 'water-year', term: 'Water year', def: 'October 1 to September 30, the year water managers use, so that one winter’s snowpack and the following spring’s runoff count in the same year.'},
    {id: 'apportionment', term: 'Apportionment', def: 'Each state’s legal yearly share of the Colorado River: in the Lower Basin, Arizona 2.8 MAF, California 4.4 MAF and Nevada 0.3 MAF. Mexico is owed 1.5 MAF by a 1944 treaty.'},
    {id: 'senior-rights', term: 'Senior water rights', aka: 'priority, junior', def: 'Older water rights are served first and cut last. Junior users, such as the Central Arizona Project, absorb shortages first, while senior users, like Yuma farms or the Colorado River Indian Tribes, are protected for longer.'},
    {id: 'lower-basin', term: 'Lower Basin', def: 'Arizona, California and Nevada: the states below Lee Ferry, Arizona, whose Colorado River water is stored in Lake Mead.'},
    {id: 'normal-deliveries', term: 'Normal deliveries', aka: 'vs normal, % of normal', def: 'Rounded typical yearly deliveries before the shortages began (around 2019–2021). The flow panel compares each river reach and canal against them.'},
    {id: 'operating-range', term: 'Operating range', def: 'Lakes Mohave and Havasu, below Hoover Dam, are kept within a few feet of a set level by their own dams for as long as Hoover keeps releasing water.'},
    {id: 'est', term: 'est. (estimate)', aka: 'estimate, est.', def: 'MeadWatch’s own estimate, not an official figure. Examples: how a state’s cut is split among its cities and farms, canal flows, and Hoover’s power capacity. Methods are under About.'},
    {id: 'usbr', term: 'USBR (Bureau of Reclamation)', aka: 'Reclamation, Bureau of Reclamation', def: 'The federal agency that runs Hoover Dam and the lower Colorado River. MeadWatch’s lake levels, releases and forecasts come from its published data.'},
    {id: 'cap', term: 'CAP (Central Arizona Project)', def: 'A 336-mile canal that lifts Colorado River water from Lake Havasu to Phoenix and Tucson. It holds junior rights, so Arizona’s cuts fall on it first.'},
    {id: 'mwd', term: 'MWD (Metropolitan Water District)', aka: 'Colorado River Aqueduct', def: 'Southern California’s regional water wholesaler, serving 19 million people. Its 242-mile Colorado River Aqueduct carries water from Lake Havasu to the coast.'},
    {id: 'iid', term: 'IID (Imperial Irrigation District)', aka: 'All-American Canal', def: 'The largest single user of Colorado River water. It irrigates about 475,000 acres in the Imperial Valley through the All-American Canal.'},
    {id: 'cvwd', term: 'CVWD (Coachella Valley Water District)', aka: 'Coachella Canal', def: 'Supplies farms and the Palm Springs-area cities through the Coachella Canal, a branch of the All-American Canal.'},
    {id: 'pvid', term: 'PVID (Palo Verde Irrigation District)', def: 'Irrigates about 104,000 acres around Blythe, California, under some of the river’s oldest rights.'},
    {id: 'crit', term: 'CRIT (Colorado River Indian Tribes)', def: 'The Mohave, Chemehuevi, Hopi and Navajo people of the Parker Valley, who farm about 79,000 acres under rights dating to 1865.'},
    {id: 'minute', term: 'IBWC Minutes 323 and 334', aka: 'Minute 323, Minute 334, Mexico', def: 'Agreements between the U.S. and Mexico through the International Boundary and Water Commission on how Mexico shares shortages. MeadWatch models Minute 323; Minute 334 (2026) is not modelled.'},
    {id: 'water-cut', term: 'Water cut', aka: 'less river water, AF/yr, reduction, shortage cut', def: 'How much less Colorado River water a region receives in a year than it normally would, in acre-feet. MeadWatch also shows it as a share of the region’s usual river supply: 100% means none of that water arrives.'},
    {id: 'hoover-power-loss', term: 'Hoover power loss', aka: 'less Hoover power, power −%', def: 'How far below its full 2,080 MW Hoover Dam’s generating capacity has fallen because the lake is low. It affects electricity, not water: utilities in Arizona, California and Nevada that buy Hoover power get less and replace it, usually at higher cost.'},
    {id: 'impact-level', term: 'Impact level (Minimal to Critical)', aka: 'severity, colour, minimal, low, moderate, high, severe, critical', def: 'MeadWatch’s summary of how hard a region is hit, set by its biggest problem: the share of its river water that is cut, half of Hoover Dam’s lost power for regions that buy it, or the risk that the dam can’t physically deliver water. Minimal is under 5%, Critical is 80% or more.'},
    {id: 'groundwater', term: 'Groundwater', def: 'Water pumped from underground aquifers. It is the main backup when river water is cut, but pumping lowers the water table and is limited or regulated in many areas.'},
    {id: 'fallowing', term: 'Fallowing', aka: 'unplanted fields, leaving fields unplanted', def: 'Leaving farmland unplanted for a season or more to save water. Many Colorado River farmers are paid to fallow so the water can stay in Lake Mead.'},
    {id: 'system-conservation', term: 'Voluntary conservation', aka: 'system conservation', def: 'Water that users agree, usually for payment, to leave in Lake Mead. It is why actual releases since 2023 have been lower than the formal cuts alone would require.'}
];

const byId = new Map(GLOSSARY.map(t => [t.id, t]));

/** An inline, underlined term with a hover/tap definition. */
export function term(id: string, label?: string) {
    const t = byId.get(id);
    if (!t) throw new Error(`unknown glossary term ${id}`);
    return `<button type="button" class="term" data-term="${id}" aria-describedby="term-tip">${label ?? t.term}</button>`;
}

/** Small "?" button that opens one glossary entry. */
export function helpDot(id: string, label: string) {
    return `<button type="button" class="help-dot" data-term="${id}" aria-label="What is ${label}?" title="What is ${label}?">?</button>`;
}

const esc = (s: string) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;');

export function initGlossary() {
    const dlg = document.querySelector('#guide-dialog') as HTMLDialogElement;
    const list = dlg.querySelector('#glossary-list') as HTMLElement;
    const search = dlg.querySelector('#glossary-search') as HTMLInputElement;
    list.innerHTML = [...GLOSSARY].sort((a, b) => a.term.localeCompare(b.term)).map(t =>
        `<div class="gl-entry" id="gl-${t.id}" data-search="${esc((t.term + ' ' + (t.aka ?? '') + ' ' + t.def).toLowerCase())}">
            <dt>${esc(t.term)}</dt><dd>${esc(t.def)}</dd></div>`).join('');
    search.addEventListener('input', () => {
        const q = search.value.trim().toLowerCase();
        let shown = 0;
        list.querySelectorAll<HTMLElement>('.gl-entry').forEach(e => {
            const on = !q || e.dataset.search!.includes(q);
            e.hidden = !on;
            if (on) shown++;
        });
        (dlg.querySelector('#glossary-empty') as HTMLElement).hidden = shown > 0;
    });
    dlg.addEventListener('click', e => { if (e.target === dlg) dlg.close(); });

    const tabs = [...dlg.querySelectorAll<HTMLButtonElement>('[data-tab]')];
    const showTab = (name: string) => {
        for (const t of tabs) {
            const on = t.dataset.tab === name;
            t.setAttribute('aria-selected', String(on));
            (dlg.querySelector(`#guide-${t.dataset.tab}`) as HTMLElement).hidden = !on;
        }
    };
    tabs.forEach(t => t.addEventListener('click', () => showTab(t.dataset.tab!)));

    const open = (id?: string) => {
        if (!dlg.open) dlg.showModal();
        if (id) {
            showTab('glossary');
            search.value = '';
            search.dispatchEvent(new Event('input'));
            const el = list.querySelector<HTMLElement>(`#gl-${id}`);
            list.querySelectorAll('.gl-entry.hl').forEach(e => e.classList.remove('hl'));
            if (el) {
                el.classList.add('hl');
                el.scrollIntoView({block: 'center'});
            }
        } else {
            showTab('start');
        }
    };
    document.querySelector('#help-btn')!.addEventListener('click', () => open());

    // hover/focus tooltips for underlined terms; click opens the full entry
    const tip = document.querySelector('#term-tip') as HTMLElement;
    let current: HTMLElement | null = null;
    const show = (el: HTMLElement) => {
        const t = byId.get(el.dataset.term!);
        if (!t) return;
        current = el;
        tip.innerHTML = `<b>${esc(t.term)}</b>${esc(t.def)}<span class="tip-more">Click for the glossary</span>`;
        tip.hidden = false;
        const r = el.getBoundingClientRect(), tw = tip.offsetWidth, th = tip.offsetHeight;
        let x = r.left + r.width / 2 - tw / 2;
        x = Math.max(8, Math.min(window.innerWidth - tw - 8, x));
        let y = r.bottom + 8;
        if (y + th > window.innerHeight - 8) y = r.top - th - 8;
        tip.style.left = `${x}px`;
        tip.style.top = `${Math.max(8, y)}px`;
    };
    const hide = () => {
        current = null;
        tip.hidden = true;
    };
    const target = (e: Event) => (e.target as Element | null)?.closest?.('.term, .help-dot') as HTMLElement | null;
    document.addEventListener('pointerover', e => {
        const el = target(e);
        if (el && el !== current && (e as PointerEvent).pointerType === 'mouse') show(el);
        if (!el && current) hide();
    });
    document.addEventListener('focusin', e => {
        const el = target(e);
        if (el) show(el); else if (current) hide();
    });
    document.addEventListener('click', e => {
        const el = target(e);
        if (!el) return;
        e.preventDefault();
        e.stopPropagation();
        hide();
        open(el.dataset.term);
    }, true);
    document.addEventListener('keydown', e => { if (e.key === 'Escape') hide(); });
    window.addEventListener('scroll', hide, true);

    // one-time pointer to the guide for first visits
    try {
        if (!localStorage.getItem('mw-guide-seen')) {
            const hint = document.querySelector('#guide-hint') as HTMLElement;
            hint.hidden = false;
            const dismiss = () => {
                hint.hidden = true;
                localStorage.setItem('mw-guide-seen', '1');
            };
            hint.querySelector('[data-open]')!.addEventListener('click', () => { dismiss(); open(); });
            hint.querySelector('[data-dismiss]')!.addEventListener('click', dismiss);
        }
    } catch {
        // storage unavailable: skip the hint
    }
}
