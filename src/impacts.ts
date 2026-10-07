// How a given Lake Mead elevation translates into water and power impacts.
//
// Two layers:
//  1. Policy: the shortage schedule that applies for the operating year, keyed
//     to Lake Mead's (projected) January 1 elevation.
//       - 2007 Interim Guidelines + 2019 Drought Contingency Plan + IBWC Minute 323
//         (governed operations through 2026)
//       - 2027–2028 Operating Guidelines (Aug 2026 ROD): a flat 1.25 MAF Lower
//         Basin reduction with consultation if Mead is projected below 1,010 ft.
//  2. Physics: what the dam and intakes can physically do at the current
//     elevation (Hoover generating capacity, minimum power pool, dead pool,
//     SNWA intake depths).
//
// Splitting state-level reductions among water users is simplified and
// illustrative (see the per-region `basis` notes); it is not an official
// allocation.

import {DEAD_POOL, MIN_POWER_POOL} from './data';

export type Regime = 'pre2007' | '2007' | '2027';

export interface Shortage {
    regime: Regime;
    tier: string;
    az: number;
    ca: number;
    nv: number;
    mx: number | null;
    consult: string | null;
}

const T2007: {above: number; tier: string; az: number; nv: number; ca: number; mx: number}[] = [
    {above: 1090, tier: 'Normal', az: 0, nv: 0, ca: 0, mx: 0},
    {above: 1075, tier: 'Tier 0', az: 192_000, nv: 8_000, ca: 0, mx: 41_000},
    {above: 1050, tier: 'Tier 1', az: 512_000, nv: 21_000, ca: 0, mx: 80_000},
    {above: 1045, tier: 'Tier 2a', az: 592_000, nv: 25_000, ca: 0, mx: 104_000},
    {above: 1040, tier: 'Tier 2b', az: 640_000, nv: 27_000, ca: 200_000, mx: 146_000},
    {above: 1035, tier: 'Tier 2b', az: 640_000, nv: 27_000, ca: 250_000, mx: 154_000},
    {above: 1030, tier: 'Tier 2b', az: 640_000, nv: 27_000, ca: 300_000, mx: 161_000},
    {above: 1025, tier: 'Tier 2b', az: 640_000, nv: 27_000, ca: 350_000, mx: 168_000},
    {above: -Infinity, tier: 'Tier 3', az: 720_000, nv: 30_000, ca: 350_000, mx: 275_000}
];

/**
 * Tiers Reclamation actually declared (from each August 24-Month Study's
 * projection of January 1), which can differ from the elevation observed on
 * December 31 -- e.g. 2023 was declared Tier 2a although Mead ended 2022 at 1,044.8 ft.
 */
export const DECLARED_TIERS: Record<number, string> = {
    ...Object.fromEntries(Array.from({length: 12}, (_, i) => [2008 + i, 'Normal'])),
    2020: 'Tier 0', 2021: 'Tier 0', 2022: 'Tier 1', 2023: 'Tier 2a', 2024: 'Tier 1', 2025: 'Tier 1', 2026: 'Tier 1'
};

export interface ShortageOptions {
    /** use this declared 2007-rules tier instead of deriving it from the elevation */
    declaredTier?: string;
    /** lowest Most Probable elevation in the next 12 months (2027–28 consultation trigger) */
    lookaheadMin?: number;
}

export function shortageFor(regime: Regime, jan1Elevation: number, opts: ShortageOptions = {}): Shortage {
    if (regime === 'pre2007') {
        // Before the 2007 Interim Guidelines there was no shortage schedule, and none was ever declared.
        return {regime, tier: 'Normal', az: 0, ca: 0, nv: 0, mx: 0, consult: null};
    }
    if (regime === '2027') {
        const low = opts.lookaheadMin ?? jan1Elevation;
        return {
            regime,
            tier: 'Shortage Condition',
            az: 760_000,
            ca: 440_000,
            nv: 50_000,
            mx: null,
            consult: low < 1010
                ? 'the forecast shows the lake below 1,010 ft within 12 months, so the Interior Department must convene the states and tribes on further action.'
                : jan1Elevation >= 1125
                    ? 'the forecast shows the lake at or above 1,125 ft, so states may be offered more water.'
                    : null
        };
    }
    // Normal and Tier 0 start strictly above their bound (Tier 1 is "at or below 1,075");
    // the deeper tiers include their lower bound.
    const row = (opts.declaredTier && T2007.find(r => r.tier === opts.declaredTier))
        || T2007.find((r, i) => (i <= 1 ? jan1Elevation > r.above : jan1Elevation >= r.above))!;
    return {
        regime,
        tier: row.tier,
        az: row.az,
        ca: row.ca,
        nv: row.nv,
        mx: row.mx,
        consult: jan1Elevation < 1025
            ? 'below 1,025 ft, the Interior Department consults on further measures to keep the lake above 1,000 ft.'
            : jan1Elevation < 1030
                ? 'below 1,030 ft, the Drought Contingency Plan requires talks on further protective steps.'
                : null
    };
}

export const regimeLabel: Record<Regime, string> = {
    'pre2007': 'Pre-2007 operations (no shortage schedule)',
    '2007': '2007 Interim Guidelines + 2019 DCP',
    '2027': '2027–28 Operating Guidelines'
};

/** Hoover Dam nameplate 2,080 MW. Effective capacity falls with head; nothing below 950 ft. */
export const HOOVER_NAMEPLATE = 2080;
export function hooverCapacityMw(h: number) {
    if (h < MIN_POWER_POOL) return 0;
    const head = Math.min(1, Math.max(0, (h - 646) / (1229 - 646)));
    return HOOVER_NAMEPLATE * Math.pow(head, 1.15);
}

export interface Threshold {
    elevation: number;
    short: string;
    label: string;
    kind: 'policy' | 'infra' | 'power' | 'limit';
}

export const THRESHOLDS: Threshold[] = [
    {elevation: 1229, short: 'Full pool', label: 'Full pool', kind: 'limit'},
    {elevation: 1090, short: 'Tier 0', label: 'DCP contributions begin (2007/2019 rules)', kind: 'policy'},
    {elevation: 1075, short: 'Tier 1', label: 'Tier 1 shortage (2007 rules)', kind: 'policy'},
    {elevation: 1050, short: 'Tier 2a · Intake 1', label: 'Tier 2a shortage; SNWA Intake 1 out of water', kind: 'policy'},
    {elevation: 1045, short: 'Tier 2b', label: 'Tier 2b: California reductions begin (2007 rules)', kind: 'policy'},
    {elevation: 1025, short: 'Tier 3', label: 'Tier 3 shortage (2007 rules)', kind: 'policy'},
    {elevation: 1010, short: 'Consultation', label: 'Basin-wide consultation trigger (2027–28 rules)', kind: 'policy'},
    {elevation: 1000, short: 'Intake 2', label: 'SNWA Intake 2 out of water', kind: 'infra'},
    {elevation: 950, short: 'Min. power pool', label: 'Minimum power pool: Hoover stops generating', kind: 'power'},
    {elevation: 895, short: 'Dead pool', label: 'Dead pool: no water can be released past Hoover Dam', kind: 'limit'},
    {elevation: 875, short: 'SNWA pumping limit', label: 'SNWA low-lake-level pumping station limit', kind: 'infra'}
];

// ---------------------------------------------------------------------------
// Regions

export interface RegionInfo {
    id: string;
    name: string;
    short: string;
    kind: 'city' | 'farm' | 'mixed' | 'intl';
    state: string;
    population: number;
    acres: number;
    /** Normal annual Colorado River supply relevant to this region, acre-feet */
    supplyAf: number;
    /** Share of the region's total water that comes from the Colorado via Mead */
    dependence: string;
    hooverShare?: string;
    basis: string;
    blurb: string;
    /** where the map flies when the region is selected */
    center: [number, number];
    zoom: number;
    /** label positions, each inside the region's own shaded area (default: one label at center) */
    labels?: {at: [number, number]; name: string}[];
}

export const REGIONS: RegionInfo[] = [
    {
        id: 'lv', name: 'Las Vegas Valley', short: 'Las Vegas Valley', kind: 'city', state: 'NV',
        population: 2_400_000, acres: 0, supplyAf: 300_000, dependence: '~90% of supply pumped straight from Lake Mead',
        hooverShare: 'Nevada holds ~23% of Hoover power',
        basis: 'Nevada’s cut compared with its 300,000 acre-foot yearly share of the river. Intake depths come from the Southern Nevada Water Authority.',
        blurb: 'Southern Nevada Water Authority draws from three intakes in Boulder Basin. Intake 1 sits at 1,050 ft, Intake 2 at 1,000 ft. The “third straw” Intake 3 (860 ft) and its low-lake-level pumping station keep water flowing down to ~875 ft.',
        center: [-115.1, 36.15], zoom: 9.5
    },
    {
        id: 'phx', name: 'Phoenix & Tucson (Central Arizona Project cities and tribes)', short: 'Phoenix & Tucson', kind: 'city', state: 'AZ',
        population: 5_900_000, acres: 0, supplyAf: 1_000_000, dependence: 'CAP is ~40% of Arizona’s water use; Tucson relies on it almost entirely',
        hooverShare: 'Arizona holds ~19% of Hoover power',
        basis: 'Arizona’s first 512,000 acre-feet of cuts fall on farms and other lower-priority users. Anything beyond that is compared with the roughly 1 million acre-feet the Central Arizona Project normally delivers to cities and tribes.',
        blurb: 'The 336-mile Central Arizona Project lifts water ~2,900 ft from Lake Havasu to Phoenix and Tucson. CAP holds junior priority, so Arizona’s cuts land on it first.',
        center: [-111.8, 33.0], zoom: 7.4,
        // Maricopa and Pima counties wrap around Pinal County, so label each city on its own county
        labels: [{at: [-112.1, 33.5], name: 'Phoenix'}, {at: [-110.95, 32.2], name: 'Tucson'}]
    },
    {
        id: 'pinal', name: 'Pinal County farms, central Arizona', short: 'Pinal County farms', kind: 'farm', state: 'AZ',
        population: 0, acres: 300_000, supplyAf: 300_000, dependence: 'CAP water was the main surface supply; now largely groundwater',
        basis: 'Water set aside for central Arizona farms is the first to be cut: Arizona’s first 512,000 acre-feet of cuts come from it, so a Tier 1 shortage or worse removes it entirely.',
        blurb: 'Cotton, alfalfa and dairy feed farms that lost most of their CAP water when Tier 1 began in 2022, and are fallowing fields or pumping groundwater.',
        center: [-111.75, 32.87], zoom: 8.6
    },
    {
        id: 'socal', name: 'Southern California cities (Metropolitan Water District)', short: 'Southern California', kind: 'city', state: 'CA',
        population: 19_000_000, acres: 0, supplyAf: 950_000, dependence: 'Colorado River Aqueduct supplies ~25–30% of the region',
        hooverShare: 'MWD, LADWP, SCE and cities hold ~57% of Hoover power; MWD uses it to pump the aqueduct',
        basis: 'An illustrative split: 60% of California’s cut, compared with the roughly 950,000 acre-feet the Colorado River Aqueduct normally carries.',
        blurb: 'Metropolitan pumps Lake Havasu water 242 miles over the desert to 26 member agencies from Ventura to San Diego.',
        center: [-117.6, 33.95], zoom: 7.3
    },
    {
        id: 'iid', name: 'Imperial Valley farms (Imperial Irrigation District)', short: 'Imperial Valley farms', kind: 'farm', state: 'CA',
        population: 180_000, acres: 475_000, supplyAf: 2_500_000, dependence: 'Colorado River is the only source of water',
        basis: 'An illustrative split: 30% of California’s cut, compared with the district’s usual 2.5 million acre-feet. Its rights date to 1901, among the oldest on the river.',
        blurb: 'The largest single user of Colorado River water. The All-American Canal carries ~2.5 MAF a year to winter vegetables, alfalfa and cattle feed.',
        center: [-115.55, 32.95], zoom: 8.7
    },
    {
        id: 'cvwd', name: 'Coachella Valley (Palm Springs area)', short: 'Coachella Valley', kind: 'mixed', state: 'CA',
        population: 450_000, acres: 70_000, supplyAf: 350_000, dependence: 'Coachella Canal supplies most farm water and recharges the aquifer',
        basis: 'An illustrative split: 7% of California’s cut, compared with the valley’s usual 350,000 acre-feet.',
        blurb: 'Dates, citrus, grapes and table vegetables, plus Palm Springs-area cities that recharge their aquifer with Colorado River water.',
        center: [-116.2, 33.65], zoom: 8.8
    },
    {
        id: 'pvid', name: 'Palo Verde Valley farms (Blythe)', short: 'Palo Verde Valley farms', kind: 'farm', state: 'CA',
        population: 20_000, acres: 104_000, supplyAf: 400_000, dependence: 'Colorado River is the only source',
        basis: 'An illustrative split: 3% of California’s cut, compared with its usual 400,000 acre-feet. Its rights date to 1877; most of its savings come from farmers paid to leave fields unplanted.',
        blurb: 'Alfalfa and hay around Blythe, irrigated by gravity from the river under some of the oldest rights on the Colorado.',
        center: [-114.62, 33.58], zoom: 9.5
    },
    {
        id: 'crit', name: 'Colorado River Indian Tribes (Parker Valley)', short: 'Colorado River Indian Tribes', kind: 'farm', state: 'AZ',
        population: 9_000, acres: 79_000, supplyAf: 660_000, dependence: 'Decreed (1865-priority) Colorado River rights',
        basis: 'Its rights are older than the rules that share out shortages, so it isn’t cut under them. It is affected only if Hoover Dam physically can’t release enough water.',
        blurb: 'The Mohave, Chemehuevi, Hopi and Navajo people of the Parker Valley farm ~79,000 acres under some of the most senior rights on the river.',
        center: [-114.35, 34.0], zoom: 9.6
    },
    {
        id: 'yuma', name: 'Yuma & Gila valleys', short: 'Yuma area', kind: 'mixed', state: 'AZ',
        population: 210_000, acres: 230_000, supplyAf: 1_000_000, dependence: 'Colorado River is the only source',
        basis: 'Its rights are older than the Central Arizona Project’s (from before 1968), so it isn’t cut under the shortage rules. It is affected only if Hoover Dam physically can’t release enough water.',
        blurb: 'Grows most of America’s winter lettuce and leafy greens. Senior rights shield Yuma from shortage tiers, but every drop must still pass Hoover Dam.',
        center: [-114.4, 32.72], zoom: 9
    },
    {
        id: 'mexico', name: 'Mexicali Valley & Tijuana (Mexico)', short: 'Mexico (Mexicali & Tijuana)', kind: 'intl', state: 'MX',
        population: 3_000_000, acres: 500_000, supplyAf: 1_500_000, dependence: '1.5 MAF a year under the 1944 Treaty',
        basis: 'Cuts follow the U.S.–Mexico agreement Minute 323 in years under the 2007 rules. The terms of the September 2026 agreement, Minute 334, aren’t modelled.',
        blurb: 'Mexico receives water at Morelos Dam below Yuma. Reductions are negotiated through the International Boundary and Water Commission.',
        center: [-115.2, 32.35], zoom: 8.5
    }
];

export const US_REGIONS = REGIONS.filter(r => r.kind !== 'intl');

export interface RegionImpact {
    id: string;
    severity: number | null;
    cutAf: number | null;
    cutFrac: number | null;
    powerLossFrac: number | null;
    physical: string | null;
    /** 0..1 physical supply risk (dam/intake limits), independent of policy */
    physSev: number;
    /** true when the region faces a scheduled water cut or a physical supply risk */
    waterAffected: boolean;
    status: string;
    short: string;
}

const CA_SPLIT: Record<string, number> = {socal: 0.6, iid: 0.3, cvwd: 0.07, pvid: 0.03};

function physicalRisk(h: number): {sev: number; note: string | null} {
    if (h <= DEAD_POOL) return {sev: 1, note: 'Dead pool: no water can be released past Hoover Dam'};
    if (h < MIN_POWER_POOL) return {sev: 0.6, note: 'Below 950 ft Hoover can release water only through small outlets, so deliveries downstream are severely limited'};
    return {sev: 0, note: null};
}

export function regionImpacts(h: number, s: Shortage): RegionImpact[] {
    const powerLoss = 1 - hooverCapacityMw(h) / HOOVER_NAMEPLATE;
    const phys = physicalRisk(h);
    return REGIONS.map(r => {
        let cut: number | null = 0;
        let physical = phys.note;
        let physSev = phys.sev;
        switch (r.id) {
            case 'lv': {
                cut = s.nv;
                // Las Vegas pumps from the lake itself, so dead pool does not cut it off.
                physSev = 0;
                physical = null;
                if (h < 875) {physSev = 1; physical = 'Below the low-lake-level pumping station: SNWA cannot draw water';}
                else if (h < 1000) {physSev = 0.3; physical = 'Only Intake 3, the “third straw”, still reaches water';}
                else if (h < 1050) {physical = 'Intake 1 is out of the water';}
                break;
            }
            case 'phx': cut = Math.max(0, s.az - 512_000); break;
            case 'pinal': cut = Math.min(s.az, 512_000) / 512_000 * r.supplyAf; break;
            case 'socal': case 'iid': case 'cvwd': case 'pvid': cut = s.ca * CA_SPLIT[r.id]; break;
            case 'crit': case 'yuma': cut = 0; break;
            case 'mexico': cut = s.mx; break;
        }
        const cutFrac = cut === null ? null : Math.min(1, cut / r.supplyAf);
        const pl = r.hooverShare ? powerLoss : null;
        let severity: number | null = cutFrac === null ? null : Math.max(cutFrac, (pl ?? 0) * 0.5, physSev);
        if (cutFrac === null && physSev > 0) severity = physSev;

        const pct = cutFrac ? Math.round(cutFrac * 100) : 0;
        const plPct = pl !== null ? Math.round(pl * 100) : 0;
        const parts: string[] = [];
        let short: string;
        if (severity === null) {
            parts.push('Mexico’s 2027–28 share of the cuts is set by a U.S.–Mexico agreement (Minute 334) that isn’t modelled here');
            short = 'Cut not modelled';
        } else if (physSev >= 1) {
            parts.push(physical!);
            short = 'No water arrives';
        } else {
            if (cut && cutFrac! > 0.005) {
                parts.push(cutFrac! >= 0.995
                    ? `Gets ${fmtAfLong(cut)} acre-feet less river water a year: none of its usual Colorado River supply`
                    : `Gets ${fmtAfLong(cut)} acre-feet less river water a year (${pct}% of its usual Colorado River supply)`);
            }
            if (physical) parts.push(physical);
            if (!parts.length) parts.push(r.id === 'crit' || r.id === 'yuma' ? 'Protected by senior water rights: no cut scheduled' : 'No water cut scheduled at this level');
            if (pl !== null && pl > 0.02) parts.push(`Hoover Dam is making ${plPct}% less power, so less low-cost electricity reaches its utilities`);
            short = cut && cutFrac! > 0.005 ? (cutFrac! >= 0.995 ? 'All river water cut' : `${pct}% less river water`)
                : physSev > 0 ? 'Supply at risk'
                    : pl !== null && pl > 0.05 ? `${plPct}% less Hoover power` : 'No water cut';
        }
        const waterAffected = (cutFrac ?? 0) >= 0.02 || physSev > 0;
        return {id: r.id, severity, cutAf: cut, cutFrac, powerLossFrac: pl, physical, physSev, waterAffected, status: parts.join(' · '), short};
    });
}

/** 21000 -> "21,000"; 1250000 -> "1.25 million" */
export function fmtAfLong(v: number) {
    if (v >= 1e6) return `${(v / 1e6).toFixed(2).replace(/\.?0+$/, '')} million`;
    const r = v >= 1e5 ? Math.round(v / 1e4) * 1e4 : v >= 1e4 ? Math.round(v / 1e3) * 1e3 : Math.round(v / 100) * 100;
    return r.toLocaleString('en-US');
}

/** One plain sentence on what this region's numbers mean in practice. */
export function impactMeaning(r: RegionInfo, imp: RegionImpact): string {
    const cut = imp.cutFrac ?? 0;
    const homes = imp.cutAf ? Math.round(imp.cutAf * 2 / 1000) * 1000 : 0;
    const homesTxt = homes >= 1000 ? ` That much water would supply roughly ${homes.toLocaleString('en-US')} homes for a year.` : '';
    if (imp.severity === null) return 'Mexico takes reductions under its own treaty agreements with the United States.';
    if (imp.physSev >= 1) return r.id === 'lv'
        ? 'The lake has dropped below Las Vegas’s deepest pumps, so the valley would have to rely on limited groundwater and stored supplies.'
        : 'No water can leave Lake Mead, so canals and the river downstream would run dry except for local inflows and groundwater.';
    if (cut >= 0.995) return `None of its usual Colorado River water arrives. ${r.kind === 'farm' ? 'Farmers pump groundwater where they can or leave fields unplanted.' : 'It must rely on groundwater, recycled and stored water.'}${homesTxt}`;
    if (cut > 0.005) {
        const how = r.kind === 'farm' ? 'Farms make up the gap by leaving some fields unplanted (often paid to) or pumping groundwater.'
            : r.kind === 'city' ? 'Cities make up the gap with conservation, groundwater and water banked in earlier years.'
                : 'The gap is met by leaving some fields unplanted, conservation and groundwater.';
        return `It receives ${Math.round(cut * 100)}% less Colorado River water than usual. ${how}${homesTxt}`;
    }
    if (imp.physSev > 0) return 'No cut is scheduled, but Hoover Dam may not physically be able to release all of the water ordered.';
    if ((imp.powerLossFrac ?? 0) > 0.05) return `Water deliveries are unaffected, but Hoover Dam’s smaller power output means its utilities buy more replacement electricity, usually at higher cost.`;
    return r.id === 'crit' || r.id === 'yuma' ? 'Older (senior) water rights are served first, so this area keeps its full supply until the lake falls much further.' : 'Its Colorado River supply is not cut at this level.';
}

export function fmtAf(v: number) {
    if (v >= 1e6) return (v / 1e6).toFixed(2).replace(/\.?0+$/, '') + 'M';
    if (v >= 1e3) return Math.round(v / 1e3) + 'k';
    return String(Math.round(v));
}

export const SEVERITY_STOPS: [number, string][] = [
    [0, '#4fb39a'],
    [0.05, '#b9d36c'],
    [0.15, '#f2c94c'],
    [0.3, '#f2994a'],
    [0.5, '#e0533d'],
    [0.8, '#9b1d3a']
];

export function severityColor(s: number | null): string {
    if (s === null) return '#8a94a6';
    for (let i = SEVERITY_STOPS.length - 1; i >= 0; i--) if (s >= SEVERITY_STOPS[i][0]) return SEVERITY_STOPS[i][1];
    return SEVERITY_STOPS[0][1];
}

export function severityLabel(s: number | null): string {
    if (s === null) return 'Not modeled';
    if (s >= 0.8) return 'Critical';
    if (s >= 0.5) return 'Severe';
    if (s >= 0.3) return 'High';
    if (s >= 0.15) return 'Moderate';
    if (s >= 0.05) return 'Low';
    return 'Minimal';
}

// ---------------------------------------------------------------------------
// Downstream flows
//
// Lake Mead's elevation reaches the river and canals two ways: the shortage
// schedule cuts the water ordered from Hoover Dam, and below 950 ft (outlet
// works only) and 895 ft (dead pool) the dam physically can't release it.
// Normal deliveries are rounded recent pre-shortage figures (est.); they sum to
// a ~9.0 MAF Hoover release, close to the 8.5–9.2 MAF released in 2019–2021.

export interface Flow {
    id: 'r1' | 'r2' | 'r3' | 'cap' | 'cra' | 'aac' | 'coachella';
    name: string;
    short: string;
    maf: number;
    normal: number;
    ratio: number;
    dry: boolean;
    note: string | null;
    observed: boolean;
}

export const NORMAL_FLOW = {cap: 1.5, cra: 1.0, aac: 2.6, coachella: 0.3, valley: 0.9, yuma: 0.8, mexico: 1.5};
const LOSS_R1 = 0.4; // mainstem users and evaporation between Hoover and Parker dams
const LOSS_R2 = 0.3; // riparian use and evaporation between Parker and Imperial dams

export function downstreamFlows(h: number, s: Shortage, observedHooverMaf: number | null): Flow[] {
    const az = s.az / 1e6, ca = s.ca / 1e6, mx = (s.mx ?? 0) / 1e6;
    const dead = h <= DEAD_POOL;
    const limited = !dead && h < MIN_POWER_POOL;
    const cap = Math.max(0, NORMAL_FLOW.cap - Math.min(az, NORMAL_FLOW.cap));
    const cra = Math.max(0, NORMAL_FLOW.cra - CA_SPLIT.socal * ca);
    const coachella = Math.max(0, NORMAL_FLOW.coachella - CA_SPLIT.cvwd * ca);
    const aac = Math.max(0, NORMAL_FLOW.aac - (CA_SPLIT.iid + CA_SPLIT.cvwd) * ca);
    const valley = Math.max(0, NORMAL_FLOW.valley - CA_SPLIT.pvid * ca);
    const r3 = NORMAL_FLOW.yuma + Math.max(0, NORMAL_FLOW.mexico - mx);
    const r2 = valley + LOSS_R2 + aac + r3;
    let r1 = r2 + cap + cra + LOSS_R1;
    const n3 = NORMAL_FLOW.yuma + NORMAL_FLOW.mexico;
    const n2 = NORMAL_FLOW.valley + LOSS_R2 + NORMAL_FLOW.aac + n3;
    const n1 = n2 + NORMAL_FLOW.cap + NORMAL_FLOW.cra + LOSS_R1;
    const observed = observedHooverMaf !== null && !dead;
    if (observed) r1 = observedHooverMaf!;

    const note = dead ? 'Dead pool: no water passes Hoover Dam'
        : limited ? 'Below 950 ft Hoover can release water only through small outlets, so these flows may not be deliverable' : null;
    const mk = (id: Flow['id'], name: string, short: string, maf: number, normal: number, obs = false): Flow => {
        const v = dead ? 0 : maf;
        return {id, name, short, maf: v, normal, ratio: normal ? v / normal : 0, dry: dead || v < 0.01, note, observed: obs};
    };
    return [
        mk('r1', 'Colorado River below Hoover Dam', 'River below Hoover Dam', r1, n1, observed),
        mk('cap', 'Central Arizona Project canal', 'Central Arizona canal', cap, NORMAL_FLOW.cap),
        mk('cra', 'Colorado River Aqueduct', 'Southern California aqueduct', cra, NORMAL_FLOW.cra),
        mk('r2', 'Colorado River below Parker Dam', 'River below Parker Dam', r2, n2),
        mk('aac', 'All-American Canal', 'All-American Canal', aac, NORMAL_FLOW.aac),
        mk('coachella', 'Coachella Canal', 'Coachella Canal', coachella, NORMAL_FLOW.coachella),
        mk('r3', 'Colorado River below Imperial Dam (to Yuma & Mexico)', 'River to Yuma & Mexico', r3, n3)
    ];
}

export interface DownstreamLake {
    name: string;
    dam: string;
    elevation: number | null;
    range: [number, number];
    status: string;
}

/** Lakes Mohave and Havasu are run within narrow ranges while Hoover keeps releasing. */
export function downstreamLakes(h: number, mohave: number | null, havasu: number | null, isObserved: boolean): DownstreamLake[] {
    const dead = h <= DEAD_POOL;
    const status = (lvl: number | null, [lo, hi]: [number, number]) =>
        dead ? 'No inflow from Hoover: would be drawn down as downstream users keep diverting'
            : !isObserved ? 'Held within its normal operating range by dam operations'
                : lvl === null ? 'No reading' : lvl >= lo && lvl <= hi ? 'Within normal operating range' : 'Outside normal operating range';
    return [
        {name: 'Lake Mohave', dam: 'Davis Dam', elevation: mohave, range: [630, 647], status: status(mohave, [630, 647])},
        {name: 'Lake Havasu', dam: 'Parker Dam', elevation: havasu, range: [440, 450], status: status(havasu, [440, 450])}
    ];
}
