# MeadWatch: Lake Mead drought explorer

An interactive 3D web map of Lake Mead at its record low, with its forecast and the people, farms and power customers downstream who depend on it.

![Lake Mead at 1,037.8 ft, October 2026](docs/overview.png)

On **September 27, 2026, Lake Mead hit 1,037.79 ft**, its lowest level since it first filled in the 1930s. That is 191 ft below full pool and 88 ft above the level at which Hoover Dam can no longer generate power.

## What it does

- **3D lake with real bathymetry.** The terrain inside the reservoir is the USGS/USBR lake-floor survey, not the flat water surface that global elevation models record. When the water drops, the actual drowned canyons appear.
- **Water at any level.** A WebGL water surface is drawn at the selected elevation and shaded by depth. Basins cut off from the main lake stay dry, because a cell only floods if it connects to Hoover Dam below that level. A faint plane shows full pool (1,229 ft).
- **Exposed lakebed that stands out.** Dry lakebed is drawn in mineral white, like the real "bathtub ring", with a band every 10 ft and hillshading. It has a dark full-pool shoreline and labelled shorelines at Tier 1, both SNWA intakes, minimum power pool and dead pool. Each threshold shoreline appears once the water drops below it.
- **Key metrics overlay:**
  - elevation, live storage, surface area and % full
  - Hoover Dam generating capacity
  - feet above minimum power pool (950 ft) and above dead pool (895 ft)
  - how many of SNWA's three Las Vegas intakes are still in the water
  - the shortage tier and the scheduled cuts for each state
- **Who is affected.** Ten downstream regions are coloured by how hard they are hit at the current level. Each one carries its population, irrigated acres and a short explanation, and clicking a region flies to it.
  - Las Vegas
  - Phoenix/Tucson
  - Pinal County farms
  - Southern California
  - Imperial
  - Coachella
  - Palo Verde
  - Colorado River Indian Tribes (CRIT)
  - Yuma
  - Mexico
- **Timeline.** Daily observed levels since 2000 run into Reclamation's 24-Month Study forecasts through 2028, with a "Since 2021" zoom. You can drag the playhead, press play, or switch between the probable-minimum, two most-probable (6.0 and 7.0 MAF Powell release) and probable-maximum runs, all from the September 2026 study set.
- **What-if mode.** Set any level from 870 to 1,229 ft with the slider or by typing a number, and choose which operating rules apply: the 2027–28 Operating Guidelines or the 2007 Guidelines plus the 2019 DCP.
- **River and canal flows.** The Colorado River below Hoover Dam and the CAP, Colorado River Aqueduct, All-American and Coachella canals are traced on OpenStreetMap's own geometry. Each line's width follows its modelled flow, and a panel compares each reach and canal with normal deliveries. The Hoover release uses real USBR data (a trailing year, then the 24-Month Study). Lake Mohave and Lake Havasu levels come from USBR too. At dead pool every reach runs dry.
- **Shareable links and embeds.** The URL keeps the level or date, forecast, rules, basemap, region and camera. The Share button copies a link or an `<iframe>` embed. `#embed=1` gives a compact view for news sites, and `#about` opens the methods and sources page.
- **Basemaps.** Topo (OpenFreeMap vector data with a hypsometric tint and hillshade computed from the terrain), Streets (OpenFreeMap) or Sentinel-2 cloudless imagery. None of them use the volunteer-run OSM or OpenTopoMap tile servers. Terrain comes from AWS Open Data Terrain Tiles. Four camera presets are included.

| Hoover Dam & Boulder Basin | Dry forecast, mid-2028 (979 ft) | Downstream regions |
|---|---|---|
| ![](docs/hoover-dam.png) | ![](docs/forecast-2028.png) | ![](docs/downstream.png) |

## Run it

```bash
npm install
npm run dev          # http://localhost:5173
npm run build        # static site in dist/ (relative paths, host anywhere)
```

### Deploying to GitHub Pages

The app has to be built before it can be served: the raw `index.html` loads `src/main.ts`, which browsers can't run. `.github/workflows/deploy.yml` builds the site and publishes `dist/` on every push to `main`. To use it, go to **Settings → Pages → Build and deployment** and set **Source** to **GitHub Actions**. Don't use "Deploy from a branch".

The same workflow runs every day at about 16:20 UTC. It fetches the latest Lake Mead, Mohave and Havasu readings from USBR, commits them if anything changed, and redeploys. If USBR is down, it deploys the last good snapshot. GitHub pauses scheduled workflows after 60 days without repository activity; a push or a manual run restarts them. `VITE_SITE_URL` in `.env` sets the absolute URL used in the social-preview tags.

The app needs network access for map tiles, terrain and fonts. Everything else is bundled in `public/data/`. The browser needs WebGL2.

### Tests

`tests/smoke.mjs` drives the real app in headless Chromium with Playwright. It runs 45 checks and saves screenshots:
- terrain decoding, including a run with simulated anti-fingerprinting canvas noise
- the what-if input and slider
- the operating-rule tiers, including the declared 2023 Tier 2a
- timeline scrubbing and playback
- region selection
- shareable links, embed mode and the methods dialog
- the OpenFreeMap basemap, with no requests to volunteer tile servers
- waterways and downstream flows, including dead pool
- phone layout
- network and console errors

```bash
npx playwright install chromium   # once
npm run dev &                     # or: npm run build && npx vite preview --port 4173
npm test                          # or: node tests/smoke.mjs <url> <screenshot-dir>
```

### Refreshing the data

| Command | Output | Source |
|---|---|---|
| `npm run data:levels` | `public/data/mead_daily.json` | USBR hydrodata: Lake Mead (site 921: elevation, storage, release), Lake Mohave (922), Lake Havasu (923). Runs daily in CI |
| `npm run data:forecast` | `public/data/forecast.json` | USBR 24-Month Study PDFs (end-of-month elevation and release). Edit the URLs in `scripts/extract_24ms.py` each month |
| `npm run data:bathymetry` | `public/data/mead_w.png`, `mead_floor.png`, `mead_ring.webp`, `mead_contours.geojson`, `mead_meta.json` | USGS OFR 03-320 lake-floor grid (downloaded automatically, about 40 MB) |
| `npm run data:waterways` | `public/data/waterways.geojson` | OpenStreetMap waterways from OpenFreeMap z12 vector tiles (cached in `.cache/vt/`) |
| `npm run data:regions` | `public/data/regions.geojson` | US Census counties (us-atlas) plus traced outlines |
| `npm run og` | `public/og.jpg` | Social-preview image rendered from the running dev server |

The Python scripts need `pip install -r scripts/requirements.txt`. USBR's services don't send CORS headers, so the app reads a snapshot instead of calling USBR from the browser. The snapshot in the repo was taken on **October 6, 2026**.

## How it works

**Bathymetry → flood threshold.** `scripts/build_bathymetry.py` does four things:
1. It resamples the 30 m USGS lake-floor surface onto the Web Mercator z12 pixel grid.
2. It puts a barrier across Black Canyon at Hoover Dam, because the smoothed grid doesn't resolve the dam itself.
3. It computes each cell's *spill elevation* W by morphological reconstruction from the deepest point in Boulder Basin. W is the lowest lake level at which water reaches that cell.
4. It derives an elevation–area–capacity curve from the same grid.

At 1,038 ft the grid gives 6.81 MAF of live storage, against USBR's reported 6.84 MAF. The app scales the curve by that ~0.4% to match.

**Rendering.** The terrain is MapLibre's raster-dem, served through a custom `meadem://` protocol. It fetches each AWS Terrarium tile and swaps in the lake-floor pixels. PNGs are decoded and encoded in JavaScript (`fast-png`), never read back from a `<canvas>`. Safari's Advanced Fingerprinting Protection, Firefox's fingerprinting protection and Brave all add random noise to canvas reads, and on a Terrarium tile ±1 in the red channel is ±256 m. That noise was the source of the needle-like peaks seen when zoomed in. A custom WebGL layer then draws the water plane at the chosen altitude. It discards pixels where W is at or above the level and colours the rest by depth. MapLibre's terrain writes depth, so canyon walls and exposed lakebed hide the water correctly. The exposed-lakebed tint is a static image clipped to the full-pool footprint. Wherever the water plane sits above the terrain it covers the tint, so only lakebed that is really dry stays visible.

**Impacts.** In `src/impacts.ts`, each region's colour is the largest of three factors:
1. its scheduled cut as a share of its Colorado River supply
2. half of Hoover's lost capacity, for regions that hold Hoover power contracts
3. physical risk: below 950 ft, releases are limited to the outlet works; at 895 ft, nothing can be released; below 875 ft, SNWA can no longer pump

On the timeline, each year's rules follow the actual regime:
- **2021–2026:** 2007 Guidelines plus the 2019 DCP, using the tier Reclamation actually declared for each year: Tier 0 (2021), Tier 1 (2022), Tier 2a (2023) and Tier 1 (2024–26). Tiers are set from the August projection of January 1, so they can differ from the level the lake actually reached by year-end.
- **2027–28:** the August 2026 Operating Guidelines. These set a flat 1.25 MAF Lower Basin cut (AZ 760k, CA 440k, NV 50k acre-feet). The 1,010 ft consultation flag appears when the selected forecast falls below 1,010 ft within the next 12 months.

**Waterways.** `scripts/build_waterways.mjs` collects every river and canal segment from OpenFreeMap's z12 vector tiles along a rough guide line. It joins the pieces that meet at tile edges, then takes the cheapest path from intake to terminus, with cost rising with distance from the guide. Bridged gaps are flagged. The river has no mapped centreline across Lake Havasu, so it isn't drawn there and the basemap's lake shows instead. The Colorado River Aqueduct is mostly buried conduit that OSM doesn't carry, so it is drawn through its real pumping plants as an approximate route.

**Flows.** `downstreamFlows()` starts from rounded normal deliveries that add up to a ~9 MAF Hoover release: CAP 1.5, Colorado River Aqueduct 1.0, All-American 2.6, Coachella 0.3, Yuma/Gila 0.8, Mexico 1.5 MAF a year, plus valley users and losses. It subtracts each year's cuts from the right canal and reach. Below 950 ft the scheduled flow is flagged as possibly undeliverable; at dead pool everything is zero.

## Caveats

- **Cut allocation is simplified.** How state cuts split among users is an approximation, labelled as one in the app. Arizona's first 512k AF of cuts fall on CAP agriculture, and the rest on CAP cities and tribes. California's cut is split 60/30/7/3 among MWD, IID, CVWD and PVID. Mexico's 2027–28 terms (IBWC Minute 334) are not modelled.
- **Hoover capacity is an estimate.** It is approximated as `2080 MW × (head/583 ft)^1.15`, calibrated against effective-capacity figures in the 24-Month Study. Reclamation's real numbers also depend on how many units are available.
- **Shapes are approximate.** Irrigation districts are hand-traced and accurate to a few km. The Colorado River Aqueduct route is approximate (see Waterways). City service areas use real county boundaries. Population and acreage figures are rounded public numbers.
- **Flows are a schedule model.** Canal and reach flows are scheduled deliveries after cuts, labelled *est.* in the app. Real operations also include voluntary conservation, which is why the observed Hoover release (7.4 MAF over the past year) is below the scheduled figure. Below 950 ft, Reclamation says releases would be "severely constrained" but publishes no capacity, so the app only flags it.
- **The social-preview image isn't refreshed by CI.** It needs a browser to render. Re-run `npm run og` now and then.
- **Most-probable lines are read from a chart.** Reclamation published September 2026's two Most Probable runs only as a chart, so `scripts/extract_24ms.py` digitises them. The scale is fitted to the minimum and maximum lines on the same chart, whose tables are published; the fit is within 0.3 ft, and Dec 31, 2026 reads 1,034.21 ft against the published 1,034.18 ft.
- **Lake-floor coverage ends at 114°W.** The lake-floor grid stops there, so the narrow Lower Granite Gorge reach above Pearce Ferry isn't modelled.

## Credits

- USGS & Bureau of Reclamation: OFR 03-320 lake-floor surface, hydrodata, 24-Month Study and Operating Guidelines
- © OpenStreetMap contributors, via OpenFreeMap and OpenMapTiles (vector tiles, fonts and waterway geometry)
- Sentinel-2 cloudless by EOX (CC BY 4.0)
- AWS Open Data Terrain Tiles
- Built with MapLibre GL JS and d3
