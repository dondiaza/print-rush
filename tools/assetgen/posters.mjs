import { fill, intersect, outline, over, sdBox, sdCircle, sdPolygon, sdSegment, subtract, union } from "./shapes.mjs";
import { fbm, makeRandom, valueNoise } from "./noise.mjs";
import { clamp01, hex, mixColor, scaleColor } from "./raster.mjs";

/**
 * Posters and wall art.
 *
 * The audit's bluntest finding was "paredes vacías" — every wall in every circuit was a flat colour
 * over a tiling material, which is what makes a track read as a corridor rather than a place. A shop
 * without its graphics is a warehouse; a print workshop without its test prints and pantone charts
 * is a garage.
 *
 * Production uses the authored WebP sheets. These compositions are the deterministic fallback:
 * bars, blocks, halftones and geometric marks — the vocabulary of screen printing, which happens
 * to be the right vocabulary for this game. A missing authored atlas therefore remains a composed,
 * readable wall rather than a broken texture or an empty rectangle.
 *
 * Five families, one per circuit, each with several variants so a wall is never one poster repeated.
 * Packed into per-circuit atlases.
 */

const PAPER = hex("#f4f1ea");
const NEWSPRINT = hex("#e6e0d2");
const INK_BLACK = hex("#1b1622");

/** The brand palette, reused so posters cannot drift out of the game's colour world. */
const PALETTE = ["#ff3da6", "#65d8ff", "#b9ff45", "#ffd43b", "#8f5cff", "#ff6b2c"].map(hex);

function layer(coverage, color) {
  return { r: color.r, g: color.g, b: color.b, a: coverage };
}

function stack(...layers) {
  let result = { r: 0, g: 0, b: 0, a: 0 };
  for (const item of layers) result = over(result, item);
  return result;
}

/**
 * A block of text, as bars.
 *
 * Deliberately not lettering. Real text would need a font, and fake letterforms at poster scale look
 * like fake letterforms; bars of varying length read as a paragraph at every distance the player will
 * ever see one from, which is the only thing that matters here.
 */
function textBlock(x, y, left, top, width, lines, random, weight = 0.014) {
  let mark = Infinity;
  for (let line = 0; line < lines; line += 1) {
    const lineY = top + line * weight * 2.4;
    const lineWidth = width * (0.55 + random() * 0.45);
    mark = union(mark, sdBox(x, y, left + lineWidth / 2, lineY, lineWidth / 2, weight, weight * 0.4));
  }
  return mark;
}

/** A halftone screen: dots on a lattice whose radius follows `density`. */
function halftone(x, y, cells, density) {
  const cx = x * cells;
  const cy = y * cells;
  const distance = Math.hypot(cx - Math.floor(cx) - 0.5, cy - Math.floor(cy) - 0.5);
  return distance - 0.52 * clamp01(density);
}

export const POSTER_FAMILIES = {
  /**
   * STORE — the graphics wall. Big shapes, one colour statement each, the way a shop's own
   * collection posters are built.
   */
  store: {
    count: 10,
    size: { width: 384, height: 480 },
    build: ({ seed, index }) => {
      const random = makeRandom(seed);
      const accent = PALETTE[Math.floor(random() * PALETTE.length)];
      const second = PALETTE[Math.floor(random() * PALETTE.length)];
      // By index, so a wall of six shows all three layouts twice rather than whatever the dice gave.
      const layout = index % 3;
      const dots = 0.4 + random() * 0.4;

      return (x, y, s) => {
        // Paper, with a slight tooth so it is not a flat fill.
        const tooth = 0.97 + fbm(x, y, { octaves: 3, frequency: 40, seed }) * 0.06;
        let result = { ...scaleColor(PAPER, tooth), a: 1 };

        // A margin frame: what separates a poster from a coloured rectangle.
        const inner = sdBox(x, y, 0.5, 0.5, 0.42, 0.44, 0.01);

        if (layout === 0) {
          // A big circle over a band: a single-garment hero poster.
          const band = sdBox(x, y, 0.5, 0.68, 0.42, 0.12, 0.008);
          result = over(result, layer(fill(intersect(sdCircle(x, y, 0.5, 0.4, 0.26), inner), s), accent));
          result = over(result, layer(fill(intersect(band, inner), s), second));
          result = over(result, layer(fill(intersect(halftone(x, y, 26, dots), sdCircle(x, y, 0.5, 0.4, 0.26)), s), INK_BLACK));
        } else if (layout === 1) {
          // Three stacked bars, decreasing: a collection announcement.
          let bars = Infinity;
          for (let i = 0; i < 3; i += 1) {
            bars = union(bars, sdBox(x, y, 0.28 + i * 0.06, 0.3 + i * 0.14, 0.2 - i * 0.05, 0.05, 0.008));
          }
          result = over(result, layer(fill(intersect(bars, inner), s), accent));
          result = over(result, layer(fill(textBlock(x, y, 0.14, 0.66, 0.6, 4, random), s), INK_BLACK));
        } else {
          // A diagonal split with a mark in the corner.
          const split = sdPolygon(x, y, [[0.08, 0.9], [0.92, 0.24], [0.92, 0.9]]);
          result = over(result, layer(fill(intersect(split, inner), s), second));
          result = over(result, layer(fill(intersect(sdCircle(x, y, 0.32, 0.32, 0.14), inner), s), accent));
          result = over(result, layer(fill(textBlock(x, y, 0.12, 0.56, 0.4, 3, random), s), INK_BLACK));
        }

        // A hairline rule at the foot, which every printed poster has and which sells the format.
        result = over(result, layer(fill(sdBox(x, y, 0.5, 0.93, 0.42, 0.004, 0), s), INK_BLACK));
        return result;
      };
    },
  },

  /**
   * SCREENPRINTING — test prints and pantone charts pinned to the wall. This is the family that
   * makes the pilot circuit say "workshop" in the two seconds the brief asks for.
   */
  screenprinting: {
    count: 8,
    size: { width: 384, height: 384 },
    build: ({ seed, index }) => {
      const random = makeRandom(seed);
      const kind = index % 3;
      const inks = [hex("#65d8ff"), hex("#ff3da6"), hex("#ffd43b"), INK_BLACK];
      // A real proof sheet is trimmed by hand, so its marks are never in exactly the same place.
      const registrationMarks = [[0.16, 0.16], [0.84, 0.16], [0.16, 0.84], [0.84, 0.84]].map(
        ([px, py]) => [px + (random() - 0.5) * 0.05, py + (random() - 0.5) * 0.05],
      );
      const stripY = 0.44 + random() * 0.14;
      const stripBands = 3 + Math.floor(random() * 3);

      return (x, y, s) => {
        const tooth = 0.96 + fbm(x, y, { octaves: 3, frequency: 44, seed }) * 0.08;
        let result = { ...scaleColor(NEWSPRINT, tooth), a: 1 };
        const inner = sdBox(x, y, 0.5, 0.5, 0.44, 0.44, 0.008);

        if (kind === 0) {
          // A pantone chart: a grid of ink chips, each a slightly different mix.
          const columns = 4;
          const rows = 5;
          const cx = Math.floor(x * columns);
          const cy = Math.floor(y * rows);
          const chip = sdBox(
            x,
            y,
            (cx + 0.5) / columns,
            (cy + 0.5) / rows,
            0.5 / columns - 0.022,
            0.5 / rows - 0.022,
            0.006,
          );
          const pick = inks[(cx + cy) % inks.length];
          const strength = 0.35 + valueNoise(cx, cy, columns, seed) * 0.65;
          result = over(result, layer(fill(intersect(chip, inner), s), mixColor(NEWSPRINT, pick, strength)));
        } else if (kind === 1) {
          // A registration test: four offset marks and a colour bar, exactly what a press proof is.
          let marks = Infinity;
          for (const [px, py] of registrationMarks) {
            marks = union(
              marks,
              union(outline(sdCircle(x, y, px, py, 0.055), 0.008), union(sdSegment(x, y, px - 0.08, py, px + 0.08, py, 0.005), sdSegment(x, y, px, py - 0.08, px, py + 0.08, 0.005))),
            );
          }
          result = over(result, layer(fill(marks, s), INK_BLACK));
          // The CMYK strip.
          const stripIndex = Math.floor(clamp01((x - 0.24) / 0.52) * stripBands);
          const strip = sdBox(x, y, 0.5, stripY, 0.26, 0.09, 0.004);
          result = over(result, layer(fill(strip, s), inks[Math.min(inks.length - 1, Math.max(0, stripIndex))]));
          result = over(result, layer(fill(textBlock(x, y, 0.24, stripY + 0.22, 0.52, 3, random, 0.01), s), INK_BLACK));
        } else {
          // A work note: a big halftone blob and a hand-written-looking scribble block.
          const accent = inks[Math.floor(random() * inks.length)];
          const blob = sdCircle(x, y, 0.5, 0.4, 0.24);
          result = over(result, layer(fill(intersect(halftone(x, y, 30, 0.75), blob), s), accent));
          result = over(result, layer(fill(outline(blob, 0.006), s), INK_BLACK));
          result = over(result, layer(fill(textBlock(x, y, 0.2, 0.72, 0.6, 4, random, 0.011), s), INK_BLACK));
        }
        return result;
      };
    },
  },

  /**
   * WAREHOUSE — logistics signage. Pure function: zone letters as blocks, hazard chevrons, barcode
   * labels. Nothing decorative, which is what makes it read as a real warehouse.
   */
  warehouse: {
    count: 6,
    size: { width: 384, height: 288 },
    build: ({ seed, index }) => {
      const random = makeRandom(seed);
      const kind = index % 3;
      const hazard = hex("#ffc02e");
      const bars = Array.from({ length: 30 }, () => random());
      // Read before the shader closes over them, so each variant of the zone marker differs.
      const counterCount = 1 + Math.floor(random() * 2);
      const stripe = random() > 0.5;
      // The hazard layout was a fixed diagonal on a fixed plate; only its text bars varied.
      const stripePeriod = 0.26 + random() * 0.16;
      const stripeSlope = 2 + Math.floor(random() * 3);
      const plateHalf = 0.3 + random() * 0.08;

      return (x, y, s) => {
        let result = { r: PAPER.r, g: PAPER.g, b: PAPER.b, a: 1 };

        if (kind === 0) {
          // Hazard stripes with a bordered plate.
          const diagonal = ((x * stripeSlope + y * stripeSlope) % stripePeriod) / stripePeriod;
          if (diagonal < 0.5) result = { ...hazard, a: 1 };
          else result = { ...INK_BLACK, a: 1 };
          const plate = sdBox(x, y, 0.5, 0.5, plateHalf, 0.24, 0.02);
          result = over(result, layer(fill(plate, s), PAPER));
          result = over(result, layer(fill(outline(plate, 0.008), s), INK_BLACK));
          result = over(result, layer(fill(textBlock(x, y, 0.22, 0.44, 0.56, 3, random, 0.018), s), INK_BLACK));
        } else if (kind === 1) {
          // A shipping label: barcode plus fields.
          const label = sdBox(x, y, 0.5, 0.5, 0.42, 0.4, 0.012);
          result = over(result, layer(fill(label, s), PAPER));
          result = over(result, layer(fill(outline(label, 0.006), s), INK_BLACK));
          const index = Math.floor(clamp01((x - 0.14) / 0.72) * bars.length);
          const inBar = y > 0.58 && y < 0.8 && x > 0.14 && x < 0.86 && bars[Math.min(bars.length - 1, index)] > 0.45;
          if (inBar) result = { ...INK_BLACK, a: 1 };
          result = over(result, layer(fill(textBlock(x, y, 0.16, 0.26, 0.5, 4, random, 0.013), s), INK_BLACK));
        } else {
          /**
           * A zone marker: one huge block form, abstracted to a bar-and-counter shape.
           *
           * The first version drew a fixed glyph on a fixed plate and consumed no randomness, so two
           * warehouse posters that landed on this layout came out byte-identical — measured at a
           * mean absolute difference of exactly zero. Every element now varies.
           */
          const counters = counterCount;
          let glyph = sdBox(x, y, 0.5, 0.5, 0.2, 0.3, 0.02);
          for (let i = 0; i < counters; i += 1) {
            glyph = subtract(glyph, sdBox(x, y, 0.5, 0.34 + i * 0.19, 0.085 + i * 0.02, 0.08, 0.01));
          }
          if (stripe) glyph = subtract(glyph, sdBox(x, y, 0.5, 0.5, 0.24, 0.022, 0));
          result = over(result, layer(fill(sdBox(x, y, 0.5, 0.5, 0.44, 0.42, 0.02), s), hazard));
          result = over(result, layer(fill(glyph, s), INK_BLACK));
          result = over(result, layer(fill(textBlock(x, y, 0.14, 0.86, 0.28, 1, random, 0.016), s), INK_BLACK));
        }
        return result;
      };
    },
  },

  /**
   * OFFICE — whiteboards and pinned sketches. Lighter, looser, more white space than the others,
   * because that is what the difference between a studio wall and a factory wall looks like.
   */
  office: {
    count: 6,
    size: { width: 384, height: 288 },
    build: ({ seed, index }) => {
      const random = makeRandom(seed);
      const kind = index % 2;
      const accent = PALETTE[Math.floor(random() * PALETTE.length)];
      /**
       * The diagram, drawn per variant rather than fixed.
       *
       * A fixed node list consumed no randomness, so two boards on this layout were identical down
       * to the byte whenever their accent colour happened to match — which it did.
       */
      const rows = 2 + Math.floor(random() * 2);
      const diagramNodes = [];
      for (let row = 0; row < rows; row += 1) {
        const inRow = 2 + Math.floor(random() * 2);
        for (let column = 0; column < inRow; column += 1) {
          diagramNodes.push([0.22 + (column / Math.max(1, inRow - 1)) * 0.56, 0.3 + row * (0.4 / rows)]);
        }
      }
      const diagramLinks = [];
      for (let i = 1; i < diagramNodes.length; i += 1) {
        diagramLinks.push([i - 1, i]);
        if (random() > 0.6 && i > 1) diagramLinks.push([i - 2, i]);
      }

      return (x, y, s) => {
        let result = { r: 0.97, g: 0.97, b: 0.98, a: 1 };
        const board = sdBox(x, y, 0.5, 0.5, 0.46, 0.44, 0.014);
        result = over(result, layer(fill(outline(board, 0.01), s), hex("#9aa0ab")));

        if (kind === 0) {
          // A flow diagram: boxes joined by lines. Legible as "planning" at any distance.
          let boxes = Infinity;
          let links = Infinity;
          for (const [px, py] of diagramNodes) boxes = union(boxes, sdBox(x, y, px, py, 0.085, 0.055, 0.012));
          for (const [a, b] of diagramLinks) {
            links = union(links, sdSegment(x, y, diagramNodes[a][0], diagramNodes[a][1], diagramNodes[b][0], diagramNodes[b][1], 0.006));
          }
          result = over(result, layer(fill(links, s), hex("#6f7681")));
          result = over(result, layer(fill(boxes, s), hex("#ffffff")));
          result = over(result, layer(fill(outline(boxes, 0.005), s), accent));
        } else {
          // Sticky notes at slight angles, plus a sketch block.
          for (let i = 0; i < 4; i += 1) {
            const nx = 0.22 + (i % 2) * 0.34;
            const ny = 0.28 + Math.floor(i / 2) * 0.3;
            const tilt = (random() - 0.5) * 0.16;
            const rx = (x - nx) * Math.cos(tilt) - (y - ny) * Math.sin(tilt) + nx;
            const ry = (x - nx) * Math.sin(tilt) + (y - ny) * Math.cos(tilt) + ny;
            const note = sdBox(rx, ry, nx, ny, 0.1, 0.09, 0.006);
            result = over(result, layer(fill(note, s), PALETTE[(i + seed) % PALETTE.length]));
            result = over(result, layer(fill(textBlock(rx, ry, nx - 0.07, ny - 0.03, 0.14, 3, random, 0.007), s), INK_BLACK));
          }
        }
        return result;
      };
    },
  },

  /**
   * MANGA — convention posters for invented properties. The loudest family: full-bleed colour, a
   * strong central mark, a title bar. No existing character, no existing logo, nothing borrowed.
   */
  manga: {
    count: 10,
    size: { width: 384, height: 576 },
    build: ({ seed, index }) => {
      const random = makeRandom(seed);
      const accent = PALETTE[Math.floor(random() * PALETTE.length)];
      const ground = [hex("#17141b"), hex("#241d3c"), hex("#2b1030"), hex("#0f1d2a")][Math.floor(random() * 4)];
      const mark = index % 4;
      const rays = 6 + Math.floor(random() * 8);

      return (x, y, s) => {
        // Radial speed lines from the focal point: the single most recognisable convention-poster
        // device, and cheap to draw.
        const dx = x - 0.5;
        const dy = y - 0.42;
        const angle = Math.atan2(dy, dx);
        const ray = ((angle * rays) / Math.PI + 8) % 1;
        const spoke = ray < 0.5 ? 0.06 : 0;
        let result = { ...scaleColor(ground, 1 + spoke), a: 1 };

        // The focal mark.
        let glyph;
        if (mark === 0) {
          glyph = union(sdCircle(x, y, 0.5, 0.42, 0.2), sdPolygon(x, y, [[0.5, 0.16], [0.62, 0.42], [0.38, 0.42]]));
        } else if (mark === 1) {
          glyph = union(
            sdBox(x, y, 0.5, 0.42, 0.06, 0.24, 0.02),
            sdBox(x, y, 0.5, 0.42, 0.24, 0.06, 0.02),
          );
        } else if (mark === 2) {
          const points = [];
          for (let i = 0; i < 10; i += 1) {
            const a = (i / 10) * Math.PI * 2 - Math.PI / 2;
            const r = i % 2 === 0 ? 0.24 : 0.11;
            points.push([0.5 + Math.cos(a) * r, 0.42 + Math.sin(a) * r * 1.2]);
          }
          glyph = sdPolygon(x, y, points);
        } else {
          glyph = outline(sdCircle(x, y, 0.5, 0.42, 0.2), 0.05);
        }
        result = over(result, layer(fill(glyph, s), accent));
        result = over(result, layer(fill(intersect(halftone(x, y, 34, 0.6), glyph), s), ground));

        // Title bar and credits, as bars.
        const bar = sdBox(x, y, 0.5, 0.76, 0.4, 0.055, 0.01);
        result = over(result, layer(fill(bar, s), PAPER));
        result = over(result, layer(fill(textBlock(x, y, 0.14, 0.75, 0.72, 2, random, 0.016), s), ground));
        result = over(result, layer(fill(textBlock(x, y, 0.2, 0.88, 0.6, 3, random, 0.008), s), PAPER));

        // A margin, so the poster has an edge rather than bleeding into the wall texture.
        const frame = outline(sdBox(x, y, 0.5, 0.5, 0.47, 0.48, 0.01), 0.006);
        result = over(result, layer(fill(frame, s), accent));
        return result;
      };
    },
  },
};
