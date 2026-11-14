// Loads the static data files and answers every question the charts ask of them.
// All values are precomputed by pipeline/02_build_site_data.py.

export const SCENARIOS = [
  { id: "ssp126", code: "SSP1-2.6", label: "Low", color: "#1c5cab" },
  { id: "ssp245", code: "SSP2-4.5", label: "Middle", color: "#5598e7" },
  { id: "ssp370", code: "SSP3-7.0", label: "High", color: "#eb6834" },
  { id: "ssp585", code: "SSP5-8.5", label: "Very high", color: "#a3161f" },
];

const STAT = { p10: 0, p50: 1, p90: 2 };

async function fetchBytes(url) {
  const res = await fetch(url);
  if (!res.ok) throw new Error(`Could not load ${url}: ${res.status}`);
  return new Uint8Array(await res.arrayBuffer());
}
async function fetchUint16(url) {
  const res = await fetch(url);
  if (!res.ok) throw new Error(`Could not load ${url}: ${res.status}`);
  return new Uint16Array(await res.arrayBuffer());
}
async function fetchJson(url) {
  const res = await fetch(url);
  if (!res.ok) throw new Error(`Could not load ${url}: ${res.status}`);
  return res.json();
}

export class ClimateData {
  static NO_STRIPE = 254; // arrival codes stop at 240, and 255 means not reached

  constructor(meta, arrival, series, land, cities, topo) {
    this.meta = meta;
    this.arrival = arrival;
    this.seriesValues = series;
    this.cities = cities;
    this.topo = topo;

    const g = meta.grid;
    this.nlat = g.nlat;
    this.nlon = g.nlon;
    this.step = g.step;
    this.nCell = g.nlat * g.nlon;
    this.nModel = meta.models.length;
    this.nScen = meta.scenarios.length;
    this.nLevel = meta.levels.length;
    this.lastYear = meta.lastYear;
    this.notReached = meta.notReached;

    this.commonYears = meta.seriesYears.common;
    this.scenYears = meta.seriesYears.scenario;
    this.statBlock = this.commonYears.length + this.nScen * this.scenYears.length;
    this.valuesPerCell = 3 * this.statBlock;

    const expected = {
      arrival: this.nScen * this.nLevel * this.nModel * this.nCell,
      series: this.valuesPerCell * this.nCell,
      land: this.nCell,
    };
    if (arrival.length !== expected.arrival || series.length !== expected.series || land.length !== expected.land) {
      throw new Error("Data files do not match meta.json");
    }

    // Area weight of each cell (share of Earth) and its land fraction
    this.area = new Float64Array(this.nCell);
    this.land = new Float32Array(this.nCell);
    let total = 0;
    for (let j = 0; j < g.nlat; j++) {
      const w = Math.cos(((g.lat0 + j * g.step) * Math.PI) / 180);
      for (let i = 0; i < g.nlon; i++) {
        const c = j * g.nlon + i;
        this.area[c] = w;
        this.land[c] = land[c] / 255;
        total += w;
      }
    }
    for (let c = 0; c < this.nCell; c++) this.area[c] /= total;

    this._sorted = new Map();
    this._curves = new Map();
  }

  cellOf(lat, lon) {
    const j = Math.max(0, Math.min(this.nlat - 1, Math.floor((lat + 90) / this.step)));
    const i = Math.floor((((lon % 360) + 360) % 360) / this.step) % this.nlon;
    return j * this.nlon + i;
  }

  cellBounds(cell) {
    const j = Math.floor(cell / this.nlon);
    const i = cell - j * this.nlon;
    return {
      lat0: -90 + j * this.step,
      lat1: -90 + (j + 1) * this.step,
      lon0: i * this.step,
      lon1: (i + 1) * this.step,
    };
  }

  yearOf(code) {
    return code === this.notReached ? null : this.meta.arrivalOffset + code;
  }

  /** Arrival codes for every cell, sorted across models: index cell * nModel + rank. */
  sortedArrival(s, l) {
    const key = s * this.nLevel + l;
    if (this._sorted.has(key)) return this._sorted.get(key);
    const { nCell, nModel } = this;
    const start = key * nModel * nCell;
    const out = new Uint8Array(nCell * nModel);
    const tmp = new Uint8Array(nModel);
    for (let c = 0; c < nCell; c++) {
      for (let m = 0; m < nModel; m++) tmp[m] = this.arrival[start + m * nCell + c];
      tmp.sort();
      out.set(tmp, c * nModel);
    }
    this._sorted.set(key, out);
    return out;
  }

  /** Median arrival code per cell; "not reached" sorts last, so it wins only with a majority. */
  medianArrival(s, l) {
    const sorted = this.sortedArrival(s, l);
    const { nCell, nModel } = this;
    const rank = Math.floor(nModel / 2);
    const out = new Uint8Array(nCell);
    for (let c = 0; c < nCell; c++) out[c] = sorted[c * nModel + rank];
    return out;
  }

  /**
   * Where the models split on whether a place arrives at all, the map draws stripes.
   * Returns one byte per cell: NO_STRIPE, or the code to alternate with the median's.
   * A split cell is one where between a third and two thirds of the models arrive.
   */
  splitStripes(s, l) {
    const sorted = this.sortedArrival(s, l);
    const { nCell, nModel, notReached } = this;
    const lo = Math.ceil(nModel / 3);
    const hi = Math.floor((2 * nModel) / 3);
    const rank = Math.floor(nModel / 2);
    const out = new Uint8Array(nCell).fill(ClimateData.NO_STRIPE);
    for (let c = 0; c < nCell; c++) {
      const base = c * nModel;
      let reach = 0;
      while (reach < nModel && sorted[base + reach] !== notReached) reach++;
      if (reach < lo || reach > hi) continue;
      // A colored cell alternates with gray; a gray cell with the median year of the models that do arrive.
      out[c] = sorted[base + rank] !== notReached ? notReached : sorted[base + Math.floor((reach - 1) / 2)];
    }
    return out;
  }

  /** Per-model arrival at one cell plus its summary. */
  placeArrival(s, l, cell) {
    const { nCell, nModel, nLevel } = this;
    const start = (s * nLevel + l) * nModel * nCell;
    const models = this.meta.models.map((name, m) => ({
      model: name,
      year: this.yearOf(this.arrival[start + m * nCell + cell]),
    }));
    const reached = models.filter((d) => d.year !== null).map((d) => d.year).sort((a, b) => a - b);
    const sorted = this.sortedArrival(s, l);
    const median = this.yearOf(sorted[cell * nModel + Math.floor(nModel / 2)]);
    return {
      models,
      median,
      earliest: reached.length ? reached[0] : null,
      latest: reached.length ? reached[reached.length - 1] : null,
      nReached: reached.length,
      nModel,
    };
  }

  /** Share of land and ocean area whose median arrival is at or before each year. */
  areaCurves(s, l) {
    const key = s * this.nLevel + l;
    if (this._curves.has(key)) return this._curves.get(key);
    const median = this.medianArrival(s, l);
    const first = 1860;
    const n = this.lastYear - first + 1;
    const landInc = new Float64Array(n);
    const oceanInc = new Float64Array(n);
    let landTotal = 0;
    let oceanTotal = 0;
    for (let c = 0; c < this.nCell; c++) {
      const a = this.area[c];
      const lf = this.land[c];
      landTotal += a * lf;
      oceanTotal += a * (1 - lf);
      const y = this.yearOf(median[c]);
      if (y !== null) {
        landInc[y - first] += a * lf;
        oceanInc[y - first] += a * (1 - lf);
      }
    }
    const curves = [];
    let cl = 0;
    let co = 0;
    for (let i = 0; i < n; i++) {
      cl += landInc[i];
      co += oceanInc[i];
      curves.push({ year: first + i, land: cl / landTotal, ocean: co / oceanTotal });
    }
    this._curves.set(key, curves);
    return curves;
  }

  /** {year, v} points for one cell, scenario and statistic. */
  series(cell, s, statName) {
    const st = STAT[statName];
    const base = cell * this.valuesPerCell + st * this.statBlock;
    const { offset, scale } = this.meta.seriesEncoding;
    const nc = this.commonYears.length;
    const ns = this.scenYears.length;
    const out = [];
    for (let i = 0; i < nc; i++) {
      out.push({ year: this.commonYears[i], v: offset + scale * this.seriesValues[base + i] });
    }
    const start = base + nc + s * ns;
    for (let i = 0; i < ns; i++) {
      out.push({ year: this.scenYears[i], v: offset + scale * this.seriesValues[start + i] });
    }
    return out;
  }

  /** Global-mean counterpart of series(). */
  worldSeries(s, statName) {
    const st = STAT[statName];
    const w = this.meta.world;
    return [
      ...this.commonYears.map((year, i) => ({ year, v: w.common[st][i] })),
      ...this.scenYears.map((year, i) => ({ year, v: w.scenario[st][s][i] })),
    ];
  }

  /** Median year the global mean reaches the level, or null. */
  worldArrival(s, l) {
    const ys = this.meta.world.arrival[s][l]
      .slice()
      .sort((a, b) => (a === null ? 1 : b === null ? -1 : a - b));
    return ys[Math.floor(ys.length / 2)];
  }
}

export async function loadData(base = "data/") {
  const [meta, cities, topo] = await Promise.all([
    fetchJson(`${base}meta.json`),
    fetchJson(`${base}cities.json`),
    fetchJson(`${base}land-110m.json`),
  ]);
  const [arrival, series, land] = await Promise.all([
    fetchBytes(`${base}arrival.bin`),
    fetchUint16(`${base}series.bin`),
    fetchBytes(`${base}land.bin`),
  ]);
  return new ClimateData(meta, arrival, series, land, cities, topo);
}
