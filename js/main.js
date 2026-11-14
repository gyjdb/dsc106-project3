// Page state and wiring. Every control writes to `state`; `render` redraws from it.
import { loadData, SCENARIOS } from "./data.js";
import { ArrivalMap, BINS, binOf } from "./map.js";
import { Timeline } from "./timeline.js";
import { PlacePanel } from "./place.js";
import { createTour } from "./tour.js";
import { CitySwarm } from "./swarm.js";
import { agePhrase, parseBirthYear } from "./lifetime.js";
import { showTooltip, hideTooltip, node } from "./tooltip.js";

const d3 = window.d3;
const fmtLevel = (v) => `+${v} °C`;
const PLAY_SECONDS = 9;
const N_CITIES = 300; // how many of the largest cities the dot plot and the table show

const STORIES = [
  { name: "San Diego", city: "San Diego" },
  { name: "Singapore", city: "Singapore" },
  { name: "Moscow", city: "Moscow" },
  { name: "Svalbard", lat: 78.2, lon: 15.6, sub: "Arctic Ocean, Norway" },
  { name: "N. Atlantic", lat: 52, lon: -35, sub: "Open ocean, south of Greenland" },
];

function distanceKm(lat1, lon1, lat2, lon2) {
  const r = Math.PI / 180;
  const a =
    Math.sin(((lat2 - lat1) * r) / 2) ** 2 +
    Math.cos(lat1 * r) * Math.cos(lat2 * r) * Math.sin(((lon2 - lon1) * r) / 2) ** 2;
  return 2 * 6371 * Math.asin(Math.sqrt(a));
}

function nearest(cities, lat, lon) {
  let best = null;
  let bestD = Infinity;
  for (const c of cities) {
    const d = distanceKm(lat, lon, c.lat, c.lon);
    if (d < bestD) {
      bestD = d;
      best = c;
    }
  }
  return best;
}

const coord = (lat, lon) =>
  `${Math.abs(lat).toFixed(1)}°${lat >= 0 ? "N" : "S"}, ${Math.abs(lon).toFixed(1)}°${lon >= 0 ? "E" : "W"}`;

async function init() {
  const data = await loadData();
  const state = {
    level: data.meta.levels.indexOf(2),
    scenario: 1,
    year: data.lastYear,
    place: null,
    playing: false,
    birth: null, // the reader's birth year, if they give one
    guess: null, // the reader's guess: { cell, level, scenario, year }, year null for "not by 2090"
  };

  // A 2.5-degree cell is about 280 km north to south and narrows toward the poles.
  const cellSize = (cell) => {
    const b = data.cellBounds(cell);
    const km = 278 * Math.cos((((b.lat0 + b.lat1) / 2) * Math.PI) / 180);
    return `grid cell about ${Math.round(km / 10) * 10} × 280 km`;
  };
  const cityPlace = (c) => {
    const cell = data.cellOf(c.lat, c.lon);
    return { name: c.n, sub: `${c.c} · ${cellSize(cell)}`, lat: c.lat, lon: c.lon, cell };
  };
  // A place takes a city's name only if that city is inside the grid cell, so the
  // name and the numbers always describe the same cell.
  const citiesByCell = new Map();
  data.cities.forEach((c) => {
    const cell = data.cellOf(c.lat, c.lon);
    if (!citiesByCell.has(cell)) citiesByCell.set(cell, []);
    citiesByCell.get(cell).push(c);
  });
  const cityInCell = ({ lat, lon, cell }) => nearest(citiesByCell.get(cell) || [], lat, lon);
  const pointPlace = (p) => {
    const city = cityInCell(p);
    if (city) return cityPlace(city);
    const kind = data.land[p.cell] > 0.5 ? "Mostly land" : "Mostly ocean";
    return { name: coord(p.lat, p.lon), sub: `${kind} · ${cellSize(p.cell)}`, lat: p.lat, lon: p.lon, cell: p.cell };
  };

  /* Controls */
  function buildSegmented(rootId, name, items, onChange) {
    const root = document.getElementById(rootId);
    const wrap = node("div", "options");
    items.forEach((it, i) => {
      const label = node("label");
      const input = node("input");
      input.type = "radio";
      input.name = name;
      input.value = i;
      input.addEventListener("change", () => onChange(i));
      const span = node("span");
      span.append(document.createTextNode(it.text));
      if (it.small) span.append(node("small", "", it.small));
      label.append(input, span);
      wrap.append(label);
    });
    root.append(wrap);
    return (i) => {
      wrap.querySelectorAll("input")[i].checked = true;
    };
  }
  const checkLevel = buildSegmented(
    "level-control",
    "level",
    data.meta.levels.map((v) => ({ text: fmtLevel(v) })),
    (i) => setLevel(i)
  );
  const checkScenario = buildSegmented(
    "scenario-control",
    "scenario",
    SCENARIOS.map((s) => ({ text: s.label, small: s.code })),
    (i) => setScenario(i)
  );

  function setLevel(i) {
    state.level = i;
    checkLevel(i);
    renderField();
  }

  function setScenario(i) {
    state.scenario = i;
    checkScenario(i);
    renderField();
  }

  /* Map, timeline, place panel */
  const map = new ArrivalMap({
    wrap: document.getElementById("map-wrap"),
    canvas: document.getElementById("map-canvas"),
    svg: document.getElementById("map-svg"),
    data,
    onHover: (p, event) => {
      const a = data.placeArrival(state.scenario, state.level, p.cell);
      const city = cityInCell(p);
      const title = city ? `${city.n}, ${city.c}` : coord(p.lat, p.lon);
      showTooltip(event, (tip) => {
        tip.append(
          node("div", "tt-value", a.median === null ? "Not by 2090" : a.median),
          node("div", "tt-head", title),
          node(
            "div",
            "",
            a.nReached === 0
              ? `No model reaches ${fmtLevel(data.meta.levels[state.level])} and stays there`
              : a.earliest === a.latest
                ? `${a.nReached} of ${a.nModel} models arrive, in ${a.earliest}`
                : `${a.nReached} of ${a.nModel} models arrive, ${a.earliest}–${a.latest}`
          )
        );
        const phrase = agePhrase(a.median, state.birth);
        if (phrase) tip.append(node("div", "", phrase));
      });
    },
    onLeave: hideTooltip,
    onSelect: (p) => {
      setPlace(pointPlace(p), { pulse: false }); // the reader is already looking at the spot
    },
  });

  const timeline = new Timeline({
    wrap: document.getElementById("timeline"),
    svg: document.getElementById("timeline-svg"),
    slider: document.getElementById("year-slider"),
    onInput: (y) => {
      stopPlaying();
      setYear(y);
    },
  });

  const panel = new PlacePanel({
    data,
    onScenario: setScenario,
    onYear: jumpToYear,
  });

  // Two findings that hold at every level and scenario, so they stay true as controls change.
  map.setCallouts([
    { lon: 150, lat: 72, fx: 0.905, fy: 0.05, text: "The Arctic arrives first" },
    { lon: -35, lat: 52, fx: 0.383, fy: 0.25, text: "North Atlantic:\namong the last" },
  ]);

  /* Legend: hover or focus isolates a class on the map */
  const legend = d3.select("#legend");
  legend
    .selectAll("button")
    .data(BINS)
    .join("button")
    .attr("type", "button")
    .each(function (b, i) {
      const swatch = node("i");
      swatch.style.background = b.color;
      if (i === BINS.length - 1) swatch.style.boxShadow = "inset 0 0 0 1px #c3c2b7";
      this.append(swatch, node("span", "", b.label));
    })
    .on("pointerenter focus", (_, b) => {
      map.setIsolated(BINS.indexOf(b));
      swarm.setIsolated(BINS.indexOf(b));
    })
    .on("pointerleave blur", () => {
      map.setIsolated(null);
      swarm.setIsolated(null);
    });

  // One more legend entry, for the stripes drawn where the models split
  const stripeKey = node("div", "legend-stripes");
  stripeKey.title = "Between a third and two thirds of the models have it arriving by 2090; the rest do not.";
  stripeKey.append(node("i", "stripe-swatch"), node("span", "", "Stripes: models split"));
  document.getElementById("legend").append(stripeKey);

  /* The largest cities as a dot plot, linked to the map */
  const swarm = new CitySwarm({
    wrap: document.getElementById("swarm-wrap"),
    svg: document.getElementById("swarm-svg"),
    data,
    cities: data.cities.slice(0, N_CITIES).map((c) => ({ c, place: cityPlace(c) })),
    getBirth: () => state.birth,
    onHover: (n) => map.setLinked(n ? n.place : null),
    onSelect: (n) => setPlace(n.place),
    onYear: jumpToYear,
  });
  const citiesTitle = document.getElementById("cities-title");
  const citiesNote = document.getElementById("cities-note");

  /* Rendering */
  const titleLevel = document.getElementById("title-level");
  const subtitle = document.getElementById("subtitle");
  const reading = document.getElementById("reading");
  document.querySelectorAll(".n-models").forEach((el) => {
    el.textContent = data.nModel;
  });
  document.getElementById("method-models").textContent = data.meta.models.join(", ");

  // Gray means "not arrived by the selected year"; classes after that year fade.
  function renderLegend() {
    const last = BINS.length - 1;
    legend
      .selectAll("button")
      .style("opacity", (b, i) => (i < last && i > 0 && BINS[i - 1].max >= state.year ? 0.35 : 1))
      .filter((_, i) => i === last)
      .select("span")
      .text(`Not by ${state.year}`);
  }

  function renderReading() {
    renderLegend();
    const curves = data.areaCurves(state.scenario, state.level);
    const row = curves.find((d) => d.year === state.year);
    const lv = fmtLevel(data.meta.levels[state.level]);
    reading.replaceChildren(
      document.createTextNode("By "),
      node("strong", "", state.year),
      document.createTextNode(`, ${lv} has arrived across `),
      node("strong", "", `${Math.round(row.land * 100)}%`),
      document.createTextNode(" of Earth’s land and "),
      node("strong", "", `${Math.round(row.ocean * 100)}%`),
      document.createTextNode(" of its oceans.")
    );
  }

  function renderField() {
    const lv = fmtLevel(data.meta.levels[state.level]);
    const scen = SCENARIOS[state.scenario];
    titleLevel.textContent = lv;
    document.title = `When Does ${lv} Arrive?`;
    subtitle.textContent = `Color shows the year each place stays ${lv} warmer than it was in 1850–1900. Median of ${data.nModel} climate models, ${scen.label.toLowerCase()} emissions (${scen.code}).`;
    map.setField(data.medianArrival(state.scenario, state.level), data.splitStripes(state.scenario, state.level));
    timeline.update({
      curves: data.areaCurves(state.scenario, state.level),
      worldYear: data.worldArrival(state.scenario, state.level),
      year: state.year,
    });
    swarm.update({ level: state.level, scenario: state.scenario, year: state.year, selected: state.place });
    // The title says what the dots show for this level and scenario.
    const [high, , tropics] = swarm.rowMedians();
    const never = swarm.neverCount();
    if (never === N_CITIES) citiesTitle.textContent = `None of the ${N_CITIES} largest cities reaches ${lv} by ${data.lastYear}`;
    else if (never > N_CITIES / 2) citiesTitle.textContent = `${never} of the ${N_CITIES} largest cities do not reach ${lv} by ${data.lastYear}`;
    else if (high !== null && tropics !== null && tropics - high >= 3) citiesTitle.textContent = `High-latitude cities reach ${lv} about ${tropics - high} years before tropical cities`;
    else citiesTitle.textContent = `When ${lv} arrives in the world’s ${N_CITIES} largest cities`;
    citiesNote.textContent = "Each dot is a city, sized by population, at the year it arrives. Click a dot to see that city, or click between dots to jump to that year.";
    renderReading();
    renderPlace();
    renderTable();
  }

  function renderPlace() {
    if (!state.place) return;
    renderGuess();
    panel.update(state);
  }

  function setYear(y) {
    state.year = y;
    map.setYear(y);
    timeline.setYear(y);
    swarm.setYear(y);
    panel.drawYear();
    renderReading();
  }

  // A year clicked in a chart moves the timeline there, kept inside the slider's range.
  function jumpToYear(y) {
    const slider = document.getElementById("year-slider");
    stopPlaying();
    setYear(Math.max(+slider.min, Math.min(data.lastYear, y)));
  }

  function setPlace(place, { pulse = true } = {}) {
    state.place = place;
    map.setPlace(place);
    if (pulse) map.pulse();
    swarm.setSelected(place);
    renderPlace();
    renderTable();
    storyButtons.attr("aria-pressed", (d) => (d.place && d.place.name === place.name ? "true" : "false"));
  }

  /* Play */
  const playBtn = document.getElementById("play");
  const playIcon = document.getElementById("play-icon");
  let playTimer = null;
  function stopPlaying() {
    if (playTimer) playTimer.stop();
    playTimer = null;
    state.playing = false;
    playIcon.setAttribute("d", "M4 2.5v11l9-5.5z");
    playBtn.setAttribute("aria-label", "Play arrivals through time");
  }
  function startPlaying(until = data.lastYear) {
    const min = +document.getElementById("year-slider").min;
    const start = state.year >= until ? min : state.year;
    const span = data.lastYear - min; // the speed is the same whatever the end year
    state.playing = true;
    playIcon.setAttribute("d", "M4 2.5h3v11H4zM9 2.5h3v11H9z");
    playBtn.setAttribute("aria-label", "Pause");
    playTimer = d3.timer((elapsed) => {
      const y = Math.min(until, Math.round(start + (elapsed / 1000 / PLAY_SECONDS) * span));
      if (y !== state.year) setYear(y);
      if (y >= until) stopPlaying();
    });
  }
  playBtn.addEventListener("click", () => (state.playing ? stopPlaying() : startPlaying()));

  /* Guess first: the panel keeps its answer back until the reader commits to a guess or skips. */
  const guessBox = document.getElementById("guess");
  const guessQuestion = document.getElementById("guess-q");
  const guessYear = document.getElementById("guess-year");
  const guessOut = document.getElementById("guess-out");
  const guessReveal = document.getElementById("guess-reveal");
  const placeBody = document.getElementById("place-body");
  let guessOpen = true;
  const guessedYear = () => (+guessYear.value > data.lastYear ? null : +guessYear.value);
  function renderGuess() {
    if (!guessOpen) return;
    guessQuestion.replaceChildren(
      document.createTextNode("Before you look: when do you think "),
      node("strong", "", state.place.name),
      document.createTextNode(` reaches ${fmtLevel(data.meta.levels[state.level])}, under the ${SCENARIOS[state.scenario].label.toLowerCase()} emissions scenario?`)
    );
  }
  function closeGuess(keep) {
    if (!guessOpen) return;
    guessOpen = false;
    if (keep) {
      state.guess = { cell: state.place.cell, level: state.level, scenario: state.scenario, year: guessedYear() };
      // The headline number then rolls from the guess to the models' answer.
      if (state.guess.year !== null) document.getElementById("hero-year").textContent = state.guess.year;
    }
    guessBox.hidden = true;
    placeBody.hidden = false;
    renderPlace();
  }
  function openGuess() {
    guessOpen = true;
    state.guess = null;
    guessYear.value = guessYear.min;
    guessOut.textContent = "Drag to guess";
    guessOut.classList.add("empty");
    guessReveal.disabled = true;
    guessBox.hidden = false;
    placeBody.hidden = true;
  }
  guessYear.addEventListener("input", () => {
    const y = guessedYear();
    guessOut.textContent = y === null ? `Not by ${data.lastYear}` : y;
    guessOut.classList.remove("empty");
    guessReveal.disabled = false;
  });
  guessReveal.addEventListener("click", () => closeGuess(true));
  document.getElementById("guess-skip").addEventListener("click", () => closeGuess(false));

  /* Birth year: asked with the guess, and editable afterwards in the panel */
  const birthInputs = [document.getElementById("birth-year"), document.getElementById("guess-birth")];
  state.birth = parseBirthYear(birthInputs[0].value);
  birthInputs.forEach((input) =>
    input.addEventListener("input", () => {
      state.birth = parseBirthYear(input.value);
      birthInputs.forEach((other) => {
        if (other !== input) other.value = input.value;
      });
      renderPlace();
    })
  );

  /* Search */
  const seen = new Map();
  data.cities.forEach((c) => {
    const key = `${c.n}, ${c.c}`;
    if (!seen.has(key)) seen.set(key, c);
  });
  const search = document.getElementById("place-search");
  const suggest = document.getElementById("place-suggest");
  const MAX_SUGGEST = 8;
  // Accents are optional when searching: "Sao Paulo" finds "São Paulo".
  const fold = (t) => t.normalize("NFD").replace(/\p{M}/gu, "").toLowerCase();
  // Cities come largest first, so among equally good matches the bigger city leads.
  const searchIndex = [...seen.values()].map((c) => ({ c, name: fold(c.n), country: fold(c.c) }));
  function matchCities(q) {
    const key = fold(q.trim());
    if (!key) return [];
    const rank = (d) => {
      if (d.name.startsWith(key)) return 0;
      if (d.name.includes(` ${key}`) || d.name.includes(`-${key}`)) return 1;
      if (d.country.startsWith(key)) return 2;
      if (d.name.includes(key)) return 3;
      return -1;
    };
    return searchIndex
      .map((d) => ({ ...d, rank: rank(d) }))
      .filter((d) => d.rank >= 0)
      .sort((p, q2) => p.rank - q2.rank)
      .slice(0, MAX_SUGGEST)
      .map((d) => ({ ...d, at: d.rank === 2 ? -1 : d.name.indexOf(key), len: key.length }));
  }

  let hits = [];
  let active = -1;
  function closeSuggest() {
    suggest.hidden = true;
    search.setAttribute("aria-expanded", "false");
    search.removeAttribute("aria-activedescendant");
    active = -1;
  }
  function setActive(i) {
    active = i;
    suggest.querySelectorAll("[role=option]").forEach((li, j) => li.setAttribute("aria-selected", j === i ? "true" : "false"));
    if (i >= 0) search.setAttribute("aria-activedescendant", `place-opt-${i}`);
    else search.removeAttribute("aria-activedescendant");
  }
  function renderSuggest() {
    const q = search.value.trim();
    hits = matchCities(q);
    if (!q) return closeSuggest();
    if (!hits.length) {
      suggest.replaceChildren(node("li", "suggest-empty", `No city matches “${q}”. Try a nearby city, or click the map.`));
    } else {
      suggest.replaceChildren(
        ...hits.map((h, i) => {
          const li = node("li");
          li.id = `place-opt-${i}`;
          li.setAttribute("role", "option");
          // Bold the typed part of the name, when the match is in the name.
          const name = node("span", "suggest-name");
          if (h.at >= 0 && h.name.length === h.c.n.length) {
            name.append(
              document.createTextNode(h.c.n.slice(0, h.at)),
              node("strong", "", h.c.n.slice(h.at, h.at + h.len)),
              document.createTextNode(h.c.n.slice(h.at + h.len))
            );
          } else {
            name.textContent = h.c.n;
          }
          li.append(name, node("span", "suggest-sub", h.c.c));
          // pointerdown, not click, so the box does not lose focus and close first
          li.addEventListener("pointerdown", (e) => {
            e.preventDefault();
            pickCity(h.c);
          });
          li.addEventListener("pointerenter", () => setActive(i));
          return li;
        })
      );
    }
    suggest.hidden = false;
    search.setAttribute("aria-expanded", "true");
    setActive(-1); // nothing highlighted until the arrow keys; Enter takes the top match
  }
  function pickCity(c) {
    search.value = `${c.n}, ${c.c}`;
    closeSuggest();
    setPlace(cityPlace(c));
  }
  search.addEventListener("input", renderSuggest);
  search.addEventListener("focus", () => {
    if (search.value.trim()) renderSuggest();
  });
  search.addEventListener("blur", closeSuggest);
  search.addEventListener("keydown", (e) => {
    const open = !suggest.hidden;
    if (e.key === "ArrowDown" || e.key === "ArrowUp") {
      e.preventDefault();
      if (!open) renderSuggest();
      if (!hits.length) return;
      const step = e.key === "ArrowDown" ? 1 : -1;
      setActive((active + step + hits.length) % hits.length);
    } else if (e.key === "Enter") {
      e.preventDefault();
      if (!open) renderSuggest();
      if (hits.length) pickCity(hits[Math.max(active, 0)].c);
    } else if (e.key === "Escape" && open) {
      e.preventDefault();
      closeSuggest();
    }
  });

  /* Stories */
  const stories = STORIES.map((s) => {
    if (s.city) {
      const c = data.cities.find((d) => d.n === s.city);
      return { ...s, place: c ? cityPlace(c) : null };
    }
    return {
      ...s,
      place: { name: s.name, sub: `${s.sub} · ${cellSize(data.cellOf(s.lat, s.lon))}`, lat: s.lat, lon: s.lon, cell: data.cellOf(s.lat, s.lon) },
    };
  }).filter((s) => s.place);
  const storyButtons = d3
    .select("#story-list")
    .selectAll("button")
    .data(stories)
    .join("button")
    .attr("type", "button")
    .attr("aria-pressed", "false")
    .text((d) => d.name)
    .on("click", (_, d) => setPlace(d.place));

  /* Table twin of the map */
  const details = document.getElementById("table-details");
  const tbody = d3.select("#city-table tbody");
  const tableCities = data.cities.slice(0, N_CITIES);
  function renderTable() {
    const lv = fmtLevel(data.meta.levels[state.level]);
    document.getElementById("table-note").textContent = `The ${tableCities.length} largest cities in the dataset, earliest first, for ${lv} under ${SCENARIOS[state.scenario].code}. Select a row to show that place in the chart.`;
    const rows = tableCities.map((c) => {
      const cell = data.cellOf(c.lat, c.lon);
      return { c, a: data.placeArrival(state.scenario, state.level, cell) };
    });
    rows.sort((p, q) => (p.a.median ?? 9999) - (q.a.median ?? 9999) || p.c.n.localeCompare(q.c.n));
    tbody
      .selectAll("tr")
      .data(rows, (d) => `${d.c.n}|${d.c.c}`)
      .join((enter) => {
        const tr = enter.append("tr").attr("tabindex", 0);
        tr.append("td").attr("class", "t-name");
        tr.append("td").attr("class", "num t-med");
        tr.append("td").attr("class", "num t-range");
        tr.append("td").attr("class", "num t-count");
        return tr;
      })
      .classed("selected", (d) => state.place && state.place.name === d.c.n)
      .on("click", (_, d) => setPlace(cityPlace(d.c)))
      .on("keydown", (e, d) => {
        if (e.key === "Enter" || e.key === " ") {
          e.preventDefault();
          setPlace(cityPlace(d.c));
        }
      })
      .each(function (d) {
        const tr = d3.select(this);
        tr.select(".t-name").text(`${d.c.n}, ${d.c.c}`);
        tr.select(".t-med").text(d.a.median ?? "Not by 2090");
        tr.select(".t-range").text(d.a.nReached ? (d.a.earliest === d.a.latest ? d.a.earliest : `${d.a.earliest}–${d.a.latest}`) : "–");
        tr.select(".t-count").text(`${d.a.nReached} of ${d.a.nModel}`);
      })
      .order();
  }

  /* First view */
  checkLevel(state.level);
  checkScenario(state.scenario);
  const home = stories.find((s) => s.name === "San Diego") || stories[0];
  state.place = home.place;
  map.setPlace(home.place);
  storyButtons.attr("aria-pressed", (d) => (d === home ? "true" : "false"));
  renderField();
  guessBox.hidden = false; // the opening question appears once there is data behind it

  /* Guided tour */
  const arctic = stories.find((s) => s.name === "Svalbard");
  const atlantic = stories.find((s) => s.name === "N. Atlantic");
  let tour = null;
  if (arctic && atlantic) {
    tour = createTour({
      data,
      places: { arctic: arctic.place, atlantic: atlantic.place },
      api: {
        setLevel,
        setScenario,
        setPlace,
        stopPlaying,
        setYear: (y) => {
          stopPlaying();
          setYear(y);
        },
        playRange: (from, to) => {
          stopPlaying();
          setYear(from);
          startPlaying(to);
        },
        cityMedians: () => swarm.rowMedians(),
        closeGuess: () => closeGuess(false),
      },
    });
  }

  /* Reset: back to the first view, including the opening guess and the birth year. */
  const start = { level: state.level, scenario: state.scenario };
  document.getElementById("reset-view").addEventListener("click", () => {
    tour?.end();
    stopPlaying();
    search.value = "";
    closeSuggest();
    openGuess();
    birthInputs.forEach((input) => {
      input.value = input.defaultValue;
    });
    state.birth = parseBirthYear(birthInputs[0].value);
    state.level = start.level;
    state.scenario = start.scenario;
    checkLevel(start.level);
    checkScenario(start.scenario);
    setYear(data.lastYear);
    renderField();
    setPlace(home.place);
  });

  // Small hook used by the automated browser checks and the demo recording.
  window.viz = {
    skipGuess: () => closeGuess(false),
    state,
    data,
    map,
    binOf,
    setYear: (y) => {
      stopPlaying();
      setYear(y);
    },
  };
}

init().catch((err) => {
  console.error(err);
  const reading = document.getElementById("reading");
  reading.textContent = `The data could not be loaded (${err.message}). This page must be served over http, for example from GitHub Pages.`;
});
