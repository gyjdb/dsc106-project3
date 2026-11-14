# When does +2 °C arrive where you live?

DSC 106 Project 3: an interactive D3 map of when each place on Earth reaches a warming
level and stays there, built from CMIP6 climate model simulations.

Live page: https://gyjdb.github.io/dsc106-project3/

## Status

Final version for the 11/13 submission, by The Avengineers: Ethan Cai, Mayur Nookala and
Matthew Ramos.

## What is on the page

- **A guess first.** The page asks when you think the warming level reaches your place, then
  shows the models' answer next to your guess.
- **A world map of arrival years**, one block per 2.5° grid cell, striped where the climate
  models split on whether a place arrives at all, with a timeline that plays the arrivals
  forward and charts the share of land and ocean reached.
- **A panel for any place**: the median arrival year, your age in that year, what the
  emissions scenario changes, the warming curves, and one dot for each climate model.
- **A dot plot of the 300 largest cities**, in rows by latitude, linked to the map.
- **A six-step tour** of the main findings, and a table of the cities.

## Run the page

The page loads data with `fetch`, so serve it over http:

```bash
python3 -m http.server 8123
```

Then open http://localhost:8123/. To publish it, push this folder to a public GitHub
repository and turn on GitHub Pages for the root of the default branch.

## Run the checks

The checks drive the real page in Chromium, WebKit (Safari) and Firefox. With the page served
as above, run this in a second terminal:

```bash
npm install playwright
npx playwright install chromium webkit firefox
BROWSER=webkit FINDINGS=eda/findings.json node tests/e2e.cjs
```

`BROWSER` can be `chromium` (the default), `webkit` or `firefox`. The regridding has its own
check: `python tests/check_regrid.py pipeline/01_fetch_cmip6.py`.

## Layout

| Path | What it is |
|---|---|
| `index.html`, `css/`, `js/` | The visualization. Plotting uses D3 only; `topojson-client` only decodes the coastline file. |
| `data/` | Static data the page loads, built by `pipeline/`. |
| `pipeline/` | Python that downloads CMIP6, regrids it and builds `data/` and `eda/`. |
| `eda/` | The six exploratory graphs and `findings.json`, the numbers behind the voiceover script. |
| `tests/` | End-to-end checks that drive the real page in a browser, and a check of the regridding. |

## Rebuild the data

```bash
python3 -m venv .venv
.venv/bin/pip install -r pipeline/requirements.txt
curl -o catalog.csv https://storage.googleapis.com/cmip6/cmip6-zarr-consolidated-stores.csv
.venv/bin/python pipeline/01_fetch_cmip6.py catalog.csv cache --workers 8
.venv/bin/python pipeline/02_build_site_data.py cache data analysis
.venv/bin/python pipeline/validate.py analysis
.venv/bin/python pipeline/04_eda_figures.py cache analysis data eda
```

`01_fetch_cmip6.py` needs about 4 GB of disk and resumes if interrupted.

## Data notes

- Model list and screening: `MODELS` in `pipeline/01_fetch_cmip6.py`. Screening values come
  from the supporting data of Hausfather et al. 2022 (https://zenodo.org/records/6476375).
  38 models have all five experiments, 25 of them pass the screen, and 17 of those are used,
  with no two from the same institution ID. The comment above `MODELS` lists the other eight.
- `validate.py` compares the processed data against the IPCC AR6 assessed warming.
