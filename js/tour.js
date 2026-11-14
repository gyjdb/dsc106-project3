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

  const steps = [
    {
      title: "Land first.",
      body: () => "Watch the timeline run to 2050. The continents fill in while most of the ocean stays gray.",
      apply: () => {
        api.setLevel(level);
        api.setScenario(MIDDLE);
        if (reducedMotion) api.setYear(2050);
        else api.playRange(2000, 2050);
      },
    },
    {
      title: "The Arctic is decades ahead.",
      body: () => {
        const a = data.placeArrival(MIDDLE, level, places.arctic.cell);
        const world = data.worldArrival(MIDDLE, level);
        const dots = "Each dot on the right is one climate model’s answer.";
        if (a.median === null) return `Svalbard warms far faster than the world average. ${dots}`;
        if (world === null || world <= a.median) return `Svalbard reached ${lv} in ${a.median}. ${dots}`;
        return `Svalbard reached ${lv} in ${a.median}, ${world - a.median} years before the world average. ${dots}`;
      },
      apply: () => {
        api.setLevel(level);
        api.setScenario(MIDDLE);
        api.setYear(last);
        api.setPlace(places.arctic);
      },
    },
    {
      title: `A few places may not arrive by ${last}.`,
      body: () => {
        const a = data.placeArrival(MIDDLE, level, places.atlantic.cell);
        if (a.nReached === a.nModel) return "South of Greenland, the ocean warms far more slowly than the land around it.";
        return `South of Greenland, only ${a.nReached} of ${a.nModel} models reach ${lv} and stay there by ${last}.`;
      },
      apply: () => {
        api.setLevel(level);
        api.setScenario(MIDDLE);
        api.setYear(last);
        api.setPlace(places.atlantic);
      },
    },
    {
      title: "Emissions decide how far it spreads.",
      body: () => {
        const low = sharesAt(LOW, last);
        const mid = sharesAt(MIDDLE, last);
        return `Under the low scenario, ${lv} reaches ${pct(low.ocean)} of the ocean by ${last}, compared with ${pct(mid.ocean)} under the middle one.`;
      },
      apply: () => {
        api.setLevel(level);
        api.setScenario(LOW);
        api.setYear(last);
      },
    },
    {
      title: "Now find your own place.",
      body: () => "Search for a city or click anywhere on the map, and enter your birth year to see how old you would be.",
      apply: () => {
        api.setLevel(level);
        api.setScenario(MIDDLE);
        api.setYear(last);
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
    show(0);
    next.focus({ preventScroll: true });
    // The tour bar pushes the map down, so bring the timeline back into view if it left.
    document.querySelector(".timeline-row").scrollIntoView({ block: "nearest", behavior: reducedMotion ? "auto" : "smooth" });
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
