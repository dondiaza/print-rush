/**
 * End-to-end visual smoke test for the player-facing shell.
 *
 * Captures home, briefing, a live measured loading state, race HUD and pause. Environment variables
 * QA_VIEWPORT_WIDTH/HEIGHT, QA_TOUCH and QA_MOBILE make the same script exercise a phone landscape.
 */
import { mkdirSync, writeFileSync } from "node:fs";
import { pathToFileURL } from "node:url";

const [outDir = "output/visualqa/flow-desktop", trackId = "tshirt-megastore", theme = "FLAGSHIP"] = process.argv.slice(2);
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
const page = await browser.newPage({
  viewport: {
    width: Number(process.env.QA_VIEWPORT_WIDTH ?? 1440),
    height: Number(process.env.QA_VIEWPORT_HEIGHT ?? 900),
  },
  hasTouch: process.env.QA_TOUCH === "1",
  isMobile: process.env.QA_MOBILE === "1",
});
const errors = [];
page.on("console", (message) => { if (message.type() === "error") errors.push(message.text().slice(0, 300)); });
page.on("pageerror", (error) => errors.push(`pageerror ${String(error).slice(0, 300)}`));

await page.addInitScript(({ trackId, theme }) => {
  localStorage.setItem("print-rush.active-track.v5", JSON.stringify({ id: trackId, theme, seed: 1, name: trackId }));
  localStorage.setItem("print-rush.controls-seen.v1", "true");
  localStorage.setItem("print-rush.quality.v3", "HIGH");
  localStorage.setItem("print-rush.settings.v1", JSON.stringify({ nickname: "QA", laps: 3, muted: true }));
}, { trackId, theme });

await page.goto(baseUrl, { waitUntil: "networkidle", timeout: 120_000 });
await page.screenshot({ path: `${outDir}/01-home.png` });
await page.getByRole("button", { name: /jugar/i }).first().click({ timeout: 20_000 });
await page.screenshot({ path: `${outDir}/02-briefing.png` });
await page.getByRole("button", { name: /parrilla/i }).first().click({ timeout: 20_000 });
const loader = page.locator(".race-loading");
await loader.waitFor({ state: "visible", timeout: 20_000 });
await page.waitForTimeout(450);
const loadingValue = await page.getByRole("progressbar").getAttribute("aria-valuenow");
await page.screenshot({ path: `${outDir}/03-loading.png` });
await loader.waitFor({ state: "hidden", timeout: 120_000 });
await page.locator(".hud").waitFor({ state: "visible", timeout: 20_000 });
await page.waitForTimeout(1100);
await page.screenshot({ path: `${outDir}/04-race.png` });
await page.keyboard.press("Escape");
await page.getByRole("heading", { name: "PAUSA" }).waitFor({ state: "visible", timeout: 10_000 });
await page.screenshot({ path: `${outDir}/05-pause.png` });

const report = await page.evaluate(() => {
  const touch = document.querySelector(".mobile-controls");
  const orientation = document.querySelector(".orientation-overlay");
  const canvas = document.querySelector("canvas");
  return {
    viewport: { width: innerWidth, height: innerHeight, devicePixelRatio },
    noHorizontalOverflow: document.documentElement.scrollWidth <= innerWidth,
    touchControlsVisible: touch ? getComputedStyle(touch).display !== "none" : false,
    orientationOverlayVisible: orientation ? getComputedStyle(orientation).display !== "none" : false,
    canvas: canvas ? { clientWidth: canvas.clientWidth, clientHeight: canvas.clientHeight, width: canvas.width, height: canvas.height } : null,
    readyLabel: document.querySelector(".connection-note")?.textContent ?? null,
  };
});
writeFileSync(`${outDir}/report.json`, JSON.stringify({ loadingValue: Number(loadingValue), errors, ...report }, null, 2));
console.log(JSON.stringify({ loadingValue: Number(loadingValue), errors, ...report }));
await browser.close();
