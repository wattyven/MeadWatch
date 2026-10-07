import maplibregl, {type LayerSpecification, type StyleSpecification, type Map as MlMap} from 'maplibre-gl';
import type {AppData} from './data';
import {DEM_ATTRIBUTION, DEM_MAXZOOM, type Raster} from './terrain';
import {WaterLayer} from './waterLayer';
import {type Flow, REGIONS, type RegionImpact, severityColor} from './impacts';
import {type Basemap, RELIEF_COLORS, type VectorBase, basemapVisibility, isRoadLayer, loadVectorBase} from './basemap';
import type {Camera} from './urlState';

export type {Basemap};

export const VIEWS = {
    lake: {center: [-114.52, 36.0] as [number, number], zoom: 9.35, pitch: 62, bearing: 8},
    dam: {center: [-114.775, 36.04] as [number, number], zoom: 12.1, pitch: 66, bearing: 38},
    overton: {center: [-114.41, 36.3] as [number, number], zoom: 10.6, pitch: 62, bearing: -12},
    region: {center: [-115.6, 33.9] as [number, number], zoom: 6.35, pitch: 38, bearing: 0}
};
export type ViewId = keyof typeof VIEWS;

const BASE = import.meta.env.BASE_URL;

/** Line width interpolated by zoom and multiplied by the flow scale in feature-state. */
function widthByFlow(extra: number, z5: number, z9: number, z13: number): maplibregl.ExpressionSpecification {
    const k: maplibregl.ExpressionSpecification = ['coalesce', ['feature-state', 'scale'], 1];
    return ['interpolate', ['linear'], ['zoom'],
        5, ['+', extra, ['*', z5, k]], 9, ['+', extra * 1.2, ['*', z9, k]], 13, ['+', extra * 1.5, ['*', z13, k]]];
}

/** Where each reach's or canal's flow label sits. */
const FLOW_ANCHORS: Record<string, [number, number]> = {
    r1: [-114.57, 34.95], cap: [-113.8, 33.97], cra: [-115.78, 33.78], r2: [-114.55, 33.82],
    aac: [-115.05, 32.66], coachella: [-115.62, 33.40], r3: [-114.75, 32.56]
};

function style(app: AppData, base: VectorBase, basemap: Basemap): StyleSpecification {
    const [w, s, e, n] = app.meta.bounds;
    const vis = new Map(basemapVisibility(base, basemap));
    const withVis = (l: LayerSpecification): LayerSpecification =>
        vis.has(l.id) ? {...l, layout: {...(l as {layout?: object}).layout, visibility: vis.get(l.id)}} as LayerSpecification : l;
    return {
        version: 8,
        glyphs: 'https://tiles.openfreemap.org/fonts/{fontstack}/{range}.pbf',
        ...(base.sprite ? {sprite: base.sprite} : {}),
        sources: {
            ...base.sources,
            satellite: {
                type: 'raster', tileSize: 256, maxzoom: 14,
                tiles: ['https://tiles.maps.eox.at/wmts/1.0.0/s2cloudless_3857/default/g/{z}/{y}/{x}.jpg'],
                attribution: '<a href="https://s2maps.eu">Sentinel-2 cloudless</a> by EOX (2016, CC BY 4.0), modified Copernicus Sentinel data'
            },
            dem: {type: 'raster-dem', tiles: ['meadem://{z}/{x}/{y}'], tileSize: 256, encoding: 'terrarium', maxzoom: DEM_MAXZOOM, attribution: DEM_ATTRIBUTION},
            hill: {type: 'raster-dem', tiles: ['meadem://{z}/{x}/{y}'], tileSize: 256, encoding: 'terrarium', maxzoom: DEM_MAXZOOM},
            ring: {
                type: 'image', url: BASE + 'data/mead_ring.webp',
                coordinates: [[w, n], [e, n], [e, s], [w, s]]
            },
            contours: {type: 'geojson', data: BASE + 'data/mead_contours.geojson'},
            regions: {type: 'geojson', data: app.regions, promoteId: 'id'},
            // all pieces of one conveyance share an id, so one feature-state colours them all
            waterways: {type: 'geojson', data: BASE + 'data/waterways.geojson', promoteId: 'id'},
            labels: {type: 'geojson', data: {type: 'FeatureCollection', features: []}},
            flowlabels: {type: 'geojson', data: {type: 'FeatureCollection', features: []}}
        },
        layers: [
            {id: 'bg', type: 'background', paint: {'background-color': '#ebe5d6'}},
            withVis({id: 'base-satellite', type: 'raster', source: 'satellite'}),
            withVis({id: 'base-relief', type: 'color-relief', source: 'hill', paint: {'color-relief-color': RELIEF_COLORS, 'color-relief-opacity': 1}}),
            ...base.under.filter(l => !isRoadLayer(l.id) && !/^ofm-(water|waterway)/.test(l.id) && !/boundary/.test(l.id)).map(withVis),
            {
                id: 'hillshade', type: 'hillshade', source: 'hill',
                paint: {
                    'hillshade-exaggeration': basemap === 'satellite' ? 0.12 : 0.42,
                    'hillshade-shadow-color': '#3d3328',
                    'hillshade-highlight-color': '#fffaf0',
                    'hillshade-accent-color': '#5c4b38'
                }
            },
            ...base.under.filter(l => /^ofm-(water|waterway)/.test(l.id) || /boundary/.test(l.id) || isRoadLayer(l.id)).map(withVis),
            {id: 'lakebed', type: 'raster', source: 'ring', paint: {'raster-opacity': 1, 'raster-fade-duration': 0, 'raster-resampling': 'linear'}},
            {
                // shorelines at operating thresholds; the water plane hides the submerged ones
                id: 'lakebed-contours', type: 'line', source: 'contours', filter: ['<', ['get', 'elevation'], 1229],
                layout: {'line-join': 'round'},
                paint: {
                    'line-color': ['match', ['get', 'elevation'], 1075, '#c9871f', 950, '#c8402f', 895, '#7d1530', '#4f6a86'],
                    'line-width': ['interpolate', ['linear'], ['zoom'], 8, 0.8, 12, 1.8],
                    'line-dasharray': [3, 2],
                    'line-opacity': 0.9
                }
            },
            {
                id: 'lakebed-outline', type: 'line', source: 'contours', filter: ['==', ['get', 'elevation'], 1229], minzoom: 7.5,
                layout: {'line-join': 'round'},
                paint: {
                    'line-color': '#1f2c3b',
                    'line-width': ['interpolate', ['linear'], ['zoom'], 7, 0.8, 10, 1.6, 13, 2.6],
                    'line-opacity': 0.85
                }
            },
            {
                id: 'region-fill', type: 'fill', source: 'regions', filter: ['==', ['get', 'layer'], 'region'],
                paint: {
                    'fill-color': ['to-color', ['coalesce', ['feature-state', 'color'], '#8a94a6']],
                    'fill-opacity': ['case', ['boolean', ['feature-state', 'hover'], false], 0.62, 0.42]
                }
            },
            {
                id: 'region-line', type: 'line', source: 'regions', filter: ['==', ['get', 'layer'], 'region'],
                paint: {
                    'line-color': ['to-color', ['coalesce', ['feature-state', 'color'], '#8a94a6']],
                    'line-width': ['case', ['boolean', ['feature-state', 'selected'], false], 3.2, 1.4],
                    'line-opacity': 0.95
                }
            },
            {
                id: 'aqueduct-casing', type: 'line', source: 'regions', filter: ['==', ['get', 'layer'], 'aqueduct'],
                layout: {'line-cap': 'round', 'line-join': 'round'},
                paint: {'line-color': '#0e1520', 'line-width': ['interpolate', ['linear'], ['zoom'], 5, 4.5, 10, 8], 'line-opacity': 0.85}
            },
            {
                id: 'aqueduct', type: 'line', source: 'regions', filter: ['==', ['get', 'layer'], 'aqueduct'],
                layout: {'line-cap': 'round', 'line-join': 'round'},
                paint: {
                    'line-color': ['to-color', ['coalesce', ['feature-state', 'color'], '#5cc8e0']],
                    'line-width': ['interpolate', ['linear'], ['zoom'], 5, 2.2, 10, 4],
                    'line-dasharray': [2.2, 1.3]
                }
            },
            // OSM-traced river and canals. Bridged pieces of the river (reservoirs with no
            // mapped centreline) are not drawn: the basemap's lake shows there instead.
            // Line width scales with modeled flow (feature-state `scale`); `dry` greys it out.
            {
                id: 'ww-casing', type: 'line', source: 'waterways',
                filter: ['all', ['!', ['get', 'gap']], ['!', ['get', 'schematic']]],
                layout: {'line-cap': 'round', 'line-join': 'round'},
                paint: {
                    'line-color': ['match', ['get', 'kind'], 'river', '#ffffff', '#0e1520'],
                    'line-width': widthByFlow(1.6, 3.4, 5.5, 9),
                    'line-opacity': ['case', ['boolean', ['feature-state', 'dry'], false], 0.45, ['match', ['get', 'kind'], 'river', 0.75, 0.8]]
                }
            },
            {
                id: 'ww-line', type: 'line', source: 'waterways',
                filter: ['all', ['!', ['get', 'gap']], ['!', ['get', 'schematic']]],
                layout: {'line-cap': 'round', 'line-join': 'round'},
                paint: {
                    'line-color': ['case', ['boolean', ['feature-state', 'dry'], false], '#a3a9b1',
                        ['match', ['get', 'kind'], 'river', '#1f78d1', ['to-color', ['coalesce', ['feature-state', 'color'], '#5cc8e0']]]],
                    'line-width': widthByFlow(0, 1.8, 3, 5)
                }
            },
            {
                // siphons and tunnel portals bridged on canals
                id: 'ww-gap', type: 'line', source: 'waterways',
                filter: ['all', ['get', 'gap'], ['==', ['get', 'kind'], 'canal']],
                paint: {
                    'line-color': ['to-color', ['coalesce', ['feature-state', 'color'], '#5cc8e0']],
                    'line-width': ['interpolate', ['linear'], ['zoom'], 5, 1.4, 10, 2.5],
                    'line-dasharray': [1, 1.4]
                }
            },
            {
                id: 'ww-schematic-casing', type: 'line', source: 'waterways', filter: ['get', 'schematic'],
                layout: {'line-cap': 'round', 'line-join': 'round'},
                paint: {'line-color': '#0e1520', 'line-width': ['interpolate', ['linear'], ['zoom'], 5, 3.6, 10, 5.5], 'line-opacity': 0.55}
            },
            {
                // Colorado River Aqueduct: buried conduit, drawn through its pumping plants
                id: 'ww-schematic', type: 'line', source: 'waterways', filter: ['get', 'schematic'],
                layout: {'line-cap': 'round', 'line-join': 'round'},
                paint: {
                    'line-color': ['case', ['boolean', ['feature-state', 'dry'], false], '#a3a9b1',
                        ['to-color', ['coalesce', ['feature-state', 'color'], '#5cc8e0']]],
                    'line-width': ['interpolate', ['linear'], ['zoom'], 5, 2, 10, 3.2],
                    'line-dasharray': [1.2, 1.2],
                    'line-opacity': 0.95
                }
            }
        ]
    };
}

const SYMBOL_LAYERS: maplibregl.LayerSpecification[] = [
    {
        id: 'lakebed-contour-labels', type: 'symbol', source: 'contours', minzoom: 9.6,
        filter: ['>', ['get', 'elevation'], 1040],
        layout: {
            'symbol-placement': 'line', 'symbol-spacing': 420, 'text-field': ['get', 'label'],
            'text-font': ['Noto Sans Bold'], 'text-size': 10.5, 'text-max-angle': 30, 'text-padding': 8
        },
        paint: {
            'text-color': ['match', ['get', 'elevation'], 1229, '#1f2c3b', 1075, '#8a5a0e', 950, '#9e2a1e', 895, '#6b1129', '#33506e'],
            'text-halo-color': 'rgba(255,255,255,0.92)', 'text-halo-width': 1.6
        }
    },
    {
        id: 'basin-label', type: 'symbol', source: 'regions', filter: ['==', ['get', 'layer'], 'basin'], minzoom: 8.5,
        layout: {
            'text-field': ['get', 'name'], 'text-font': ['Noto Sans Italic'], 'text-size': 12.5,
            'text-letter-spacing': 0.08, 'text-allow-overlap': false
        },
        paint: {'text-color': '#0d4f7c', 'text-halo-color': 'rgba(255,255,255,0.85)', 'text-halo-width': 1.4}
    },
    {
        id: 'poi-dot', type: 'circle', source: 'regions', filter: ['==', ['get', 'layer'], 'poi'],
        paint: {
            'circle-radius': ['match', ['get', 'id'], 'hoover', 6, 4],
            'circle-color': ['match', ['get', 'kind'], 'dam', '#1d2433', '#2f7fb8'],
            'circle-stroke-color': '#fff', 'circle-stroke-width': 1.6
        }
    },
    {
        id: 'poi-label', type: 'symbol', source: 'regions', filter: ['==', ['get', 'layer'], 'poi'],
        minzoom: 6.5,
        layout: {
            'text-field': ['get', 'name'], 'text-font': ['Noto Sans Bold'], 'text-size': ['match', ['get', 'id'], 'hoover', 13, 11],
            'text-offset': [0, 1.0], 'text-anchor': 'top', 'text-optional': true
        },
        paint: {'text-color': '#1d2433', 'text-halo-color': 'rgba(255,255,255,0.9)', 'text-halo-width': 1.5}
    },
    {
        id: 'flow-label', type: 'symbol', source: 'flowlabels', minzoom: 5.6, maxzoom: 10.5,
        layout: {
            'text-field': ['format',
                ['get', 'name'], {'font-scale': 0.92, 'text-font': ['literal', ['Noto Sans Bold']]},
                '\n', {},
                ['get', 'flow'], {'font-scale': 0.86, 'text-font': ['literal', ['Noto Sans Regular']]}],
            'text-font': ['Noto Sans Bold'], 'text-size': 11.5, 'text-line-height': 1.2,
            'text-variable-anchor': ['left', 'right', 'top', 'bottom'], 'text-radial-offset': 0.9, 'text-padding': 3
        },
        paint: {
            'text-color': ['case', ['get', 'dry'], '#7a2b2b', '#0d4f7c'],
            'text-halo-color': 'rgba(255,255,255,0.92)', 'text-halo-width': 1.6
        }
    },
    {
        id: 'region-label', type: 'symbol', source: 'labels', maxzoom: 9.2,
        layout: {
            'text-field': ['format',
                ['get', 'name'], {'font-scale': 1, 'text-font': ['literal', ['Noto Sans Bold']]},
                '\n', {},
                ['get', 'status'], {'font-scale': 0.82, 'text-font': ['literal', ['Noto Sans Regular']]}],
            'text-font': ['Noto Sans Bold'], 'text-size': 13, 'text-max-width': 14, 'text-line-height': 1.25,
            'text-allow-overlap': false, 'text-padding': 4
        },
        paint: {
            'text-color': '#151b26', 'text-halo-color': 'rgba(255,255,255,0.92)', 'text-halo-width': 1.8
        }
    }
];

export interface MapHandles {
    map: MlMap;
    water: WaterLayer;
    setBasemap(b: Basemap): void;
    getCamera(): Camera;
    setLevel(ft: number): void;
    setView(v: ViewId): void;
    setTerrain(on: boolean, exaggeration?: number): void;
    updateImpacts(impacts: RegionImpact[]): void;
    updateFlows(flows: Flow[]): void;
    onRegionClick(cb: (id: string) => void): void;
    selectRegion(id: string | null, fly?: boolean): void;
}

export interface MapOptions {
    camera?: Camera;
    basemap: Basemap;
    interactive?: boolean;
}

export async function createMap(container: HTMLElement, app: AppData, w: Raster, floor: Raster, opts: MapOptions): Promise<MapHandles> {
    const phone = window.innerWidth <= 760;
    const base = await loadVectorBase();
    const map = new maplibregl.Map({
        container,
        style: style(app, base, opts.basemap),
        ...(opts.camera ?? {...VIEWS.lake, zoom: VIEWS.lake.zoom - (phone ? 1.1 : 0)}),
        maxPitch: 80,
        attributionControl: {compact: true},
        interactive: opts.interactive ?? true,
        canvasContextAttributes: {antialias: true}
    });
    map.addControl(new maplibregl.NavigationControl({visualizePitch: true}), 'top-right');
    map.addControl(new maplibregl.ScaleControl({unit: 'imperial'}), 'bottom-right');

    const water = new WaterLayer(app.meta, w, floor);
    let exaggeration = 1.6;
    let selected: string | null = null;
    const clickHandlers: ((id: string) => void)[] = [];

    return new Promise(resolve => {
        const applyPadding = () => map.setPadding(panelPadding());
        applyPadding();
        window.addEventListener('resize', applyPadding);
        map.on('load', () => {
            if (phone) container.querySelector('.maplibregl-ctrl-attrib')?.classList.remove('maplibregl-compact-show');
            map.setTerrain({source: 'dem', exaggeration});
            map.setSky({
                'sky-color': '#9cc3e6', 'horizon-color': '#e8eef2', 'fog-color': '#e9e4d8',
                'sky-horizon-blend': 0.6, 'horizon-fog-blend': 0.6, 'fog-ground-blend': 0.35, 'atmosphere-blend': 0
            });
            map.addLayer(water);
            for (const l of base.labels) map.addLayer(l);
            for (const l of SYMBOL_LAYERS) map.addLayer(l);

            let hovered: string | null = null;
            map.on('mousemove', 'region-fill', e => {
                const id = e.features?.[0]?.properties?.id as string | undefined;
                if (id === hovered) return;
                if (hovered) map.setFeatureState({source: 'regions', id: hovered}, {hover: false});
                hovered = id ?? null;
                if (hovered) map.setFeatureState({source: 'regions', id: hovered}, {hover: true});
                map.getCanvas().style.cursor = 'pointer';
            });
            map.on('mouseleave', 'region-fill', () => {
                if (hovered) map.setFeatureState({source: 'regions', id: hovered}, {hover: false});
                hovered = null;
                map.getCanvas().style.cursor = '';
            });
            map.on('click', 'region-fill', e => {
                const id = e.features?.[0]?.properties?.id as string | undefined;
                if (id) clickHandlers.forEach(cb => cb(id));
            });

            const handles: MapHandles = {
                map,
                water,
                setBasemap(b) {
                    for (const [id, v] of basemapVisibility(base, b)) if (map.getLayer(id)) map.setLayoutProperty(id, 'visibility', v);
                    map.setPaintProperty('hillshade', 'hillshade-exaggeration', b === 'satellite' ? 0.12 : 0.42);
                    for (const l of base.under) {
                        if (isRoadLayer(l.id) && l.type === 'line') map.setPaintProperty(l.id, 'line-opacity', b === 'satellite' ? 0.55 : 1);
                    }
                },
                setLevel(ft) {
                    water.setLevel(ft);
                    // Only show shorelines that are above the water. Submerged ones are normally
                    // hidden by the water plane, but in canyons narrower than the terrain mesh
                    // the smoothed surface would show them through.
                    map.setFilter('lakebed-contour-labels', ['>', ['get', 'elevation'], ft + 0.5]);
                    map.setFilter('lakebed-contours', ['all', ['<', ['get', 'elevation'], 1229], ['>', ['get', 'elevation'], ft + 0.5]]);
                },
                getCamera() {
                    const c = map.getCenter();
                    return {center: [c.lng, c.lat], zoom: map.getZoom(), pitch: map.getPitch(), bearing: map.getBearing()};
                },
                setView(v) {
                    if (v === 'region') {
                        map.fitBounds([[-118.9, 31.9], [-110.8, 36.45]], {pitch: 30, bearing: 0, duration: 2600, essential: true});
                    } else {
                        map.flyTo({...VIEWS[v], duration: 2600, essential: true});
                    }
                },
                setTerrain(on, ex) {
                    if (ex !== undefined) exaggeration = ex;
                    map.setTerrain(on ? {source: 'dem', exaggeration} : null);
                    if (!on) map.easeTo({pitch: 0, duration: 800});
                    water.setLevel(water.level);
                },
                updateImpacts(impacts) {
                    const byId = new Map(impacts.map(i => [i.id, i]));
                    for (const imp of impacts) {
                        map.setFeatureState({source: 'regions', id: imp.id}, {color: severityColor(imp.severity)});
                    }
                    const aqueductTarget: Record<string, [string, string]> = {
                        cra: ['waterways', 'socal'], cap: ['waterways', 'phx'], aac: ['waterways', 'iid'],
                        coachella: ['waterways', 'cvwd'], snwa: ['regions', 'lv']
                    };
                    for (const [aq, [source, region]] of Object.entries(aqueductTarget)) {
                        const imp = byId.get(region);
                        map.setFeatureState({source, id: aq}, {color: imp ? severityColor(imp.severity) : '#5cc8e0'});
                    }
                    const features = REGIONS.flatMap(r => {
                        const imp = byId.get(r.id)!;
                        return (r.labels ?? [{at: r.center, name: r.short}]).map(l => ({
                            type: 'Feature' as const,
                            properties: {name: l.name, status: imp.short, rid: r.id},
                            geometry: {type: 'Point' as const, coordinates: l.at}
                        }));
                    });
                    (map.getSource('labels') as maplibregl.GeoJSONSource).setData({type: 'FeatureCollection', features});
                },
                updateFlows(flows) {
                    for (const f of flows) {
                        // area-like scaling so a halved flow reads as clearly thinner, never vanishing
                        const scale = f.dry ? 0.55 : 0.35 + 0.65 * Math.sqrt(Math.min(1.2, f.ratio));
                        map.setFeatureState({source: 'waterways', id: f.id}, {scale, dry: f.dry});
                    }
                    const fmt = (f: Flow) => f.dry ? 'dry: no water released'
                        : `${f.maf.toFixed(2)} MAF a year${Math.abs(f.ratio - 1) >= 0.01 ? `, ${Math.round(Math.abs(1 - f.ratio) * 100)}% ${f.ratio < 1 ? 'below' : 'above'} normal` : ', normal'}`;
                    (map.getSource('flowlabels') as maplibregl.GeoJSONSource).setData({
                        type: 'FeatureCollection',
                        features: flows.map(f => ({
                            type: 'Feature' as const,
                            properties: {name: f.short, flow: fmt(f), dry: f.dry},
                            geometry: {type: 'Point' as const, coordinates: FLOW_ANCHORS[f.id]}
                        }))
                    });
                },
                onRegionClick(cb) {
                    clickHandlers.push(cb);
                },
                selectRegion(id, fly = true) {
                    if (selected) map.setFeatureState({source: 'regions', id: selected}, {selected: false});
                    selected = id;
                    if (id) {
                        map.setFeatureState({source: 'regions', id}, {selected: true});
                        const r = REGIONS.find(x => x.id === id)!;
                        if (fly) map.flyTo({center: r.center, zoom: r.zoom, pitch: 45, bearing: 0, duration: 2200, essential: true});
                    }
                }
            };
            if (opts.basemap === 'satellite') handles.setBasemap('satellite');
            resolve(handles);
        });
    });
}

/** Keep camera targets centred in the part of the map not covered by panels. */
function panelPadding() {
    const w = window.innerWidth;
    if (w < 1000) return {top: 120, bottom: 260, left: 0, right: 0};
    const side = w < 1280 ? 280 : 312;
    return {top: 60, bottom: 250, left: side + 24, right: side + 24};
}

