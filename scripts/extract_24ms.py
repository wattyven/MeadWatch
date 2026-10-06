"""
Extract Lake Mead end-of-month projections from Reclamation's 24-Month Study
reports and write public/data/forecast.json.

Usage:  python scripts/extract_24ms.py
Requires: pdfplumber

Reclamation publishes the Most Probable study monthly and the Probable Minimum /
Maximum runs in selected months; each scenario below uses the latest report of
that type that was available when the snapshot was built.
"""
import json
import os
import re
import urllib.request

import pdfplumber

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
CACHE = os.path.join(ROOT, ".cache", "24ms")
OUT = os.path.join(ROOT, "public", "data", "forecast.json")
BASE = "https://www.usbr.gov/lc/region/g4000/24mo/2026/"

SCENARIOS = [
    {
        "id": "min",
        "label": "Probable Minimum",
        "study": "September 2026",
        "url": BASE + "SEP26_MIN.pdf",
        "note": "Dry hydrology, exceeded ~90% of the time.",
    },
    {
        "id": "most",
        "label": "Most Probable",
        "study": "July 2026",
        "url": BASE + "JUL26.pdf",
        "note": "Median hydrology. Latest full Most Probable table available; the "
                "September 2026 Most Probable run projects 1,034.18 ft on Dec 31, 2026.",
    },
    {
        "id": "max",
        "label": "Probable Maximum",
        "study": "August 2026",
        "url": BASE + "AUG26_MAX.pdf",
        "note": "Wet hydrology, exceeded ~10% of the time.",
    },
]

MONTHS = {m: i + 1 for i, m in enumerate(
    ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"])}
ROW = re.compile(r"^([A-Z][a-z]{2}) (20\d\d) (.*)$")


def month_end(mon, year):
    import calendar
    m = MONTHS[mon]
    return f"{year}-{m:02d}-{calendar.monthrange(year, m)[1]:02d}"


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


def parse(scn):
    os.makedirs(CACHE, exist_ok=True)
    path = os.path.join(CACHE, os.path.basename(scn["url"]))
    if not os.path.exists(path):
        print("downloading", scn["url"])
        urllib.request.urlretrieve(scn["url"], path)
    pdf = pdfplumber.open(path)
    ops, power = pages_for_mead(pdf)
    rows = {}
    for line in ops.split("\n"):
        m = ROW.match(line)
        if not m:
            continue
        nums = m.group(3).split()
        # last two columns: end-of-month elevation (ft), live storage (kaf)
        rows[month_end(m.group(1), int(m.group(2)))] = {
            "elevationFt": float(nums[-2]),
            "storageKaf": float(nums[-1]),
        }
    if power:
        for line in power.split("\n"):
            m = ROW.match(line)
            if not m:
                continue
            nums = m.group(3).split()
            # release, release cfs, elevation, storage, change, static head, capacity, energy, units%, kwh/af
            d = month_end(m.group(1), int(m.group(2)))
            if d in rows and len(nums) >= 9:
                rows[d]["hooverCapacityMw"] = float(nums[6])
                rows[d]["hooverEnergyGwh"] = float(nums[7])
                rows[d]["unitsAvailablePct"] = float(nums[8])
    series = [{"date": d, **v} for d, v in sorted(rows.items())]
    return {k: scn[k] for k in ("id", "label", "study", "url", "note")} | {"series": series}


def main():
    out = {
        "source": "U.S. Bureau of Reclamation, 24-Month Study (Operation Plan for Colorado River System Reservoirs)",
        "url": "https://www.usbr.gov/lc/region/g4000/24mo/index.html",
        "scenarios": [parse(s) for s in SCENARIOS],
        "pointForecasts": [
            {"date": "2026-12-31", "elevationFt": 1034.18,
             "label": "September 2026 Most Probable (Dec 31, 2026)",
             "url": "https://www.usbr.gov/lc/region/g4000/24mo/2026/September-Chart.pdf"},
        ],
    }
    with open(OUT, "w") as f:
        json.dump(out, f, indent=1)
    for s in out["scenarios"]:
        print(s["id"], s["study"], len(s["series"]), s["series"][0]["date"], "->", s["series"][-1]["date"],
              s["series"][-1]["elevationFt"])


if __name__ == "__main__":
    main()
