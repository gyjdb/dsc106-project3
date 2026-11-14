#!/usr/bin/env python3
"""Check the processed data against published numbers before anything is drawn.
Usage: python validate.py ANALYSIS_DIR
"""
import sys

import numpy as np

a = sys.argv[1]
d = np.load(f"{a}/summary.npz")
models = [str(m) for m in d["models"]]
ra = d["region_annual"]  # model, scenario, region (global, land, ocean), year-1850
Y = np.arange(1850, 2101)
SC = ["ssp126", "ssp245", "ssp370", "ssp585"]
# IPCC AR6 WGI SPM Table SPM.1 assessed warming relative to 1850-1900: best (very likely range)
IPCC_LATE = {"ssp126": (1.8, 1.3, 2.4), "ssp245": (2.7, 2.1, 3.5), "ssp370": (3.6, 2.8, 4.6), "ssp585": (4.4, 3.3, 5.7)}
IPCC_MID = {"ssp126": 1.7, "ssp245": 2.0, "ssp370": 2.1, "ssp585": 2.4}


def period(arr, y0, y1):
    k = (Y >= y0) & (Y <= y1)
    return np.nanmean(arr[..., k], axis=-1)


print("Models:", len(models))
print("\nGlobal warming relative to 1850-1900, multi-model median [10-90%] vs IPCC assessed")
for j, s in enumerate(SC):
    late = period(ra[:, j, 0], 2081, 2100)
    mid = period(ra[:, j, 0], 2041, 2060)
    lp = np.percentile(late, [10, 50, 90])
    print(
        f"  {s} 2081-2100 {lp[1]:.2f} [{lp[0]:.2f}-{lp[2]:.2f}] | IPCC {IPCC_LATE[s][0]} [{IPCC_LATE[s][1]}-{IPCC_LATE[s][2]}]"
        f" || 2041-2060 {np.median(mid):.2f} | IPCC {IPCC_MID[s]}"
    )
hist = period(ra[:, 1, 0], 1995, 2014)
print(f"  1995-2014 median {np.median(hist):.2f} (IPCC observed estimate about 0.85)")

print("\nPer model, SSP2-4.5 global 2081-2100, and jump between 2005-2014 and 2015-2024")
late = period(ra[:, 1, 0], 2081, 2100)
for i, m in enumerate(models):
    jump = period(ra[i, 1, 0], 2015, 2024) - period(ra[i, 1, 0], 2005, 2014)
    print(f"  {m:16s} {late[i]:.2f}  decade step {jump:+.2f}")

land = period(ra[:, 1, 1], 2081, 2100)
ocean = period(ra[:, 1, 2], 2081, 2100)
print(f"\nLand/ocean warming ratio, SSP2-4.5, 2081-2100: {np.median(land / ocean):.2f} (literature: about 1.4-1.7)")

roll = np.load(f"{a}/roll.npy", mmap_mode="r")
YR = d["years"]
LAT = -88.75 + 2.5 * np.arange(72)
w = np.cos(np.deg2rad(LAT))
k = YR == 2090
late_map = np.median(np.asarray(roll[:, 1, k])[:, 0], axis=0)
arctic = LAT >= 66.5
glob = (late_map.mean(1) * w).sum() / w.sum()
arc = (late_map[arctic].mean(1) * w[arctic]).sum() / w[arctic].sum()
print(f"Arctic amplification, SSP2-4.5, 2080-2099 vs 1850-1900: {arc:.2f} / {glob:.2f} = {arc / glob:.2f} (at this distance from baseline literature: about 2-3x)")

arr = d["arrival"]
print("\nHow often a cell dips back below +2 C after first touching it, SSP2-4.5")
r = np.asarray(roll[:, 1])  # model, year, lat, lon
hit = r >= 2.0
first = hit.argmax(1)
ever = hit.any(1)
# last time the smoothed series is below the level before staying above it
rev = hit[:, ::-1]
never_below_after = rev.argmin(1)  # number of final years continuously above
sustained = len(YR) - never_below_after
sustained[~ever] = -1
diff = (sustained - first)[ever & (sustained < len(YR))]
print(f"  cells x models with an arrival: {diff.size}; gap between first reach and final sustained crossing:")
print(f"  median {np.median(diff):.0f}, 90th pct {np.percentile(diff, 90):.0f}, 99th pct {np.percentile(diff, 99):.0f} years; share with gap 0: {(diff == 0).mean():.2f}")
