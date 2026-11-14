#!/usr/bin/env python3
"""Trim Natural Earth 1:50m populated places (public domain) to what the page needs.
Usage: python 03_build_cities.py INPUT_GEOJSON OUTPUT_JSON
"""
import json
import sys

src = json.load(open(sys.argv[1]))
rows = []
for f in src["features"]:
    p = f["properties"]
    lon, lat = f["geometry"]["coordinates"][:2]
    rows.append({
        "n": p["name"],
        "c": p.get("adm0name") or p.get("sov0name") or "",
        "lat": round(lat, 2),
        "lon": round(lon, 2),
        "pop": int(p.get("pop_max") or 0),
    })
rows.sort(key=lambda r: -r["pop"])
json.dump(rows, open(sys.argv[2], "w"), ensure_ascii=False, separators=(",", ":"))
print(len(rows), "places; largest:", [r["n"] for r in rows[:5]])
print("San Diego present:", [r for r in rows if r["n"] == "San Diego"])
