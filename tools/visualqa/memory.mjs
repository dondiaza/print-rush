/** Rebuilds and disposes a race repeatedly, recording browser heap and leaked runtime surfaces. */
import { mkdirSync, writeFileSync } from "node:fs";
import { pathToFileURL } from "node:url";

const [outDir = "output/visualqa/memory"] = process.argv.slice(2);
const cycles = Number(process.env.QA_CYCLES ?? 10);
const baseUrl = process.env.QA_BASE_URL ?? "http://localhost:3000/";
const playwrightModule = process.env.PLAYWRIGHT_MODULE
  ? pathToFileURL(process.env.PLAYWRIGHT_MODULE).href
  : "playwright";
const { chromium } = await import(playwrightModule);

mkdirSync(outDir, { recursive: true });
const launch = {
  headless: true,
  args: [
    "--use-gl=angle", "--use-angle=swiftshader", "--enable-unsafe-swiftshader", "--ignore-gpu-blocklist", "--enable-webgl", "--mute-audio",
    "--enable-precise-memory-info", "--js-flags=--expose-gc",
  ],
};
if (process.env.CHROMIUM_PATH) launch.executablePath = process.env.CHROMIUM_PATH;
const browser = await chromium.launch(launch);
const page = await browser.newPage({ viewport: { width: 1024, height: 640 } });
const errors = [];
page.on("console", (message) => { if (message.type() === "error") errors.push(message.text().slice(0, 300)); });
page.on("pageerror", (error) => errors.push(`pageerror ${String(error).slice(0, 300)}`));
await page.addInitScript(() => {
  localStorage.setItem("print-rush.active-track.v5", JSON.stringify({ id: "tshirt-megastore", theme: "FLAGSHIP", seed: 1, name: "T-Shirt Megastore" }));
  localStorage.setItem("print-rush.controls-seen.v1", "true");
  localStorage.setItem("print-rush.quality.v3", "LOW");
  localStorage.setItem("print-rush.debug", "1");
  localStorage.setItem("print-rush.settings.v1", JSON.stringify({ nickname: "QA", laps: 3, muted: true }));
});
await page.goto(baseUrl, { waitUntil: "networkidle", timeout: 120_000 });
// The home hero is intentionally a live Babylon canvas. Disposal is clean when the app returns to
// this baseline count, not to zero.
const baselineCanvases = await page.locator("canvas").count();

const samples = [];
for (let cycle = 1; cycle <= cycles; cycle += 1) {
  await page.getByRole("button", { name: /jugar/i }).first().click({ timeout: 20_000 });
  await page.getByRole("button", { name: /parrilla/i }).first().click({ timeout: 20_000 });
  await page.waitForFunction(() => Boolean(window.__printRushQA), null, { timeout: 120_000 });
  const live = await page.evaluate(() => ({
    heap: performance.memory?.usedJSHeapSize ?? null,
    stats: window.__printRushQA.stats(),
    canvases: document.querySelectorAll("canvas").length,
  }));
  await page.keyboard.press("Escape");
  await page.getByRole("button", { name: /salir de la carrera/i }).click({ timeout: 10_000 });
  await page.getByRole("button", { name: /jugar/i }).first().waitFor({ state: "visible", timeout: 20_000 });
  await page.evaluate(() => window.gc?.());
  await page.waitForTimeout(250);
  const disposed = await page.evaluate(() => ({
    heap: performance.memory?.usedJSHeapSize ?? null,
    qaHookPresent: Boolean(window.__printRushQA),
    canvases: document.querySelectorAll("canvas").length,
  }));
  samples.push({ cycle, live, disposed });
  console.log(`cycle ${cycle}/${cycles}`, JSON.stringify(disposed));
}

const heaps = samples.map((sample) => sample.disposed.heap).filter((value) => typeof value === "number");
const first = heaps[0] ?? null;
const last = heaps.at(-1) ?? null;
const median = (values) => {
  const sorted = [...values].sort((a, b) => a - b);
  return sorted[Math.floor(sorted.length / 2)] ?? null;
};
const windowSize = Math.min(3, heaps.length);
const firstMedian = median(heaps.slice(0, windowSize));
const lastMedian = median(heaps.slice(-windowSize));
const medianGrowthRatio = firstMedian && lastMedian ? (lastMedian - firstMedian) / firstMedian : null;
const report = {
  cycles,
  errors,
  hookClean: samples.every((sample) => !sample.disposed.qaHookPresent),
  baselineCanvases,
  canvasClean: samples.every((sample) => sample.disposed.canvases === baselineCanvases),
  stable: samples.every((sample) => !sample.disposed.qaHookPresent && sample.disposed.canvases === baselineCanvases)
    && errors.length === 0
    && (medianGrowthRatio === null || medianGrowthRatio < 0.1),
  heap: {
    first,
    last,
    growthRatio: first && last ? (last - first) / first : null,
    firstMedian,
    lastMedian,
    medianGrowthRatio,
  },
  samples,
};
writeFileSync(`${outDir}/report.json`, JSON.stringify(report, null, 2));
console.log("report", JSON.stringify({ cycles, errors, hookClean: report.hookClean, canvasClean: report.canvasClean, stable: report.stable, heap: report.heap }));
await browser.close();
