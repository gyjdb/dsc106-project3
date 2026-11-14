// A short guided tour. Each step puts the page in a state and says what to look at.
// The numbers in the texts are read from the data, so they stay true if the data is rebuilt.

export function createTour({ data, api, places }) {
  const bar = document.getElementById("tour");
  const startBtn = document.getElementById("tour-start");
  const count = document.getElementById("tour-count");
  const title = document.getElementById("tour-title");
  const body = document.getElementById("tour-body");
  const back = document.getElementById("tour-back");
  const next = document.getElementById("tour-next");
  const close = document.getElementById("tour-close");

  const level = data.meta.levels.indexOf(2);
  const LOW = 0;
  const MIDDLE = 1;
  const lv = "+2 °C";
  const last = data.lastYear;
  const pct = (x) => `${Math.round(x * 100)}%`;
  const sharesAt = (scenario, year) => data.areaCurves(scenario, level).find((d) => d.year === year);
  const reducedMotion = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
  const scrollTo = (selector, block) => document.querySelector(selector).scrollIntoView({ block, behavior: reducedMotion ? "auto" : "smooth" });
  const showMap = () => scrollTo(".map-col", "nearest");

  const steps = [
    {
      title: "Where does it show up first?",
      body: () => "Watch 2000 to 2050 play out. The land fills in, while most of the ocean stays gray.",
      apply: () => {
        api.setLevel(level);
        api.setScenario(MIDDLE);
        if (reducedMotion) api.setYear(2050);
        else api.playRange(2000, 2050);
        showMap();
      },
    },
    {
      title: "Is everywhere warming at the same speed?",
      body: () => {
        const a = data.placeArrival(MIDDLE, level, places.arctic.cell);
        const world = data.worldArrival(MIDDLE, level);
        const dots = "Each dot on the right is one model’s answer.";
        if (a.median === null) return `No. Svalbard warms far faster than the world average. ${dots}`;
        if (world === null || world <= a.median) return `No. Svalbard reached ${lv} in ${a.median}. ${dots}`;
        return `No. Svalbard reached ${lv} in ${a.median}, ${world - a.median} years before the world average. ${dots}`;
      },
      apply: () => {
        api.setLevel(level);
        api.setScenario(MIDDLE);
        api.setYear(last);
        api.setPlace(places.arctic);
        showMap();
      },
    },
    {
      title: `Does every place get there by ${last}?`,
      body: () => {
        const a = data.placeArrival(MIDDLE, level, places.atlantic.cell);
        if (a.nReached === a.nModel) return "Yes, but south of Greenland the ocean warms far more slowly than the land around it.";
        return `Not this one. South of Greenland, only ${a.nReached} of ${a.nModel} models get there. Stripes mark places where the models disagree.`;
      },
      apply: () => {
        api.setLevel(level);
        api.setScenario(MIDDLE);
        api.setYear(last);
        api.setPlace(places.atlantic);
        showMap();
      },
    },
    {
      title: "Can we still change this?",
      body: () => {
        const low = sharesAt(LOW, last);
        const mid = sharesAt(MIDDLE, last);
        return `Yes. With low emissions, ${lv} reaches ${pct(low.ocean)} of the ocean by ${last}, not ${pct(mid.ocean)}.`;
      },
      apply: () => {
        api.setLevel(level);
        api.setScenario(LOW);
        api.setYear(last);
        showMap();
      },
    },
    {
      title: "Which cities feel it first?",
      body: () => {
        const [high, , tropics] = api.cityMedians();
        const intro = "Here are the 300 biggest cities.";
        if (high === null || tropics === null) return intro;
        return `${intro} High-latitude cities reach ${lv} around ${high}, tropical cities around ${tropics}.`;
      },
      apply: () => {
        api.setLevel(level);
        api.setScenario(MIDDLE);
        api.setYear(last);
        scrollTo(".cities", "center");
      },
    },
    {
      title: "So when does it reach you?",
      body: () => "Search for your city or click the map. Add your birth year to see how old you’ll be.",
      apply: () => {
        api.setLevel(level);
        api.setScenario(MIDDLE);
        api.setYear(last);
        scrollTo(".masthead", "start");
      },
    },
  ];

  let current = -1;

  function show(i) {
    current = i;
    const step = steps[i];
    step.apply();
    count.textContent = `${i + 1} of ${steps.length}`;
    title.textContent = step.title;
    body.textContent = step.body();
    back.disabled = i === 0;
    next.textContent = i === steps.length - 1 ? "Done" : "Next";
    bar.hidden = false;
    startBtn.hidden = true;
  }

  function end() {
    api.stopPlaying();
    current = -1;
    bar.hidden = true;
    startBtn.hidden = false;
  }

  startBtn.addEventListener("click", () => {
    api.closeGuess(); // the tour needs the place panel open
    show(0);
    next.focus({ preventScroll: true });
  });
  back.addEventListener("click", () => show(current - 1));
  next.addEventListener("click", () => {
    if (current === steps.length - 1) {
      end();
      startBtn.focus({ preventScroll: true });
    } else {
      show(current + 1);
    }
  });
  close.addEventListener("click", () => {
    end();
    startBtn.focus({ preventScroll: true });
  });

  startBtn.hidden = false;
  return { show, end, steps: steps.length };
}
