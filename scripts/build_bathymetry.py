"""
Build the Lake Mead lake-floor rasters used by the web app.

Source: USGS Open-File Report 03-320, "Surface Representing the Floor of Lake Mead
and the surrounding area" (30 m grid, UTM 11N, metres). 2001 swath bathymetry +
pre-impoundment contours + NED, published by USGS / Bureau of Reclamation.
https://pubs.usgs.gov/of/2003/of03-320/

The grid is resampled onto the Web Mercator z12 pixel grid (the same grid the
terrain tiles use) and three products are written to public/data:

  mead_floor.png   Terrarium-encoded lake-floor elevation (m). Pixels outside the
                   reservoir basin are (0,0,0) = "keep the regular terrain tile".
  mead_w.png       16-bit "flood threshold" W (ft) in R,G: a cell is under water
                   when the lake surface is above W. W is the minimax path
                   elevation from Hoover Dam, so pools cut off from the main lake
                   by a sill stay dry. 0xFFFF = never part of the lake.
  mead_ring.webp   RGBA overlay of the full-pool footprint: hillshaded exposed lakebed
                   with 10 ft banding.
  mead_contours.geojson  shorelines at full pool and key operating thresholds.
  mead_meta.json   grid placement, encodings and an elevation-area-capacity curve.

Usage:  python scripts/build_bathymetry.py [path/to/present30m.asc]
Requires: numpy scipy pillow pyproj scikit-image
"""
import json
import math
import os
import sys
import urllib.request
import zipfile

import numpy as np
from PIL import Image
from pyproj import Transformer
from scipy import ndimage
from skimage.morphology import reconstruction

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
OUT = os.path.join(ROOT, "public", "data")
CACHE = os.path.join(ROOT, ".cache")
SRC_URL = "https://pubs.usgs.gov/of/2003/of03-320/data/surfaces/utm11/present30m.zip"

FT = 3.28084
FULL_POOL_FT = 1229.0
W_OFFSET_FT = 600.0  # W encoding: v = (W - offset) * scale
W_SCALE = 50.0
Z = 12
WORLD = 256 * 2**Z

# Hoover Dam: the smoothed 30 m grid does not resolve the dam itself, so a
# barrier is drawn across Black Canyon to stop the flood fill leaking downstream.
DAM = (-114.7377, 36.0161)
SEED_BOX = (-114.80, 36.03, -114.68, 36.10)  # Boulder Basin; seed = deepest cell here


def load_grid(path):
    if path is None:
        os.makedirs(CACHE, exist_ok=True)
        path = os.path.join(CACHE, "present30m.asc")
        if not os.path.exists(path):
            zpath = os.path.join(CACHE, "present30m.zip")
            print("downloading", SRC_URL)
            urllib.request.urlretrieve(SRC_URL, zpath)
            with zipfile.ZipFile(zpath) as z:
                z.extract("present30m.asc", CACHE)
    with open(path) as f:
        hdr = {}
        for _ in range(6):
            k, v = f.readline().split()
            hdr[k.lower()] = float(v)
        data = np.fromstring(f.read(), sep=" ", dtype=np.float32)
    g = data.reshape(int(hdr["nrows"]), int(hdr["ncols"]))
    g[g == hdr["nodata_value"]] = np.nan
    return g, hdr


def merc_px(lon, lat):
    x = (lon + 180.0) / 360.0 * WORLD
    s = math.sin(math.radians(lat))
    y = (0.5 - math.log((1 + s) / (1 - s)) / (4 * math.pi)) * WORLD
    return x, y


def px_lonlat(gx, gy):
    lon = gx / WORLD * 360.0 - 180.0
    lat = np.degrees(np.arctan(np.sinh(np.pi * (1 - 2 * gy / WORLD))))
    return lon, lat


def main():
    src = sys.argv[1] if len(sys.argv) > 1 else None
    g, hdr = load_grid(src)
    nr, nc = g.shape
    to_utm = Transformer.from_crs("EPSG:4326", "EPSG:26911", always_xy=True)

    # Mercator pixel window safely inside the grid's footprint.
    x0, y0 = merc_px(-114.99, 36.74)
    x1, y1 = merc_px(-114.006, 35.765)
    px0, py0 = int(math.ceil(x0)), int(math.ceil(y0))
    w, h = int(x1) - px0, int(y1) - py0
    gx, gy = np.meshgrid(px0 + np.arange(w) + 0.5, py0 + np.arange(h) + 0.5)
    lon, lat = px_lonlat(gx, gy)
    ux, uy = to_utm.transform(lon, lat)
    col = (ux - hdr["xllcorner"]) / hdr["cellsize"] - 0.5
    row = (nr - (uy - hdr["yllcorner"]) / hdr["cellsize"]) - 0.5
    floor_m = ndimage.map_coordinates(g, [row, col], order=1, mode="constant", cval=np.nan)
    print("resampled", floor_m.shape)

    elev_ft = floor_m * FT
    walls = np.where(np.isnan(elev_ft), 9999.0, elev_ft)

    # Barrier across Black Canyon at the dam (NW-SE, perpendicular to the canyon).
    dx, dy = merc_px(*DAM)
    for t in np.linspace(-1, 1, 400):
        bx = dx - px0 + t * 14
        by = dy - py0 + t * 14
        ix, iy = int(round(bx)), int(round(by))
        walls[iy - 1:iy + 2, ix - 1:ix + 2] = 9999.0

    # Minimax ("spill") elevation from the dam via morphological reconstruction.
    bx0, by0 = merc_px(SEED_BOX[0], SEED_BOX[3])
    bx1, by1 = merc_px(SEED_BOX[2], SEED_BOX[1])
    bx0, by0, bx1, by1 = (int(v) for v in (bx0 - px0, by0 - py0, bx1 - px0, by1 - py0))
    sub = walls[by0:by1, bx0:bx1]
    sy, sx = np.unravel_index(np.argmin(sub), sub.shape)
    sy, sx = sy + by0, sx + bx0
    marker = np.full_like(walls, 9999.0)
    marker[sy, sx] = walls[sy, sx]
    W = reconstruction(marker, walls, method="erosion")
    print("seed floor ft", walls[sy, sx])

    basin = W < FULL_POOL_FT
    lbl, n = ndimage.label(basin)
    print("full-pool basin px", basin.sum(), "components", n)

    # Crop to the basin (+margin) to keep the textures small.
    ys, xs = np.where(W < 1260)
    m = 24
    cy0, cy1 = max(ys.min() - m, 0), min(ys.max() + m, h)
    cx0, cx1 = max(xs.min() - m, 0), min(xs.max() + m, w)
    W, floor_m, elev_ft, basin = (a[cy0:cy1, cx0:cx1] for a in (W, floor_m, elev_ft, basin))
    px0 += cx0
    py0 += cy0
    h, w = W.shape
    print("crop", w, h)

    # Per-pixel ground area (m^2) varies with latitude in Web Mercator.
    _, lat_rows = px_lonlat(np.zeros(h), py0 + np.arange(h) + 0.5)
    m_per_px = 40075016.686 / WORLD * np.cos(np.radians(lat_rows))
    area_px = (m_per_px**2)[:, None] * np.ones((1, w))

    # Elevation-area-capacity curve of the connected lake.
    curve = []
    for lvl in np.arange(860, 1241, 1.0):
        wet = W < lvl
        a = float(area_px[wet].sum())
        depth_m = np.clip(lvl / FT - floor_m, 0, None)
        v = float((depth_m * area_px)[wet].sum())
        curve.append([float(lvl), round(a / 4046.86), round(v / 1233.48)])
    for c in curve:
        if c[0] in (895, 950, 1000, 1025, 1038, 1050, 1075, 1100, 1150, 1200, 1229):
            print("elev %d ft  area %8d ac  volume %10d af" % tuple(c))

    # mead_w.png: 16-bit W in R,G.
    v = np.where(W < 1300, np.clip(np.round((W - W_OFFSET_FT) * W_SCALE), 0, 65534), 65535).astype(np.uint32)
    rgb = np.zeros((h, w, 3), np.uint8)
    rgb[..., 0] = v >> 8
    rgb[..., 1] = v & 255
    Image.fromarray(rgb, "RGB").save(os.path.join(OUT, "mead_w.png"), optimize=True)

    # mead_floor.png: Terrarium-encoded floor where it replaces the terrain tiles.
    replace = ndimage.binary_dilation(W < FULL_POOL_FT + 15, iterations=3) & ~np.isnan(floor_m)
    tv = np.where(replace, floor_m + 32768.0, 0)
    fr = np.zeros((h, w, 3), np.uint8)
    fr[..., 0] = np.floor(tv / 256)
    fr[..., 1] = np.floor(tv) % 256
    fr[..., 2] = np.floor((tv - np.floor(tv)) * 256)
    fr[~replace] = 0
    Image.fromarray(fr, "RGB").save(os.path.join(OUT, "mead_floor.png"), optimize=True)

    # mead_ring.webp: exposed lakebed. A pale "mineral" white that reads against the
    # warm desert basemap, banded every 10 ft of exposure elevation with a fine line
    # every 50 ft (the bathtub ring), and hillshaded from the lake floor so the
    # drained canyons keep their relief.
    m_px = (40075016.686 / WORLD) * np.cos(np.radians(lat_rows))[:, None]
    z = np.nan_to_num(floor_m, nan=float(np.nanmean(floor_m))) * 1.6
    dzdy, dzdx = np.gradient(z)
    dzdx, dzdy = dzdx / m_px, dzdy / m_px
    az, alt = np.radians(315), np.radians(42)
    slope = np.arctan(np.hypot(dzdx, dzdy))
    aspect = np.arctan2(-dzdx, dzdy)
    shade = np.clip(np.sin(alt) * np.cos(slope) + np.cos(alt) * np.sin(slope) * np.cos(az - aspect), 0, 1)
    t = np.clip((W - 880) / (FULL_POOL_FT - 880), 0, 1)[..., None]
    old_ring = np.array([250, 249, 245], float)     # long-exposed, near full pool
    new_ring = np.array([226, 224, 218], float)     # recently exposed, near today's shoreline
    base = new_ring + (old_ring - new_ring) * t
    band = ((np.floor(W / 10) % 2) == 0)[..., None]
    base = np.where(band, base * 0.955, base)
    fifty = (np.abs(((W + 25) % 50) - 25) < 0.9)[..., None]   # ~1 px line every 50 ft
    base = np.where(fifty, base * 0.8, base)
    lit = base * (0.62 + 0.38 * shade[..., None]) + 18 * (shade[..., None] - 0.6)
    ring = np.zeros((h, w, 4), np.uint8)
    ring[..., :3] = np.clip(lit, 0, 255)
    ring[..., 3] = np.where(basin, 250, 0)
    Image.fromarray(ring, "RGBA").save(os.path.join(OUT, "mead_ring.webp"), quality=90, method=6)
    old_png = os.path.join(OUT, "mead_ring.png")
    if os.path.exists(old_png):
        os.remove(old_png)

    # mead_contours.geojson: the full-pool shoreline and the shorelines at key
    # operating thresholds, traced from the same spill-elevation grid.
    from shapely.geometry import LineString
    from skimage.measure import find_contours
    levels = {1229: "Full pool", 1075: "Tier 1", 1050: "SNWA Intake 1", 1000: "SNWA Intake 2",
              950: "Min. power pool", 895: "Dead pool"}
    Wc = np.where(W < 1300, W, 1300)
    feats = []
    for lvl, label in levels.items():
        for c in find_contours(Wc, lvl):
            if len(c) < 25:
                continue
            ls = LineString(c[:, ::-1]).simplify(0.9)
            xy = np.asarray(ls.coords)
            lon, lat = px_lonlat(px0 + xy[:, 0] + 0.5, py0 + xy[:, 1] + 0.5)
            feats.append({"type": "Feature", "properties": {"elevation": lvl, "label": f"{lvl:,} ft · {label}"},
                          "geometry": {"type": "LineString", "coordinates": [[round(float(a), 5), round(float(b), 5)] for a, b in zip(lon, lat)]}})
    with open(os.path.join(OUT, "mead_contours.geojson"), "w") as f:
        json.dump({"type": "FeatureCollection", "features": feats}, f, separators=(",", ":"))

    lon_w, lat_n = px_lonlat(np.array(px0), np.array(py0))
    lon_e, lat_s = px_lonlat(np.array(px0 + w), np.array(py0 + h))
    meta = {
        "source": "USGS OFR 03-320 lake-floor surface (2001 bathymetry), resampled to Web Mercator z12",
        "z": Z,
        "px0": int(px0),
        "py0": int(py0),
        "width": w,
        "height": h,
        "bounds": [float(lon_w), float(lat_s), float(lon_e), float(lat_n)],
        "wEncoding": {"offsetFt": W_OFFSET_FT, "scale": W_SCALE, "none": 65535},
        "fullPoolFt": FULL_POOL_FT,
        "curve": curve,
    }
    with open(os.path.join(OUT, "mead_meta.json"), "w") as f:
        json.dump(meta, f, separators=(",", ":"))
    for name in ("mead_w.png", "mead_floor.png", "mead_ring.webp", "mead_contours.geojson", "mead_meta.json"):
        print(name, os.path.getsize(os.path.join(OUT, name)) // 1024, "KB")


if __name__ == "__main__":
    main()
