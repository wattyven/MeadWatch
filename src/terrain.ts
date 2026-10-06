// Terrain tiles: AWS Open Data Terrain Tiles (Terrarium encoding, derived from
// USGS 3DEP/SRTM) with the Lake Mead basin swapped for the USGS lake-floor
// surface, so that the drained reservoir shows the real canyon bottom instead
// of the flat water surface that the elevation models captured.

import maplibregl from 'maplibre-gl';
import type {BathyMeta} from './data';

const TERRARIUM = 'https://s3.amazonaws.com/elevation-tiles-prod/terrarium';
export const DEM_MAXZOOM = 12;
export const DEM_ATTRIBUTION =
    'Terrain: <a href="https://registry.opendata.aws/terrain-tiles/">AWS Terrain Tiles</a> · Lake floor: <a href="https://pubs.usgs.gov/of/2003/of03-320/">USGS/USBR OFR 03-320</a>';

export interface Raster {
    width: number;
    height: number;
    data: Uint8ClampedArray;
}

export async function loadRaster(url: string): Promise<{bitmap: ImageBitmap; raster: Raster}> {
    const blob = await (await fetch(url)).blob();
    const bitmap = await createImageBitmap(blob, {premultiplyAlpha: 'none', colorSpaceConversion: 'none'});
    const canvas = new OffscreenCanvas(bitmap.width, bitmap.height);
    const ctx = canvas.getContext('2d', {willReadFrequently: true})!;
    ctx.drawImage(bitmap, 0, 0);
    const data = ctx.getImageData(0, 0, bitmap.width, bitmap.height).data;
    return {bitmap, raster: {width: bitmap.width, height: bitmap.height, data}};
}

export function registerTerrainProtocol(meta: BathyMeta, floor: Promise<Raster>) {
    maplibregl.addProtocol('meadem', async (params, abort) => {
        const [z, x, y] = params.url.replace('meadem://', '').split('/').map(Number);
        const res = await fetch(`${TERRARIUM}/${z}/${x}/${y}.png`, {signal: abort.signal});
        if (!res.ok) throw new Error(`terrain ${z}/${x}/${y}: ${res.status}`);
        const buf = await res.arrayBuffer();

        // Does this tile overlap the lake-floor grid (expressed in z12 pixels)?
        const s = 2 ** (meta.z - z);
        const tx0 = x * 256 * s, ty0 = y * 256 * s, tsz = 256 * s;
        if (z < 7 || tx0 + tsz <= meta.px0 || ty0 + tsz <= meta.py0 ||
            tx0 >= meta.px0 + meta.width || ty0 >= meta.py0 + meta.height) {
            return {data: buf};
        }

        const fl = await floor;
        const bitmap = await createImageBitmap(new Blob([buf]), {premultiplyAlpha: 'none', colorSpaceConversion: 'none'});
        const canvas = new OffscreenCanvas(256, 256);
        const ctx = canvas.getContext('2d', {willReadFrequently: true})!;
        ctx.drawImage(bitmap, 0, 0);
        const img = ctx.getImageData(0, 0, 256, 256);
        const px = img.data, src = fl.data;
        let changed = false;
        for (let j = 0; j < 256; j++) {
            const gy = Math.floor(ty0 + (j + 0.5) * s) - meta.py0;
            if (gy < 0 || gy >= meta.height) continue;
            for (let i = 0; i < 256; i++) {
                const gx = Math.floor(tx0 + (i + 0.5) * s) - meta.px0;
                if (gx < 0 || gx >= meta.width) continue;
                const k = (gy * meta.width + gx) * 4;
                if (src[k] === 0 && src[k + 1] === 0 && src[k + 2] === 0) continue;
                const o = (j * 256 + i) * 4;
                px[o] = src[k];
                px[o + 1] = src[k + 1];
                px[o + 2] = src[k + 2];
                changed = true;
            }
        }
        if (!changed) return {data: buf};
        ctx.putImageData(img, 0, 0);
        const out = await canvas.convertToBlob({type: 'image/png'});
        return {data: await out.arrayBuffer()};
    });
}
