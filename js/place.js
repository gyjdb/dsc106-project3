// The selected place: a headline year, its warming curves and each model's answer.
import { SCENARIOS } from "./data.js";
import { showTooltip, hideTooltip, node } from "./tooltip.js";
import { TODAY, agePhrase, lifetimeParts } from "./lifetime.js";
const d3 = window.d3;

const X_DOMAIN = [1960, 2090];
const AGE_ROW = 13; // a second row of axis labels: the reader's age in those years
const LINE_H = 226;
const MOVE_MS = 350; // how long lines and numbers take to move to a new state
const STRIP_H = 98;
const M = { top: 12, right: 100, bottom: 20, left: 32 };

const fmtTemp = (v) => `${v >= 0 ? "+" : "−"}${Math.abs(v).toFixed(1)} °C`;
const fmtEnd = (v) => `${v >= 0 ? "+" : "−"}${Math.abs(v).toFixed(1)}°`;
const fmtLevel = (v) => `+${v} °C`;

export class PlacePanel {
  constructor({ data, onScenario }) {
    this.data = data;
    this.onScenario = onScenario;
    this.nameEl = document.getElementById("place-name");
    this.subEl = document.getElementById("place-sub");
    this.heroYear = document.getElementById("hero-year");
    this.heroAround = document.getElementById("hero-around");
    // The band holds the 10th to 90th percentile of the models: say that as a count.
    document.getElementById("line-note").textContent = `Against this place’s 1850–1900 average. Lines: model median, smoothed over 20 years. Band: where about ${Math.round(data.nModel * 0.8)} of the ${data.nModel} models fall. Dot: median arrival.`;
    this.heroText = document.getElementById("hero-text");
    this.lifetimeText = document.getElementById("lifetime-text");
    this.lineWrap = document.getElementById("line-wrap");
    this.stripWrap = document.getElementById("strip-wrap");
    this.stripTitle = document.getElementById("strip-title");
    this.stripNote = document.getElementById("strip-note");
    this.lineTitle = document.getElementById("line-title");
    this.guessResult = document.getElementById("guess-result");
    this.motion = !window.matchMedia("(prefers-reduced-motion: reduce)").matches;

    this.line = d3.select("#line-svg");
    this.gGrid = this.line.append("g").attr("class", "chart-axis");
    this.gXAxis = this.line.append("g").attr("class", "chart-axis");
    this.gAge = this.line.append("g").attr("class", "chart-axis age-axis");
    this.todayLine = this.line.append("line").attr("class", "chart-base");
    this.todayText = this.line.append("text").attr("class", "strip-label").attr("text-anchor", "middle").text("today");
    this.band = this.line.append("path").attr("class", "band");
    this.worldPath = this.line.append("path").attr("class", "world-line");
    this.gLines = this.line.append("g");
    this.levelLine = this.line.append("line").attr("class", "level-line");
    this.levelText = this.line.append("text").attr("class", "level-label");
    this.dropLine = this.line.append("line").attr("class", "level-line");
    this.arrivalDot = this.line.append("circle").attr("class", "arrival-dot").attr("r", 5.5);
    this.gLabels = this.line.append("g");
    this.crossLine = this.line.append("line").attr("class", "cross-line").attr("display", "none");
    this.overlay = this.line.append("rect").attr("fill", "transparent").style("cursor", "crosshair");

    this.strip = d3.select("#strip-svg");
    this.gStripAxis = this.strip.append("g").attr("class", "chart-axis");
    this.stripBase = this.strip.append("line").attr("class", "chart-base");
    this.stripMedian = this.strip.append("line").attr("class", "strip-median");
    this.stripMedianText = this.strip.append("text").attr("class", "strip-label strong");
    this.afterText = this.strip.append("text").attr("class", "strip-label").attr("text-anchor", "middle");
    this.gGuess = this.strip.append("g").attr("display", "none");
    this.gGuess.append("line").attr("class", "guess-line");
    this.gGuess.append("circle").attr("class", "guess-dot").attr("r", 3.5);
    this.gGuess.append("text").attr("class", "guess-label");
    this.gDots = this.strip.append("g");
    this.stripOverlay = this.strip.append("rect").attr("fill", "transparent");

    new ResizeObserver(() => {
      if (this.state && this.lineWrap.clientWidth !== this.width) this.update(this.state);
    }).observe(this.lineWrap);
  }

  update(state) {
    this.state = state;
    this.width = this.lineWrap.clientWidth;
    this._text(state);
    if (this.width <= 0) return; // not laid out yet; the ResizeObserver calls again
    this._lineChart(state);
    this._stripChart(state);
  }

  /** The reader's guess, if it was made for the place, level and scenario now on show. */
  _guessFor({ place, level, scenario, guess }) {
    return guess && guess.cell === place.cell && guess.level === level && guess.scenario === scenario ? guess : null;
  }

  _text({ place, level, scenario, birth, guess }) {
    const { data } = this;
    const a = data.placeArrival(scenario, level, place.cell);
    this.summary = a;
    const lv = data.meta.levels[level];
    const scen = SCENARIOS[scenario];
    this.nameEl.textContent = place.name;
    this.subEl.textContent = place.sub;
    this.heroYear.classList.toggle("long", a.median === null);
    this.heroAround.hidden = a.median === null; // a median across models, so "around"; never a forecast for one year
    const before = Number(this.heroYear.textContent);
    if (this.motion && a.median !== null && Number.isInteger(before) && before !== a.median) {
      const step = d3.interpolateRound(before, a.median);
      d3.select(this.heroYear)
        .interrupt()
        .transition()
        .duration(MOVE_MS)
        .tween("text", () => (t) => {
          this.heroYear.textContent = step(t);
        });
    } else {
      d3.select(this.heroYear).interrupt();
      this.heroYear.textContent = a.median === null ? "Not by 2090" : a.median;
    }

    const world = data.worldArrival(scenario, level);
    const parts = [];
    if (a.median !== null) {
      parts.push(["is when this place’s 20-year average reaches ", false], [fmtLevel(lv), true], [` and stays there, under ${scen.code}: the median of ${a.nModel} models. `, false]);
      if (a.nReached > 0) {
        parts.push(
          a.earliest === a.latest
            ? [`Every model that arrives says ${a.earliest}. `, false]
            : [`Models range from ${a.earliest} to ${a.latest}. `, false]
        );
      }
      if (a.nReached < a.nModel) parts.push([`${a.nModel - a.nReached} of ${a.nModel} do not arrive by 2090. `, false]);
      if (world !== null) {
        const gap = world - a.median;
        if (gap === 0) parts.push(["Same year as the world average.", true]);
        else {
          const n = Math.abs(gap);
          parts.push([`${n} year${n === 1 ? "" : "s"} ${gap > 0 ? "before" : "after"} the world average.`, true]);
        }
      } else {
        parts.push(["The world average does not arrive by 2090.", true]);
      }
    } else {
      parts.push(["for ", false], [fmtLevel(lv), true], [` under ${scen.code}: `, false]);
      parts.push([a.nReached === 0 ? "no model reaches it and stays there. " : `only ${a.nReached} of ${a.nModel} models reach it and stay there. `, false]);
      parts.push([world !== null ? `The world average arrives in ${world}.` : "The world average does not arrive by 2090.", true]);
    }
    // What the emissions path changes for this place: the two ends of the scenario range.
    const low = data.placeArrival(0, level, place.cell).median;
    const veryHigh = data.placeArrival(SCENARIOS.length - 1, level, place.cell).median;
    if (low !== null && veryHigh !== null && Math.max(low, veryHigh) <= TODAY) {
      parts.push([" It has already happened under every scenario.", false]);
    } else if (low !== null && veryHigh !== null) {
      const gap = low - veryHigh;
      parts.push([gap >= 3 ? ` Emissions shift it by ${gap} years: ${veryHigh} if very high, ${low} if low.` : ` Emissions barely move it: ${veryHigh} if very high, ${low} if low.`, false]);
    } else if (veryHigh !== null) {
      parts.push([` Very high emissions bring it in ${veryHigh}; low emissions keep it away past ${data.lastYear}.`, false]);
    } else if (low === null && a.median === null) {
      parts.push([` Even very high emissions do not bring it by ${data.lastYear}.`, false]);
    }
    const toNodes = (list) => list.map(([t, strong]) => (strong ? node("strong", "", t) : document.createTextNode(t)));
    this.heroText.replaceChildren(...toNodes(parts));
    this.lifetimeText.replaceChildren(...toNodes(lifetimeParts(a.median, birth, data.lastYear)));

    // How the reader's own guess compares with the models
    const g = this._guessFor({ place, level, scenario, guess });
    this.guessResult.hidden = !g;
    if (g) {
      const said = g.year === null ? `not by ${data.lastYear}` : g.year;
      let verdict;
      if (g.year === null && a.median === null) verdict = "The models agree.";
      else if (a.median === null) verdict = `Most models say it does not arrive by ${data.lastYear}.`;
      else if (g.year === null) verdict = `The models say ${a.median}.`;
      else if (g.year === a.median) verdict = "That is exactly the models’ median.";
      else {
        const n = Math.abs(a.median - g.year);
        verdict = `The models say ${n} year${n === 1 ? "" : "s"} ${a.median < g.year ? "sooner" : "later"}.`;
      }
      this.guessResult.replaceChildren(document.createTextNode(`You guessed ${said}. `), node("strong", "", verdict));
    }
  }

  _lineChart({ place, level, scenario, birth }) {
    const { data, width } = this;
    const yb = LINE_H - M.bottom - AGE_ROW; // bottom of the plot area
    const svg = this.line;
    svg.attr("viewBox", `0 0 ${width} ${LINE_H}`).attr("height", LINE_H);
    const cell = place.cell;
    const inRange = (d) => d.year >= X_DOMAIN[0];
    const all = SCENARIOS.map((_, s) => data.series(cell, s, "p50").filter(inRange));
    const lo = data.series(cell, scenario, "p10").filter(inRange);
    const hi = data.series(cell, scenario, "p90").filter(inRange);
    const world = data.worldSeries(scenario, "p50").filter(inRange);
    const lv = data.meta.levels[level];
    const sel = all[scenario];
    const nowPoint = sel.find((d) => d.year === 2025) || sel[sel.length - 1];
    this.lineTitle.textContent = `${fmtTemp(nowPoint.v)} here today, ${fmtTemp(sel[sel.length - 1].v)} by ${data.lastYear} under ${SCENARIOS[scenario].code}`;

    // The axis depends only on the place and level, so switching scenario does not rescale it.
    const allHi = SCENARIOS.flatMap((_, s) => data.series(cell, s, "p90").filter(inRange).map((d) => d.v));
    const allLo = SCENARIOS.flatMap((_, s) => data.series(cell, s, "p10").filter(inRange).map((d) => d.v));
    const yMax = Math.max(lv + 0.5, d3.max(allHi));
    const yMin = Math.min(-0.5, d3.min(allLo));
    const x = d3.scaleLinear(X_DOMAIN, [M.left, width - M.right]);
    const y = d3.scaleLinear([yMin, yMax], [yb, M.top]).nice(5);
    this.lx = x;

    this.gGrid.selectAll("*").remove();
    y.ticks(5).forEach((t) => {
      this.gGrid.append("line").attr("x1", M.left).attr("x2", width - M.right).attr("y1", y(t)).attr("y2", y(t)).attr("stroke", t === 0 ? "#c3c2b7" : "#e1e0d9");
      this.gGrid.append("text").attr("x", M.left - 5).attr("y", y(t)).attr("dy", "0.32em").attr("text-anchor", "end").text(`${t > 0 ? "+" : t < 0 ? "−" : ""}${Math.abs(t)}°`);
    });
    this.gXAxis.selectAll("*").remove();
    d3.range(1960, 2091, 20).forEach((t) => {
      this.gXAxis.append("text").attr("x", x(t)).attr("y", yb + 15).attr("text-anchor", "middle").text(t);
    });
    // The reader's age in the same years, when they have given a birth year.
    this.gAge.selectAll("*").remove();
    if (birth) {
      let first = true;
      d3.range(1960, 2091, 20).forEach((t) => {
        const age = t - birth;
        if (age < 0 || age > 100) return;
        this.gAge.append("text").attr("x", x(t)).attr("y", yb + 15 + AGE_ROW).attr("text-anchor", "middle").text(first ? `age ${age}` : age);
        first = false;
      });
    }
    this.todayLine.attr("x1", x(TODAY)).attr("x2", x(TODAY)).attr("y1", M.top).attr("y2", yb);
    this.todayText.attr("x", x(TODAY)).attr("y", M.top - 3);

    const line = d3.line().x((d) => x(d.year)).y((d) => y(d.v)).curve(d3.curveMonotoneX);
    const band = d3
      .area()
      .x((d, i) => x(lo[i].year))
      .y0((d, i) => y(lo[i].v))
      .y1((d, i) => y(hi[i].v))
      .curve(d3.curveMonotoneX);
    // Shapes glide to their new form; the first draw and reduced-motion readers get it at once.
    const move = (sel, name, value) => {
      if (this.motion && sel.attr(name)) sel.interrupt(name).transition(name).duration(MOVE_MS).attr(name, value);
      else sel.interrupt(name).attr(name, value);
    };
    move(this.band.attr("fill", SCENARIOS[scenario].color), "d", band(lo));
    move(this.worldPath, "d", line(world));

    const order = d3.range(SCENARIOS.length).sort((a, b) => (a === scenario) - (b === scenario));
    this.gLines
      .selectAll("path")
      .data(order, (s) => s)
      .join("path")
      .attr("class", "s-line")
      .attr("stroke", (s) => SCENARIOS[s].color)
      .attr("stroke-width", (s) => (s === scenario ? 2.5 : 1.25))
      .each(function (s) {
        move(d3.select(this), "d", line(all[s]));
      })
      .order();

    this.levelLine.attr("x1", M.left).attr("x2", width - M.right);
    move(this.levelLine, "y1", y(lv));
    move(this.levelLine, "y2", y(lv));
    this.levelText.attr("x", M.left + 4).text(fmtLevel(lv));
    move(this.levelText, "y", y(lv) - 4);

    const a = this.summary;
    if (a.median !== null) {
      const ax = x(Math.max(a.median, X_DOMAIN[0]));
      const wasHidden = this.arrivalDot.attr("display") === "none";
      this.arrivalDot.attr("display", null);
      this.dropLine.attr("display", null).attr("y2", yb);
      if (wasHidden) {
        this.arrivalDot.interrupt("cx").interrupt("cy").attr("cx", ax).attr("cy", y(lv));
        this.dropLine.interrupt("x1").interrupt("x2").interrupt("y1").attr("x1", ax).attr("x2", ax).attr("y1", y(lv));
      } else {
        move(this.arrivalDot, "cx", ax);
        move(this.arrivalDot, "cy", y(lv));
        move(this.dropLine, "x1", ax);
        move(this.dropLine, "x2", ax);
        move(this.dropLine, "y1", y(lv));
      }
    } else {
      this.arrivalDot.attr("display", "none");
      this.dropLine.attr("display", "none");
    }

    // End labels: one per line, spaced so they never overlap, each with a line key.
    const labels = SCENARIOS.map((sc, s) => ({
      key: sc.id,
      s,
      text: `${sc.code} ${fmtEnd(all[s][all[s].length - 1].v)}`,
      color: sc.color,
      y0: y(all[s][all[s].length - 1].v),
    }));
    labels.push({
      key: "world",
      s: null,
      text: `World ${fmtEnd(world[world.length - 1].v)}`,
      color: "#52514e",
      y0: y(world[world.length - 1].v),
    });
    labels.sort((p, q) => p.y0 - q.y0);
    const gap = 12;
    labels.forEach((d, i) => {
      d.y = i === 0 ? d.y0 : Math.max(d.y0, labels[i - 1].y + gap);
    });
    const overflow = labels[labels.length - 1].y - (yb);
    if (overflow > 0) {
      labels[labels.length - 1].y -= overflow;
      for (let i = labels.length - 2; i >= 0; i--) labels[i].y = Math.min(labels[i].y, labels[i + 1].y - gap);
    }
    const ex = width - M.right;
    this.gLabels
      .selectAll("g")
      .data(labels, (d) => d.key)
      .join((enter) => {
        const g = enter.append("g");
        g.append("line").attr("class", "leader");
        g.append("line").attr("class", "end-key");
        g.append("text").attr("class", "end-label").attr("dy", "0.32em");
        return g;
      })
      .each((d, i, nodes) => {
        const g = d3.select(nodes[i]);
        g.select(".leader").attr("x1", ex).attr("x2", ex + 5).attr("y1", d.y0).attr("y2", d.y);
        g.select(".end-key").attr("x1", ex + 6).attr("x2", ex + 13).attr("y1", d.y).attr("y2", d.y).attr("stroke", d.color);
        g.select(".end-label")
          .attr("x", ex + 16)
          .attr("y", d.y)
          .classed("active", d.s === scenario)
          .text(d.text)
          .style("cursor", d.s === null ? "default" : "pointer")
          .on("click", d.s === null ? null : () => this.onScenario(d.s));
      });

    // Crosshair: snap to the nearest stored year, show every series at that year.
    this.overlay
      .attr("x", M.left)
      .attr("y", M.top)
      .attr("width", width - M.left - M.right)
      .attr("height", yb - M.top)
      .on("pointermove", (event) => {
        const [mx] = d3.pointer(event, svg.node());
        const yr = x.invert(mx);
        const i = d3.bisector((d) => d.year).center(world, yr);
        const year = world[i].year;
        this.crossLine.attr("display", null).attr("x1", x(year)).attr("x2", x(year)).attr("y1", M.top).attr("y2", yb);
        showTooltip(event, (tip) => {
          tip.append(node("div", "tt-head", year));
          const rows = SCENARIOS.map((sc, s) => ({ c: sc.color, n: sc.code, v: all[s][i].v }))
            .concat([{ c: "#52514e", n: "World average", v: world[i].v }])
            .sort((p, q) => q.v - p.v);
          rows.forEach((r) => {
            const row = node("div", "tt-row");
            const key = node("span", "tt-key");
            key.style.background = r.c;
            row.append(key, node("span", "", r.n), node("b", "", fmtTemp(r.v)));
            tip.append(row);
          });
        });
      })
      .on("pointerleave", () => {
        this.crossLine.attr("display", "none");
        hideTooltip();
      });
  }

  _stripChart({ place, level, scenario, guess }) {
    const { width } = this;
    const a = this.summary;
    const svg = this.strip;
    svg.attr("viewBox", `0 0 ${width} ${STRIP_H}`).attr("height", STRIP_H);
    const x = this.lx;
    const baseY = STRIP_H - 20;
    const afterX = width - M.right + 38;
    const lvText = fmtLevel(this.data.meta.levels[level]);
    // The title states what the dots show; the note says how to read them.
    if (a.nReached === 0) this.stripTitle.textContent = `No model has ${lvText} arriving here by ${this.data.lastYear}`;
    else if (a.nReached < a.nModel) this.stripTitle.textContent = `${a.nReached} of ${a.nModel} models have ${lvText} arriving here by ${this.data.lastYear}`;
    else if (a.earliest === a.latest) this.stripTitle.textContent = `All ${a.nModel} models say ${a.earliest}`;
    else this.stripTitle.textContent = `The ${a.nModel} models disagree by ${a.latest - a.earliest} years`;
    this.stripNote.textContent = `One dot per climate model, at the year it says ${lvText} arrives and stays. Bar: the median.`;

    this.stripBase.attr("x1", M.left).attr("x2", width - M.right).attr("y1", baseY).attr("y2", baseY);
    // Dots earlier than the axis sit at its left edge, and the first tick says so.
    const anyEarlier = a.models.some((d) => d.year !== null && d.year < X_DOMAIN[0]);
    this.gStripAxis.selectAll("*").remove();
    d3.range(1960, 2091, 20).forEach((t) => {
      this.gStripAxis
        .append("text")
        .attr("x", x(t))
        .attr("y", STRIP_H - 5)
        .attr("text-anchor", "middle")
        .text(t === X_DOMAIN[0] && anyEarlier ? `≤${t}` : t);
    });

    // Stack dots upward so each one stays visible and hoverable.
    const pts = a.models.map((d) => ({ ...d, x: d.year === null ? afterX : x(Math.max(d.year, X_DOMAIN[0])) }));
    pts.sort((p, q) => p.x - q.x);
    const rowsLast = [];
    const minGap = 9.5;
    pts.forEach((p) => {
      let r = rowsLast.findIndex((last) => p.x - last >= minGap);
      if (r < 0) {
        r = rowsLast.length;
        rowsLast.push(0);
      }
      rowsLast[r] = p.x;
      p.row = r;
    });
    const rowH = Math.min(10, (baseY - 20) / Math.max(1, rowsLast.length));
    pts.forEach((p) => {
      p.y = baseY - 6 - p.row * rowH;
    });
    const dots = this.gDots
      .selectAll("circle")
      .data(pts, (d) => d.model)
      .join("circle")
      .attr("class", (d) => `strip-dot${d.year === null ? " after" : ""}`)
      .attr("r", 4.5)
      .attr("cx", (d) => d.x)
      .attr("cy", (d) => d.y);

    if (a.median !== null) {
      const mx = x(Math.max(a.median, X_DOMAIN[0]));
      this.stripMedian.attr("display", null).attr("x1", mx).attr("x2", mx).attr("y1", 13).attr("y2", baseY + 3);
      const flip = mx > width - M.right - 80;
      this.stripMedianText
        .attr("display", null)
        .attr("x", mx + (flip ? -4 : 4))
        .attr("y", 11)
        .attr("text-anchor", flip ? "end" : "start")
        .text(`Median ${a.median}`);
    } else {
      this.stripMedian.attr("display", "none");
      this.stripMedianText.attr("display", "none");
    }
    // The reader's guess, drawn in the same strip as the models' answers
    const g = this._guessFor({ place, level, scenario, guess });
    this.gGuess.attr("display", g ? null : "none");
    if (g) {
      const gx = g.year === null ? afterX : x(Math.max(g.year, X_DOMAIN[0]));
      const flip = width - gx < 100; // not enough room on the right for the label
      this.gGuess.select("line").attr("x1", gx).attr("x2", gx).attr("y1", 30).attr("y2", baseY);
      this.gGuess.select("circle").attr("cx", gx).attr("cy", 30);
      this.gGuess
        .select("text")
        .attr("x", gx + (flip ? -7 : 7))
        .attr("y", 33.5)
        .attr("text-anchor", flip ? "end" : "start")
        .text(g.year === null ? "your guess" : `your guess ${g.year}`);
    }
    const nAfter = a.nModel - a.nReached;
    this.afterText.attr("x", afterX).attr("y", STRIP_H - 5).text(nAfter ? "not by 2090" : "");

    const list = a.models.map((d) => `${d.model} ${d.year === null ? "not by 2090" : d.year}`).join(", ");
    svg.attr("aria-label", `Arrival year by model: ${list}.`);

    // The pointer only has to be closest, not on the dot.
    this.stripOverlay
      .attr("x", 0)
      .attr("y", 0)
      .attr("width", width)
      .attr("height", STRIP_H)
      .on("pointermove", (event) => {
        const [mx, my] = d3.pointer(event, svg.node());
        let best = null;
        let bestD = 18 * 18;
        pts.forEach((p) => {
          const d = (p.x - mx) ** 2 + (p.y - my) ** 2;
          if (d < bestD) {
            bestD = d;
            best = p;
          }
        });
        dots.classed("hot", (d) => d === best);
        if (!best) {
          hideTooltip();
          return;
        }
        showTooltip(event, (tip) => {
          tip.append(node("div", "tt-value", best.year === null ? "Not by 2090" : best.year), node("div", "tt-head", best.model));
          const phrase = agePhrase(best.year, this.state.birth);
          if (phrase) tip.append(node("div", "", phrase));
        });
      })
      .on("pointerleave", () => {
        dots.classed("hot", false);
        hideTooltip();
      });
  }
}
