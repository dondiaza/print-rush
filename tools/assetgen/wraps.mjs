import { fbm, makeRandom, torusDistance } from "./noise.mjs";
import { clamp01, falloff, hex, mixColor, scaleColor } from "./raster.mjs";

/**
 * Kart wraps.
 *
 * Six liveries, each a distinct graphic language rather than the same shape in a different colour —
 * which is the explicit requirement: "No cambiar solamente el color."
 *
 * These map onto the kart body's UV, which runs U around the hull and V along its length (see
 * `render/Geometry.ts` `loft`). So U is the wrap-around coordinate and V goes nose to tail, and the
 * designs are laid out accordingly: stripes run along V, side panels sit at particular U bands.
 *
 * None of these reference an existing motorsport livery, team or brand.
 */

const PALETTE = {
  magenta: hex("#ff3da6"),
  lime: hex("#b9ff45"),
  cyan: hex("#65d8ff"),
  violet: hex("#8f5cff"),
  yellow: hex("#ffd43b"),
  paper: hex("#f7f2e8"),
  ink: hex("#14121a"),
  orange: hex("#ff6b2c"),
  navy: hex("#2c3e70"),
  teal: hex("#1f7a6c"),
  sand: hex("#e8d5a8"),
  steel: hex("#8f979f"),
};

/** A soft grid, used by several wraps to break up large flat areas. */
function panelLines(u, v, spacing = 18, weight = 0.02) {
  const gu = Math.abs(((u * spacing) % 1) - 0.5) * 2;
  const gv = Math.abs(((v * spacing) % 1) - 0.5) * 2;
  return Math.max(gu > 1 - weight ? 1 : 0, gv > 1 - weight ? 1 : 0);
}

export const WRAPS = {
  /**
   * PAMPLING RACING — the house livery. Bold diagonal sweep, number roundel on the flanks.
   */
  pampling_racing: {
    build: ({ seed }) => (u, v) => {
      // Diagonal sweep across the body.
      const sweep = u * 0.6 + v * 1.4;
      let color = PALETTE.paper;
      if (sweep > 0.62 && sweep < 1.02) color = PALETTE.magenta;
      else if (sweep >= 1.02 && sweep < 1.14) color = PALETTE.lime;
      else if (sweep >= 1.14) color = PALETTE.ink;

      // Number roundels on both flanks: U bands roughly a quarter and three quarters round.
      for (const centre of [0.25, 0.75]) {
        const distance = Math.hypot((u - centre) * 1.6, v - 0.42);
        if (distance < 0.11) color = PALETTE.paper;
        if (distance < 0.085) color = PALETTE.ink;
        // A stylised numeral: a thick vertical bar with a foot. No typeface, no lettering.
        if (distance < 0.085) {
          const bar = Math.abs(u - centre) < 0.012 && Math.abs(v - 0.42) < 0.055;
          const foot = Math.abs(v - 0.472) < 0.012 && Math.abs(u - centre) < 0.03;
          if (bar || foot) color = PALETTE.paper;
        }
      }

      const wear = fbm(u, v, { octaves: 4, frequency: 26, seed });
      return scaleColor(color, 0.95 + wear * 0.1);
    },
  },

  /**
   * WITUKA SURF — soft wave bands, warm sand and teal. Illustration-adjacent without illustration.
   */
  wituka_surf: {
    build: ({ seed }) => (u, v) => {
      // Stacked sine bands along the body, warped so they read as waves.
      const warp = fbm(u, v, { octaves: 3, frequency: 4, seed }) * 0.12;
      const wave = v + Math.sin(u * Math.PI * 2 * 2) * 0.05 + warp;
      let color = PALETTE.sand;
      if (wave > 0.3) color = mixColor(PALETTE.teal, PALETTE.cyan, 0.35);
      if (wave > 0.46) color = PALETTE.cyan;
      if (wave > 0.58) color = mixColor(PALETTE.paper, PALETTE.cyan, 0.25);
      if (wave > 0.66) color = PALETTE.teal;

      // Foam speckle along each band edge.
      const edge = Math.abs(((wave * 6) % 1) - 0.5) * 2;
      const foam = edge > 0.9 ? fbm(u, v, { octaves: 4, frequency: 60, seed: seed + 3 }) : 0;
      return scaleColor(mixColor(color, PALETTE.paper, clamp01((foam - 0.55) * 2)), 0.97 + warp);
    },
  },

  /**
   * SCREENPRINT CMYK — the print factory livery: registration marks, halftone dots, ink splatter.
   */
  screenprint_cmyk: {
    build: ({ seed }) => {
      const random = makeRandom(seed);
      const splats = Array.from({ length: 10 }, () => ({
        x: random(),
        y: random(),
        r: 0.03 + random() * 0.07,
        color: [PALETTE.cyan, PALETTE.magenta, PALETTE.yellow, PALETTE.ink][Math.floor(random() * 4)],
      }));
      return (u, v) => {
        let color = PALETTE.paper;

        // Halftone: a dot grid whose radius rises toward the tail.
        const cell = 34;
        const gx = (u * cell) % 1;
        const gy = (v * cell) % 1;
        const dot = Math.hypot(gx - 0.5, gy - 0.5);
        const density = 0.12 + v * 0.26;
        if (dot < density) color = PALETTE.cyan;

        // CMYK registration bars near the nose.
        if (v < 0.14) {
          const band = Math.floor(u * 8) % 4;
          color = [PALETTE.cyan, PALETTE.magenta, PALETTE.yellow, PALETTE.ink][band];
        }

        // Crosshair registration marks on the flanks.
        for (const centre of [0.25, 0.75]) {
          const dx = Math.abs(u - centre);
          const dy = Math.abs(v - 0.62);
          if ((dx < 0.002 && dy < 0.05) || (dy < 0.002 && dx < 0.03)) color = PALETTE.ink;
          const ring = Math.hypot(dx * 1.6, dy);
          if (ring > 0.028 && ring < 0.032) color = PALETTE.ink;
        }

        // Ink splatter over the top.
        for (const splat of splats) {
          const distance = torusDistance(u, v, splat.x, splat.y);
          if (falloff(distance, splat.r, 0.35) > 0.5) color = splat.color;
        }
        return color;
      };
    },
  },

  /**
   * WAREHOUSE EXPRESS — logistics livery: safety hatching, label blocks, stencilled numbering.
   */
  warehouse_express: {
    build: ({ seed }) => (u, v) => {
      let color = PALETTE.steel;

      // Hazard hatching along the lower body.
      if (v > 0.7) {
        const diagonal = (u + v) * 14;
        color = diagonal - Math.floor(diagonal) < 0.5 ? PALETTE.yellow : PALETTE.ink;
      }

      // Label panels on the flanks: pale blocks with grey rules.
      for (const centre of [0.25, 0.75]) {
        if (Math.abs(u - centre) < 0.09 && v > 0.28 && v < 0.56) {
          color = { r: 0.95, g: 0.94, b: 0.9 };
          const rule = Math.floor((v - 0.28) / 0.035);
          const inRule = (v - 0.28) / 0.035 - rule < 0.45;
          const width = 0.3 + ((rule * 29) % 8) / 14;
          if (inRule && Math.abs(u - centre) < 0.09 * width * 2) color = { r: 0.28, g: 0.28, b: 0.3 };
        }
      }

      // A stencilled bar down the spine.
      if (Math.abs(u - 0.5) < 0.03 && v > 0.16 && v < 0.68) color = PALETTE.orange;

      const wear = fbm(u, v, { octaves: 5, frequency: 30, seed });
      const scuff = clamp01((wear - 0.62) * 2.2);
      return scaleColor(mixColor(color, PALETTE.steel, scuff * 0.5), 0.93 + wear * 0.14);
    },
  },

  /**
   * COMIC — flat graphic panels with heavy outlines and a benday dot field.
   */
  comic: {
    build: ({ seed }) => (u, v) => {
      // Angular panels, like a comic page.
      const panel = Math.floor(u * 5) + Math.floor(v * 3.5) * 5;
      const fields = [PALETTE.yellow, PALETTE.paper, PALETTE.magenta, PALETTE.cyan, PALETTE.paper];
      let color = fields[panel % fields.length];

      // Heavy black gutters between the panels.
      const gutterU = Math.abs(((u * 5) % 1) - 0.5) * 2;
      const gutterV = Math.abs(((v * 3.5) % 1) - 0.5) * 2;
      if (gutterU > 0.93 || gutterV > 0.94) color = PALETTE.ink;

      // Benday dots on the pale panels only.
      if (color === PALETTE.paper) {
        const cell = 46;
        const dot = Math.hypot(((u * cell) % 1) - 0.5, ((v * cell) % 1) - 0.5);
        if (dot < 0.22) color = PALETTE.magenta;
      }

      // A speed-line burst toward the nose.
      const angle = Math.atan2(v - 0.1, u - 0.5);
      const rays = Math.sin(angle * 22) > 0.72;
      if (v < 0.24 && rays) color = PALETTE.ink;

      void seed;
      return color;
    },
  },

  /**
   * RETRO — vintage motorsport: broad centre stripe, roundel, muted paint. Original layout.
   */
  retro: {
    build: ({ seed }) => (u, v) => {
      let color = mixColor(PALETTE.navy, PALETTE.paper, 0.12);

      // Twin centre stripes running nose to tail.
      const spine = Math.abs(u - 0.5);
      if (spine < 0.085) color = PALETTE.paper;
      if (spine < 0.055) color = mixColor(PALETTE.navy, PALETTE.ink, 0.4);
      if (spine < 0.02) color = PALETTE.paper;

      // Roundels on the flanks.
      for (const centre of [0.24, 0.76]) {
        const distance = Math.hypot((u - centre) * 1.55, v - 0.46);
        if (distance < 0.1) color = PALETTE.paper;
        if (distance < 0.075) color = mixColor(PALETTE.navy, PALETTE.ink, 0.3);
      }

      // A chrome-like flash along the shoulder line.
      if (Math.abs(v - 0.62) < 0.012) color = PALETTE.steel;

      const patina = fbm(u, v, { octaves: 4, frequency: 18, seed });
      return scaleColor(color, 0.9 + patina * 0.16);
    },
  },

  /**
   * NEON — dark body with emissive-looking grid and edge glow. Reads well in the Manga circuit.
   */
  neon: {
    build: ({ seed }) => (u, v) => {
      let color = scaleColor(PALETTE.ink, 0.9);

      // Perspective grid toward the tail.
      const gridV = Math.abs(((v * 22) % 1) - 0.5) * 2;
      const gridU = Math.abs(((u * 30) % 1) - 0.5) * 2;
      if (gridV > 0.92) color = mixColor(color, PALETTE.violet, 0.75);
      if (gridU > 0.94) color = mixColor(color, PALETTE.cyan, 0.6);

      // Glowing edge bands along the flanks.
      for (const centre of [0.15, 0.85]) {
        const band = Math.abs(u - centre);
        if (band < 0.02) color = PALETTE.magenta;
        else if (band < 0.035) color = mixColor(color, PALETTE.magenta, 0.5);
      }

      // Chevrons on the nose.
      if (v < 0.2) {
        const chevron = Math.abs(u - 0.5) * 2 + v * 2.2;
        if (chevron % 0.34 < 0.13) color = PALETTE.cyan;
      }

      const shimmer = fbm(u, v, { octaves: 3, frequency: 14, seed });
      return scaleColor(color, 0.95 + shimmer * 0.16);
    },
  },
};
