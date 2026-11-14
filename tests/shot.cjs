// Saves a screenshot of the page in a given state.
// Run: node tests/shot.cjs OUT.png [width height scale] [js expression to run first]
const playwright = require("playwright");
(async () => {
  const [out, w = "1440", h = "810", scale = "1.3333", expr = ""] = process.argv.slice(2);
  const browser = await playwright[process.env.BROWSER || "chromium"].launch();
  const page = await browser.newPage({ viewport: { width: +w, height: +h }, deviceScaleFactor: +scale });
  await page.goto(process.env.BASE || "http://localhost:8123/");
  await page.waitForFunction(() => window.viz);
  if (expr) await page.evaluate(expr);
  await page.waitForTimeout(500);
  await page.screenshot({ path: out, fullPage: process.env.FULL === "1" });
  await browser.close();
})();
