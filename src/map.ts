import maplibregl, {type StyleSpecification, type Map as MlMap} from 'maplibre-gl';
import type {AppData} from './data';
import {DEM_ATTRIBUTION, DEM_MAXZOOM, type Raster} from './terrain';
import {WaterLayer} from './waterLayer';
import {REGIONS, type RegionImpact, severityColor} from './impacts';

export type Basemap = 'topo' | 'osm' | 'satellite';

export const VIEWS = {
    lake: {center: [-114.52, 36.0] as [number, number], zoom: 9.35, pitch: 62, bearing: 8},
    dam: {center: [-114.775, 36.04] as [number, number], zoom: 12.1, pitch: 66, bearing: 38},
    overton: {center: [-114.41, 36.3] as [number, number], zoom: 10.6, pitch: 62, bearing: -12},
    region: {center: [-115.6, 33.9] as [number, number], zoom: 6.35, pitch: 38, bearing: 0}
};
export type ViewId = keyof typeof VIEWS;

const BASE = import.meta.env.BASE_URL;

function style(app: AppData): StyleSpecification {
    const [w, s, e, n] = app.meta.bounds;
    return {
        version: 8,
        glyphs: 'https://tiles.openfreemap.org/fonts/{fontstack}/{range}.pbf',
        sources: {
            // OpenTopoMap drops its elevation tint from z11, so the tinted z≤10 tiles
            // are used everywhere and the crisp z11+ tiles fade in on close-ups.
            topo: {
                type: 'raster', tileSize: 256, maxzoom: 10,
                tiles: ['a', 'b', 'c'].map(sd => `https://${sd}.tile.opentopomap.org/{z}/{x}/{y}.png`),
                attribution: 'Map data © <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors, SRTM · Style © <a href="https://opentopomap.org">OpenTopoMap</a> (CC-BY-SA)'
            },
            topoHigh: {
                type: 'raster', tileSize: 256, minzoom: 11, maxzoom: 17,
                tiles: ['a', 'b', 'c'].map(sd => `https://${sd}.tile.opentopomap.org/{z}/{x}/{y}.png`)
            },
            osm: {
                type: 'raster', tileSize: 256, maxzoom: 19,
                tiles: ['https://tile.openstreetmap.org/{z}/{x}/{y}.png'],
                attribution: '© <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors'
            },
            satellite: {
                type: 'raster', tileSize: 256, maxzoom: 14,
                tiles: ['https://tiles.maps.eox.at/wmts/1.0.0/s2cloudless_3857/default/g/{z}/{y}/{x}.jpg'],
                attribution: '<a href="https://s2maps.eu">Sentinel-2 cloudless</a> by EOX (2016, CC BY 4.0), modified Copernicus Sentinel data'
            },
            dem: {type: 'raster-dem', tiles: ['meadem://{z}/{x}/{y}'], tileSize: 256, encoding: 'terrarium', maxzoom: DEM_MAXZOOM, attribution: DEM_ATTRIBUTION},
            hill: {type: 'raster-dem', tiles: ['meadem://{z}/{x}/{y}'], tileSize: 256, encoding: 'terrarium', maxzoom: DEM_MAXZOOM},
            ring: {
                type: 'image', url: BASE + 'data/mead_ring.png',
                coordinates: [[w, n], [e, n], [e, s], [w, s]]
            },
            regions: {type: 'geojson', data: app.regions, promoteId: 'id'},
            labels: {type: 'geojson', data: {type: 'FeatureCollection', features: []}}
        },
        layers: [
            {id: 'bg', type: 'background', paint: {'background-color': '#e9e4d8'}},
            {id: 'base-topo', type: 'raster', source: 'topo', paint: {'raster-saturation': -0.25, 'raster-contrast': -0.05}},
            {
                id: 'base-topoHigh', type: 'raster', source: 'topoHigh', minzoom: 11.3,
                paint: {'raster-opacity': ['interpolate', ['linear'], ['zoom'], 11.3, 0, 12.3, 0.8], 'raster-saturation': -0.25}
            },
            {id: 'base-osm', type: 'raster', source: 'osm', layout: {visibility: 'none'}, paint: {'raster-saturation': -0.3}},
            {id: 'base-satellite', type: 'raster', source: 'satellite', layout: {visibility: 'none'}},
            {
                id: 'hillshade', type: 'hillshade', source: 'hill',
                paint: {
                    'hillshade-exaggeration': 0.32,
                    'hillshade-shadow-color': '#3d3328',
                    'hillshade-highlight-color': '#fffaf0',
                    'hillshade-accent-color': '#5c4b38'
                }
            },
            {id: 'lakebed', type: 'raster', source: 'ring', paint: {'raster-opacity': 0.93, 'raster-fade-duration': 0}},
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
                id: 'aqueduct-casing', type: 'line', source: 'regions',
                filter: ['all', ['==', ['get', 'layer'], 'aqueduct'], ['!=', ['get', 'id'], 'river']],
                layout: {'line-cap': 'round', 'line-join': 'round'},
                paint: {'line-color': '#0e1520', 'line-width': ['interpolate', ['linear'], ['zoom'], 5, 4.5, 10, 8], 'line-opacity': 0.85}
            },
            {
                id: 'aqueduct', type: 'line', source: 'regions',
                filter: ['all', ['==', ['get', 'layer'], 'aqueduct'], ['!=', ['get', 'id'], 'river']],
                layout: {'line-cap': 'round', 'line-join': 'round'},
                paint: {
                    'line-color': ['to-color', ['coalesce', ['feature-state', 'color'], '#5cc8e0']],
                    'line-width': ['interpolate', ['linear'], ['zoom'], 5, 2.2, 10, 4],
                    'line-dasharray': [2.2, 1.3]
                }
            },
            {
                id: 'river', type: 'line', source: 'regions',
                filter: ['all', ['==', ['get', 'layer'], 'aqueduct'], ['==', ['get', 'id'], 'river']],
                layout: {'line-cap': 'round', 'line-join': 'round'},
                paint: {
                    'line-color': '#1f78d1',
                    'line-width': ['interpolate', ['linear'], ['zoom'], 5, 2, 10, 3.5],
                    'line-opacity': 0.9
                }
            }
        ]
    };
}

const SYMBOL_LAYERS: maplibregl.LayerSpecification[] = [
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
    setView(v: ViewId): void;
    setTerrain(on: boolean, exaggeration?: number): void;
    updateImpacts(impacts: RegionImpact[]): void;
    onRegionClick(cb: (id: string) => void): void;
    selectRegion(id: string | null): void;
}

export function createMap(container: HTMLElement, app: AppData, w: Raster, floor: Raster): Promise<MapHandles> {
    const phone = window.innerWidth <= 760;
    const map = new maplibregl.Map({
        container,
        style: style(app),
        ...VIEWS.lake,
        zoom: VIEWS.lake.zoom - (phone ? 1.1 : 0),
        maxPitch: 80,
        attributionControl: {compact: true},
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
                    for (const id of ['topo', 'osm', 'satellite'] as Basemap[]) {
                        map.setLayoutProperty(`base-${id}`, 'visibility', id === b ? 'visible' : 'none');
                    }
                    map.setLayoutProperty('base-topoHigh', 'visibility', b === 'topo' ? 'visible' : 'none');
                    map.setPaintProperty('hillshade', 'hillshade-exaggeration', b === 'satellite' ? 0.12 : 0.32);
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
                    const aqueductTarget: Record<string, string> = {cra: 'socal', cap: 'phx', aac: 'iid', coachella: 'cvwd', snwa: 'lv'};
                    for (const [aq, region] of Object.entries(aqueductTarget)) {
                        const imp = byId.get(region);
                        map.setFeatureState({source: 'regions', id: aq}, {color: imp ? severityColor(imp.severity) : '#5cc8e0'});
                    }
                    const features = REGIONS.map(r => {
                        const imp = byId.get(r.id)!;
                        return {
                            type: 'Feature' as const,
                            properties: {name: r.short, status: imp.short},
                            geometry: {type: 'Point' as const, coordinates: r.center}
                        };
                    });
                    (map.getSource('labels') as maplibregl.GeoJSONSource).setData({type: 'FeatureCollection', features});
                },
                onRegionClick(cb) {
                    clickHandlers.push(cb);
                },
                selectRegion(id) {
                    if (selected) map.setFeatureState({source: 'regions', id: selected}, {selected: false});
                    selected = id;
                    if (id) {
                        map.setFeatureState({source: 'regions', id}, {selected: true});
                        const r = REGIONS.find(x => x.id === id)!;
                        map.flyTo({center: r.center, zoom: r.zoom, pitch: 45, bearing: 0, duration: 2200, essential: true});
                    }
                }
            };
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

