"""
Extracts the location-derived inputs for the fine-tuning dataset from the local FAO downloads in
`Datasets/` (see Datasets/README.md) into two small JSON files the TypeScript builder reads:

  data/dataset/qatar-site-grid.json   one record per 0.1-degree cell over Qatar (AgERA5 grid):
                                      aridity, farming system, irrigation, soil and a 1979-2026
                                      monthly climate from AgERA5
  data/dataset/qatar-production.json  FAOSTAT value of agricultural production for Qatar

Only needs numpy + rasterio:

  python -m venv .venv-geo && .venv-geo/Scripts/pip install numpy rasterio   (Windows)
  .venv-geo/Scripts/python scripts/dataset/extract_site_grid.py

Cells over the sea are kept (the builder drops them with the Qatar outline, lib/qatar/outline.ts).
A layer that is missing on disk is skipped and listed under "missing" in the output.
"""
import csv, glob, json, math, os, re, sys, time
from datetime import date

import numpy as np
import rasterio

ROOT = os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
DS = os.path.join(ROOT, "Datasets")
AQ = os.path.join(DS, "AQUAMAPS")
OUT = os.path.join(ROOT, "data", "dataset")

# AgERA5 pixel centres over the Qatar box (lon 50.7-51.7, lat 24.4-26.2).
LATS = [round(24.45 + 0.1 * i, 2) for i in range(18)]
LNGS = [round(50.75 + 0.1 * i, 2) for i in range(10)]
POINTS = [(lng, lat) for lat in LATS for lng in LNGS]

CLIM = os.path.join(AQ, "Climatology of Monthly Means")
ANALYSES = os.path.join(AQ, "Analyses")
GLOBWAT = os.path.join(ANALYSES, "GlobWat- a global water balance model to assess water use in irrigated agriculture")
GMIA = os.path.join(AQ, "Irrigation-Infrastructure", "Irrigation areas v.5 (Global - ~10 km)")
AGERA5 = os.path.join(AQ, "Global Weather for Agriculture - AgERA5")


def vsizip(zip_path, inner):
    return "/vsizip/" + zip_path.replace("\\", "/") + "/" + inner


# id, file, what it is, source (FAO catalog title), resolution
LAYERS = [
    ("aridity_index", os.path.join(CLIM, "Map of aridity (Global - ~20 km) -  AQUASTAT", "AQUASTAT.ARDT.tif"),
     "Aridity index P/ET0 (UNEP classes: <0.05 hyper-arid, <0.2 arid, <0.5 semi-arid)", "FAO AQUASTAT, Map of aridity", "~20 km"),
    ("precip_annual_mm_cru", os.path.join(CLIM, "Precipitation (Global - Mean Annual - ~20 km) - CRU CL 2.0", "AQUASTAT.PREC.tif"),
     "Mean annual precipitation, mm (1961-1990 normal)", "FAO AQUASTAT / CRU CL 2.0", "~20 km"),
    ("et0_annual_mm_aquastat", os.path.join(CLIM, "Reference evapotranspiration (Global - Mean Annual - ~20 km) - AQUASTAT", "AQUASTAT.RET.tif"),
     "Mean annual reference evapotranspiration (FAO Penman-Monteith), mm", "FAO AQUASTAT", "~20 km"),
    ("farming_system_id", os.path.join(ANALYSES, "Major agricultural systems (Global)", "farmsys-final.tif"),
     "Major agricultural (farming) system class", "FAO, Major agricultural systems (SOLAW)", "5 arc-min"),
    ("irrigated_share_pct", vsizip(os.path.join(GMIA, "gmia_v5_aei_pct_asc.zip"), "gmia_v5_aei_pct.asc"),
     "Share of the cell equipped for irrigation, %", "FAO GMIA v5 (Global Map of Irrigation Areas)", "5 arc-min"),
    ("irrigated_ha", vsizip(os.path.join(GMIA, "gmia_v5_aei_ha_asc.zip"), "gmia_v5_aei_ha.asc"),
     "Area equipped for irrigation in the cell, ha", "FAO GMIA v5", "5 arc-min"),
    ("irrigated_groundwater_pct", "/vsizip/{" + vsizip(os.path.join(GMIA, "gmia_v5_all.zip"), "gmia_v5_aeigw_pct_aei_asc.zip") + "}/gmia_v5_aeigw_pct_aei.asc",
     "Share of the irrigated area supplied by groundwater, %", "FAO GMIA v5", "5 arc-min"),
    ("salinized_share_pct", os.path.join(ANALYSES, "Proportion of land salinized due to irrigation (Global)", "aei_sal_38014.tif"),
     "Share of the irrigated area salinized by irrigation, %", "FAO, Proportion of land salinized due to irrigation", "~9 km"),
    ("soil_water_max_mm", vsizip(os.path.join(GLOBWAT, "GlobWat-InputP5-soilp.zip"), "hwsd-smax.asc"),
     "Maximum soil water held in the root zone, mm (HWSD)", "FAO GlobWat input (Harmonized World Soil Database)", "5 arc-min"),
    ("root_depth_m", vsizip(os.path.join(GLOBWAT, "GlobWat-InputP5-soilp.zip"), "rtdpth5m.asc"),
     "Effective rooting depth, m", "FAO GlobWat input", "5 arc-min"),
]
# Monthly layers that are sampled 12 times ({m} = 01..12).
MONTHLY_LAYERS = [
    ("wet_days_monthly", lambda m: vsizip(os.path.join(GLOBWAT, "GlobWat-InputP3_raind.zip"), f"wet{m}wb.asc"),
     "Wet days per month (CRU CL 2.0)", "FAO GlobWat input / CRU CL 2.0", "5 arc-min"),
]

FARMING_SYSTEMS = {
    101: "Water", 104: "Other", 107: "Forest", 108: "Irrigated crops (other than paddy rice)", 109: "Irrigated paddy rice",
    110: "Rainfed agriculture: dry tropics", 111: "Rainfed agriculture: humid tropics", 112: "Rainfed agriculture: highlands",
    113: "Rainfed agriculture: subtropics", 114: "Rainfed agriculture: temperate", 221: "Desert", 222: "Rangelands: subtropics",
    224: "Rangelands: temperate", 225: "Rangelands: boreal",
}


def sample(path):
    """Values at every POINT, None where nodata/missing."""
    with rasterio.open(path) as src:
        nodata = src.nodata
        vals = []
        for v in src.sample(POINTS):
            x = float(v[0])
            bad = (nodata is not None and (x == nodata or (abs(nodata) > 1e30 and abs(x) > 1e30))) or math.isnan(x) or x <= -9 or x == 999
            vals.append(None if bad else x)
        return vals


def window_values(path):
    """AgERA5 COGs are north-up 0.1-degree grids: read the Qatar window once, index the centres."""
    with rasterio.open(path) as src:
        rows_cols = [src.index(lng, lat) for lng, lat in POINTS]
        r0 = min(r for r, _ in rows_cols); r1 = max(r for r, _ in rows_cols)
        c0 = min(c for _, c in rows_cols); c1 = max(c for _, c in rows_cols)
        a = src.read(1, window=((r0, r1 + 1), (c0, c1 + 1)))
        out = []
        for r, c in rows_cols:
            x = float(a[r - r0, c - c0])
            out.append(None if x == src.nodata or math.isnan(x) else x)
        return out


def agera5_monthly(folder_glob, code, kelvin):
    """{ 'YYYY-MM': [value per point] } for every readable monthly GeoTIFF."""
    folders = glob.glob(os.path.join(AGERA5, folder_glob))
    if not folders:
        return {}
    series = {}
    files = sorted(glob.glob(os.path.join(folders[0], "data", f"C3S.{code}.*.tif")))
    for f in files:
        m = re.search(r"\.(\d{4}-\d{2})\.tif$", f)
        if not m:
            continue
        try:
            vals = window_values(f)
        except Exception as e:  # a file still downloading
            print("  skip", os.path.basename(f), e, file=sys.stderr)
            continue
        series[m.group(1)] = [None if v is None else (v - 273.15 if kelvin else v) for v in vals]
    return series


def mean(xs):
    xs = [x for x in xs if x is not None]
    return sum(xs) / len(xs) if xs else None


def slope_per_decade(years, values):
    pairs = [(y, v) for y, v in zip(years, values) if v is not None]
    if len(pairs) < 10:
        return None
    ys = np.array([p[0] for p in pairs], dtype=float); vs = np.array([p[1] for p in pairs], dtype=float)
    return float(np.polyfit(ys, vs, 1)[0] * 10)


def r(v, d=1):
    return None if v is None else round(v, d)


def climate_block(i, tmax, tmin, pf, et0):
    """Per-cell climate from AgERA5 monthly series: 1991-2020 normals (or what's on disk), trends, extremes."""
    def normals(series, lo=1991, hi=2020):
        months = [[] for _ in range(12)]
        years_used = set()
        for ym, vals in series.items():
            y, m = int(ym[:4]), int(ym[5:])
            if lo <= y <= hi and vals[i] is not None:
                months[m - 1].append(vals[i]); years_used.add(y)
        if not years_used:
            return None, None
        return [mean(ms) for ms in months], (min(years_used), max(years_used))

    def annual(series, agg):
        by_year = {}
        for ym, vals in series.items():
            by_year.setdefault(int(ym[:4]), []).append(vals[i])
        full = {y: vs for y, vs in by_year.items() if len(vs) == 12 and all(v is not None for v in vs)}
        return sorted(full), [agg(full[y]) for y in sorted(full)]

    tx, tx_p = normals(tmax); tn, tn_p = normals(tmin); pr, pr_p = normals(pf); et, et_p = normals(et0)
    if tx is None and et is None:
        return None
    # Summer (Jun-Aug) mean Tmax per year, for the warming trend.
    summer = {}
    for ym, vals in tmax.items():
        if int(ym[5:]) in (6, 7, 8) and vals[i] is not None:
            summer.setdefault(int(ym[:4]), []).append(vals[i])
    s_years = sorted(y for y, v in summer.items() if len(v) == 3)
    rain_years, rain_totals = annual(pf, sum)
    et_years, et_totals = annual(et0, sum)
    rain_cv = None
    if len(rain_totals) > 5 and mean(rain_totals):
        rain_cv = float(np.std(rain_totals) / np.mean(rain_totals) * 100)
    recent = [v for y, v in zip(rain_years, rain_totals) if y >= 2016]
    return {
        "normal_period": {k: v for k, v in {"tmax": tx_p, "tmin": tn_p, "precip": pr_p, "et0": et_p}.items() if v},
        "tmax_monthly_c": [r(v) for v in tx] if tx else None,
        "tmin_monthly_c": [r(v) for v in tn] if tn else None,
        "precip_monthly_mm": [r(v) for v in pr] if pr else None,
        "et0_monthly_mm": [r(v, 0) for v in et] if et else None,
        "precip_annual_mm": r(sum(pr), 0) if pr else None,
        "et0_annual_mm": r(sum(et), 0) if et else None,
        "precip_annual_cv_pct": r(rain_cv, 0),
        "precip_recent_mean_mm": r(mean(recent), 0),
        "precip_wettest_year": ({"year": rain_years[int(np.argmax(rain_totals))], "mm": r(max(rain_totals), 0)} if rain_totals else None),
        "summer_tmax_trend_c_per_decade": r(slope_per_decade(s_years, [mean(summer[y]) for y in s_years]), 2),
        "summer_tmax_last5_c": r(mean([mean(summer[y]) for y in s_years[-5:]])) if s_years else None,
        "et0_trend_mm_per_decade": r(slope_per_decade(et_years, et_totals), 0),
        "series_years": {"tmax": [s_years[0], s_years[-1]] if s_years else None, "precip": [rain_years[0], rain_years[-1]] if rain_years else None},
    }


def production():
    """FAOSTAT QV for Qatar: gross production value (constant 2014-2016 US$) by item, latest year and trend."""
    path = os.path.join(DS, "FAO_Value_of_Agricultural_Production", "qatar", "Qatar_Value_of_Production_long.csv")
    if not os.path.exists(path):
        return None
    element = "Gross Production Value (constant 2014-2016 thousand US$)"
    current = "Gross Production Value (current thousand US$)"
    by_item, flags, cur = {}, {}, {}
    with open(path, encoding="utf-8") as f:
        for row in csv.DictReader(f):
            if not row["Value"]:
                continue
            y = int(row["Year"])
            if row["Element"] == element:
                by_item.setdefault(row["Item"], {})[y] = float(row["Value"])
                flags.setdefault(row["Item"], {})[y] = row["Flag"]
            elif row["Element"] == current:
                cur.setdefault(row["Item"], {})[y] = float(row["Value"])
    latest = max(max(v) for v in by_item.values())
    items = []
    for item, series in by_item.items():
        if latest not in series:
            continue
        v = series[latest]
        v10 = series.get(latest - 10)
        v5 = series.get(latest - 5)
        items.append({
            "item": item,
            "value_kusd_2015": round(v),
            "value_kusd_current": round(cur.get(item, {}).get(latest, 0)) or None,
            "change_10y_pct": round((v / v10 - 1) * 100) if v10 else None,
            "change_5y_pct": round((v / v5 - 1) * 100) if v5 else None,
            "first_year": min(series),
            "flag": flags[item][latest],
            "series": {str(y): round(series[y]) for y in sorted(series) if y >= latest - 14},
        })
    items.sort(key=lambda x: -x["value_kusd_2015"])
    return {
        "source": "FAOSTAT, Value of Agricultural Production (QV), Qatar extract",
        "url": "https://www.fao.org/faostat/en/#data/QV",
        "licence": "CC-BY-4.0",
        "element": element,
        "latest_year": latest,
        "flag_note": "E = estimated by FAO, A = official, I = imputed.",
        "items": items,
    }


def main():
    t0 = time.time()
    os.makedirs(OUT, exist_ok=True)
    missing, layers_meta = [], []
    values = {}
    for key, path, what, source, res in LAYERS:
        try:
            values[key] = sample(path)
            layers_meta.append({"id": key, "what": what, "source": source, "resolution": res})
        except Exception as e:
            missing.append({"id": key, "error": str(e)[:200]})
    for key, fn, what, source, res in MONTHLY_LAYERS:
        try:
            months = [sample(fn(f"{m:02d}")) for m in range(1, 13)]
            values[key] = [[months[m][i] for m in range(12)] for i in range(len(POINTS))]
            layers_meta.append({"id": key, "what": what, "source": source, "resolution": res})
        except Exception as e:
            missing.append({"id": key, "error": str(e)[:200]})
    print(f"static layers {time.time() - t0:.1f}s", file=sys.stderr)

    tmax = agera5_monthly("Average Maximum Air Temperature (Global - Monthly*", "AGERA5-TMAX-AVG-M", True)
    tmin = agera5_monthly("Average Minimum Air Temperature (Global - Monthly*", "AGERA5-TMIN-AVG-M", True)
    pf = agera5_monthly("Precipitation flux (Global - Monthly*", "AGERA5-PF-M", False)
    et0 = agera5_monthly("Reference evapotranspiration (Global - Monthly*", "AGERA5-ET0-M", False)
    print(f"AgERA5 monthly: tmax {len(tmax)} tmin {len(tmin)} pf {len(pf)} et0 {len(et0)} months, {time.time() - t0:.1f}s", file=sys.stderr)
    for name, series in [("agera5_tmax", tmax), ("agera5_tmin", tmin), ("agera5_precip", pf), ("agera5_et0", et0)]:
        if series:
            layers_meta.append({"id": name, "what": f"AgERA5 monthly {name.split('_')[1]}, {min(series)} to {max(series)}",
                                "source": "Copernicus C3S AgERA5 via FAO AQUAMAPS", "resolution": "0.1 degree"})
        else:
            missing.append({"id": name, "error": "no files"})

    cells = []
    for i, (lng, lat) in enumerate(POINTS):
        cell = {"lat": lat, "lng": lng}
        for key, _, *_ in LAYERS:
            if key in values:
                v = values[key][i]
                cell[key] = None if v is None else (int(v) if key == "farming_system_id" else round(v, 3 if key == "aridity_index" else 1))
        if cell.get("farming_system_id") is not None:
            cell["farming_system"] = FARMING_SYSTEMS.get(cell["farming_system_id"], "Unknown")
        if "wet_days_monthly" in values:
            wd = values["wet_days_monthly"][i]
            cell["wet_days_per_year"] = None if any(v is None for v in wd) else round(sum(wd))
        cell["climate"] = climate_block(i, tmax, tmin, pf, et0)
        cells.append(cell)

    grid = {
        "generated": date.today().isoformat(),
        "note": "0.1-degree cells over the Qatar box (AgERA5 pixel centres). Sea cells are included; filter with the Qatar outline.",
        "grid": {"lat0": LATS[0], "lng0": LNGS[0], "step": 0.1, "rows": len(LATS), "cols": len(LNGS)},
        "layers": layers_meta,
        "missing": missing,
        "cells": cells,
    }
    with open(os.path.join(OUT, "qatar-site-grid.json"), "w", encoding="utf-8") as f:
        json.dump(grid, f, separators=(",", ":"))
    prod = production()
    if prod:
        with open(os.path.join(OUT, "qatar-production.json"), "w", encoding="utf-8") as f:
            json.dump(prod, f, indent=1)
    print(f"wrote {len(cells)} cells, {len(prod['items']) if prod else 0} production items, missing {[m['id'] for m in missing]} in {time.time() - t0:.1f}s", file=sys.stderr)


if __name__ == "__main__":
    main()
