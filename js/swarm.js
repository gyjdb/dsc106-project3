// The world's largest cities as dots along a time axis: each city sits at the year its grid
// cell arrives, in a row for its latitude band. Dots move when the level or scenario changes.
import { BINS, binOf } from "./map.js";
import { showTooltip, hideTooltip, node } from "./tooltip.js";
import { agePhrase } from "./lifetime.js";
const d3 = window.d3;

const X_DOMAIN = [2005, 2090]; // no large city arrives earlier at any level or scenario
const TICKS = d3.range(2010, 2091, 10);
const NEVER_COLOR = "#c4c3bb";
const BANDS = [
  { label: "High latitudes", note: "beyond 45°", test: (lat) => Math.abs(lat) > 45 },
  { label: "Mid-latitudes", note: "23.5° to 45°", test: (lat) => Math.abs(lat) > 23.5 },
  { label: "Tropics", note: "within 23.5° of the equator", test: () => true },
];

export class CitySwarm {
  constructor({ wrap, svg, data, cities, getBirth, onHover, onSelect }) {
    Object.assign(this, { wrap, data, getBirth, onHover, onSelect });
    this.svg = d3.select(svg);
    this.radius = d3.scaleSqrt(d3.extent(cities, (d) => d.c.pop), [3, 11]);
    this.nodes = cities.map(({ c, place }, i) => ({
      id: i,
      c,
      place,
      band: BANDS.findIndex((b) => b.test(c.lat)),
      year: null,
    }));
    this.level = null;
    this.scenario = null;
    this.year = data.lastYear;
    this.isolated = null;
    this.selected = null;
    this.hovered = null;
    this.motion = !window.matchMedia("(prefers-reduced-motion: reduce)").matches;

    this.gGrid = this.svg.append("g").attr("class", "chart-axis");
    this.gRows = this.svg.append("g");
    this.playLine = this.svg.append("line").attr("class", "swarm-play");
    this.gDots = this.svg.append("g");
    this.playText = this.svg.append("text").attr("class", "swarm-play-label");
    this.hoverRing = this.svg.append("circle").attr("class", "swarm-hover").attr("display", "none");
    this.selRing = this.svg.append("circle").attr("class", "swarm-selected").attr("display", "none");
    this.selLabel = this.svg.append("text").attr("class", "swarm-selected-label").attr("display", "none");
    this.overlay = this.svg
      .append("rect")
      .attr("fill", "transparent")
      .style("cursor", "pointer")
      .on("pointermove", (e) => this._pointer(e))
      .on("pointerleave", () => this._hover(null))
      .on("click", (e) => {
        const n = this._nearest(e);
        if (n) this.onSelect?.(n);
      });

    // A new width changes this chart's height too. Doing that on the next frame, not inside
    // the observer's own callback, keeps browsers from reporting a resize loop.
    new ResizeObserver(() => {
      if (this.level === null || Math.abs(this.wrap.clientWidth - this.width) <= 0.5) return;
      cancelAnimationFrame(this._resizeFrame);
      this._resizeFrame = requestAnimationFrame(() => {
        this._measure();
        this._layout();
        this._render(false);
      });
    }).observe(this.wrap);
  }

  /** Sizes that depend on the available width. */
  _measure() {
    const w = this.wrap.clientWidth;
    const narrow = w < 640;
    this.width = w;
    this.narrow = narrow;
    this.m = { top: 24, right: narrow ? 58 : 96, bottom: 22, left: narrow ? 6 : 150 };
    this.rowH = narrow ? 104 : 88;
    this.labelH = narrow ? 30 : 0; // on a narrow screen the row labels sit above each row
    this.height = this.m.top + BANDS.length * (this.rowH + this.labelH) + this.m.bottom;
    this.x = d3.scaleLinear(X_DOMAIN, [this.m.left + 12, w - this.m.right - 10]);
    this.sizeFactor = narrow ? 0.7 : 1;
    this.pitch = narrow ? 4.6 : 6; // spacing of the "not by 2090" grid
    this.neverX = w - this.m.right + 12;
    this.neverCols = Math.max(1, Math.floor((this.m.right - 14) / this.pitch));
    this.svg.attr("viewBox", `0 0 ${w} ${this.height}`).attr("height", this.height);
    this.overlay.attr("width", w).attr("height", this.height);
  }

  _rowTop(b) {
    return this.m.top + b * (this.rowH + this.labelH) + this.labelH;
  }

  update({ level, scenario, year, selected }) {
    const changed = level !== this.level || scenario !== this.scenario;
    this.level = level;
    this.scenario = scenario;
    this.year = year;
    this.selected = selected;
    if (!this.width) this._measure();
    if (!this.width) return; // not laid out yet; the ResizeObserver calls again
    if (changed) {
      const median = this.data.medianArrival(scenario, level);
      this.nodes.forEach((n) => {
        n.year = this.data.yearOf(median[n.place.cell]);
        n.bin = binOf(n.year);
      });
      this._layout();
      this._render(true);
    } else {
      this._renderState();
    }
  }

  setYear(year) {
    this.year = year;
    if (this.width) this._renderState();
  }

  setSelected(place) {
    this.selected = place;
    if (this.width) this._renderState();
  }

  /** Median arrival year of each latitude row, or null where most cities do not arrive. */
  rowMedians() {
    return BANDS.map((_, b) => {
      const years = this.nodes.filter((n) => n.band === b).map((n) => (n.year === null ? Infinity : n.year)).sort((p, q) => p - q);
      const med = years[Math.floor(years.length / 2)];
      return Number.isFinite(med) ? med : null;
    });
  }

  /** How many cities do not arrive by the last year. */
  neverCount() {
    return this.nodes.filter((n) => n.year === null).length;
  }

  setIsolated(bin) {
    this.isolated = bin;
    if (this.width) this._renderState();
  }

  /** Target position and size for every dot. */
  _layout() {
    BANDS.forEach((_, b) => {
      const top = this._rowTop(b);
      const mid = top + this.rowH / 2;
      const inRow = this.nodes.filter((n) => n.band === b);

      // Cities that arrive: a force layout keeps each dot at its year and pushes overlaps apart.
      const arrived = inRow.filter((n) => n.year !== null);
      arrived.forEach((n) => {
        n.r = this.radius(n.c.pop) * this.sizeFactor;
        n.x = this.x(Math.max(n.year, X_DOMAIN[0]));
        // Start from the last position, or from a spread that depends only on the city.
        n.y = n.ty !== undefined && !n.wasNever ? n.ty : mid + (((n.id * 37) % 21) - 10) * 2;
        n.wasNever = false;
        n.vx = 0;
        n.vy = 0;
      });
      const sim = d3
        .forceSimulation(arrived)
        .force("x", d3.forceX((n) => this.x(Math.max(n.year, X_DOMAIN[0]))).strength(1))
        .force("y", d3.forceY(mid).strength(0.08))
        .force("collide", d3.forceCollide((n) => n.r + 0.6).iterations(3))
        .stop();
      for (let i = 0; i < 160; i++) sim.tick();
      arrived.forEach((n) => {
        n.tx = n.x;
        n.ty = Math.max(top + n.r, Math.min(top + this.rowH - n.r, n.y));
      });

      // Cities that do not arrive by the last year: a tidy block of small dots at the right.
      const never = inRow.filter((n) => n.year === null).sort((p, q) => q.c.pop - p.c.pop);
      never.forEach((n, i) => {
        n.r = this.narrow ? 1.8 : 2.3;
        n.tx = this.neverX + (i % this.neverCols) * this.pitch;
        n.ty = top + 5 + Math.floor(i / this.neverCols) * this.pitch;
        n.wasNever = true;
      });
    });
    this.delaunay = d3.Delaunay.from(this.nodes, (n) => n.tx, (n) => n.ty);
  }

  _render(animate) {
    const { x, m, width } = this;
    const bottom = this.height - m.bottom;

    // Grid and axis
    this.gGrid.selectAll("*").remove();
    TICKS.forEach((t) => {
      if (this.narrow && t % 20 !== 10) return;
      this.gGrid.append("line").attr("x1", x(t)).attr("x2", x(t)).attr("y1", m.top).attr("y2", bottom).attr("stroke", "#e1e0d9");
      this.gGrid.append("text").attr("x", x(t)).attr("y", bottom + 15).attr("text-anchor", "middle").text(t);
    });
    this.gGrid
      .append("text")
      .attr("x", this.neverX + ((this.neverCols - 1) * this.pitch) / 2)
      .attr("y", bottom + 15)
      .attr("text-anchor", "middle")
      .text(this.narrow ? "not by 2090" : `not by ${this.data.lastYear}`);

    // Row labels with what the row says in numbers
    this.gRows.selectAll("*").remove();
    const medians = this.rowMedians();
    BANDS.forEach((band, b) => {
      const inRow = this.nodes.filter((n) => n.band === b);
      const med = medians[b];
      const summary = med !== null ? `${inRow.length} cities, median ${med}` : `${inRow.length} cities, most not by ${this.data.lastYear}`;
      const top = this._rowTop(b);
      const g = this.gRows.append("g");
      if (b > 0) g.append("line").attr("x1", this.narrow ? 0 : m.left).attr("x2", width).attr("y1", top - this.labelH).attr("y2", top - this.labelH).attr("stroke", "#e1e0d9");
      const lx = this.narrow ? 2 : 0;
      const ly = this.narrow ? top - this.labelH + 13 : top + this.rowH / 2 - 12;
      g.append("text").attr("class", "swarm-row-label").attr("x", lx).attr("y", ly).text(band.label);
      if (this.narrow) {
        g.append("text").attr("class", "swarm-row-note").attr("x", lx).attr("y", ly + 13).text(summary);
      } else {
        g.append("text").attr("class", "swarm-row-note").attr("x", lx).attr("y", ly + 15).text(band.note);
        g.append("text").attr("class", "swarm-row-note").attr("x", lx).attr("y", ly + 29).text(summary);
      }
      if (med !== null) {
        const mx = x(Math.max(med, X_DOMAIN[0]));
        g.append("line").attr("class", "swarm-median").attr("x1", mx).attr("x2", mx).attr("y1", top + 2).attr("y2", top + this.rowH - 2);
      }
    });

    // Dots
    const dur = animate && this.motion && this.drawn ? 750 : 0;
    const dots = this.gDots
      .selectAll("circle")
      .data(this.nodes, (n) => n.id)
      .join((enter) =>
        enter
          .append("circle")
          .attr("class", "swarm-dot")
          .attr("cx", (n) => n.tx)
          .attr("cy", (n) => n.ty)
          .attr("r", (n) => n.r)
          .attr("fill", (n) => (n.year === null ? NEVER_COLOR : BINS[n.bin].color))
      );
    dots
      .interrupt()
      .transition()
      .duration(dur)
      .delay((n) => (dur ? (n.id % 12) * 12 : 0))
      .attr("cx", (n) => n.tx)
      .attr("cy", (n) => n.ty)
      .attr("r", (n) => n.r)
      .attr("fill", (n) => (n.year === null ? NEVER_COLOR : BINS[n.bin].color));
    this.drawn = true;
    this._renderState(dur);

    const arrivedN = this.nodes.filter((n) => n.year !== null).length;
    this.svg.attr("aria-label", `Dot plot of the ${this.nodes.length} largest cities by arrival year. ${arrivedN} arrive by ${this.data.lastYear}. The table below lists every city.`);
  }

  /** Everything that changes without a new layout: the year line, dimming, hover and selection. */
  _renderState(dur = 0) {
    const { x, m } = this;
    const bottom = this.height - m.bottom;
    const lastBin = BINS.length - 1;
    this.gDots.selectAll("circle").attr("opacity", (n) => {
      if (this.isolated !== null) return n.bin === this.isolated || (this.isolated === lastBin && n.year === null) ? 1 : 0.1;
      return n.year !== null && n.year > this.year ? 0.25 : 1;
    });

    const count = this.nodes.filter((n) => n.year !== null && n.year <= this.year).length;
    const px = x(Math.max(this.year, X_DOMAIN[0]));
    this.playLine.attr("x1", px).attr("x2", px).attr("y1", m.top - 4).attr("y2", bottom);
    const right = px < this.width - m.right - 150;
    this.playText
      .attr("x", px + (right ? 5 : -5))
      .attr("y", m.top - 9)
      .attr("text-anchor", right ? "start" : "end")
      .text(`By ${this.year}: ${count} of ${this.nodes.length} cities`);

    const sel = this.selected && this.nodes.find((n) => n.c.n === this.selected.name && n.place.cell === this.selected.cell);
    if (sel) {
      const labelRight = sel.tx < this.width - 150;
      const moveRing = this.selRing.attr("display", null).interrupt().transition().duration(dur);
      moveRing.attr("cx", sel.tx).attr("cy", sel.ty).attr("r", sel.r + 3);
      const moveLabel = this.selLabel.attr("display", null).text(sel.c.n).attr("text-anchor", labelRight ? "start" : "end").interrupt().transition().duration(dur);
      moveLabel.attr("x", sel.tx + (labelRight ? sel.r + 6 : -sel.r - 6)).attr("y", sel.ty + 4);
    } else {
      this.selRing.attr("display", "none");
      this.selLabel.attr("display", "none");
    }
    if (this.hovered) this.hoverRing.attr("cx", this.hovered.tx).attr("cy", this.hovered.ty).attr("r", this.hovered.r + 2.5);
  }

  _nearest(event) {
    const [px, py] = d3.pointer(event, this.svg.node());
    const n = this.nodes[this.delaunay.find(px, py)];
    if (!n) return null;
    const reach = Math.max(14, n.r + 8);
    return (n.tx - px) ** 2 + (n.ty - py) ** 2 <= reach * reach ? n : null;
  }

  _pointer(event) {
    const n = this._nearest(event);
    this._hover(n);
    if (!n) return;
    const a = this.data.placeArrival(this.scenario, this.level, n.place.cell);
    showTooltip(event, (tip) => {
      tip.append(
        node("div", "tt-value", a.median === null ? `Not by ${this.data.lastYear}` : a.median),
        node("div", "tt-head", `${n.c.n}, ${n.c.c}`),
        node("div", "", a.nReached === 0 ? "No model arrives" : a.earliest === a.latest ? `${a.nReached} of ${a.nModel} models arrive, in ${a.earliest}` : `${a.nReached} of ${a.nModel} models arrive, ${a.earliest}–${a.latest}`)
      );
      const phrase = agePhrase(a.median, this.getBirth?.());
      if (phrase) tip.append(node("div", "", phrase));
    });
  }

  _hover(n) {
    if (n === this.hovered) return;
    this.hovered = n;
    if (n) {
      this.hoverRing.attr("display", null).attr("cx", n.tx).attr("cy", n.ty).attr("r", n.r + 2.5);
    } else {
      this.hoverRing.attr("display", "none");
      hideTooltip();
    }
    this.onHover?.(n);
  }
}
