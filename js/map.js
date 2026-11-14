// World map of arrival years. Each grid cell is painted as one block, so a color on the map
// always matches the numbers shown for that cell. A per-pixel lookup means moving the time
// slider only swaps a color table. Coastlines, markers and hover state live in an SVG on top.
const d3 = window.d3;
const topojson = window.topojson;

export const BINS = [
  { label: "By 2025", max: 2025, color: "#6b0f1a" },
  { label: "2026–2040", max: 2040, color: "#b3261e" },
  { label: "2041–2055", max: 2055, color: "#e4572e" },
  { label: "2056–2070", max: 2070, color: "#f59e4c" },
  { label: "2071–2090", max: 2090, color: "#fbd28a" },
  { label: "Not by 2090", max: Infinity, color: "#edece8" },
];
const NOT_YET = "#edece8";
const DIMMED = "#f6f5f2";
const ISOLATED_NEUTRAL = "#a9a89f";
const ROTATE = 11; // map center longitude: keeps Russia and Alaska in one piece

export function binOf(year) {
  if (year === null) return BINS.length - 1;
  return BINS.findIndex((b) => year <= b.max);
}

function rgba(hex) {
  const c = d3.color(hex);
  return (255 << 24) | (c.b << 16) | (c.g << 8) | c.r;
}

export class ArrivalMap {
  constructor({ wrap, canvas, svg, data, onHover, onLeave, onSelect }) {
    Object.assign(this, { wrap, canvas, data, onHover, onLeave, onSelect });
    this.svg = d3.select(svg);
    this.year = data.lastYear;
    this.isolated = null;
    this.place = null;
    this.codes = null;
    this.callouts = [];
    this.projection = d3.geoEqualEarth().rotate([-ROTATE, 0]);
    this.land = topojson.feature(data.topo, data.topo.objects.land);

    this.gCoast = this.svg.append("g");
    this.coastHalo = this.gCoast.append("path").attr("class", "coast-halo");
    this.coast = this.gCoast.append("path").attr("class", "coast");
    this.sphere = this.gCoast.append("path").attr("class", "sphere");
    this.gCallouts = this.svg.append("g");
    this.hoverCell = this.svg.append("path").attr("class", "hover-cell").attr("display", "none");
    this.linkRing = this.svg.append("g").attr("display", "none").attr("pointer-events", "none");
    this.linkRing.append("circle").attr("class", "marker-ring").attr("r", 9);
    this.linkRing.append("circle").attr("class", "link-ring").attr("r", 9);
    this.gMarker = this.svg.append("g").attr("display", "none");
    this.gMarker.append("circle").attr("class", "marker-ring").attr("r", 7);
    this.gMarker.append("circle").attr("class", "marker-dot").attr("r", 7);
    this.gMarker.append("circle").attr("class", "marker-center").attr("r", 1.8);
    this.markerLabel = this.gMarker.append("text").attr("class", "marker-label").attr("dy", "0.35em");

    this.svg
      .on("pointermove", (e) => this._pointer(e))
      .on("pointerleave", () => {
        this.hoverCell.attr("display", "none");
        this.onLeave?.();
      })
      .on("click", (e) => {
        const p = this._locate(e);
        if (p) this.onSelect?.(p);
      });

    this._resize();
    // The wrapper's size comes from CSS alone (width from the layout, height from aspect-ratio),
    // so redrawing never resizes the element being observed.
    this._observer = new ResizeObserver(() => {
      const box = this.wrap.getBoundingClientRect();
      if (!this.width || Math.abs(box.width - this.width) > 0.5 || Math.abs(box.height - this.height) > 0.5) this._resize();
    });
    this._observer.observe(this.wrap);
  }

  _resize() {
    const box = this.wrap.getBoundingClientRect();
    const w = box.width;
    const h = box.height;
    if (w <= 0 || h <= 0) return; // not laid out yet; the ResizeObserver calls again
    this.width = w;
    this.height = h;
    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    const cw = Math.round(w * dpr);
    const ch = Math.round(h * dpr);
    this.canvas.width = cw;
    this.canvas.height = ch;
    this.ctx = this.canvas.getContext("2d");
    this.image = this.ctx.createImageData(cw, ch);
    this.pixels = new Uint32Array(this.image.data.buffer);
    this.svg.attr("viewBox", `0 0 ${w} ${h}`);

    this.projection.fitExtent([[1, 1], [w - 1, h - 1]], { type: "Sphere" });
    this.path = d3.geoPath(this.projection);
    this.coastHalo.attr("d", this.path(this.land));
    this.coast.attr("d", this.path(this.land));
    this.sphere.attr("d", this.path({ type: "Sphere" }));

    this._buildLookup(cw, ch);
    this._drawCallouts();
    this._drawMarker();
    this.setLinked(this.linked || null);
    if (this.codes) {
      this.setField(this.codes);
    }
  }

  /** For each canvas pixel, find the grid cell it falls in. */
  _buildLookup(cw, ch) {
    const { nlat, nlon, step } = this.data;
    const sx = this.width / cw; // CSS pixels per canvas pixel
    const sy = this.height / ch;
    const k = this.projection.scale();
    const [tx, ty] = this.projection.translate();
    const raw = d3.geoEqualEarthRaw;
    const max = cw * ch;
    const pos = new Int32Array(max);
    const cell = new Uint16Array(max);
    let n = 0;
    for (let py = 0; py < ch; py++) {
      const Y = (ty - (py + 0.5) * sy) / k;
      // Equal Earth: longitude is linear in x for a given y, so invert once per row.
      const [g, phi] = raw.invert(1, Y);
      if (!Number.isFinite(g) || !Number.isFinite(phi)) continue;
      const latDeg = (phi * 180) / Math.PI;
      const j = Math.max(0, Math.min(nlat - 1, Math.floor((latDeg + 90) / step)));
      for (let px = 0; px < cw; px++) {
        const lam = (((px + 0.5) * sx - tx) / k) * g;
        if (Math.abs(lam) > Math.PI) continue;
        const lon = (lam * 180) / Math.PI + ROTATE;
        const i = Math.floor((((lon % 360) + 360) % 360) / step) % nlon;
        pos[n] = py * cw + px;
        cell[n] = j * nlon + i;
        n++;
      }
    }
    this.lookup = { n, pos, cell };
  }

  /** Set the arrival field: one byte per cell, year - 1850, 255 for not reached. */
  setField(codes) {
    this.codes = codes;
    this._paint();
  }

  setYear(year) {
    if (year === this.year) return;
    this.year = year;
    this._paint();
  }

  setIsolated(bin) {
    this.isolated = bin;
    this._paint();
  }

  _paint() {
    if (!this.codes || !this.lookup) return;
    const lastCode = this.data.lastYear - 1850;
    const colors = BINS.map((b) => rgba(b.color));
    const notYet = rgba(NOT_YET);
    const dim = rgba(DIMMED);
    const isoNeutral = rgba(ISOLATED_NEUTRAL);
    const notBin = BINS.length - 1;
    const lut = new Uint32Array(256);
    for (let v = 0; v < 256; v++) {
      const year = 1850 + v;
      const bin = v > lastCode ? notBin : binOf(year);
      const notArrived = v > lastCode || year > this.year;
      let color;
      if (this.isolated === notBin) {
        // Gray always means "not arrived by the selected year", so isolate exactly that.
        color = notArrived ? isoNeutral : dim;
      } else if (this.isolated !== null) {
        color = bin === this.isolated ? colors[bin] : dim;
      } else {
        color = notArrived ? notYet : colors[bin];
      }
      lut[v] = color;
    }
    const { n, pos, cell } = this.lookup;
    const codes = this.codes;
    const px = this.pixels;
    for (let p = 0; p < n; p++) px[pos[p]] = lut[codes[cell[p]]];
    this.ctx.putImageData(this.image, 0, 0);
  }

  setPlace(place) {
    this.place = place;
    this._drawMarker();
  }

  _drawMarker() {
    if (!this.place || !this.width) {
      this.gMarker.attr("display", "none");
      return;
    }
    const [x, y] = this.projection([this.place.lon, this.place.lat]);
    this.gMarker.attr("display", null).attr("transform", `translate(${x},${y})`);
    const right = x < this.width - 130;
    this.markerLabel
      .text(this.place.name)
      .attr("x", right ? 11 : -11)
      .attr("text-anchor", right ? "start" : "end");
  }

  /** Ring a place that is being pointed at in another chart, or pass null to clear it. */
  setLinked(place) {
    this.linked = place;
    if (!place || !this.width) {
      this.linkRing.attr("display", "none");
      return;
    }
    const [x, y] = this.projection([place.lon, place.lat]);
    this.linkRing.attr("display", null).attr("transform", `translate(${x},${y})`);
  }

  setCallouts(list) {
    this.callouts = list;
    this._drawCallouts();
  }

  _drawCallouts() {
    if (!this.width) return;
    // On a narrow map the fixed labels would run into each other and the edge.
    this.gCallouts.attr("display", this.width < 560 ? "none" : null);
    const sel = this.gCallouts
      .selectAll("g.callout")
      .data(this.callouts, (d) => d.text)
      .join((enter) => {
        const g = enter.append("g").attr("class", "callout");
        g.append("line");
        g.append("text");
        return g;
      });
    sel.each((d, i, nodes) => {
      const g = d3.select(nodes[i]);
      const [x, y] = this.projection([d.lon, d.lat]);
      const tx = d.fx * this.width;
      const ty = d.fy * this.height;
      const lines = d.text.split("\n");
      g.select("text")
        .attr("text-anchor", "middle")
        .selectAll("tspan")
        .data(lines)
        .join("tspan")
        .attr("x", tx)
        .attr("y", (_, k) => ty + k * 13)
        .text((t) => t);
      // The leader stops at the side of the label when the anchor is off to one side,
      // and at its top or bottom otherwise.
      const w = g.select("text").node().getBBox().width;
      const side = Math.abs(x - tx) > w / 2;
      g.select("line")
        .attr("x1", x)
        .attr("y1", y)
        .attr("x2", side ? tx + (x < tx ? -w / 2 - 3 : w / 2 + 3) : tx)
        .attr("y2", side ? ty - 4 : ty > y ? ty - 12 : ty + 4 + (lines.length - 1) * 13);
    });
  }

  _locate(event) {
    const [x, y] = d3.pointer(event, this.svg.node());
    const k = this.projection.scale();
    const [tx, ty] = this.projection.translate();
    const [g, phi] = d3.geoEqualEarthRaw.invert(1, (ty - y) / k);
    if (!Number.isFinite(g) || !Number.isFinite(phi)) return null;
    const lam = ((x - tx) / k) * g;
    if (Math.abs(lam) > Math.PI) return null;
    const lon = (lam * 180) / Math.PI + ROTATE;
    const lat = (phi * 180) / Math.PI;
    return { lat, lon: lon > 180 ? lon - 360 : lon, cell: this.data.cellOf(lat, lon) };
  }

  _pointer(event) {
    const p = this._locate(event);
    if (!p) {
      this.hoverCell.attr("display", "none");
      this.onLeave?.();
      return;
    }
    const b = this.data.cellBounds(p.cell);
    this.hoverCell.attr("display", null).attr(
      "d",
      this.path({
        type: "LineString",
        coordinates: [
          [b.lon0, b.lat0],
          [b.lon0, b.lat1],
          [b.lon1, b.lat1],
          [b.lon1, b.lat0],
          [b.lon0, b.lat0],
        ],
      })
    );
    this.onHover?.(p, event);
  }
}
