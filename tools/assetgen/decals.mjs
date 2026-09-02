import { fbm, makeRandom, torusDistance } from "./noise.mjs";
import { clamp01, falloff, hex, scaleColor } from "./raster.mjs";

/**
 * Decals: RGBA, projected onto surfaces.
 *
 * These are NOT tileable — a decal is a single mark placed once, so it must fade to zero alpha at
 * its own border or it shows as a visible rectangle on the floor. Every generator here multiplies
 * by `border()` for exactly that reason.
 *
 * The art bible's wear library, plus the ink splashes that are the print factory's signature.
 */

/** Fades alpha to zero at the edge of the image, so a decal never shows its own bounds. */
function border(u, v, margin = 0.06) {
  const edge = Math.min(u, v, 1 - u, 1 - v);
  return clamp01(edge / margin);
}

/** An irregular blob: a circle whose radius is modulated by angular noise. Reads as a splash. */
function blob(u, v, cx, cy, radius, lobes, seed, wobble = 0.45) {
  const dx = u - cx;
  const dy = v - cy;
  const distance = Math.hypot(dx, dy);
  const angle = Math.atan2(dy, dx);
  // Two harmonics, so the outline is uneven rather than a smooth ellipse.
  const modulation =
    1 +
    Math.sin(angle * lobes + seed) * wobble * 0.5 +
    Math.sin(angle * (lobes * 2 + 1) - seed * 1.7) * wobble * 0.25;
  const effective = radius * modulation;
  return distance > effective ? 0 : clamp01(1 - (distance / effective) ** 3);
}

export const DECALS = {
  /** Ink splash. Four variants; the main blob plus satellite droplets, which is what sells it. */
  ink_splash: {
    count: 4,
    size: 512,
    build: ({ seed, color }) => {
      const random = makeRandom(seed);
      const lobes = 5 + Math.floor(random() * 4);
      const droplets = Array.from({ length: 14 }, () => ({
        x: 0.5 + (random() - 0.5) * 0.78,
        y: 0.5 + (random() - 0.5) * 0.78,
        r: 0.008 + random() * 0.035,
        lobes: 3 + Math.floor(random() * 3),
      }));
      // A few thin flicks, as if the ink was thrown.
      const flicks = Array.from({ length: 5 }, () => ({
        angle: random() * Math.PI * 2,
        length: 0.16 + random() * 0.2,
        width: 0.004 + random() * 0.006,
      }));

      return (u, v) => {
        let alpha = blob(u, v, 0.5, 0.5, 0.26, lobes, seed, 0.5);
        for (const drop of droplets) {
          alpha = Math.max(alpha, blob(u, v, drop.x, drop.y, drop.r, drop.lobes, seed + drop.r * 1000, 0.6));
        }
        for (const flick of flicks) {
          // Distance from the point to the flick's line segment, in normalised units.
          const ex = 0.5 + Math.cos(flick.angle) * flick.length;
          const ey = 0.5 + Math.sin(flick.angle) * flick.length;
          const vx = ex - 0.5;
          const vy = ey - 0.5;
          const t = clamp01(((u - 0.5) * vx + (v - 0.5) * vy) / (vx * vx + vy * vy));
          const px = 0.5 + vx * t;
          const py = 0.5 + vy * t;
          const distance = Math.hypot(u - px, v - py);
          // Tapers along its length, like a real flick of ink.
          alpha = Math.max(alpha, falloff(distance, flick.width * (1 - t * 0.75), 0.4));
        }
        const shade = 0.82 + fbm(u, v, { octaves: 3, frequency: 12, seed }) * 0.3;
        return { ...scaleColor(color, shade), a: alpha * border(u, v) };
      };
    },
  },

  /** Scratches. Thin, straight, clustered — how a scuff on painted metal actually looks. */
  scratch: {
    count: 3,
    size: 512,
    build: ({ seed }) => {
      const random = makeRandom(seed);
      const lines = Array.from({ length: 9 }, () => ({
        x: random(),
        y: random(),
        angle: (random() - 0.5) * 0.7 + (random() > 0.5 ? 0 : Math.PI / 2),
        length: 0.1 + random() * 0.5,
        width: 0.0012 + random() * 0.0022,
        strength: 0.35 + random() * 0.5,
      }));
      return (u, v) => {
        let alpha = 0;
        for (const line of lines) {
          const vx = Math.cos(line.angle) * line.length;
          const vy = Math.sin(line.angle) * line.length;
          const t = clamp01(((u - line.x) * vx + (v - line.y) * vy) / (vx * vx + vy * vy));
          const px = line.x + vx * t;
          const py = line.y + vy * t;
          const distance = Math.hypot(u - px, v - py);
          // Fades at both ends, so a scratch does not stop abruptly.
          const taper = Math.sin(t * Math.PI) ** 0.4;
          alpha = Math.max(alpha, falloff(distance, line.width, 0.3) * line.strength * taper);
        }
        // A 3 % margin left 12/255 of alpha on the outermost pixels, which draws the decal's own
        // bounding box on the surface. Scratches are placed near the edge by design, so they need a
        // wide fade rather than a narrow one.
        return { r: 0.88, g: 0.9, b: 0.93, a: alpha * border(u, v, 0.1) };
      };
    },
  },

  /** Ground dirt. Broad, soft, low alpha — the thing that stops a floor reading as new. */
  dirt: {
    count: 3,
    size: 512,
    build: ({ seed }) => (u, v) => {
      const patch = fbm(u, v, { octaves: 5, frequency: 5, seed });
      const radial = falloff(Math.hypot(u - 0.5, v - 0.5), 0.48, 1.1);
      // Peaked at 64/255 in the first version, which is too faint to read on a floor at speed.
      // The threshold is lower and the gain higher, so the densest part of the patch is opaque.
      const alpha = clamp01((patch - 0.34) * 2.6) * radial * 0.85;
      const shade = 0.3 + patch * 0.22;
      return { r: shade * 0.9, g: shade * 0.84, b: shade * 0.74, a: alpha * border(u, v) };
    },
  },

  /** Packing tape: a straight translucent strip with frayed ends. */
  tape: {
    count: 2,
    size: 512,
    build: ({ seed }) => {
      const random = makeRandom(seed);
      const angle = (random() - 0.5) * 0.24;
      const halfWidth = 0.085;
      return (u, v) => {
        // Rotate into the strip's frame.
        const cu = u - 0.5;
        const cv = v - 0.5;
        const ru = cu * Math.cos(angle) - cv * Math.sin(angle);
        const rv = cu * Math.sin(angle) + cv * Math.cos(angle);
        if (Math.abs(rv) > halfWidth) return { r: 0, g: 0, b: 0, a: 0 };
        // Frayed, uneven ends rather than a clean cut.
        const endFray = fbm(u * 3, v * 3, { octaves: 3, frequency: 9, seed }) * 0.06;
        const along = clamp01((0.46 - Math.abs(ru) + endFray) / 0.05);
        // Creases along the strip catch the light.
        const crease = 1 + Math.sin(rv * 140) * 0.05;
        const edge = clamp01((halfWidth - Math.abs(rv)) / 0.008);
        return {
          r: 0.86 * crease,
          g: 0.84 * crease,
          b: 0.78 * crease,
          // `border` as well as the strip's own ends: after rotation the strip can still reach the
          // image edge, and it measured 33/255 of alpha there — a visible rectangle.
          a: along * edge * 0.66 * border(u, v, 0.05),
        };
      };
    },
  },

  /** Shipping label: a pale rectangle with a barcode block and text bands. No real text. */
  label: {
    count: 3,
    size: 512,
    build: ({ seed }) => {
      const random = makeRandom(seed);
      const bars = Array.from({ length: 34 }, () => 0.3 + random() * 0.7);
      const rotation = (random() - 0.5) * 0.09;
      return (u, v) => {
        const cu = u - 0.5;
        const cv = v - 0.5;
        const ru = cu * Math.cos(rotation) - cv * Math.sin(rotation) + 0.5;
        const rv = cu * Math.sin(rotation) + cv * Math.cos(rotation) + 0.5;
        if (ru < 0.12 || ru > 0.88 || rv < 0.2 || rv > 0.8) return { r: 0, g: 0, b: 0, a: 0 };

        const paper = { r: 0.96, g: 0.95, b: 0.91 };
        // Barcode block in the lower third.
        if (rv > 0.56 && rv < 0.74) {
          const index = Math.floor(((ru - 0.12) / 0.76) * bars.length);
          const bar = bars[Math.max(0, Math.min(bars.length - 1, index))];
          const ink = bar > 0.55 ? 0.09 : 0.94;
          return { r: ink, g: ink, b: ink, a: 0.95 };
        }
        // Text bands in the upper two thirds: grey rules, not lettering.
        const band = Math.floor((rv - 0.2) / 0.055);
        const inBand = (rv - 0.2) / 0.055 - band < 0.5;
        const bandWidth = 0.3 + ((band * 37) % 9) / 18;
        if (inBand && ru < 0.12 + 0.76 * bandWidth) {
          return { r: 0.24, g: 0.24, b: 0.27, a: 0.9 };
        }
        return { ...paper, a: 0.95 };
      };
    },
  },

  /** Sticker: a rounded shape with a coloured ring. Stands in for branding without inventing one. */
  sticker: {
    count: 3,
    size: 256,
    build: ({ seed, color }) => {
      const random = makeRandom(seed);
      const sides = 3 + Math.floor(random() * 5);
      const rotation = random() * Math.PI;
      return (u, v) => {
        const dx = u - 0.5;
        const dy = v - 0.5;
        const distance = Math.hypot(dx, dy);
        const angle = Math.atan2(dy, dx) + rotation;
        // A rounded polygon: the radius dips between the vertices.
        const radius = 0.34 * (0.86 + 0.14 * Math.cos(angle * sides));
        if (distance > radius) return { r: 0, g: 0, b: 0, a: 0 };
        const edge = clamp01((radius - distance) / 0.012);
        // White border, coloured field, darker core ring.
        if (distance > radius * 0.86) return { r: 0.97, g: 0.96, b: 0.93, a: edge };
        if (distance > radius * 0.52) return { ...color, a: 1 };
        return { ...scaleColor(color, 0.55), a: 1 };
      };
    },
  },

  /** Shoe and tyre marks on the floor. Directional smears. */
  floor_mark: {
    count: 3,
    size: 512,
    build: ({ seed }) => {
      const random = makeRandom(seed);
      const angle = random() * Math.PI * 2;
      return (u, v) => {
        const cu = u - 0.5;
        const cv = v - 0.5;
        const along = cu * Math.cos(angle) + cv * Math.sin(angle);
        const across = -cu * Math.sin(angle) + cv * Math.cos(angle);
        const smear = fbm(u * 2, v * 2, { octaves: 4, frequency: 14, seed });
        const shape = falloff(Math.abs(across), 0.06 + smear * 0.04, 0.6) * falloff(Math.abs(along), 0.36, 1.2);
        const alpha = clamp01(shape * (smear + 0.25)) * 0.55;
        return { r: 0.14, g: 0.14, b: 0.16, a: alpha * border(u, v) };
      };
    },
  },
};

/** Colours cycled through the coloured decal families, from the brand palette. */
export const DECAL_COLORS = ["#ff3da6", "#65d8ff", "#b9ff45", "#ffd43b", "#8f5cff"].map(hex);
