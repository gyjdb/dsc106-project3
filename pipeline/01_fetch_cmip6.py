#!/usr/bin/env python3
"""Download CMIP6 monthly fields from the public Google Cloud Zarr stores and
regrid each model to one shared 2.5-degree grid.

Usage:
    python 01_fetch_cmip6.py CATALOG_CSV CACHE_DIR [--models A,B] [--workers N]

Each output file holds one model + experiment + variable, so an interrupted run
resumes where it stopped.
"""
import argparse
import os
import re
import sys
import time
from concurrent.futures import ProcessPoolExecutor, as_completed

import numpy as np

# 38 models have all five experiments in the catalog, and 25 of them pass the TCR "likely"
# screen (1.4-2.2 C) in the supporting data of Hausfather et al. 2022. These are 17 of the 25,
# with no two from the same CMIP6 institution ID. (ACCESS-CM2 and ACCESS-ESM1-5 are listed
# under different IDs, CSIRO-ARCCSS and CSIRO, and both are kept.)
# Not used: CESM2, CMCC-CM2-SR5, FGOALS-f3-L, GISS-E2-1-H and MIROC-ES2L, which each share an
# institution ID with a model below, and IITM-ESM, MCM-UA-1-0 and MPI-ESM1-2-HR.
MODELS = {
    "ACCESS-CM2": "r1i1p1f1",
    "ACCESS-ESM1-5": "r31i1p1f1",
    "AWI-CM-1-1-MR": "r1i1p1f1",
    "BCC-CSM2-MR": "r1i1p1f1",
    "CAMS-CSM1-0": "r1i1p1f1",
    "CESM2-WACCM": "r1i1p1f1",
    "CMCC-ESM2": "r1i1p1f1",
    "CNRM-ESM2-1": "r1i1p1f2",
    "FGOALS-g3": "r1i1p1f1",
    "GFDL-ESM4": "r1i1p1f1",
    "GISS-E2-1-G": "r1i1p3f1",
    "INM-CM5-0": "r1i1p1f1",
    "KACE-1-0-G": "r1i1p1f1",
    "MIROC6": "r1i1p1f1",
    "MPI-ESM1-2-LR": "r1i1p1f1",
    "MRI-ESM2-0": "r1i1p1f1",
    "NorESM2-LM": "r1i1p1f1",
}

SCENARIOS = ["ssp126", "ssp245", "ssp370", "ssp585"]

# variable, experiment, first year, last year
JOBS = [("tas", "historical", 1850, 2014)]
JOBS += [("tas", s, 2015, 2100) for s in SCENARIOS]
JOBS += [("pr", "historical", 1995, 2014), ("pr", "ssp245", 2081, 2100)]

DLAT = DLON = 2.5
TARGET_LAT_EDGES = np.arange(-90, 90 + DLAT, DLAT)
TARGET_LON_EDGES = np.arange(0, 360 + DLON, DLON)


def edges_from_centers(c):
    mid = (c[:-1] + c[1:]) / 2
    return np.concatenate([[c[0] - (mid[0] - c[0])], mid, [c[-1] + (c[-1] - mid[-1])]])


def lat_weights(src_lat):
    """Target-by-source area overlap in latitude (weights use sin(lat), so they are
    proportional to true area)."""
    e = np.clip(edges_from_centers(src_lat), -90, 90)
    se = np.sin(np.deg2rad(e))
    te = np.sin(np.deg2rad(TARGET_LAT_EDGES))
    w = np.zeros((len(te) - 1, len(src_lat)))
    for i in range(len(te) - 1):
        lo = np.maximum(te[i], se[:-1])
        hi = np.minimum(te[i + 1], se[1:])
        w[i] = np.clip(hi - lo, 0, None)
    return w / w.sum(axis=1, keepdims=True)


def lon_weights(src_lon):
    """Target-by-source overlap in longitude, wrapping around 360 degrees."""
    e = edges_from_centers(src_lon)
    n_t = len(TARGET_LON_EDGES) - 1
    w = np.zeros((n_t, len(src_lon)))
    for i in range(n_t):
        for shift in (-360.0, 0.0, 360.0):
            lo = np.maximum(TARGET_LON_EDGES[i], e[:-1] + shift)
            hi = np.minimum(TARGET_LON_EDGES[i + 1], e[1:] + shift)
            w[i] += np.clip(hi - lo, 0, None)
    return w / w.sum(axis=1, keepdims=True)


def regrid(field, src_lat, src_lon):
    """Area-conservative regrid of (time, lat, lon) onto the 2.5-degree target grid."""
    wl = lat_weights(src_lat)
    wo = lon_weights(src_lon).T
    out = np.empty((field.shape[0], len(TARGET_LAT_EDGES) - 1, len(TARGET_LON_EDGES) - 1), "f4")
    for k in range(field.shape[0]):
        out[k] = wl @ field[k] @ wo
    return out


def pick_store(cat, model, member, table, var, exp):
    q = cat[
        (cat.source_id == model)
        & (cat.member_id == member)
        & (cat.table_id == table)
        & (cat.variable_id == var)
        & (cat.experiment_id == exp)
    ]
    if q.empty:
        return None
    return q.sort_values("version").iloc[-1].zstore


def fetch(model, member, var, exp, y0, y1, store, cache):
    import dask
    import gcsfs
    import xarray as xr

    dask.config.set(scheduler="threads", num_workers=12)
    path = os.path.join(cache, f"{model}__{exp}__{var}.npz")
    if os.path.exists(path):
        return f"skip {model} {exp} {var}"
    t0 = time.time()
    fs = gcsfs.GCSFileSystem(token="anon", timeout=120)
    ds = xr.open_zarr(fs.get_mapper(store), consolidated=True,
                      decode_times=xr.coders.CFDatetimeCoder(use_cftime=True))
    da = ds[var]
    if da.ndim == 4:  # e.g. a singleton height or member dimension
        da = da.squeeze(drop=True)
    lat_name = "lat" if "lat" in da.dims else "latitude"
    lon_name = "lon" if "lon" in da.dims else "longitude"
    if lat_name not in da.dims or lon_name not in da.dims:
        raise RuntimeError(f"curvilinear grid: {da.dims}")
    da = da.sel(time=(da.time.dt.year >= y0) & (da.time.dt.year <= y1))
    da = da.transpose("time", lat_name, lon_name).sortby(lat_name)
    years = da.time.dt.year.values.astype("i2")
    months = da.time.dt.month.values.astype("i1")
    lat = da[lat_name].values.astype("f8")
    lon = np.mod(da[lon_name].values.astype("f8"), 360)
    order = np.argsort(lon)
    field = da.values[:, :, order]
    lon = lon[order]
    if np.isnan(field).any():
        raise RuntimeError(f"{np.isnan(field).sum()} NaN values in source")
    grid = regrid(field, lat, lon)
    if var == "pr":
        grid = grid * 86400.0  # kg m-2 s-1 -> mm/day
    tmp = path + ".tmp.npz"
    np.savez_compressed(tmp, data=grid, years=years, months=months, src_shape=np.array(field.shape))
    os.replace(tmp, path)
    return f"done {model:15s} {exp:10s} {var:3s} {field.shape} {time.time() - t0:5.0f}s"


def fetch_mask(cat, cache):
    """Land fraction on the target grid, taken from one model's sftlf field."""
    import gcsfs
    import xarray as xr

    path = os.path.join(cache, "land_fraction.npz")
    if os.path.exists(path):
        return "skip land mask"
    fs = gcsfs.GCSFileSystem(token="anon")
    q = cat[(cat.variable_id == "sftlf") & (cat.source_id == "GFDL-ESM4")]
    ds = xr.open_zarr(fs.get_mapper(q.iloc[0].zstore), consolidated=True)
    da = ds["sftlf"].squeeze(drop=True).sortby("lat")
    lon = np.mod(da.lon.values.astype("f8"), 360)
    order = np.argsort(lon)
    grid = regrid(da.values[np.newaxis, :, order] / 100.0, da.lat.values.astype("f8"), lon[order])[0]
    np.savez_compressed(path, land=grid)
    return f"done land mask, source {q.iloc[0].zstore}"


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("catalog")
    ap.add_argument("cache")
    ap.add_argument("--models", default="")
    ap.add_argument("--workers", type=int, default=6)
    a = ap.parse_args()

    import pandas as pd

    cat = pd.read_csv(a.catalog)
    cat = cat[cat.table_id.isin(["Amon", "fx"]) & cat.variable_id.isin(["tas", "pr", "sftlf"])]
    os.makedirs(a.cache, exist_ok=True)
    print(fetch_mask(cat, a.cache), flush=True)
    models = a.models.split(",") if a.models else list(MODELS)
    tasks, missing = [], []
    for m in models:
        for var, exp, y0, y1 in JOBS:
            store = pick_store(cat, m, MODELS[m], "Amon", var, exp)
            if store is None:
                missing.append((m, var, exp))
            else:
                tasks.append((m, MODELS[m], var, exp, y0, y1, store, a.cache))
    print("tasks", len(tasks), "missing", missing, flush=True)
    errors = 0
    with ProcessPoolExecutor(a.workers) as pool:
        futs = {pool.submit(fetch, *t): t for t in tasks}
        for f in as_completed(futs):
            try:
                print(f.result(), flush=True)
            except Exception as e:  # keep going; a failed model is reported at the end
                errors += 1
                t = futs[f]
                print(f"FAILED {t[0]} {t[3]} {t[2]}: {type(e).__name__}: {str(e)[:300]}", flush=True)
    print("finished, errors:", errors, flush=True)
    sys.exit(1 if errors else 0)


if __name__ == "__main__":
    main()
