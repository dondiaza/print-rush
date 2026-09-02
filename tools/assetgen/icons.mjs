import {
  fill,
  intersect,
  outline,
  over,
  sdArc,
  sdBox,
  sdCircle,
  sdPolygon,
  sdSegment,
  subtract,
  union,
} from "./shapes.mjs";
import { hex } from "./raster.mjs";

/**
 * The icon set.
 *
 * What this replaces: the HUD's item slot rendered `hud.itemName?.slice(0, 1)` — the first letter of
 * the item's name. A capital T for the T-Shirt Cannon and a capital T for the Tape Trap and a capital
 * T for Thread Boost. That is not iconography, and the brief rules out placeholder glyphs as final
 * UI explicitly.
 *
 * Design rules, applied to all twenty-two:
 *
 *  - **One glyph, one silhouette.** Read at 34 px on a moving HUD, which is the only size that
 *    matters. No outlines thinner than 2 % of the icon, no detail below 6 %.
 *  - **Near-white, with one accent.** The glyph is off-white so it holds against the dark HUD
 *    without CSS help; a single accent shape in the item's own colour carries the meaning that
 *    silhouette alone cannot — ink is cyan, thread is lime, tape is amber. Two-tone keeps the set
 *    coherent while staying distinguishable, which a pure monochrome set of thirteen would not.
 *  - **Drawn from the game's own objects.** A T-shirt, a shipping box, a coat hanger, a squeegee.
 *    Nothing generic, nothing borrowed.
 *
 * All are 128 px, transparent, and packed into one atlas — see `atlas.mjs`.
 */

const GLYPH = hex("#f4f2f7");
const SHADE = hex("#b9b4c4");

/** The accent palette, from the brand colours already in use across the game. */
const INK_CYAN = hex("#65d8ff");
const MAGENTA = hex("#ff3da6");
const LIME = hex("#b9ff45");
const AMBER = hex("#ffc02e");
const VIOLET = hex("#8f5cff");
const ORANGE = hex("#ff6b2c");

/** A layer: a shape's coverage in a colour. */
function layer(coverage, color) {
  return { r: color.r, g: color.g, b: color.b, a: coverage };
}

/**
 * Stacks layers back to front.
 *
 * Order matters and the accent goes last, so it sits on top of the glyph rather than being punched
 * through it.
 */
function stack(...layers) {
  let result = { r: 0, g: 0, b: 0, a: 0 };
  for (const item of layers) result = over(result, item);
  return result;
}

/** A T-shirt: body, two sleeves, and a neck notch taken out of the top. */
function tshirt(x, y, cx, cy, scale) {
  const body = sdPolygon(x, y, [
    [cx - 0.2 * scale, cy - 0.24 * scale],
    [cx - 0.34 * scale, cy - 0.1 * scale],
    [cx - 0.24 * scale, cy + 0.02 * scale],
    [cx - 0.17 * scale, cy - 0.05 * scale],
    [cx - 0.17 * scale, cy + 0.3 * scale],
    [cx + 0.17 * scale, cy + 0.3 * scale],
    [cx + 0.17 * scale, cy - 0.05 * scale],
    [cx + 0.24 * scale, cy + 0.02 * scale],
    [cx + 0.34 * scale, cy - 0.1 * scale],
    [cx + 0.2 * scale, cy - 0.24 * scale],
  ]);
  // The collar, cut out so the shirt reads as a shirt and not as a cross.
  const collar = sdCircle(x, y, cx, cy - 0.26 * scale, 0.09 * scale);
  return subtract(body, collar);
}

/** A shipping box seen face on, with its lid seam. */
function parcel(x, y, cx, cy, scale) {
  return sdBox(x, y, cx, cy, 0.3 * scale, 0.26 * scale, 0.035 * scale);
}

export const ICONS = {
  // ------------------------------------------------------------------- items
  "item_tshirt_cannon": {
    accent: MAGENTA,
    draw: (x, y, s, accent) => {
      // A shirt leaving a barrel: the barrel says cannon, the shirt says what it fires.
      const barrel = sdBox(x, y, 0.3, 0.6, 0.17, 0.1, 0.03);
      const muzzle = sdBox(x, y, 0.46, 0.6, 0.06, 0.13, 0.02);
      const shirt = tshirt(x, y, 0.66, 0.36, 0.9);
      return stack(
        layer(fill(union(barrel, muzzle), s), SHADE),
        layer(fill(shirt, s), GLYPH),
        layer(fill(sdCircle(x, y, 0.66, 0.34, 0.055), s), accent),
      );
    },
  },

  "item_express_package": {
    accent: AMBER,
    draw: (x, y, s, accent) => {
      const box = parcel(x, y, 0.5, 0.54, 1);
      const seam = sdBox(x, y, 0.5, 0.54, 0.3, 0.022, 0);
      // A speed chevron across the label, which is what makes it "express".
      const chevron = union(
        sdSegment(x, y, 0.38, 0.44, 0.5, 0.54, 0.028),
        sdSegment(x, y, 0.5, 0.54, 0.38, 0.64, 0.028),
      );
      return stack(
        layer(fill(box, s), GLYPH),
        layer(fill(intersect(seam, box), s), SHADE),
        layer(fill(intersect(chevron, box), s), accent),
      );
    },
  },

  "item_hanger_boomerang": {
    accent: INK_CYAN,
    draw: (x, y, s, accent) => {
      // Hook, then the two shoulders of a coat hanger.
      const hook = sdArc(x, y, 0.5, 0.28, 0.075, 0.028, Math.PI * 0.15, Math.PI * 1.1);
      const stem = sdSegment(x, y, 0.5, 0.34, 0.5, 0.44, 0.026);
      const bar = union(
        sdSegment(x, y, 0.5, 0.44, 0.24, 0.64, 0.032),
        sdSegment(x, y, 0.5, 0.44, 0.76, 0.64, 0.032),
      );
      const rail = sdSegment(x, y, 0.24, 0.64, 0.76, 0.64, 0.03);
      return stack(
        layer(fill(union(union(hook, stem), bar), s), GLYPH),
        layer(fill(rail, s), accent),
      );
    },
  },

  "item_sticker_mine": {
    accent: MAGENTA,
    draw: (x, y, s, accent) => {
      // A burst sticker: a circle whose radius pulses with the angle.
      const dx = x - 0.5;
      const dy = y - 0.5;
      const angle = Math.atan2(dy, dx);
      const spikes = 0.3 + Math.cos(angle * 9) * 0.055;
      const burst = Math.hypot(dx, dy) - spikes;
      const ring = outline(sdCircle(x, y, 0.5, 0.5, 0.17), 0.026);
      return stack(
        layer(fill(burst, s), GLYPH),
        layer(fill(ring, s), accent),
        layer(fill(sdCircle(x, y, 0.5, 0.5, 0.06), s), accent),
      );
    },
  },

  "item_ink_blast": {
    accent: INK_CYAN,
    draw: (x, y, s, accent) => {
      const dx = x - 0.5;
      const dy = y - 0.52;
      const angle = Math.atan2(dy, dx);
      // Uneven blob: two harmonics, the same trick the ink decals use.
      const wobble = 0.26 + Math.sin(angle * 5 + 0.7) * 0.05 + Math.sin(angle * 9 - 1.3) * 0.025;
      let blob = Math.hypot(dx, dy) - wobble;
      // Satellite droplets, which is what makes a splash read as a splash.
      for (const [px, py, r] of [[0.22, 0.24, 0.045], [0.8, 0.3, 0.038], [0.76, 0.78, 0.05], [0.2, 0.74, 0.032]]) {
        blob = union(blob, sdCircle(x, y, px, py, r));
      }
      return stack(
        layer(fill(blob, s), accent),
        layer(fill(sdCircle(x, y, 0.42, 0.44, 0.07), s), { r: 1, g: 1, b: 1 }),
      );
    },
  },

  "item_thread_boost": {
    accent: LIME,
    draw: (x, y, s, accent) => {
      // A stack of chevrons: the universal "faster", drawn as thread stitches.
      let arrows = Infinity;
      for (let i = 0; i < 3; i += 1) {
        const cx = 0.3 + i * 0.2;
        arrows = union(
          arrows,
          union(sdSegment(x, y, cx - 0.09, 0.32, cx + 0.05, 0.5, 0.036), sdSegment(x, y, cx + 0.05, 0.5, cx - 0.09, 0.68, 0.036)),
        );
      }
      const thread = sdSegment(x, y, 0.14, 0.84, 0.86, 0.84, 0.022);
      return stack(layer(fill(arrows, s), GLYPH), layer(fill(thread, s), accent));
    },
  },

  "item_package_shield": {
    accent: LIME,
    draw: (x, y, s, accent) => {
      // A shield: a rounded top narrowing to a point.
      const shield = sdPolygon(x, y, [
        [0.5, 0.16],
        [0.82, 0.3],
        [0.82, 0.56],
        [0.5, 0.86],
        [0.18, 0.56],
        [0.18, 0.3],
      ]);
      const inner = parcel(x, y, 0.5, 0.48, 0.62);
      return stack(
        layer(fill(shield, s), accent),
        layer(fill(outline(shield, 0.022), s), GLYPH),
        layer(fill(inner, s), GLYPH),
      );
    },
  },

  "item_dye_cloud": {
    accent: VIOLET,
    draw: (x, y, s, accent) => {
      // Three overlapping lobes plus a flat base: a cloud, not a flower.
      const cloud = union(
        union(sdCircle(x, y, 0.36, 0.5, 0.17), sdCircle(x, y, 0.64, 0.5, 0.17)),
        union(sdCircle(x, y, 0.5, 0.38, 0.19), sdBox(x, y, 0.5, 0.58, 0.28, 0.09, 0.06)),
      );
      let drops = Infinity;
      for (const [px, r] of [[0.34, 0.032], [0.5, 0.04], [0.66, 0.032]]) {
        drops = union(drops, sdCircle(x, y, px, 0.79, r));
      }
      return stack(layer(fill(cloud, s), GLYPH), layer(fill(drops, s), accent));
    },
  },

  "item_magnetic_tag": {
    accent: MAGENTA,
    draw: (x, y, s, accent) => {
      // A horseshoe magnet: an arc with two legs and coloured poles.
      const horseshoe = sdArc(x, y, 0.5, 0.52, 0.24, 0.075, Math.PI, Math.PI * 2);
      const legs = union(sdBox(x, y, 0.26, 0.62, 0.075, 0.1, 0.01), sdBox(x, y, 0.74, 0.62, 0.075, 0.1, 0.01));
      const poles = union(sdBox(x, y, 0.26, 0.71, 0.075, 0.045, 0.01), sdBox(x, y, 0.74, 0.71, 0.075, 0.045, 0.01));
      return stack(layer(fill(union(horseshoe, legs), s), GLYPH), layer(fill(poles, s), accent));
    },
  },

  "item_mega_print": {
    accent: ORANGE,
    draw: (x, y, s, accent) => {
      // A squeegee over a sheet: the biggest object in a print shop, and the biggest item.
      const sheet = sdBox(x, y, 0.5, 0.62, 0.32, 0.2, 0.02);
      const blade = sdBox(x, y, 0.5, 0.36, 0.36, 0.055, 0.02);
      const handle = sdBox(x, y, 0.5, 0.24, 0.1, 0.075, 0.03);
      return stack(
        layer(fill(sheet, s), SHADE),
        layer(fill(sdBox(x, y, 0.5, 0.66, 0.24, 0.12, 0.015), s), accent),
        layer(fill(union(blade, handle), s), GLYPH),
      );
    },
  },

  "item_tape_trap": {
    accent: AMBER,
    draw: (x, y, s, accent) => {
      // Two crossed strips, with the serrated ends that say packing tape.
      const a = sdBox(x, y, 0.5, 0.5, 0.4, 0.085, 0.01);
      const b = sdBox(x, y, 0.5, 0.5, 0.085, 0.4, 0.01);
      // Rotating the coordinates for the cross is cheaper than rotating the SDF.
      const rx = (x - 0.5) * 0.707 - (y - 0.5) * 0.707 + 0.5;
      const ry = (x - 0.5) * 0.707 + (y - 0.5) * 0.707 + 0.5;
      const ra = sdBox(rx, ry, 0.5, 0.5, 0.4, 0.085, 0.01);
      const rb = sdBox(rx, ry, 0.5, 0.5, 0.085, 0.4, 0.01);
      void a;
      void b;
      return stack(
        layer(fill(ra, s), accent),
        layer(fill(rb, s), GLYPH),
        layer(fill(sdCircle(x, y, 0.5, 0.5, 0.055), s), SHADE),
      );
    },
  },

  "item_size_tag": {
    accent: INK_CYAN,
    draw: (x, y, s, accent) => {
      // A swing tag: a pentagon with a punched hole and a string.
      const tag = sdPolygon(x, y, [
        [0.3, 0.24],
        [0.74, 0.24],
        [0.86, 0.5],
        [0.74, 0.76],
        [0.3, 0.76],
      ]);
      const hole = sdCircle(x, y, 0.4, 0.5, 0.055);
      const string = sdSegment(x, y, 0.4, 0.5, 0.14, 0.28, 0.02);
      const bars = union(sdBox(x, y, 0.62, 0.42, 0.1, 0.028, 0.01), sdBox(x, y, 0.62, 0.58, 0.14, 0.028, 0.01));
      return stack(
        layer(fill(subtract(tag, hole), s), GLYPH),
        layer(fill(string, s), SHADE),
        layer(fill(bars, s), accent),
      );
    },
  },

  "item_design_shuffle": {
    accent: VIOLET,
    draw: (x, y, s, accent) => {
      // Two arcs chasing each other, with arrowheads: a cycle.
      const top = sdArc(x, y, 0.5, 0.5, 0.26, 0.036, Math.PI * 1.12, Math.PI * 1.92);
      const bottom = sdArc(x, y, 0.5, 0.5, 0.26, 0.036, Math.PI * 0.12, Math.PI * 0.92);
      const headA = sdPolygon(x, y, [[0.74, 0.36], [0.86, 0.42], [0.72, 0.5]]);
      const headB = sdPolygon(x, y, [[0.26, 0.64], [0.14, 0.58], [0.28, 0.5]]);
      return stack(
        layer(fill(union(top, headA), s), GLYPH),
        layer(fill(union(bottom, headB), s), accent),
      );
    },
  },

  // ------------------------------------------------------------------ system
  "ui_turbo": {
    accent: ORANGE,
    draw: (x, y, s, accent) => {
      const flame = sdPolygon(x, y, [
        [0.5, 0.14],
        [0.66, 0.4],
        [0.58, 0.44],
        [0.72, 0.66],
        [0.5, 0.88],
        [0.28, 0.66],
        [0.42, 0.44],
        [0.34, 0.4],
      ]);
      return stack(
        layer(fill(flame, s), accent),
        layer(fill(sdPolygon(x, y, [[0.5, 0.42], [0.58, 0.64], [0.5, 0.78], [0.42, 0.64]]), s), GLYPH),
      );
    },
  },

  "ui_drift": {
    accent: INK_CYAN,
    draw: (x, y, s, accent) => {
      // A skid arc with two tyre tracks peeling off it.
      const arc = sdArc(x, y, 0.72, 0.3, 0.42, 0.05, Math.PI * 0.55, Math.PI * 1.0);
      const marks = union(sdSegment(x, y, 0.26, 0.7, 0.5, 0.82, 0.03), sdSegment(x, y, 0.34, 0.56, 0.6, 0.7, 0.03));
      return stack(layer(fill(arc, s), GLYPH), layer(fill(marks, s), accent));
    },
  },

  "ui_lap": {
    accent: LIME,
    draw: (x, y, s, accent) => {
      // A closed circuit with a start marker: the shape of a lap.
      const track = outline(sdBox(x, y, 0.5, 0.5, 0.3, 0.22, 0.16), 0.045);
      const marker = sdBox(x, y, 0.5, 0.24, 0.05, 0.06, 0.01);
      return stack(layer(fill(track, s), GLYPH), layer(fill(marker, s), accent));
    },
  },

  "ui_timer": {
    accent: MAGENTA,
    draw: (x, y, s, accent) => {
      const ring = outline(sdCircle(x, y, 0.5, 0.54, 0.3), 0.042);
      const crown = sdBox(x, y, 0.5, 0.18, 0.08, 0.045, 0.015);
      const hands = union(sdSegment(x, y, 0.5, 0.54, 0.5, 0.36, 0.028), sdSegment(x, y, 0.5, 0.54, 0.64, 0.6, 0.026));
      return stack(layer(fill(union(ring, crown), s), GLYPH), layer(fill(hands, s), accent));
    },
  },

  "ui_position": {
    accent: AMBER,
    draw: (x, y, s, accent) => {
      // A podium: three steps, the tallest in the accent.
      const left = sdBox(x, y, 0.26, 0.68, 0.13, 0.14, 0.012);
      const right = sdBox(x, y, 0.74, 0.72, 0.13, 0.1, 0.012);
      const middle = sdBox(x, y, 0.5, 0.56, 0.13, 0.26, 0.012);
      return stack(layer(fill(union(left, right), s), GLYPH), layer(fill(middle, s), accent));
    },
  },

  "ui_map": {
    accent: INK_CYAN,
    draw: (x, y, s, accent) => {
      const sheet = sdBox(x, y, 0.5, 0.5, 0.32, 0.26, 0.03);
      const folds = union(sdSegment(x, y, 0.39, 0.24, 0.39, 0.76, 0.018), sdSegment(x, y, 0.61, 0.24, 0.61, 0.76, 0.018));
      const pin = union(sdCircle(x, y, 0.58, 0.42, 0.065), sdPolygon(x, y, [[0.53, 0.46], [0.63, 0.46], [0.58, 0.62]]));
      return stack(
        layer(fill(sheet, s), GLYPH),
        layer(fill(intersect(folds, sheet), s), SHADE),
        layer(fill(pin, s), accent),
      );
    },
  },

  "ui_settings": {
    accent: VIOLET,
    draw: (x, y, s, accent) => {
      // A cog: a ring with teeth punched around it by an angular modulation.
      const dx = x - 0.5;
      const dy = y - 0.5;
      const angle = Math.atan2(dy, dx);
      const teeth = 0.3 + (Math.cos(angle * 8) > 0.42 ? 0.05 : 0);
      const body = Math.hypot(dx, dy) - teeth;
      const bore = sdCircle(x, y, 0.5, 0.5, 0.11);
      return stack(layer(fill(subtract(body, bore), s), GLYPH), layer(fill(outline(bore, 0.022), s), accent));
    },
  },

  "ui_item_empty": {
    accent: SHADE,
    draw: (x, y, s, accent) => {
      // A dashed empty slot. Says "nothing held" without saying it in words.
      const frame = outline(sdBox(x, y, 0.5, 0.5, 0.3, 0.3, 0.06), 0.028);
      const gaps = Math.min(
        Math.abs(x - 0.5) - 0.09,
        Math.abs(y - 0.5) - 0.09,
      );
      return stack(layer(fill(intersect(frame, gaps), s), accent));
    },
  },

  "ui_wrong_way": {
    accent: MAGENTA,
    draw: (x, y, s, accent) => {
      const triangle = sdPolygon(x, y, [[0.5, 0.16], [0.88, 0.8], [0.12, 0.8]]);
      const bar = sdBox(x, y, 0.5, 0.52, 0.045, 0.14, 0.02);
      const dot = sdCircle(x, y, 0.5, 0.72, 0.05);
      return stack(
        layer(fill(triangle, s), accent),
        layer(fill(outline(triangle, 0.024), s), GLYPH),
        layer(fill(union(bar, dot), s), GLYPH),
      );
    },
  },

  "ui_shortcut": {
    accent: LIME,
    draw: (x, y, s, accent) => {
      // A branching path: the fork that a shortcut is.
      const main = sdSegment(x, y, 0.5, 0.86, 0.5, 0.5, 0.04);
      const branch = sdSegment(x, y, 0.5, 0.54, 0.76, 0.26, 0.04);
      const head = sdPolygon(x, y, [[0.66, 0.2], [0.86, 0.18], [0.8, 0.38]]);
      const straight = sdSegment(x, y, 0.5, 0.5, 0.5, 0.2, 0.032);
      return stack(
        layer(fill(union(main, straight), s), SHADE),
        layer(fill(union(branch, head), s), accent),
      );
    },
  },
};

/** Every icon id, in a stable order — the atlas depends on it being deterministic. */
export const ICON_IDS = Object.keys(ICONS).sort();

/** The RGBA shader for one icon, ready for `renderShape`. */
export function iconShader(id) {
  const definition = ICONS[id];
  if (!definition) throw new Error(`unknown icon: ${id}`);
  return (x, y, softness) => definition.draw(x, y, softness, definition.accent);
}
