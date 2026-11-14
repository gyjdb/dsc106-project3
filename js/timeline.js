// Time control whose track is also a chart: the share of land and ocean that has
// passed the level by each year. A native range input keeps it keyboard accessible.
const d3 = window.d3;
const TODAY = 2026;
const THUMB = 20; // keep in sync with the thumb width in style.css
const M = { top: 18, right: 72, bottom: 22, left: 34 };
const H = 86;

export class Timeline {
  constructor({ wrap, svg, slider, onInput }) {
    Object.assign(this, { wrap, slider, onInput });
    this.svg = d3.select(svg);
    this.x = d3.scaleLinear().domain([+slider.min, +slider.max]);
    this.y = d3.scaleLinear().domain([0, 1]).range([H - M.bottom, M.top]);

    this.gGrid = this.svg.append("g");
    this.gAxis = this.svg.append("g").attr("class", "tl-axis");
    this.landArea = this.svg.append("path").attr("class", "tl-land");
    this.landLine = this.svg.append("path").attr("class", "tl-land-line");
    this.oceanLine = this.svg.append("path").attr("class", "tl-ocean-line");
    this.nowLine = this.svg.append("line").attr("class", "tl-now");
    this.nowText = this.svg.append("text").attr("class", "tl-label").attr("text-anchor", "middle").text("today");
    this.worldLine = this.svg.append("line").attr("class", "tl-world");
    this.worldText = this.svg.append("text").attr("class", "tl-label");
    this.endLand = this.svg.append("text").attr("class", "tl-label");
    this.endOcean = this.svg.append("text").attr("class", "tl-label");
    this.playLine = this.svg.append("line").attr("class", "tl-play-line");
    this.playChip = this.svg.append("rect").attr("class", "tl-play-chip").attr("rx", 4).attr("height", 16).attr("width", 36);
    this.playText = this.svg.append("text").attr("class", "tl-play-year").attr("text-anchor", "middle");

    slider.addEventListener("input", () => this.onInput(+slider.value));
    this._resize();
    new ResizeObserver(() => {
      if (this.wrap.clientWidth !== this.width) {
        this._resize();
        this._draw();
      }
    }).observe(this.wrap);
  }

  _resize() {
    const w = this.wrap.clientWidth;
    if (w <= 0) return; // not laid out yet; the ResizeObserver calls again
    this.width = w;
    this.svg.attr("viewBox", `0 0 ${w} ${H}`);
    this.x.range([M.left, w - M.right]);
    this.slider.style.left = `${M.left - THUMB / 2}px`;
    this.slider.style.width = `${w - M.left - M.right + THUMB}px`;

    const ticks = d3.range(1980, 2091, 10).filter((y) => w > 520 || y % 20 === 0);
    this.gAxis
      .selectAll("text.xt")
      .data(ticks, (d) => d)
      .join("text")
      .attr("class", "xt")
      .attr("x", (d) => this.x(d))
      .attr("y", H - 6)
      .attr("text-anchor", "middle")
      .text((d) => d);
    this.gAxis
      .selectAll("text.yt")
      .data([0, 0.5, 1])
      .join("text")
      .attr("class", "yt")
      .attr("x", M.left - 6)
      .attr("y", (d) => this.y(d))
      .attr("dy", "0.32em")
      .attr("text-anchor", "end")
      .text((d) => `${d * 100}%`);
    this.gGrid
      .selectAll("line")
      .data([0, 0.5, 1])
      .join("line")
      .attr("class", "tl-grid")
      .attr("x1", M.left)
      .attr("x2", w - M.right)
      .attr("y1", (d) => this.y(d))
      .attr("y2", (d) => this.y(d));
  }

  update({ curves, worldYear, year }) {
    this.curves = curves.filter((d) => d.year >= +this.slider.min);
    this.worldYear = worldYear;
    this.year = year;
    this.slider.value = year;
    this._draw();
  }

  setYear(year) {
    this.year = year;
    this.slider.value = year;
    this._drawPlayhead();
  }

  _draw() {
    if (!this.curves || !this.width) return;
    this._drawCount = (this._drawCount || 0) + 1;
    const { x, y } = this;
    const area = d3.area().x((d) => x(d.year)).y0(y(0)).y1((d) => y(d.land)).curve(d3.curveMonotoneX);
    const lineL = d3.line().x((d) => x(d.year)).y((d) => y(d.land)).curve(d3.curveMonotoneX);
    const lineO = d3.line().x((d) => x(d.year)).y((d) => y(d.ocean)).curve(d3.curveMonotoneX);
    this.landArea.attr("d", area(this.curves));
    this.landLine.attr("d", lineL(this.curves));
    this.oceanLine.attr("d", lineO(this.curves));

    const end = this.curves[this.curves.length - 1];
    const ex = x(end.year) + 5;
    let yl = y(end.land);
    let yo = y(end.ocean);
    if (Math.abs(yl - yo) < 12) {
      const mid = (yl + yo) / 2;
      yl = mid + (end.land >= end.ocean ? -6 : 6);
      yo = mid + (end.land >= end.ocean ? 6 : -6);
    }
    this.endLand.attr("x", ex).attr("y", yl).attr("dy", "0.32em").text(`Land ${Math.round(end.land * 100)}%`);
    this.endOcean.attr("x", ex).attr("y", yo).attr("dy", "0.32em").text(`Ocean ${Math.round(end.ocean * 100)}%`);

    this.nowLine.attr("x1", x(TODAY)).attr("x2", x(TODAY)).attr("y1", M.top).attr("y2", y(0));
    // "today" gives way when the world-average label would run into it
    const clash = this.worldYear !== null && Math.abs(x(this.worldYear) - x(TODAY)) < 92;
    this.nowText.attr("x", x(TODAY)).attr("y", M.top - 5).attr("text-anchor", "middle").attr("display", clash ? "none" : null);

    if (this.worldYear !== null && this.worldYear >= +this.slider.min) {
      const wx = x(this.worldYear);
      const flip = wx > this.width - M.right - 150;
      this.worldLine.attr("display", null).attr("x1", wx).attr("x2", wx).attr("y1", M.top).attr("y2", y(0));
      this.worldText
        .attr("display", null)
        .attr("x", wx)
        .attr("y", M.top - 5)
        .attr("text-anchor", flip ? "end" : "middle")
        .text(`World average: ${this.worldYear}`);
    } else if (this.worldYear !== null) {
      // The world average passed this level before the slider's first year.
      this.worldLine.attr("display", "none");
      this.worldText.attr("display", null).attr("x", M.left).attr("y", M.top - 5).attr("text-anchor", "start").text(`World average: ${this.worldYear}`);
    } else {
      this.worldLine.attr("display", "none");
      this.worldText
        .attr("display", null)
        .attr("x", this.width - M.right)
        .attr("y", M.top - 5)
        .attr("text-anchor", "end")
        .text("World average: not by 2090");
    }
    this._drawPlayhead();
  }

  /** Labels on the chip's row move out of its way, then return. */
  _avoidChip(chipLeft, chipRight) {
    const gap = 4;
    for (const sel of [this.nowText, this.worldText]) {
      if (sel.attr("display") === "none") continue;
      const node = sel.node();
      if (node.dataset.drawn !== String(this._drawCount)) {
        node.dataset.x = sel.attr("x");
        node.dataset.anchor = sel.attr("text-anchor");
        node.dataset.drawn = String(this._drawCount);
      }
      const x0 = +node.dataset.x;
      const anchor = node.dataset.anchor;
      const w = node.getComputedTextLength();
      const left = anchor === "end" ? x0 - w : anchor === "start" ? x0 : x0 - w / 2;
      const right = left + w;
      if (chipRight + gap > left && chipLeft - gap < right) {
        // Step to whichever side of the chip has room inside the plot. On a narrow screen
        // there may be none, and the label waits until the chip has moved on.
        const goRight = chipRight + gap + w <= this.x.range()[1];
        const fitsLeft = chipLeft - gap - w >= this.x.range()[0];
        sel
          .attr("visibility", goRight || fitsLeft ? null : "hidden")
          .attr("x", goRight ? chipRight + gap : chipLeft - gap)
          .attr("text-anchor", goRight ? "start" : "end");
      } else {
        sel.attr("visibility", null).attr("x", x0).attr("text-anchor", anchor);
      }
    }
  }

  _drawPlayhead() {
    if (!this.width) return;
    const px = this.x(this.year);
    this.playLine.attr("x1", px).attr("x2", px).attr("y1", M.top).attr("y2", this.y(0));
    // Near the end the chip stops short of the end labels; the line still marks the year.
    const chipX = Math.min(px - 18, this.x.range()[1] + 3 - 36);
    this._avoidChip(chipX, chipX + 36);
    this.playChip.attr("x", chipX).attr("y", 0);
    this.playText.attr("x", chipX + 18).attr("y", 12).text(this.year);
  }
}
