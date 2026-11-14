#!/usr/bin/env python3
"""Checks the regridding in 01_fetch_cmip6.py on made-up fields with known answers.
Usage: python tests/check_regrid.py pipeline/01_fetch_cmip6.py
"""
import importlib.util
import sys

import numpy as np

spec = importlib.util.spec_from_file_location("fetch", sys.argv[1])
m = importlib.util.module_from_spec(spec)
spec.loader.exec_module(m)

T_LAT = -88.75 + 2.5 * np.arange(72)
T_LON = 1.25 + 2.5 * np.arange(144)
T_AREA = np.cos(np.deg2rad(T_LAT))[:, None] * np.ones((72, 144))
ok = True


def report(name, passed, detail):
    global ok
    ok &= bool(passed)
    print(f"{'PASS' if passed else 'FAIL'}  {name}  [{detail}]")


def src_area(lat, nlon):
    e = np.clip(m.edges_from_centers(lat), -90, 90)
    return np.diff(np.sin(np.deg2rad(e)))[:, None] * np.ones((len(lat), nlon))


# Three source grids like real models: Gaussian-style latitudes, a coarse grid, a fine grid
gauss = np.sort(np.rad2deg(np.arcsin(np.polynomial.legendre.leggauss(96)[0])))
grids = {
    "T63-style 96x192": (gauss, 0.0 + 1.875 * np.arange(192)),
    "coarse 80x96": (np.linspace(-88.875, 88.875, 80), 1.875 + 3.75 * np.arange(96)),
    "fine 192x288": (np.linspace(-90, 90, 192), 1.25 * np.arange(288)),
}
for name, (lat, lon) in grids.items():
    lon2, lat2 = np.meshgrid(lon, lat)
    # 1. A constant stays that constant
    c = m.regrid(np.full((1,) + lon2.shape, 287.5), lat, lon)[0]
    report(f"{name}: constant kept", np.allclose(c, 287.5, atol=1e-3), f"max error {np.abs(c - 287.5).max():.1e}")
    # 2. The global area-weighted mean is conserved
    f = 15 * np.cos(np.deg2rad(lat2)) ** 2 + 4 * np.sin(np.deg2rad(lon2)) * np.cos(np.deg2rad(lat2)) + 2 * np.sin(np.deg2rad(3 * lon2))
    g = m.regrid(f[None], lat, lon)[0]
    a0 = src_area(lat, len(lon))
    src_mean = (f * a0).sum() / a0.sum()
    dst_mean = (g * T_AREA).sum() / T_AREA.sum()
    report(f"{name}: global mean conserved", abs(src_mean - dst_mean) < 2e-2, f"{src_mean:.4f} vs {dst_mean:.4f}")
    # 3. The pattern lands in the right place, including across the 0/360 seam
    tl2, ta2 = np.meshgrid(T_LON, T_LAT)
    truth = 15 * np.cos(np.deg2rad(ta2)) ** 2 + 4 * np.sin(np.deg2rad(tl2)) * np.cos(np.deg2rad(ta2)) + 2 * np.sin(np.deg2rad(3 * tl2))
    rms = np.sqrt(((g - truth) ** 2 * T_AREA).sum() / T_AREA.sum())
    report(f"{name}: pattern in place", rms < 0.06, f"area-weighted RMS {rms:.3f}")

# 4. A one-box signal lands in the expected target cells
lat = np.arange(-89.5, 90, 1.0)
lon = np.arange(0.5, 360, 1.0)
f = np.zeros((180, 360))
f[(lat >= 30) & (lat < 35)][:, :] = 0
f[np.ix_((lat >= 30) & (lat < 35), (lon >= 100) & (lon < 105))] = 10
g = m.regrid(f[None], lat, lon)[0]
j, i = np.unravel_index(g.argmax(), g.shape)
report("box lands where it should", 30 <= T_LAT[j] <= 35 and 100 <= T_LON[i] <= 105 and abs(g.max() - 10) < 1e-6, f"peak {g.max():.3f} at lat {T_LAT[j]}, lon {T_LON[i]}")
sys.exit(0 if ok else 1)
