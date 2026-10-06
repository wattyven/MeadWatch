// Terrain tiles: AWS Open Data Terrain Tiles (Terrarium encoding, derived from
// USGS 3DEP/SRTM) with the Lake Mead basin swapped for the USGS lake-floor
// surface, so that the drained reservoir shows the real canyon bottom instead
// of the flat water surface that the elevation models captured.
//
// PNGs are decoded and encoded in JavaScript rather than through a <canvas>:
// Safari's Advanced Fingerprinting Protection, Firefox's fingerprinting
// protection and Brave all add random noise to canvas pixel reads. On a
// Terrarium tile, ±1 in the red channel is ±256 m, which shows up as needle
// peaks scattered across the terrain.

import maplibregl from 'maplibre-gl';
import {convertIndexedToRgb, decode, encode} from 'fast-png';
import type {BathyMeta} from './data';

const TERRARIUM = 'https://s3.amazonaws.com/elevation-tiles-prod/terrarium';
export const DEM_MAXZOOM = 12;
export const DEM_ATTRIBUTION =
    'Terrain: <a href="https://registry.opendata.aws/terrain-tiles/">AWS Terrain Tiles</a> · Lake floor: <a href="https://pubs.usgs.gov/of/2003/of03-320/">USGS/USBR OFR 03-320</a>';

export interface Raster {
    width: number;
    height: number;
    /** RGBA, 8 bits per channel */
    data: Uint8ClampedArray;
}

/** Decode a PNG to exact RGBA bytes, independent of browser colour management or canvas noise. */
export function decodePng(buf: ArrayBuffer | Uint8Array): Raster {
    const png = decode(buf);
    if (png.depth !== 8 && !png.palette) throw new Error(`unsupported PNG bit depth ${png.depth}`);
    const n = png.width * png.height;
    const out = new Uint8ClampedArray(n * 4);
    let src = png.data as Uint8Array;
    let channels = png.channels;
    if (png.palette) {
        src = convertIndexedToRgb(png) as Uint8Array;
        channels = png.palette[0].length;
    }
    for (let i = 0; i < n; i++) {
        const o = i * 4, s = i * channels;
        if (channels >= 3) {
            out[o] = src[s];
            out[o + 1] = src[s + 1];
            out[o + 2] = src[s + 2];
        } else {
            out[o] = out[o + 1] = out[o + 2] = src[s];
        }
        out[o + 3] = channels === 4 ? src[s + 3] : channels === 2 ? src[s + 1] : 255;
    }
    return {width: png.width, height: png.height, data: out};
}

export async function loadRaster(url: string): Promise<Raster> {
    const res = await fetch(url);
    if (!res.ok) throw new Error(`${url}: HTTP ${res.status}`);
    return decodePng(await res.arrayBuffer());
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
        const tile = decodePng(buf);
        const size = tile.width;
        const px = tile.data, src = fl.data;
        const k = 256 / size; // AWS tiles are 256 px; keep the maths general
        let changed = false;
        for (let j = 0; j < size; j++) {
            const gy = Math.floor(ty0 + (j + 0.5) * k * s) - meta.py0;
            if (gy < 0 || gy >= meta.height) continue;
            for (let i = 0; i < size; i++) {
                const gx = Math.floor(tx0 + (i + 0.5) * k * s) - meta.px0;
                if (gx < 0 || gx >= meta.width) continue;
                const q = (gy * meta.width + gx) * 4;
                if (src[q] === 0 && src[q + 1] === 0 && src[q + 2] === 0) continue;
                const o = (j * size + i) * 4;
                px[o] = src[q];
                px[o + 1] = src[q + 1];
                px[o + 2] = src[q + 2];
                changed = true;
            }
        }
        if (!changed) return {data: buf};
        const rgb = new Uint8Array(size * size * 3);
        for (let i = 0, o = 0; i < px.length; i += 4, o += 3) {
            rgb[o] = px[i];
            rgb[o + 1] = px[i + 1];
            rgb[o + 2] = px[i + 2];
        }
        const png = encode({width: size, height: size, data: rgb, channels: 3, depth: 8}, {zlib: {level: 1}});
        return {data: png.buffer.slice(png.byteOffset, png.byteOffset + png.byteLength) as ArrayBuffer};
    });
}
