/**
 * VISUAL QA — the eight views.
 *
 * Photographs a circuit from the fixed positions the brief names — START, TURN 1, LANDMARK 1,
 * MIDDLE, SHORTCUT, HERO, FINAL TURN, FINISH — plus an overview, a hero wide, a gate and a tunnel view,
 * without HUD, and writes the frame's measured cost beside them. It drives the running dev server
 * through the runtime's QA hook (`window.__printRushQA`, enabled by the `print-rush.debug` flag).
 *
 * Usage (dev server on :3000):
 *
 *   node tools/visualqa/shots.mjs <trackId> <THEME> <outDir> [quality]
 *   node tools/visualqa/shots.mjs ink-print-factory PRINT_FACTORY output/visualqa/factory HIGH
 *
 * Playwright is resolved from `PLAYWRIGHT_MODULE` (a path to the package's `index.mjs`) or from an
 * ordinary `playwright` install; the browser from `CHROMIUM_PATH` or Playwright's own. In a headless
 * environment without a GPU, SwiftShader renders the WebGL scene: slow, but the pixels are real.
 */
import { mkdirSync, writeFileSync } from "node:fs";
import { pathToFileURL } from "node:url";

const [trackId = "ink-print-factory", theme = "PRINT_FACTORY", outDir = "output/visualqa", quality = "HIGH"] = process.argv.slice(2);
const baseUrl = process.env.QA_BASE_URL ?? "http://localhost:3000/";

const playwrightModule = process.env.PLAYWRIGHT_MODULE
  ? pathToFileURL(process.env.PLAYWRIGHT_MODULE).href
  : "playwright";
const { chromium } = await import(playwrightModule);

mkdirSync(outDir, { recursive: true });
const launch = {
  headless: true,
  args: ["--use-gl=angle", "--use-angle=swiftshader", "--enable-unsafe-swiftshader", "--ignore-gpu-blocklist", "--enable-webgl", "--mute-audio"],
};
if (process.env.CHROMIUM_PATH) launch.executablePath = process.env.CHROMIUM_PATH;
const browser = await chromium.launch(launch);
const page = await browser.newPage({ viewport: { width: 1600, height: 900 } });
const errors = [];
page.on("console", (message) => { if (message.type() === "error") errors.push(message.text().slice(0, 300)); });
page.on("pageerror", (error) => errors.push(`pageerror ${String(error).slice(0, 300)}`));

await page.addInitScript(({ trackId, theme, quality }) => {
  localStorage.setItem("print-rush.active-track.v5", JSON.stringify({ id: trackId, theme, seed: 1, name: trackId }));
  localStorage.setItem("print-rush.controls-seen.v1", "true");
  localStorage.setItem("print-rush.quality.v3", quality);
  localStorage.setItem("print-rush.debug", "1");
  localStorage.setItem("print-rush.settings.v1", JSON.stringify({ nickname: "QA", laps: 3, muted: true }));
}, { trackId, theme, quality });

await page.goto(baseUrl, { waitUntil: "networkidle", timeout: 120_000 });
await page.getByRole("button", { name: /jugar/i }).first().click({ timeout: 20_000 });
await page.getByRole("button", { name: /parrilla/i }).first().click({ timeout: 20_000 });
await page.waitForFunction(() => Boolean(window.__printRushQA), null, { timeout: 120_000 });
await page.waitForTimeout(1500);
// HUD-less frames, as the brief asks: everything but the canvas is hidden.
await page.addStyleTag({ content: "body *:not(canvas):not(:has(canvas)) { visibility: hidden !important; } canvas { visibility: visible !important; } nextjs-portal { display: none !important; }" });

const info = await page.evaluate(() => window.__printRushQA.track());
writeFileSync(`${outDir}/track.json`, JSON.stringify(info, null, 2));
const hero = info.landmarks.find((landmark) => /CARRUSEL|ESCENARIO|ROBOT|MONITOR|PARED/.test(landmark.label)) ?? info.landmarks[2] ?? { progress: 0.5 };
const first = info.landmarks[0] ?? { progress: 0.1 };

const shots = [
  { name: "01-start", progress: 0.002, back: 12, height: 4.2 },
  { name: "02-turn1", progress: 0.14, back: 10, height: 3.6 },
  { name: "03-landmark1", progress: first.progress - 0.02, back: 10, height: 3.8, aimLateral: 10 },
  { name: "04-middle", progress: 0.5, back: 10, height: 3.6 },
  { name: "05-shortcut", progress: (info.shortcuts[0]?.from ?? 0.3) - 0.01, back: 10, height: 3.6 },
  { name: "06-hero", progress: hero.progress - 0.035, back: 12, height: 4.4, lookAhead: 34 },
  { name: "06b-hero-aim", progress: hero.progress - 0.02, back: 10, height: 4, lookAhead: 30, aimLateral: 34, aimHeight: 8 },
  { name: "07-finalturn", progress: 0.93, back: 10, height: 3.6 },
  { name: "08-finish", progress: 0.985, back: 14, height: 4 },
  { name: "09-overview", progress: 0.06, back: 46, height: 21, lookAhead: 110, aimHeight: 0, fov: 1.25 },
  { name: "10-hero-wide", progress: hero.progress - 0.06, back: 30, height: 12, lookAhead: 70, aimHeight: 4, fov: 1.2 },
  { name: "11-tunnel", progress: 0.68, back: 8, height: 3.2, lookAhead: 30 },
  { name: "12-gate", progress: 0.185, back: 10, height: 3.6, lookAhead: 30 },
];
for (const shot of shots) {
  await page.evaluate((options) => window.__printRushQA.photo(options.progress, options), shot);
  await page.waitForTimeout(700);
  await page.screenshot({ path: `${outDir}/${shot.name}.png` });
}

const stats = await page.evaluate(() => window.__printRushQA.stats());
writeFileSync(`${outDir}/stats.json`, JSON.stringify({ trackId, theme, quality, stats, errors }, null, 2));
console.log("landmarks", JSON.stringify(info.landmarks));
console.log("stats", JSON.stringify(stats));
console.log("errors", JSON.stringify(errors.slice(0, 8)));
await browser.close();
