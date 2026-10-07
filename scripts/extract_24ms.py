"""
Extract Lake Mead end-of-month projections from Reclamation's 24-Month Study
and write public/data/forecast.json.

Usage:  python scripts/extract_24ms.py
Requires: pdfplumber numpy pillow

All four scenarios come from the September 2026 study set, so they share one
starting point and one set of assumptions:

  min     September 2026 Probable Minimum        (full table, PDF)
  most    September 2026 Most Probable, 6.0 maf  (read from Reclamation's chart)
  most7   September 2026 Most Probable, 7.0 maf  (read from Reclamation's chart)
  max     August 2026 Probable Maximum           (full table, PDF; the max run
                                                  Reclamation pairs with September)

Reclamation published September's Most Probable runs only as a chart
(September-Chart.pdf), so those two lines are digitised: the chart is rendered
at 300 dpi, each line is sampled between its markers, and the pixel-to-feet
scale is fitted to the Probable Minimum and Maximum lines on the same chart,
whose exact values are known from their tables. Validation against those tables
and against the published Dec 31, 2026 value (1,034.18 ft) is printed on every
run; expect agreement within a few tenths of a foot.
"""
import calendar
import json
import os
import re
import urllib.request

import numpy as np
import pdfplumber

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
CACHE = os.path.join(ROOT, ".cache", "24ms")
OUT = os.path.join(ROOT, "public", "data", "forecast.json")
BASE = "https://www.usbr.gov/lc/region/g4000/24mo/2026/"
CHART_URL = BASE + "September-Chart.pdf"

TABLES = [
    {
        "id": "min",
        "label": "Probable Minimum",
        "study": "September 2026",
        "url": BASE + "SEP26_MIN.pdf",
        "note": "Dry hydrology, exceeded ~90% of the time.",
    },
    {
        "id": "max",
        "label": "Probable Maximum",
        "study": "August 2026",
        "url": BASE + "AUG26_MAX.pdf",
        "note": "Wet hydrology, exceeded ~10% of the time. The latest maximum run; Reclamation pairs it with September's studies.",
    },
]
CHART_LINES = [
    {
        "id": "most",
        "label": "Most Probable",
        "detail": "6.0 maf Powell release",
        "study": "September 2026",
        "color": (80, 208, 80),
        "note": "Median hydrology with a 6.0 maf Glen Canyon Dam release in water year 2027. Read from Reclamation's chart (±0.3 ft).",
    },
    {
        "id": "most7",
        "label": "Most Probable",
        "detail": "7.0 maf Powell release",
        "study": "September 2026",
        "color": (32, 128, 80),
        "note": "Median hydrology with a 7.0 maf Glen Canyon Dam release in water year 2027. Read from Reclamation's chart (±0.3 ft).",
    },
]
CHART_TABLE_COLORS = {"min": (208, 48, 48), "max": (0, 48, 96)}
PUBLISHED_CHECK = ("2026-12", 1034.18)  # September Most Probable, Dec 31, 2026 (study text)

MONTHS = {m: i + 1 for i, m in enumerate(
    ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"])}
ROW = re.compile(r"^([A-Z][a-z]{2}) (20\d\d) (.*)$")


def month_end(year, month):
    return f"{year}-{month:02d}-{calendar.monthrange(year, month)[1]:02d}"


def fetch(url):
    os.makedirs(CACHE, exist_ok=True)
    path = os.path.join(CACHE, os.path.basename(url))
    if not os.path.exists(path):
        print("downloading", url)
        urllib.request.urlretrieve(url, path)
    return path


def pages_for_mead(pdf):
    ops = power = None
    for p in pdf.pages:
        t = p.extract_text() or ""
        if "Hoover Dam" in t and "Lake Mead" in t:
            if "Static Head" in t:
                power = t
            elif "Glen Side Inflow" in t or "Downstream" in t:
                ops = t
    return ops, power


def parse_table(scn):
    pdf = pdfplumber.open(fetch(scn["url"]))
    ops, power = pages_for_mead(pdf)
    rows = {}
    for line in ops.split("\n"):
        m = ROW.match(line)
        if not m:
            continue
        nums = m.group(3).split()
        # columns: Glen release, side inflow, evaporation, total release (kaf), total release (kcfs),
        # SNWP use, downstream requirements, bank storage, end-of-month elevation (ft), live storage (kaf)
        row = {"elevationFt": float(nums[-2]), "storageKaf": float(nums[-1])}
        if len(nums) >= 10:
            row["releaseKaf"] = float(nums[3])
        rows[month_end(int(m.group(2)), MONTHS[m.group(1)])] = row
    if power:
        for line in power.split("\n"):
            m = ROW.match(line)
            if not m:
                continue
            nums = m.group(3).split()
            # release, release cfs, elevation, storage, change, static head, capacity, energy, units%, kwh/af
            d = month_end(int(m.group(2)), MONTHS[m.group(1)])
            if d in rows and len(nums) >= 9:
                rows[d]["hooverCapacityMw"] = float(nums[6])
                rows[d]["hooverEnergyGwh"] = float(nums[7])
                rows[d]["unitsAvailablePct"] = float(nums[8])
    series = [{"date": d, **v} for d, v in sorted(rows.items())]
    return {k: scn[k] for k in ("id", "label", "study", "url", "note")} | {"series": series}


# ---------------------------------------------------------------- chart digitising

def chart_images():
    """Rasterise the chart pages (they are images without a text layer)."""
    pdf = pdfplumber.open(fetch(CHART_URL))
    for p in pdf.pages:
        if p.images and not (p.extract_text() or "").strip():
            yield p.page_number, np.asarray(p.to_image(resolution=300).original.convert("RGB")).astype(float)


def plot_frame(a):
    """Left/right x of the plot (Feb 2026 / Aug 2028 axes) from the dark vertical axis lines."""
    gray = (np.abs(a[..., 0] - a[..., 1]) < 8) & (np.abs(a[..., 1] - a[..., 2]) < 8) & (a[..., 0] < 110)
    cols = np.where(gray[200:1900].sum(0) > 1200)[0]
    if len(cols) < 2:
        return None
    groups = np.split(cols, np.where(np.diff(cols) > 2)[0] + 1)
    centers = [g.mean() for g in groups]
    return (centers[0], centers[-1]) if len(centers) >= 2 else None


def line_row(a, color, x, near=None, tol=40):
    col = a[150:2000, int(x)]
    rows = np.where(np.sqrt(((col - np.array(color)) ** 2).sum(-1)) < tol)[0]
    if not len(rows):
        return None
    runs = [r for r in np.split(rows, np.where(np.diff(rows) > 2)[0] + 1) if len(r) <= 14]  # thin line runs
    if not runs:
        return None
    centers = [150 + (r[0] + r[-1]) / 2 for r in runs]
    return min(centers, key=lambda c: abs(c - near)) if near is not None else centers[0]


def vertex_row(a, color, xm, near):
    """Row where a polyline passes x = xm, from straight fits to the segments either side (skips the marker)."""
    est = []
    for side in (-1, 1):
        xs, ys = [], []
        for d in range(22, 72, 3):
            x = xm + side * d
            if x < 0 or x >= a.shape[1]:
                continue
            y = line_row(a, color, x, near)
            if y is not None:
                xs.append(x)
                ys.append(y)
        if len(xs) >= 5:
            k, c = np.polyfit(xs, ys, 1)
            est.append(k * xm + c)
    return float(np.mean(est)) if est else None


def digitise(tables):
    known = {(t["id"], p["date"][:7]): p["elevationFt"] for t in tables for p in t["series"]}
    for page, a in chart_images():
        frame = plot_frame(a)
        if frame is None:
            continue
        x0, x1 = frame
        step = (x1 - x0) / 30  # Feb 2026 .. Aug 2028
        months = [(2026 + (1 + m) // 12, (1 + m) % 12 + 1) for m in range(31)]
        # 1. scale: fit row -> feet on the table-backed lines
        pts = []
        for tid, color in CHART_TABLE_COLORS.items():
            for m, (y, mo) in enumerate(months):
                ft = known.get((tid, f"{y}-{mo:02d}"))
                if ft is None or (y, mo) < (2026, 9):
                    continue
                r = vertex_row(a, color, x0 + m * step, None)
                if r is not None:
                    pts.append((r, ft))
        if len(pts) < 20:
            continue  # not the Lake Mead chart
        rows, feet = np.array(pts).T
        b, a0 = np.polyfit(rows, feet, 1)
        resid = feet - (a0 + b * rows)
        rms = float(np.sqrt((resid ** 2).mean()))
        print(f"chart page {page}: scale fitted on {len(pts)} published points, rms {rms:.2f} ft, max {np.abs(resid).max():.2f} ft")
        if rms > 1.0:
            continue  # the Lake Powell chart uses the same colours; only Mead's lines match Mead's tables
        # 2. read the Most Probable lines
        out = {}
        for line in CHART_LINES:
            vals = {}
            for m, (y, mo) in enumerate(months):
                if (y, mo) < (2026, 9):
                    continue
                guess = None
                prev = vals.get(month_end(*months[m - 1])) if m else None
                if prev is not None:
                    guess = (prev - a0) / b
                r = vertex_row(a, line["color"], x0 + m * step, guess)
                if r is not None:
                    vals[month_end(y, mo)] = round(a0 + b * r, 2)
            out[line["id"]] = vals
        # The two Most Probable runs are identical until the release volumes differ; there the
        # 7.0 maf line is drawn on top and hides the 6.0 maf one, so share its values.
        for d, v in out["most7"].items():
            out["most"].setdefault(d, v)
        check = out["most7"].get(month_end(2026, 12))
        print(f"  check: Dec 31, 2026 read {check} ft vs published {PUBLISHED_CHECK[1]} ft")
        return out
    raise RuntimeError("Lake Mead chart not found in " + CHART_URL)


def main():
    tables = [parse_table(s) for s in TABLES]
    lines = digitise(tables)
    by_id = {t["id"]: t for t in tables}
    scenarios = [by_id["min"]]
    for line in CHART_LINES:
        series = [{"date": d, "elevationFt": v} for d, v in sorted(lines[line["id"]].items())]
        scenarios.append({"id": line["id"], "label": line["label"], "detail": line["detail"], "study": line["study"],
                          "url": CHART_URL, "note": line["note"], "digitized": True, "series": series})
    scenarios.append(by_id["max"])

    # Sanity: the most-probable runs must sit inside the probable range.
    lo = {p["date"]: p["elevationFt"] for p in by_id["min"]["series"]}
    hi = {p["date"]: p["elevationFt"] for p in by_id["max"]["series"]}
    for s in scenarios[1:3]:
        bad = [p["date"] for p in s["series"] if p["date"] in lo and p["date"] in hi
               and not (lo[p["date"]] - 0.5 <= p["elevationFt"] <= hi[p["date"]] + 0.5)]
        print(f"  {s['id']}: {len(s['series'])} months, outside min..max: {bad or 'none'}")

    out = {
        "source": "U.S. Bureau of Reclamation, 24-Month Study (Operation Plan for Colorado River System Reservoirs)",
        "url": "https://www.usbr.gov/lc/region/g4000/24mo/index.html",
        "scenarios": scenarios,
        "pointForecasts": [],
    }
    with open(OUT, "w") as f:
        json.dump(out, f, indent=1)
    for s in scenarios:
        print(s["id"], s["study"], len(s["series"]), s["series"][0]["date"], "->", s["series"][-1]["date"], s["series"][-1]["elevationFt"])


if __name__ == "__main__":
    main()
