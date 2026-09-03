import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

/**
 * COLOUR CONTRAST.
 *
 * This exists because a contrast failure is invisible to every other check in the project. It
 * typechecks, it lints, it renders, it looks deliberate — and a player reports that they cannot read
 * the button. Four rules were failing when this was written, and the worst of them was the primary
 * action on every screen: `#fff` on `--pink` measures 3.25:1, and 2.45:1 on hover, because the hover
 * state lightens the pink. White is the wrong instinct on a colour whose relative luminance is 0.27.
 *
 * The measurement is WCAG 2.1's: relative luminance with the sRGB transfer curve, `(L1+0.05) /
 * (L2+0.05)`. 4.5:1 is the threshold for body text, and it is the one asserted here rather than the
 * 3:1 large-text allowance, because a button's label is 9–12 px in this interface and only the hero
 * variant is large.
 *
 * What it cannot do is resolve the cascade. A rule that sets a background and no colour inherits one,
 * and this assumes that inherited colour is `body`'s `--paper` — true for most of the interface and
 * wrong for the handful of elements listed in `NO_TEXT`, which either contain no text at all or take
 * a colour from a base rule this parser does not follow. Each of those is named with its reason,
 * because an unexplained allowlist is how a real failure gets hidden.
 */

const TOKENS: Record<string, string> = {
  "--ink": "#0b0b0f",
  "--paper": "#f7f2e8",
  "--pink": "#ff3da6",
  "--acid": "#b9ff45",
  "--blue": "#4db7ff",
  "--surface-0": "#0b0b0f",
  "--surface-1": "#14131b",
  "--surface-2": "#1d1b26",
  "--text-dim": "rgba(247,242,232,0.58)",
  "--text-faint": "rgba(247,242,232,0.36)",
};

/**
 * Selectors excluded from the text-contrast assertion, each with the reason it carries no text.
 *
 * Deliberately exact selector strings rather than patterns: a pattern would quietly swallow a future
 * rule that does have text in it.
 */
const NO_TEXT: Record<string, string> = {
  ".build-tag i": "a status dot",
  ".studio-status span": "a status dot",
  ".studio-status.warning span": "a status dot",
  ".drift-fill": "the drift meter's fill bar",
  // `.drift-reserve` is not listed: it lives in `RaceExperience`'s inline <style> block, which
  // this parser does not read. The allowlist check above caught it as stale on the first run,
  // which is the behaviour that keeps this file honest.
  ".touch-stick__knob": "the thumbstick's knob",
  ".guide-line": "a framing guide line in the crop editor",
  ".asset-glyph.character": "takes `color` from `.asset-glyph`, which sets #08080c",
  ".asset-glyph.kart": "takes `color` from `.asset-glyph`, which sets #08080c",
  ".asset-glyph.prop": "takes `color` from `.asset-glyph`, which sets #08080c",
  ".asset-glyph.track": "takes `color` from `.asset-glyph`, which sets #08080c",
};

type Rgb = [number, number, number];

/** The page's ground, which every translucent surface in these sheets is composited over. */
const GROUND: Rgb = [11, 11, 15];

function resolve(raw: string): Rgb | null {
  const value = raw.trim().replace(/;$/, "").trim();

  const token = /^var\((--[\w-]+)\)$/.exec(value);
  if (token) {
    const mapped = TOKENS[token[1]!];
    return mapped ? resolve(mapped) : null;
  }

  const long = /^#([0-9a-fA-F]{6})$/.exec(value);
  if (long) {
    const hex = long[1]!;
    return [0, 2, 4].map((offset) => Number.parseInt(hex.slice(offset, offset + 2), 16)) as Rgb;
  }

  const short = /^#([0-9a-fA-F]{3})$/.exec(value);
  if (short) {
    return [...short[1]!].map((char) => Number.parseInt(char + char, 16)) as Rgb;
  }

  /**
   * A gradient's first colour stop.
   *
   * `var(--x)` has to be matched as a unit. An earlier version of this used `[^,)]+`, whose capture
   * stops at the closing paren of `var(`, so every gradient built from a token resolved to nothing —
   * and the tool reported the broken primary button as fine. A silent parse failure in an auditor is
   * worse than no auditor.
   */
  const gradient = /linear-gradient\([^,]+,\s*(var\(--[\w-]+\)|#[0-9a-fA-F]{3,8}|rgba?\([^)]*\))/.exec(value);
  if (gradient) return resolve(gradient[1]!);

  const rgba = /^rgba?\((\d+)[,\s]+(\d+)[,\s]+(\d+)(?:[,\s/]+([\d.]+))?\)$/.exec(value);
  if (rgba) {
    const channels = [1, 2, 3].map((group) => Number(rgba[group])) as Rgb;
    const alpha = rgba[4] === undefined ? 1 : Number(rgba[4]);
    if (alpha >= 1) return channels;
    return channels.map((channel, index) => Math.round(channel * alpha + GROUND[index]! * (1 - alpha))) as Rgb;
  }

  // `transparent`, `none`, `currentColor`, an image — nothing this can reason about.
  return null;
}

function luminance([r, g, b]: Rgb): number {
  const linear = (value: number): number => {
    const channel = value / 255;
    return channel <= 0.03928 ? channel / 12.92 : ((channel + 0.055) / 1.055) ** 2.4;
  };
  return 0.2126 * linear(r) + 0.7152 * linear(g) + 0.0722 * linear(b);
}

function contrast(a: Rgb, b: Rgb): number {
  const first = luminance(a);
  const second = luminance(b);
  return (Math.max(first, second) + 0.05) / (Math.min(first, second) + 0.05);
}

type Pair = { selector: string; file: string; ratio: number; inherited: boolean };

function pairsIn(file: string): Pair[] {
  const css = readFileSync(join(__dirname, "..", "app", file), "utf8").replace(/\/\*[\s\S]*?\*\//g, "");
  const pairs: Pair[] = [];
  const rule = /([^{}]+)\{([^{}]*)\}/g;

  for (let match = rule.exec(css); match !== null; match = rule.exec(css)) {
    const selector = match[1]!.split(/\s+/).join(" ").trim();
    if (!selector || selector.startsWith("@")) continue;

    let background: Rgb | null = null;
    let color: Rgb | null = null;
    for (const declaration of match[2]!.split(";")) {
      const separator = declaration.indexOf(":");
      if (separator < 0) continue;
      const property = declaration.slice(0, separator).trim();
      const value = declaration.slice(separator + 1);
      if (property === "background" || property === "background-color") background = resolve(value);
      else if (property === "color") color = resolve(value);
    }

    if (!background) continue;
    const inherited = color === null;
    // `body { color: var(--paper) }`, so anything that paints a surface and no text renders light.
    pairs.push({ selector, file, ratio: contrast(background, color ?? [247, 242, 232]), inherited });
  }
  return pairs;
}

const pairs = [...pairsIn("globals.css"), ...pairsIn("game-ui.css")];

describe("the stylesheets", () => {
  it("were parsed at all", () => {
    // A regex that stops matching turns this whole file into a test that asserts nothing and passes.
    expect(pairs.length).toBeGreaterThan(60);
    expect(pairs.some((pair) => pair.selector === ".pr-button--primary")).toBe(true);
  });

  it("names a reason for every excluded selector", () => {
    for (const [selector, reason] of Object.entries(NO_TEXT)) {
      expect(reason.length, selector).toBeGreaterThan(4);
      // An allowlist entry for a selector that no longer exists is dead weight that hides the next
      // real failure behind a stale name.
      expect(pairs.some((pair) => pair.selector === selector), `${selector} is no longer in the CSS`).toBe(true);
    }
  });
});

describe("every text colour is legible on its own background", () => {
  const measured = pairs.filter((pair) => !(pair.selector in NO_TEXT));

  it.each(measured.map((pair) => [`${pair.file} · ${pair.selector}`, pair] as const))(
    "%s",
    (_label, pair) => {
      expect(
        pair.ratio,
        `${pair.selector} in ${pair.file} measures ${pair.ratio.toFixed(2)}:1${pair.inherited ? " (inherited colour)" : ""}`,
      ).toBeGreaterThanOrEqual(4.5);
    },
  );
});

describe("the brand pairings", () => {
  it("puts dark text on the bright brand colours", () => {
    /**
     * The rule the primary button was breaking, stated directly.
     *
     * `--pink` and `--acid` are *light* colours — luminance 0.27 and 0.82 — so text on them has to be
     * dark. This is not a preference; it is what the numbers allow, and the interface was already
     * doing it everywhere except the one button a player presses on every screen.
     */
    const ink = resolve("var(--ink)")!;
    const paper = resolve("var(--paper)")!;
    for (const token of ["--pink", "--acid"] as const) {
      const brand = resolve(TOKENS[token]!)!;
      expect(contrast(brand, ink), `${token} with ink`).toBeGreaterThanOrEqual(4.5);
      expect(contrast(brand, paper), `${token} with paper`).toBeLessThan(4.5);
    }
  });
});
