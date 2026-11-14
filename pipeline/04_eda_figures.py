#!/usr/bin/env python3
"""The six exploratory graphs that led to the question.

Usage: python 04_eda_figures.py CACHE_DIR ANALYSIS_DIR SITE_DATA_DIR OUT_DIR
Also writes eda/findings.json with the numbers quoted in the talk track.
"""
import json
import os
import sys

import matplotlib

matplotlib.use("Agg")
import matplotlib.pyplot as plt
import numpy as np
from matplotlib.colors import BoundaryNorm, LinearSegmentedColormap, ListedColormap

cache, analysis, site, out = sys.argv[1:5]
os.makedirs(out, exist_ok=True)

INK, INK2, INK3, GRID, AXIS = "#0b0b0b", "#52514e", "#6f6e69", "#e1e0d9", "#c3c2b7"
SURFACE = "#fcfcfb"
SCEN = ["ssp126", "ssp245", "ssp370", "ssp585"]
SCEN_NAME = ["SSP1-2.6", "SSP2-4.5", "SSP3-7.0", "SSP5-8.5"]
SCEN_COLOR = ["#1c5cab", "#5598e7", "#eb6834", "#a3161f"]
LEVELS = [1.5, 2.0, 3.0, 4.0]
ARRIVAL_COLORS = ["#6b0f1a", "#b3261e", "#e4572e", "#f59e4c", "#fbd28a", "#edece8"]
ARRIVAL_EDGES = [1850, 2025.5, 2040.5, 2055.5, 2070.5, 2090.5, 2200]
ARRIVAL_LABELS = ["By 2025", "2026–2040", "2041–2055", "2056–2070", "2071–2090", "Not by 2090"]
DPI = 200

plt.rcParams.update({
    "font.family": ["Helvetica Neue", "Arial", "DejaVu Sans"],
    "font.size": 11,
    "axes.edgecolor": AXIS,
    "axes.labelcolor": INK2,
    "axes.titlecolor": INK,
    "xtick.color": INK3,
    "ytick.color": INK3,
    "xtick.major.size": 0,
    "ytick.major.size": 0,
    "axes.spines.top": False,
    "axes.spines.right": False,
    "axes.spines.left": False,
    "axes.grid": True,
    "grid.color": GRID,
    "grid.linewidth": 0.8,
    "figure.facecolor": SURFACE,
    "axes.facecolor": SURFACE,
    "savefig.facecolor": SURFACE,
})

d = np.load(f"{analysis}/summary.npz")
models = [str(m) for m in d["models"]]
YEARS = d["years"]
land = d["land"]
arrival = d["arrival"]  # scenario, level, model, lat, lon
roll = np.load(f"{analysis}/roll.npy", mmap_mode="r")  # model, scenario, year, lat, lon
LAT = -88.75 + 2.5 * np.arange(72)
LON = 1.25 + 2.5 * np.arange(144)
AREA = np.cos(np.deg2rad(LAT))[:, None] * np.ones((72, 144))
AREA = AREA / AREA.sum()
findings = {"n_models": len(models)}


def sustained_year(series, level, hold=20):
    """First year the 1-D smoothed series reaches level and holds for `hold` more years."""
    hit = series >= level
    for i in range(len(hit)):
        if YEARS[i] >= 1911 and hit[i : i + hold + 1].all():
            return int(YEARS[i])
    return None


def cell_of(lat, lon):
    return int(np.floor((lat + 90) / 2.5)), int(np.floor((lon % 360) / 2.5))


# Coastlines from the same Natural Earth file the page uses
topo = json.load(open(f"{site}/land-110m.json"))
scale, translate = topo["transform"]["scale"], topo["transform"]["translate"]
arcs = []
for arc in topo["arcs"]:
    xy = np.cumsum(np.array(arc), axis=0) * np.array(scale) + np.array(translate)
    arcs.append(xy)


def draw_coast(ax, lw=0.5, color="#0b0b0b", alpha=0.65):
    for xy in arcs:
        x = xy[:, 0]
        # split where a line jumps across the map edge
        breaks = np.where(np.abs(np.diff(x)) > 180)[0] + 1
        for seg in np.split(xy, breaks):
            ax.plot(seg[:, 0], seg[:, 1], color=color, lw=lw, alpha=alpha, solid_capstyle="round")


def shift(field):
    """Reorder longitudes from 0..360 to -180..180 for plotting."""
    n = field.shape[-1] // 2
    return np.roll(field, n, axis=-1)


LON_PLOT = LON - 180
lon_edges = np.arange(-180, 180.01, 2.5)
lat_edges = np.arange(-90, 90.01, 2.5)


def map_axes(ax):
    ax.set_xlim(-180, 180)
    ax.set_ylim(-90, 90)
    ax.set_aspect(1.0)
    ax.grid(False)
    ax.set_xticks([])
    ax.set_yticks([])
    for sp in ax.spines.values():
        sp.set_visible(False)


def save(fig, name):
    path = os.path.join(out, name)
    fig.savefig(path, dpi=DPI)
    plt.close(fig)
    print("wrote", path)


def median_arrival_years(js, jl):
    a = np.sort(arrival[js, jl], axis=0)[len(models) // 2].astype("f8")
    a[a == 255] = np.nan
    return a + 1850


# 1. Global warming by scenario ----------------------------------------------
gw = np.empty((len(models), 4, len(YEARS)))
for i in range(len(models)):
    for j in range(4):
        gw[i, j] = (np.asarray(roll[i, j]) * AREA).sum(axis=(1, 2))
fig, ax = plt.subplots(figsize=(8.8, 4.7), constrained_layout=True)
qs = np.percentile(gw, [10, 50, 90], axis=0)
k = YEARS >= 1900
hist = (YEARS >= 1900) & (YEARS <= 2005)  # windows that end by 2014 are the same in every scenario
fut = YEARS >= 2005
ax.fill_between(YEARS[hist], qs[0, 0, hist], qs[2, 0, hist], color=INK2, alpha=0.13, lw=0)
for j in [3, 2, 1, 0]:
    ax.fill_between(YEARS[fut], qs[0, j, fut], qs[2, j, fut], color=SCEN_COLOR[j], alpha=0.10, lw=0)
ax.plot(YEARS[hist], qs[1, 0, hist], color=INK2, lw=2)
for j in [3, 2, 1, 0]:
    ax.plot(YEARS[fut], qs[1, j, fut], color=SCEN_COLOR[j], lw=2)
ax.text(1975, 0.62, "Historical run", fontsize=10.5, color=INK2, ha="center")
ends = sorted([(qs[1, j, -1], j) for j in range(4)])
for v, j in ends:
    ax.annotate(f"{SCEN_NAME[j]}  +{v:.1f} °C", (2090, v), xytext=(6, 0), textcoords="offset points", va="center", color=INK2, fontsize=10.5, annotation_clip=False)
ax.axhline(2, color=INK, lw=1)
ax.text(1902, 2.07, "+2 °C", fontsize=10.5, fontweight="bold", color=INK)
ax.set_xlim(1900, 2090)
ax.set_ylabel("Global warming since 1850–1900 (°C)")
ax.grid(axis="x", visible=False)
ax.margins(y=0.04)
fig.get_layout_engine().set(rect=(0, 0, 0.87, 1))
save(fig, "1_global_warming_by_scenario.png")
findings["global"] = {
    SCEN_NAME[j]: {
        "y2090": round(float(qs[1, j, -1]), 2),
        "arrival_2C_median": (lambda ys: None if sum(y is None for y in ys) > len(models) / 2 else sorted(y for y in ys if y is not None)[len(models) // 2])(
            [sustained_year(gw[i, j], 2) for i in range(len(models))]
        ),
    }
    for j in range(4)
}
for yy in (2030, 2040, 2050, 2060):
    i = int(np.where(YEARS == yy)[0][0])
    findings["global"].setdefault("spread_by_year", {})[str(yy)] = round(float(qs[1, :, i].max() - qs[1, :, i].min()), 2)

# 2. Warming map --------------------------------------------------------------
i2090 = int(np.where(YEARS == 2090)[0][0])
late = np.median(np.asarray(roll[:, 1, i2090]), axis=0)
global_late = float((late * AREA).sum())
vmin, vmax = -2, 10
bounds = np.arange(vmin, vmax + 0.01, 1)
# Diverging at zero: blue means cooling, every warm step means warming.
colors = ["#7fb0e6", "#cfe0f5", "#fdf0d3", "#fbd28a", "#f8b567", "#f59e4c", "#e4572e", "#cb3b25", "#b3261e", "#8e1a1e", "#6b0f1a", "#3f0810"]
norm = BoundaryNorm(bounds, len(bounds) - 1)
fig, ax = plt.subplots(figsize=(8.8, 4.7), constrained_layout=True)
pm = ax.pcolormesh(lon_edges, lat_edges, shift(late), cmap=ListedColormap(colors), norm=norm, rasterized=True)
draw_coast(ax)
map_axes(ax)
cb = fig.colorbar(pm, ax=ax, orientation="horizontal", fraction=0.05, pad=0.02, aspect=50, ticks=bounds[::2])
cb.outline.set_visible(False)
cb.ax.tick_params(length=0, labelsize=10)
cb.set_label(f"Warming, 2080–2099 vs 1850–1900, SSP2-4.5, °C (world average +{global_late:.1f})", color=INK2)
save(fig, "2_warming_map_ssp245.png")
nc_i, nc_j = cell_of(52, -35)
findings["map"] = {
    "global": round(global_late, 2),
    "arctic_66N": round(float((late[LAT >= 66.5] * AREA[LAT >= 66.5]).sum() / AREA[LAT >= 66.5].sum()), 2),
    "land": round(float((late * AREA * land).sum() / (AREA * land).sum()), 2),
    "ocean": round(float((late * AREA * (1 - land)).sum() / (AREA * (1 - land)).sum()), 2),
    "north_atlantic_52N35W": round(float(late[nc_i, nc_j]), 2),
    "southern_ocean_57S60W": round(float(late[cell_of(-57, -60)]), 2),
    "min_cell": round(float(late.min()), 2),
    "max_cell": round(float(late.max()), 2),
}

# 3. Latitude x time ----------------------------------------------------------
med = np.median(np.asarray(roll[:, 1]), axis=0)  # year, lat, lon
zonal = med.mean(axis=2)  # year, lat
fig, ax = plt.subplots(figsize=(8.8, 4.7), constrained_layout=True)
k = YEARS >= 1960
pm = ax.pcolormesh(np.append(YEARS[k] - 0.5, YEARS[k][-1] + 0.5), lat_edges, zonal[k].T, cmap=ListedColormap(colors), norm=norm, rasterized=True)
cs = ax.contour(YEARS[k], LAT, zonal[k].T, levels=[2.0], colors=[INK], linewidths=2)
ax.clabel(cs, fmt="+2 °C", fontsize=10.5, inline=True, manual=[(2040, 50)])
ax.axhline(66.5, color=INK2, lw=0.7)
ax.text(1962, 68, "Arctic Circle", fontsize=9.5, color=INK)
ax.set_yticks([-60, -30, 0, 30, 60, 90], ["60°S", "30°S", "Equator", "30°N", "60°N", "90°N"])
ax.set_ylim(-90, 90)
ax.grid(False)
cb = fig.colorbar(pm, ax=ax, orientation="horizontal", fraction=0.05, pad=0.02, aspect=50, ticks=bounds[::2])
cb.outline.set_visible(False)
cb.ax.tick_params(length=0, labelsize=10)
cb.set_label("Warming since 1850–1900, average around each latitude, SSP2-4.5, °C", color=INK2)
save(fig, "3_latitude_by_time_ssp245.png")
zona_year = {}
for name, cond in {"arctic": LAT >= 66.5, "tropics": np.abs(LAT) <= 23.5, "southern_ocean": (LAT <= -50) & (LAT >= -65)}.items():
    s = (zonal[:, cond] * np.cos(np.deg2rad(LAT[cond]))).sum(1) / np.cos(np.deg2rad(LAT[cond])).sum()
    zona_year[name] = sustained_year(s, 2)
findings["latitude_arrival_2C"] = zona_year

# 4. Precipitation agreement ---------------------------------------------------
pr_changes, ta_changes = [], []
DAYS = np.array([31, 28, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31], "f4")
for i, m in enumerate(models):
    a = np.load(f"{cache}/{m}__historical__pr.npz")
    b = np.load(f"{cache}/{m}__ssp245__pr.npz")
    wa = DAYS[a["months"] - 1]
    wb = DAYS[b["months"] - 1]
    pa = (a["data"] * wa[:, None, None]).sum(0) / wa.sum()
    pb = (b["data"] * wb[:, None, None]).sum(0) / wb.sum()
    pr_changes.append(100 * (pb - pa) / np.maximum(pa, 0.05))
    # same periods for temperature so the two variables are compared fairly
    r1 = np.asarray(roll[i, 1, int(np.where(YEARS == 2005)[0][0])])
    ta_changes.append(np.asarray(roll[i, 1, i2090]) - r1)
pr_changes = np.array(pr_changes)
ta_changes = np.array(ta_changes)
pr_med = np.median(pr_changes, axis=0)
pr_agree = np.maximum((pr_changes > 0).mean(0), (pr_changes < 0).mean(0))
ta_agree = np.maximum((ta_changes > 0).mean(0), (ta_changes < 0).mean(0))
AGREE = 0.8
findings["agreement"] = {
    "threshold": AGREE,
    "pr_area_agree": round(float((AREA * (pr_agree >= AGREE)).sum()), 3),
    "tas_area_agree": round(float((AREA * (ta_agree >= AGREE)).sum()), 3),
    "pr_land_agree": round(float((AREA * land * (pr_agree >= AGREE)).sum() / (AREA * land).sum()), 3),
    "tas_land_agree": round(float((AREA * land * (ta_agree >= AGREE)).sum() / (AREA * land).sum()), 3),
}
brbg = LinearSegmentedColormap.from_list("rain", ["#8a5a1c", "#c79a58", "#ece3d0", "#f4f1ea", "#cfe3dd", "#5aa79a", "#0f6b63"])
b_pr = np.array([-40, -30, -20, -10, -3, 3, 10, 20, 30, 40])
fig, ax = plt.subplots(figsize=(8.8, 4.7), constrained_layout=True)
pm = ax.pcolormesh(lon_edges, lat_edges, shift(pr_med), cmap=ListedColormap(brbg(np.linspace(0, 1, len(b_pr) - 1))), norm=BoundaryNorm(b_pr, len(b_pr) - 1), rasterized=True)
ag = shift(pr_agree) < AGREE
lon2, lat2 = np.meshgrid(lon_edges[:-1] + 1.25, lat_edges[:-1] + 1.25)
ax.scatter(lon2[ag][::1], lat2[ag][::1], s=1.1, color="#0b0b0b", alpha=0.42, linewidths=0, rasterized=True)
draw_coast(ax)
map_axes(ax)
cb = fig.colorbar(pm, ax=ax, orientation="horizontal", fraction=0.05, pad=0.02, aspect=50, ticks=b_pr)
cb.outline.set_visible(False)
cb.ax.tick_params(length=0, labelsize=10)
cb.set_label("Rainfall change, 2081–2100 vs 1995–2014, SSP2-4.5, %. Dots: fewer than 80% of models agree on the sign", color=INK2)
save(fig, "4_rainfall_change_agreement.png")

# 5. Cities and model spread ---------------------------------------------------
CITIES = [
    ("Longyearbyen", 78.2, 15.6),
    ("Moscow", 55.75, 37.6),
    ("Phoenix", 33.45, -112.07),
    ("Madrid", 40.4, -3.7),
    ("Beijing", 39.9, 116.4),
    ("San Diego", 32.72, -117.15),
    ("Nairobi", -1.29, 36.82),
    ("São Paulo", -23.55, -46.63),
    ("Singapore", 1.29, 103.85),
    ("Sydney", -33.87, 151.21),
]
rows = []
for name, la, lo in CITIES:
    j, i = cell_of(la, lo)
    a = arrival[1, 1, :, j, i].astype("f8")
    ys = np.where(a == 255, np.nan, a + 1850)
    nn = np.sort(np.nan_to_num(ys, nan=9999))
    rows.append((name, ys, nn[len(models) // 2]))
rows.sort(key=lambda r: r[2], reverse=True)
fig, ax = plt.subplots(figsize=(8.8, 4.7), constrained_layout=True)
for r, (name, ys, md) in enumerate(rows):
    ok = ~np.isnan(ys)
    if ok.any():
        ax.plot([np.nanmin(ys), np.nanmax(ys)], [r, r], color=AXIS, lw=1.2, zorder=1)
    jit = (np.arange(len(ys)) % 3 - 1) * 0.13
    ax.scatter(ys[ok], r + jit[ok], s=30, color="#e4572e", edgecolor=SURFACE, linewidth=0.8, zorder=2)
    n_after = int((~ok).sum())
    if n_after:
        ax.text(2092, r, f"{n_after} not by 2090", fontsize=9.5, color=INK2, va="center")
    if md < 9999:
        ax.plot([md, md], [r - 0.33, r + 0.33], color=INK, lw=2.2, zorder=3)
ax.set_yticks(range(len(rows)), [r[0] for r in rows])
ax.set_xlim(1940, 2112)
ax.set_xticks(np.arange(1940, 2091, 10), [str(y) if y % 20 == 0 else "" for y in np.arange(1940, 2091, 10)])
ax.grid(axis="y", visible=False)
ax.set_xlabel("Year the 20-year average reaches +2 °C and stays there, SSP2-4.5.  Dot: one climate model.  Bar: median.")
save(fig, "5_city_arrival_model_spread.png")
findings["cities"] = {
    name: {
        "median": None if md >= 9999 else int(md),
        "earliest": None if np.isnan(ys).all() else int(np.nanmin(ys)),
        "latest": None if np.isnan(ys).all() else int(np.nanmax(ys)),
        "n_reached": int((~np.isnan(ys)).sum()),
    }
    for name, ys, md in rows
}
a = arrival[1, 1].astype("f8")
a[a == 255] = np.nan
all_reach = ~np.isnan(a).any(axis=0)
with np.errstate(all="ignore"):
    import warnings

    with warnings.catch_warnings():
        warnings.simplefilter("ignore")
        rng = np.nanmax(a, axis=0) - np.nanmin(a, axis=0)
findings["model_range_2C_ssp245"] = {
    "median_range_years_cells_all_models_reach": round(float(np.median(rng[all_reach])), 1),
    "area_share_all_models_reach": round(float((AREA * all_reach).sum()), 3),
}

# 6. Why a static map is not enough: every level x scenario --------------------
fig, axes = plt.subplots(4, 4, figsize=(8.8, 4.7), constrained_layout=True)
cm = ListedColormap(ARRIVAL_COLORS)
nb = BoundaryNorm(ARRIVAL_EDGES, cm.N)
for jl in range(4):
    for js in range(4):
        ax = axes[jl, js]
        f = np.nan_to_num(median_arrival_years(js, jl), nan=2150)
        pm = ax.pcolormesh(lon_edges, lat_edges, shift(f), cmap=cm, norm=nb, rasterized=True)
        draw_coast(ax, lw=0.18, alpha=0.5)
        map_axes(ax)
        if jl == 0:
            ax.set_title(SCEN_NAME[js], fontsize=9.5, color=INK2, pad=2)
        if js == 0:
            ax.text(-0.04, 0.5, f"+{LEVELS[jl]:g} °C", transform=ax.transAxes, rotation=90, ha="right", va="center", fontsize=9.5, color=INK2)
handles = [plt.Rectangle((0, 0), 1, 1, color=c) for c in ARRIVAL_COLORS]
fig.legend(handles, ARRIVAL_LABELS, loc="outside lower center", ncol=6, frameon=False, fontsize=9.5, handlelength=1.2, columnspacing=1.2, labelcolor=INK2)
save(fig, "6_arrival_year_16_maps.png")

# Numbers for the talk track and stories ---------------------------------------
ms = {}
for js, s in enumerate(SCEN_NAME):
    for jl, lv in enumerate(LEVELS):
        a = median_arrival_years(js, jl)
        ms[f"{s}|+{lv:g}"] = {
            "land_by_2025": round(float((AREA * land * (a <= 2025)).sum() / (AREA * land).sum()), 3),
            "land_by_2050": round(float((AREA * land * (a <= 2050)).sum() / (AREA * land).sum()), 3),
            "ocean_by_2050": round(float((AREA * (1 - land) * (a <= 2050)).sum() / (AREA * (1 - land)).sum()), 3),
            "land_by_2090": round(float((AREA * land * (a <= 2090)).sum() / (AREA * land).sum()), 3),
            "ocean_by_2090": round(float((AREA * (1 - land) * (a <= 2090)).sum() / (AREA * (1 - land)).sum()), 3),
        }
findings["shares"] = ms
places = {}
for name, la, lo in CITIES + [("North Atlantic", 52, -35), ("Southern Ocean", -57, -60)]:
    j, i = cell_of(la, lo)
    entry = {}
    for js, s in enumerate(SCEN_NAME):
        v = median_arrival_years(js, 1)[j, i]
        entry[s] = None if np.isnan(v) else int(v)
    places[name] = entry
findings["place_arrival_2C"] = places
json.dump(findings, open(os.path.join(out, "findings.json"), "w"), indent=1, ensure_ascii=False)
print(json.dumps(findings, indent=0, ensure_ascii=False)[:6000])
