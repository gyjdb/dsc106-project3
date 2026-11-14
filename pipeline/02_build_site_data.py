#!/usr/bin/env python3
"""Turn the cached model fields into the compact static files the D3 page loads.

Usage: python 02_build_site_data.py CACHE_DIR SITE_DATA_DIR ANALYSIS_DIR

Definitions (the page describes the same steps to the reader):
  anomaly   annual mean temperature minus that model's own 1850-1900 mean, per grid cell
  smoothed  20-year running mean; year y is the mean of years y-10 .. y+9
  arrival   first year y from 1911 on whose smoothed anomaly reaches the warming level and
            stays at or above it for at least the next 20 years (or to the end of the data,
            if sooner). 1911 is the first window fully after the 1850-1900 baseline. Grid cells
            swing widely from decade to decade, especially near the poles, so without these
            rules a warm spell, even one inside the baseline itself, could count as an arrival.
Windows stop at 2080-2099 (y = 2090) because one model ends in 2099, so "not by 2090"
means a model has not arrived in any window that fits inside its run.
"""
import glob
import json
import os
import sys

import numpy as np

SCENARIOS = ["ssp126", "ssp245", "ssp370", "ssp585"]
LEVELS = [1.5, 2.0, 3.0, 4.0]
YEARS = np.arange(1860, 2091)
NLAT, NLON = 72, 144
LAT = -88.75 + 2.5 * np.arange(NLAT)
LON = 1.25 + 2.5 * np.arange(NLON)
AREA = np.cos(np.deg2rad(LAT))[:, None] * np.ones((NLAT, NLON))
AREA = AREA / AREA.sum()
DAYS = np.array([31, 28, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31], "f4")

HOLD_YEARS = 20
FIRST_ARRIVAL_YEAR = 1911
NOT_REACHED = 255  # arrival files store year - 1850; this value means "not by 2090"
SERIES_STEP = 5
COMMON_YEARS = np.arange(1860, 2006, SERIES_STEP)  # windows end by 2014: same in all scenarios
SCEN_YEARS = np.arange(2010, 2091, SERIES_STEP)  # windows reach into the scenario years
ENC_OFFSET, ENC_SCALE = -6.0, 0.01  # stored as little-endian uint16


def annual_means(path):
    d = np.load(path)
    data, years, months = d["data"], d["years"], d["months"]
    uniq = np.unique(years)
    # A few runs stop partway through 2100; the analysis ends at 2099, so drop that year.
    if uniq[-1] == 2100 and (years == 2100).sum() != 12:
        uniq = uniq[:-1]
    out = np.empty((len(uniq), NLAT, NLON), "f4")
    for i, y in enumerate(uniq):
        k = years == y  # grouping by year also handles stores whose time axis is out of order
        if sorted(months[k].tolist()) != list(range(1, 13)):
            raise RuntimeError(f"{path}: year {y} has months {sorted(months[k].tolist())}")
        w = DAYS[months[k] - 1]
        out[i] = (data[k] * w[:, None, None]).sum(0) / w.sum()
    return uniq, out


def smooth_20yr(anom, first_year):
    """anom: (year, lat, lon) starting at first_year. Returns the smoothed anomaly at YEARS."""
    start = YEARS - 10 - first_year
    stop = YEARS + 10 - first_year  # exclusive, so the window is y-10 .. y+9
    cum = np.concatenate([np.zeros((1, NLAT, NLON)), np.cumsum(anom, axis=0, dtype="f8")])
    return ((cum[stop] - cum[start]) / 20.0).astype("f4")


def sustained_arrival(smoothed, level):
    """Index along axis 0 of the first arrival, and a mask of where one exists.
    Works for (year,) and (year, lat, lon) arrays."""
    hit = smoothed >= level
    ny = hit.shape[0]
    cum = np.concatenate([np.zeros((1,) + hit.shape[1:], "i4"), np.cumsum(hit, axis=0, dtype="i4")])
    start = np.arange(ny)
    stop = np.minimum(start + HOLD_YEARS + 1, ny)  # this year plus the next HOLD_YEARS
    shape = (ny,) + (1,) * (hit.ndim - 1)
    holds = (cum[stop] - cum[start]) == (stop - start).reshape(shape)
    holds[YEARS < FIRST_ARRIVAL_YEAR] = False
    return holds.argmax(axis=0), holds.any(axis=0)


def first_reach(smoothed, level):
    idx, found = sustained_arrival(smoothed, level)
    out = (YEARS[idx] - 1850).astype("u1")
    out[~found] = NOT_REACHED
    return out


def encode(x):
    return np.clip(np.rint((x - ENC_OFFSET) / ENC_SCALE), 0, 65535).astype("<u2")


def median_arrival(a):
    """Median across models (first axis) of byte-coded arrival; not-reached sorts last."""
    return np.sort(a, axis=0)[a.shape[0] // 2]


def main():
    cache, site, analysis = sys.argv[1:4]
    os.makedirs(site, exist_ok=True)
    os.makedirs(analysis, exist_ok=True)
    models = sorted(
        os.path.basename(p).split("__")[0] for p in glob.glob(os.path.join(cache, "*__historical__tas.npz"))
    )
    if len(models) % 2 == 0:
        raise SystemExit(f"need an odd number of models for a single median, got {len(models)}")
    print("models:", len(models), models)
    land = np.load(os.path.join(cache, "land_fraction.npz"))["land"].astype("f4")

    nm, ns, ny = len(models), len(SCENARIOS), len(YEARS)
    roll = np.empty((nm, ns, ny, NLAT, NLON), "f4")
    arrival = np.empty((ns, len(LEVELS), nm, NLAT, NLON), "u1")
    # annual global, land and ocean means for each model and scenario, 1850-2100
    region_annual = np.full((nm, ns, 3, 251), np.nan, "f4")
    masks = [AREA, AREA * land, AREA * (1 - land)]
    masks = [m / m.sum() for m in masks]

    for im, m in enumerate(models):
        hy, h = annual_means(os.path.join(cache, f"{m}__historical__tas.npz"))
        if hy[0] == 1851:
            # AWI-CM-1-1-MR starts in 1851. Reuse that year as 1850 so all models share
            # one time axis; it only touches the baseline and the earliest 20-year window.
            print(f"  note: {m} starts in 1851; using 1851 for 1850")
            hy = np.concatenate([[1850], hy])
            h = np.concatenate([h[:1], h])
        if hy[0] != 1850 or hy[-1] != 2014:
            raise RuntimeError(f"{m} historical covers {hy[0]}-{hy[-1]}")
        base = h[(hy >= 1850) & (hy <= 1900)].mean(axis=0)
        for js, s in enumerate(SCENARIOS):
            fy, f = annual_means(os.path.join(cache, f"{m}__{s}__tas.npz"))
            if fy[0] != 2015 or fy[-1] < 2099:
                raise RuntimeError(f"{m} {s} covers {fy[0]}-{fy[-1]}")
            anom = np.concatenate([h, f]) - base
            for r, w in enumerate(masks):
                region_annual[im, js, r, : anom.shape[0]] = (anom * w).sum(axis=(1, 2))
            roll[im, js] = smooth_20yr(anom[: 2099 - 1850 + 1], 1850)
            for jl, lv in enumerate(LEVELS):
                arrival[js, jl, im] = first_reach(roll[im, js], lv)
        print("  built", m, flush=True)

    # sizes stay small enough for a static host
    arrival.reshape(ns, len(LEVELS), nm, -1).tofile(os.path.join(site, "arrival.bin"))

    q = np.percentile(roll, [10, 50, 90], axis=0)  # (stat, scenario, year, lat, lon)
    ci = np.searchsorted(YEARS, COMMON_YEARS)
    si = np.searchsorted(YEARS, SCEN_YEARS)
    cell_rows = []
    for st in range(3):
        cell_rows.append(q[st, 0, ci])  # common part: all scenarios share it (see check below)
        for js in range(ns):
            cell_rows.append(q[st, js, si])
    series = encode(np.concatenate(cell_rows, axis=0))  # (values, lat, lon)
    series = np.moveaxis(series, 0, -1).reshape(NLAT * NLON, -1)  # cell-major for fast reads
    series.tofile(os.path.join(site, "series.bin"))
    print("series values per cell:", series.shape[1], "range", float(q.min()), float(q.max()))

    (np.rint(land * 255).astype("u1")).tofile(os.path.join(site, "land.bin"))

    # global reference for the place chart and the timeline
    gw = np.array([[(roll[im, js] * AREA).sum(axis=(1, 2)) for js in range(ns)] for im in range(nm)])
    gq = np.percentile(gw, [10, 50, 90], axis=0)
    world_arrival = []
    for js in range(ns):
        by_level = []
        for lv in LEVELS:
            ys = []
            for im in range(nm):
                idx, found = sustained_arrival(gw[im, js], lv)
                ys.append(int(YEARS[idx]) if found else None)
            by_level.append(ys)
        world_arrival.append(by_level)

    meta = {
        "models": models,
        "scenarios": SCENARIOS,
        "levels": LEVELS,
        "grid": {"nlat": NLAT, "nlon": NLON, "lat0": float(LAT[0]), "lon0": float(LON[0]), "step": 2.5},
        "baseline": [1850, 1900],
        "window": 20,
        "holdYears": HOLD_YEARS,
        "firstArrivalYear": FIRST_ARRIVAL_YEAR,
        "lastYear": int(YEARS[-1]),
        "notReached": NOT_REACHED,
        "arrivalOffset": 1850,
        "seriesYears": {"common": COMMON_YEARS.tolist(), "scenario": SCEN_YEARS.tolist()},
        "seriesEncoding": {"offset": ENC_OFFSET, "scale": ENC_SCALE},
        "world": {
            "common": np.round(gq[:, 0, ci], 3).tolist(),
            "scenario": np.round(gq[:, :, si], 3).tolist(),
            "arrival": world_arrival,
        },
    }
    with open(os.path.join(site, "meta.json"), "w") as fh:
        json.dump(meta, fh, separators=(",", ":"))

    np.save(os.path.join(analysis, "roll.npy"), roll)
    np.savez_compressed(
        os.path.join(analysis, "summary.npz"),
        models=np.array(models),
        arrival=arrival,
        region_annual=region_annual,
        land=land,
        years=YEARS,
    )
    for name in ("arrival.bin", "series.bin", "land.bin", "meta.json"):
        print(name, os.path.getsize(os.path.join(site, name)))


if __name__ == "__main__":
    main()
