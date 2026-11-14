// End-to-end checks in a real browser, using real mouse and keyboard input.
// Run: BASE=http://localhost:8123/ FINDINGS=eda/findings.json node tests/e2e.cjs
// Set BROWSER to chromium (default), webkit or firefox.
const playwright = require("playwright");
const ENGINE = process.env.BROWSER || "chromium";
const fs = require("fs");

const BASE = process.env.BASE || "http://localhost:8123/";
const results = [];
function check(name, ok, detail = "") {
  results.push({ name, ok, detail });
  console.log(`${ok ? "PASS" : "FAIL"}  ${name}${detail ? "  [" + detail + "]" : ""}`);
}

(async () => {
  const browser = await playwright[ENGINE].launch();
  const page = await browser.newPage({ viewport: { width: 1440, height: 810 } });
  const errors = [];
  page.on("pageerror", (e) => errors.push(String(e)));
  page.on("console", (m) => m.type() === "error" && errors.push(m.text()));
  page.on("requestfailed", (r) => errors.push("request failed " + r.url()));
  page.on("response", (r) => r.status() >= 400 && errors.push(`${r.status()} ${r.url()}`));

  await page.goto(BASE);
  await page.waitForFunction(() => window.viz);
  check("page loads and exposes state", true);

  // 0. Guess first: the panel keeps its answer back until the reader commits to a guess.
  const gate = await page.evaluate(() => ({ open: !document.getElementById("guess").hidden, bodyHidden: document.getElementById("place-body").hidden, q: document.getElementById("guess-q").textContent }));
  check("the panel asks for a guess before showing the answer", gate.open && gate.bodyHidden && /San Diego/.test(gate.q) && (await page.locator("#guess-reveal").isDisabled()), gate.q);
  await page.locator("#guess-year").focus();
  await page.keyboard.press("ArrowRight"); // a real key press: 2000 to 2001
  const afterKey = await page.locator("#guess-out").innerText();
  await page.locator("#guess-year").evaluate((el) => {
    el.value = "2070";
    el.dispatchEvent(new Event("input", { bubbles: true }));
  });
  await page.locator("#guess-birth").fill("1999");
  const shown = await page.locator("#guess-out").innerText();
  await page.locator("#guess-reveal").click();
  await page.waitForTimeout(600); // the headline number rolls from the guess to the answer
  const sdAnswer = await page.evaluate(() => window.viz.data.placeArrival(1, 1, window.viz.state.place.cell).median);
  const verdict = await page.locator("#guess-result").innerText();
  const afterGuess = await page.evaluate(() => ({ gateHidden: document.getElementById("guess").hidden, hero: document.getElementById("hero-year").textContent, marker: document.querySelector("#strip-svg .guess-label").textContent, lines: document.querySelectorAll("#line-svg path.s-line").length }));
  check("revealing compares the guess with the models", afterKey === "2001" && shown === "2070" && verdict.includes("You guessed 2070.") && verdict.includes(`${2070 - sdAnswer} years sooner`), verdict);
  const lifeAfterGuess = await page.locator("#lifetime-text").innerText();
  const heroAfterGuess = await page.locator("#hero-text").innerText();
  const ends = await page.evaluate(() => [0, 3].map((sc) => window.viz.data.placeArrival(sc, 1, window.viz.state.place.cell).median));
  check("the birth year given with the guess carries over", lifeAfterGuess.includes(`You would be ${sdAnswer - 1999}.`) && (await page.locator("#birth-year").inputValue()) === "1999", lifeAfterGuess);
  check("the headline says what emissions change", heroAfterGuess.includes(`Emissions shift it by ${ends[0] - ends[1]} years: ${ends[1]} if very high, ${ends[0]} if low.`), heroAfterGuess);
  await page.locator("#birth-year").fill("2005");
  check("the answer and the guess marker appear after the reveal", afterGuess.gateHidden && afterGuess.hero === String(sdAnswer) && afterGuess.marker === "your guess 2070" && afterGuess.lines === 4, JSON.stringify(afterGuess));

  // 1. Painted colors line up with the data: the pixel at every cell center must show that
  // cell's class. Skip the far south and north, where cells get thinner than a pixel, and the
  // one column of cells that the edge of the map cuts through (its centers sit under a pixel
  // from the edge).
  const align = await page.evaluate(async () => {
    const { data, map, state, binOf } = window.viz;
    const BINS = ["#6b0f1a", "#b3261e", "#e4572e", "#f59e4c", "#fbd28a", "#edece8"].map((h) => window.d3.color(h));
    const codes = data.medianArrival(state.scenario, state.level);
    const stripes = data.splitStripes(state.scenario, state.level);
    const ctx = map.canvas.getContext("2d");
    const kx = map.canvas.width / map.width;
    const ky = map.canvas.height / map.height;
    let tested = 0;
    let bad = 0;
    let striped = 0;
    const samples = [];
    for (let j = 6; j < data.nlat - 6; j++) {
      for (let i = 0; i < data.nlon; i++) {
        const c = j * data.nlon + i;
        const lat = -88.75 + j * 2.5;
        const lon = 1.25 + i * 2.5;
        const fromCenter = ((lon - map.projection.rotate()[0] * -1 + 540) % 360) - 180;
        if (Math.abs(fromCenter) > 178.75) continue;
        const [x, y] = map.projection([lon, lat]);
        const px = ctx.getImageData(Math.floor(x * kx), Math.floor(y * ky), 1, 1).data;
        const col = BINS[binOf(data.yearOf(codes[c]))];
        const same = (k) => px[0] === k.r && px[1] === k.g && px[2] === k.b;
        tested++;
        // A cell where the models split is striped: either of its two colors is right there.
        if (stripes[c] !== 254) {
          striped++;
          if (!same(col) && !same(BINS[binOf(data.yearOf(stripes[c]))])) bad++;
          continue;
        }
        if (!same(col)) {
          bad++;
          if (samples.length < 4) samples.push({ lat, lon, want: col.formatHex(), px: [...px] });
        }
      }
    }
    return { tested, bad, striped, samples };
  });
  check("map pixels match the data at every cell center", align.tested === 8580 && align.bad === 0 && align.striped > 500, `tested ${align.tested}, striped ${align.striped}, wrong ${align.bad} ${JSON.stringify(align.samples)}`);

  // 2. Clicking the map selects the place under the pointer.
  const clickTarget = await page.evaluate(() => {
    const { map } = window.viz;
    const r = map.svg.node().getBoundingClientRect();
    const [x, y] = map.projection([139.7, 35.7]); // Tokyo
    return { x: r.left + x, y: r.top + y };
  });
  await page.mouse.move(clickTarget.x, clickTarget.y);
  const tipShown = await page.evaluate(() => !document.getElementById("tooltip").hidden);
  check("hovering the map shows a tooltip", tipShown);
  await page.mouse.click(clickTarget.x, clickTarget.y);
  const tokyo = await page.evaluate(() => ({ name: window.viz.state.place.name, cell: window.viz.state.place.cell, want: window.viz.data.cellOf(35.7, 139.7), hero: document.getElementById("place-name").textContent }));
  check("clicking Tokyo selects Tokyo's cell", tokyo.cell === tokyo.want && tokyo.name === "Tokyo" && tokyo.hero === "Tokyo", JSON.stringify(tokyo));
  await page.mouse.move(5, 5);

  // 3. Every level and scenario control changes the state, title and map.
  const canvasHash = () => page.evaluate(() => {
    const c = document.getElementById("map-canvas");
    const d = c.getContext("2d").getImageData(0, 0, c.width, c.height).data;
    let h = 0;
    for (let i = 0; i < d.length; i += 97) h = (h * 31 + d[i]) | 0;
    return h;
  });
  let prev = await canvasHash();
  let changed = 0;
  const levels = page.locator('#level-control input');
  for (let i = 0; i < 4; i++) {
    await page.locator('#level-control label').nth(i).click();
    const st = await page.evaluate(() => window.viz.state.level);
    const h = await canvasHash();
    if (st === i && h !== prev) changed++;
    prev = h;
  }
  check("level control changes the map", changed >= 3, `${changed} changes`);
  const title = await page.locator("h1").innerText();
  check("title follows the level", title.includes("+4 °C"), title);
  changed = 0;
  for (let i = 0; i < 4; i++) {
    await page.locator('#scenario-control label').nth(i).click();
    const st = await page.evaluate(() => window.viz.state.scenario);
    const h = await canvasHash();
    if (st === i && h !== prev) changed++;
    prev = h;
  }
  check("scenario control changes the map", changed >= 3, `${changed} changes`);
  await page.locator('#level-control label').nth(1).click();
  await page.locator('#scenario-control label').nth(1).click();

  // 4. Time slider, by keyboard and by dragging.
  await page.locator("#year-slider").focus();
  await page.keyboard.press("ArrowLeft");
  let yr = await page.evaluate(() => window.viz.state.year);
  check("arrow key moves the year", yr === 2089, String(yr));
  const box = await page.locator("#year-slider").boundingBox();
  await page.mouse.move(box.x + box.width - 8, box.y + 20);
  await page.mouse.down();
  await page.mouse.move(box.x + box.width * 0.45, box.y + 20, { steps: 8 });
  await page.mouse.up();
  yr = await page.evaluate(() => window.viz.state.year);
  check("dragging moves the year", yr > 2010 && yr < 2050, String(yr));
  const reading = await page.locator("#reading").innerText();
  check("reading sentence follows the year", reading.includes(String(yr)), reading);
  const unrevealed = await page.evaluate(() => {
    const { map } = window.viz;
    const c = map.canvas.getContext("2d");
    const px = c.getImageData(0, 0, map.canvas.width, map.canvas.height).data;
    const neutral = window.d3.color("#edece8");
    let n = 0;
    let filled = 0;
    for (let i = 0; i < px.length; i += 4) {
      if (px[i + 3] === 0) continue;
      filled++;
      if (px[i] === neutral.r && px[i + 1] === neutral.g && px[i + 2] === neutral.b) n++;
    }
    return n / filled;
  });
  check("earlier year hides later arrivals", unrevealed > 0.2, `${(unrevealed * 100).toFixed(0)}% not yet arrived`);

  // 5. Play runs and can pause.
  await page.locator("#play").click();
  const y0 = await page.evaluate(() => window.viz.state.year);
  await page.waitForTimeout(700);
  const y1 = await page.evaluate(() => window.viz.state.year);
  check("play advances the year", y1 > y0, `${y0} -> ${y1}`);
  await page.locator("#play").click();
  await page.waitForTimeout(200);
  const y2 = await page.evaluate(() => window.viz.state.year);
  await page.waitForTimeout(300);
  const y3 = await page.evaluate(() => window.viz.state.year);
  check("pause stops the year", y2 === y3, `${y2} -> ${y3}`);
  await page.evaluate(() => window.viz.setYear(2090));

  // 6. Search and stories.
  await page.locator("#place-search").fill("Nairobi");
  await page.keyboard.press("Enter");
  check("search finds a city", (await page.locator("#place-name").innerText()) === "Nairobi");
  await page.locator("#place-search").fill("Sao Paulo");
  await page.keyboard.press("Enter");
  check("search ignores accents", (await page.locator("#place-name").innerText()) === "São Paulo");
  await page.locator("#place-search").fill("");
  const n = await page.locator("#story-list button").count();
  let okStories = 0;
  for (let i = 0; i < n; i++) {
    const b = page.locator("#story-list button").nth(i);
    const label = await b.innerText();
    await b.click();
    if ((await page.locator("#place-name").innerText()) === label && (await b.getAttribute("aria-pressed")) === "true") okStories++;
  }
  check("every story button selects its place", okStories === n && n > 0, `${okStories}/${n}`);

  // 7. Gray is labeled by the selected year, and the map agrees with the panel at a city.
  await page.evaluate(() => window.viz.setYear(2045));
  const grayLabel = await page.locator("#legend button").last().innerText();
  check("gray legend entry follows the year", grayLabel.trim() === "Not by 2045", grayLabel);
  const agrees = await page.evaluate(() => {
    const { data, map, state } = window.viz;
    const kx = map.canvas.width / map.width;
    const ky = map.canvas.height / map.height;
    const b = data.cellBounds(data.cellOf(32.72, -117.15));
    const [x, y] = map.projection([(b.lon0 + b.lon1) / 2, (b.lat0 + b.lat1) / 2]);
    const px = map.canvas.getContext("2d").getImageData(Math.floor(x * kx), Math.floor(y * ky), 1, 1).data;
    const gray = window.d3.color("#edece8");
    const median = data.placeArrival(state.scenario, state.level, data.cellOf(32.72, -117.15)).median;
    return { median, isGray: px[0] === gray.r && px[1] === gray.g && px[2] === gray.b };
  });
  check("San Diego's map color agrees with its year", agrees.median <= 2045 && !agrees.isGray, JSON.stringify(agrees));
  await page.evaluate(() => window.viz.setYear(2090));

  // 8. Legend isolation and reset.
  const before = await canvasHash();
  await page.locator("#legend button").nth(2).hover();
  const during = await canvasHash();
  await page.mouse.move(5, 5);
  const after = await canvasHash();
  check("legend hover isolates a class and resets", before !== during && before === after);

  // 9. Line chart crosshair and strip plot tooltips.
  await page.locator("#story-list button").first().click();
  const lb = await page.locator("#line-svg").boundingBox();
  await page.mouse.move(lb.x + lb.width * 0.5, lb.y + lb.height * 0.5);
  const lineTip = await page.locator("#tooltip").innerText();
  check("line chart tooltip lists every series", /SSP1-2\.6/.test(lineTip) && /SSP5-8\.5/.test(lineTip) && /World average/.test(lineTip), lineTip.replace(/\n/g, " "));
  await page.locator("#strip-svg").scrollIntoViewIfNeeded();
  const firstDot = await page.evaluate(() => {
    const d = document.querySelector("#strip-svg circle.strip-dot");
    const r = d.getBoundingClientRect();
    return { x: r.left + r.width / 2, y: r.top + r.height / 2 };
  });
  await page.mouse.move(firstDot.x, firstDot.y);
  const stripTip = await page.locator("#tooltip").innerText();
  check("strip plot tooltip names a model", stripTip.length > 4 && !/SSP/.test(stripTip), stripTip.replace(/\n/g, " "));
  await page.mouse.move(5, 5);

  // 10. Table twin.
  await page.locator("#table-details summary").click();
  const rows = await page.locator("#city-table tbody tr").count();
  check("table lists cities", rows === 300, String(rows));
  const firstName = (await page.locator("#city-table tbody tr td").first().innerText()).split(",")[0];
  await page.locator("#city-table tbody tr").first().click();
  check("table row selects the place", (await page.locator("#place-name").innerText()) === firstName, firstName);
  await page.locator("#table-details summary").click();

  // 11. The page agrees with the Python analysis.
  if (process.env.FINDINGS && fs.existsSync(process.env.FINDINGS)) {
    const f = JSON.parse(fs.readFileSync(process.env.FINDINGS, "utf8"));
    const js = await page.evaluate((places) => {
      const { data } = window.viz;
      const out = {};
      for (const [name, lat, lon] of places) {
        out[name] = [0, 1, 2, 3].map((s) => data.placeArrival(s, 1, data.cellOf(lat, lon)).median);
      }
      out.__world = [0, 1, 2, 3].map((s) => data.worldArrival(s, 1));
      out.__shares = data.areaCurves(1, 1).find((d) => d.year === 2050);
      return out;
    }, [["San Diego", 32.72, -117.15], ["Moscow", 55.75, 37.6], ["Singapore", 1.29, 103.85], ["North Atlantic", 52, -35], ["Southern Ocean", -57, -60]]);
    let same = true;
    const sc = ["SSP1-2.6", "SSP2-4.5", "SSP3-7.0", "SSP5-8.5"];
    for (const name of ["San Diego", "Moscow", "Singapore", "North Atlantic", "Southern Ocean"]) {
      sc.forEach((s, i) => {
        if (f.place_arrival_2C[name][s] !== js[name][i]) same = false;
      });
    }
    check("arrival years match the Python analysis", same);
    const worldOk = sc.every((s, i) => f.global[s].arrival_2C_median === js.__world[i]);
    check("world arrival matches the Python analysis", worldOk, JSON.stringify(js.__world));
    const sh = f.shares["SSP2-4.5|+2"];
    check("land share matches the Python analysis", Math.abs(sh.land_by_2050 - js.__shares.land) < 0.002 && Math.abs(sh.ocean_by_2050 - js.__shares.ocean) < 0.002, `${sh.land_by_2050} vs ${js.__shares.land.toFixed(3)}`);
  }

  // 12. Lifetime: a birth year turns arrival years into ages.
  await page.locator("#story-list button").first().click();
  const sd = await page.evaluate(() => window.viz.data.placeArrival(1, 1, window.viz.data.cellOf(32.72, -117.15)).median);
  const life1 = await page.locator("#lifetime-text").innerText();
  check("default birth year gives an age", life1.includes(`You would be ${sd - 2005}.`) && life1.includes(`A child born today would be ${sd - 2026}.`), life1);
  await page.locator("#birth-year").fill("1990");
  const life2 = await page.locator("#lifetime-text").innerText();
  const ages = await page.evaluate(() => [...document.querySelectorAll("#line-svg .age-axis text")].map((t) => t.textContent));
  check("changing the birth year updates the age", life2.includes(`You would be ${sd - 1990}.`), life2);
  check("the chart shows an age row", ages.join(",") === "age 10,30,50,70,90", ages.join(","));
  await page.locator("#story-list button").nth(3).click();
  const sv = await page.evaluate(() => window.viz.data.placeArrival(1, 1, window.viz.state.place.cell).median);
  const life3 = await page.locator("#lifetime-text").innerText();
  check("an arrival in the past uses the past tense", life3.includes(`You were ${sv - 1990} when it arrived.`) && life3.includes("it was already here"), life3);
  await page.locator("#birth-year").fill("2005");
  const life4 = await page.locator("#lifetime-text").innerText();
  check("an arrival before birth says so", life4.includes(`${2005 - sv} years before you were born`), life4);
  await page.locator("#story-list button").nth(4).click();
  const life5 = await page.locator("#lifetime-text").innerText();
  check("a place that never arrives gives the age in 2090", life5.includes("By 2090 you would be 85"), life5);
  await page.locator("#birth-year").fill("");
  const life6 = await page.locator("#lifetime-text").innerText();
  const noAges = await page.evaluate(() => document.querySelectorAll("#line-svg .age-axis text").length);
  check("an empty birth year turns the ages off", /Enter your birth year/.test(life6) && noAges === 0, life6);
  await page.locator("#birth-year").fill("2005");

  // 13. Cities dot plot: one dot per city, no overlaps, linked to the map and the panel.
  const settle = () => page.waitForTimeout(1100); // dots take about a second to move
  const swarmStats = () =>
    page.evaluate(() => {
      const { data, state } = window.viz;
      const cs = [...document.querySelectorAll("#swarm-svg circle.swarm-dot")].map((c) => ({ x: +c.getAttribute("cx"), y: +c.getAttribute("cy"), r: +c.getAttribute("r"), d: c.__data__ }));
      let overlaps = 0;
      for (let i = 0; i < cs.length; i++) for (let j = i + 1; j < cs.length; j++) if (Math.hypot(cs[i].x - cs[j].x, cs[i].y - cs[j].y) < cs[i].r + cs[j].r - 1.2) overlaps++;
      const median = data.medianArrival(state.scenario, state.level);
      const want = cs.map((c) => data.yearOf(median[c.d.place.cell]));
      const wrongYear = cs.filter((c, i) => c.d.year !== want[i]).length;
      const never = want.filter((y) => y === null).length;
      const byYear = want.filter((y) => y !== null && y <= state.year).length;
      return { n: cs.length, overlaps, wrongYear, never, gray: cs.filter((c) => c.d.year === null).length, byYear, label: document.querySelector(".swarm-play-label").textContent };
    });
  await page.locator("#story-list button").first().click();
  await settle();
  let sw = await swarmStats();
  check("dot plot shows 300 cities at the right years without overlaps", sw.n === 300 && sw.overlaps === 0 && sw.wrongYear === 0, JSON.stringify(sw));
  check("dot plot counts arrivals", sw.label === `By 2090: ${sw.byYear} of 300 cities`, sw.label);
  const tokyoDot = await page.evaluate(() => {
    const c = [...document.querySelectorAll("#swarm-svg circle.swarm-dot")].find((el) => el.__data__.c.n === "Tokyo");
    c.scrollIntoView({ block: "center" });
    const r = c.getBoundingClientRect();
    return { x: r.left + r.width / 2, y: r.top + r.height / 2 };
  });
  await page.mouse.move(tokyoDot.x, tokyoDot.y);
  const swarmTip = await page.locator("#tooltip").innerText();
  const ringShown = await page.evaluate(() => getComputedStyle(document.querySelector("#map-svg .link-ring").parentNode).display !== "none");
  check("hovering a city dot names it and rings it on the map", /Tokyo/.test(swarmTip) && ringShown, swarmTip.replace(/\n/g, " "));
  await page.mouse.click(tokyoDot.x, tokyoDot.y);
  check("clicking a city dot selects the city", (await page.locator("#place-name").innerText()) === "Tokyo");
  await page.mouse.move(5, 5);
  await page.locator("#scenario-control label").nth(0).click();
  await settle();
  sw = await swarmStats();
  check("dots regroup when the scenario changes", sw.overlaps === 0 && sw.wrongYear === 0 && sw.gray === sw.never && sw.never > 100, JSON.stringify(sw));
  await page.locator("#scenario-control label").nth(3).click();
  await page.locator("#level-control label").nth(3).click();
  await settle();
  sw = await swarmStats();
  check("dots stay apart in the densest setting", sw.overlaps === 0 && sw.wrongYear === 0, JSON.stringify(sw));
  await page.locator("#level-control label").nth(1).click();
  await page.locator("#scenario-control label").nth(1).click();
  await page.evaluate(() => window.viz.setYear(2050));
  sw = await swarmStats();
  check("dot plot follows the timeline", sw.label === `By 2050: ${sw.byYear} of 300 cities` && sw.byYear > 0 && sw.byYear < 300, sw.label);
  await page.evaluate(() => window.viz.setYear(2090));
  await page.evaluate(() => window.scrollTo(0, 0));
  await page.locator("#story-list button").first().click();

  // 14. Guided tour: every step sets the state it describes.
  await page.locator("#tour-start").click();
  const tourOpen = await page.locator("#tour").isVisible();
  await page.waitForFunction(() => window.viz.state.year === 2050 && !window.viz.state.playing, null, { timeout: 20000 });
  check("tour opens and step 1 plays to 2050", tourOpen && (await page.locator("#tour-count").innerText()).trim() === "1 of 6");
  await page.locator("#tour-next").click();
  const step2 = await page.locator("#tour-body").innerText();
  check("tour step 2 selects the Arctic", (await page.locator("#place-name").innerText()) === "Svalbard" && /years before the world average/.test(step2), step2);
  await page.locator("#tour-next").click();
  const step3 = await page.locator("#tour-body").innerText();
  check("tour step 3 selects the North Atlantic", (await page.locator("#place-name").innerText()) === "N. Atlantic" && /of 17 models/.test(step3), step3);
  await page.locator("#tour-next").click();
  const step4 = await page.locator("#tour-body").innerText();
  check("tour step 4 switches to the low scenario", (await page.evaluate(() => window.viz.state.scenario)) === 0 && /% of the ocean/.test(step4), step4);
  await page.locator("#tour-back").click();
  check("tour can go back", (await page.locator("#tour-count").innerText()).trim() === "3 of 6" && (await page.evaluate(() => window.viz.state.scenario)) === 1);
  await page.locator("#tour-next").click();
  await page.locator("#tour-next").click();
  const step5 = await page.locator("#tour-body").innerText();
  const citiesInView = await page.evaluate(async () => {
    await new Promise((r) => setTimeout(r, 900));
    const r = document.querySelector(".cities").getBoundingClientRect();
    return r.top < innerHeight && r.bottom > 0;
  });
  check("tour step 5 brings up the cities", citiesInView && /High-latitude cities reach \+2 °C around \d{4}, tropical cities around \d{4}/.test(step5), step5);
  await page.locator("#tour-next").click();
  const lastLabel = (await page.locator("#tour-next").innerText()).trim();
  await page.locator("#tour-next").click();
  const afterTour = await page.evaluate(() => ({ s: window.viz.state.scenario, l: window.viz.state.level, y: window.viz.state.year }));
  check(
    "tour ends cleanly",
    lastLabel === "Done" && !(await page.locator("#tour").isVisible()) && (await page.locator("#tour-start").isVisible()) && afterTour.s === 1 && afterTour.l === 1 && afterTour.y === 2090,
    JSON.stringify(afterTour)
  );

  // 15. Every level and scenario, at several places: no broken text and no errors.
  const sweep = await page.evaluate(async () => {
    const bad = [];
    const levels = document.querySelectorAll("#level-control input");
    const scenarios = document.querySelectorAll("#scenario-control input");
    const stories = document.querySelectorAll("#story-list button");
    for (let l = 0; l < levels.length; l++) {
      levels[l].click();
      for (let s = 0; s < scenarios.length; s++) {
        scenarios[s].click();
        for (const b of stories) {
          b.click();
          const text = document.querySelector("main").innerText + document.querySelector(".cities").innerText + document.querySelector("h1").innerText;
          if (/undefined|NaN|null|Infinity/.test(text)) bad.push(`level ${l} scenario ${s} ${b.textContent}`);
        }
      }
    }
    levels[1].click();
    scenarios[1].click();
    stories[0].click();
    return bad;
  });
  check("no broken text in any of the 16 settings", sweep.length === 0, sweep.slice(0, 4).join("; "));

  // 16. Layout at phone width: nothing overflows sideways.
  await page.setViewportSize({ width: 390, height: 844 });
  await page.waitForTimeout(400);
  const overflow = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
  check("no sideways scroll at phone width", overflow <= 0, `${overflow}px`);
  await page.setViewportSize({ width: 1440, height: 810 });

  check("no console errors or failed requests", errors.length === 0, errors.slice(0, 5).join(" | "));
  await browser.close();
  const failed = results.filter((r) => !r.ok);
  console.log(`\n${results.length - failed.length}/${results.length} passed`);
  process.exit(failed.length ? 1 : 0);
})();
