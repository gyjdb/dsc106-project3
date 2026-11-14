// Turns an arrival year into a statement about the reader's own age.
export const TODAY = 2026;

/** A birth year typed by the reader, or null if it is missing or not plausible. */
export function parseBirthYear(text) {
  const v = Number(String(text).trim());
  return Number.isInteger(v) && v >= 1900 && v <= TODAY ? v : null;
}

const years = (n) => `${n} year${n === 1 ? "" : "s"}`;

/** Short phrase for tooltips, or null when there is nothing to say. */
export function agePhrase(year, birth) {
  if (!birth || year === null) return null;
  const age = year - birth;
  if (age < 0) return `${years(-age)} before you were born`;
  if (age === 0) return "The year you were born";
  return year <= TODAY ? `You were ${age}` : `You would be ${age}`;
}

/** Sentences for the place panel, as [text, strong] pairs. */
export function lifetimeParts(year, birth, lastYear, earliest = null, latest = null) {
  if (!birth) return [["Enter your birth year to see how old you would be.", false]];
  if (year === null) {
    return [[`By ${lastYear} you would be `, false], [String(lastYear - birth), true], [", and it would still not be here.", false]];
  }
  const parts = [];
  const age = year - birth;
  if (age < 0) parts.push(["It arrived ", false], [`${years(-age)} before you were born`, true], [".", false]);
  else if (age === 0) parts.push(["It arrived ", false], ["the year you were born", true], [".", false]);
  else if (year <= TODAY) parts.push(["You were ", false], [String(age), true], [" when it arrived.", false]);
  else {
    parts.push(["You would be ", false], [String(age), true], [".", false]);
    // A single age is as uncertain as the single year behind it, so give the range too.
    if (earliest !== null && latest !== null && latest > earliest && earliest >= birth) {
      parts.push([` Across the models: ${earliest - birth} to ${latest - birth}.`, false]);
    }
  }
  // A second generation, as in the IPCC AR6 Synthesis Report's Figure SPM.1.
  if (TODAY - birth >= 10) {
    if (year > TODAY) parts.push([" A child born today would be ", false], [String(year - TODAY), true], [".", false]);
    else parts.push([" For a child born today, it was already here.", false]);
  }
  return parts;
}
