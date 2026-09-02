import { fbm, makeRandom, streaks, torusDistance, valueNoise, worley } from "./noise.mjs";
import { clamp01, falloff, hex, lerp, mixColor, scaleColor } from "./raster.mjs";

/**
 * Tileable material definitions.
 *
 * Each material is a triple of pure functions of normalised (u, v):
 *   `color`     the basecolour
 *   `height`    the surface relief the normal map is derived from
 *   `roughness` how rough the surface is, per texel
 *
 * Keeping height separate from colour is what stops a stain reading as a bump. Everything is built
 * from periodic noise, so all three wrap.
 *
 * The classes and their roughness values come from `ART_BIBLE_V5.md` §4.1 — this is the same table,
 * expressed as texture rather than as a constant.
 */

/** Low-frequency staining. Every surface gets some, or it reads as flat colour at distance. */
function staining(u, v, seed, amount = 0.08) {
  return 1 - fbm(u, v, { octaves: 3, frequency: 3, seed }) * amount;
}

export const MATERIALS = {
  // ------------------------------------------------------------------ ASPHALT
  asphalt: {
    tile: 4.5,
    base: "#3a3a40",
    build: ({ base, seed }) => {
      const chippings = (u, v) => worley(u, v, 26, seed);
      const grain = (u, v) => fbm(u, v, { octaves: 5, frequency: 22, seed: seed + 3 });
      return {
        height: (u, v) => chippings(u, v) * 0.65 + grain(u, v) * 0.35,
        color: (u, v) => {
          const c = chippings(u, v);
          const g = grain(u, v);
          // Aggregate reads lighter than the binder around it.
          const shade = 0.78 + c * 0.34 + (g - 0.5) * 0.16;
          return scaleColor(base, shade * staining(u, v, seed + 11, 0.12));
        },
        roughness: (u, v) => clamp01(0.94 - worley(u, v, 26, seed) * 0.08),
      };
    },
  },

  // ------------------------------------------------------------------ CONCRETE
  concrete: {
    tile: 3.2,
    base: "#8d8f93",
    build: ({ base, seed }) => {
      const aggregate = (u, v) => worley(u, v, 14, seed);
      const grain = (u, v) => fbm(u, v, { octaves: 5, frequency: 14, seed: seed + 5 });
      // Trowel marks: broad, soft, directional. The thing that says "poured floor".
      const trowel = (u, v) => fbm(u * 0.35 + v * 0.1, v * 2.2, { octaves: 2, frequency: 4, seed: seed + 9 });
      return {
        height: (u, v) => aggregate(u, v) * 0.4 + grain(u, v) * 0.6,
        color: (u, v) => {
          const shade = 0.86 + grain(u, v) * 0.2 + (trowel(u, v) - 0.5) * 0.12;
          return scaleColor(base, shade * staining(u, v, seed + 17, 0.16));
        },
        roughness: (u, v) => clamp01(0.9 - fbm(u, v, { octaves: 3, frequency: 9, seed: seed + 23 }) * 0.1),
      };
    },
  },

  // ------------------------------------------------------------------ FLOOR TILE
  floorTile: {
    tile: 2.4,
    base: "#8e857b",
    build: ({ base, seed }) => {
      const cells = 4;
      const groutWidth = 0.016;
      // Distance to the nearest grout line, in tile units.
      const groutMask = (u, v) => {
        const fx = Math.abs(((u * cells) % 1) - 0.5);
        const fy = Math.abs(((v * cells) % 1) - 0.5);
        const edge = Math.max(fx, fy);
        return edge > 0.5 - groutWidth * cells ? 1 : 0;
      };
      const tileIndex = (u, v) => Math.floor(u * cells) + Math.floor(v * cells) * cells;
      return {
        height: (u, v) => (groutMask(u, v) ? 0.2 : 0.8 + fbm(u, v, { octaves: 3, frequency: 18, seed }) * 0.2),
        color: (u, v) => {
          if (groutMask(u, v)) return scaleColor(base, 0.52);
          // Every tile a slightly different shade. Identical tiles are what makes a floor read as
          // a texture rather than as a floor.
          const index = tileIndex(u, v);
          const perTile = 0.9 + ((index * 37) % 11) / 40;
          const speckle = fbm(u, v, { octaves: 4, frequency: 26, seed: seed + 4 });
          const polish = 1 + (v * 0.06 - 0.03);
          return scaleColor(base, perTile * (0.94 + speckle * 0.14) * polish * staining(u, v, seed + 31, 0.07));
        },
        roughness: (u, v) => (groutMask(u, v) ? 0.86 : clamp01(0.5 + fbm(u, v, { octaves: 2, frequency: 7, seed: seed + 8 }) * 0.14)),
      };
    },
  },

  // ------------------------------------------------------------------ WOOD
  wood: {
    tile: 2.2,
    base: "#b07a45",
    build: ({ base, seed }) => {
      // Grain runs along v. Warped so the rings are not machine-straight.
      const grain = (u, v) => {
        const warp = fbm(u, v, { octaves: 3, frequency: 3, seed }) * 0.12;
        const rings = Math.sin((u + warp) * Math.PI * 2 * 9) * 0.5 + 0.5;
        const fine = streaks(v, u, { frequency: 90, warp: 0.03, seed: seed + 2 });
        return rings * 0.7 + fine * 0.3;
      };
      const knots = (u, v) => {
        const random = makeRandom(seed + 77);
        let mask = 0;
        for (let index = 0; index < 3; index += 1) {
          const kx = random();
          const ky = random();
          const radius = 0.03 + random() * 0.03;
          mask = Math.max(mask, falloff(torusDistance(u, v, kx, ky), radius, 0.7));
        }
        return mask;
      };
      return {
        height: (u, v) => grain(u, v) * 0.7 + knots(u, v) * 0.3,
        color: (u, v) => {
          const g = grain(u, v);
          const k = knots(u, v);
          const light = mixColor(base, scaleColor(base, 1.25), g);
          return scaleColor(mixColor(light, scaleColor(base, 0.5), k * 0.8), staining(u, v, seed + 13, 0.1));
        },
        roughness: (u, v) => clamp01(0.72 - grain(u, v) * 0.1),
      };
    },
  },

  // ------------------------------------------------------------------ CARPET
  carpet: {
    tile: 1.6,
    base: "#7d7469",
    build: ({ base, seed }) => {
      // Dense short fibres: high-frequency worley reads as pile better than noise alone.
      const pile = (u, v) => worley(u, v, 90, seed) * 0.6 + fbm(u, v, { octaves: 4, frequency: 60, seed: seed + 3 }) * 0.4;
      return {
        height: pile,
        color: (u, v) => {
          const p = pile(u, v);
          // Broad tonal drift, as if laid in strips.
          const strips = Math.sin(u * Math.PI * 2 * 3) * 0.02;
          return scaleColor(base, (0.88 + p * 0.26 + strips) * staining(u, v, seed + 19, 0.09));
        },
        roughness: () => 0.95,
      };
    },
  },

  // ------------------------------------------------------------------ CARDBOARD
  cardboard: {
    tile: 0.9,
    base: "#b98a57",
    build: ({ base, seed }) => {
      // Pulp fibres plus the flute of the corrugation, visible as a soft ripple.
      const fibre = (u, v) => fbm(u, v, { octaves: 5, frequency: 40, seed });
      const flute = (u) => Math.sin(u * Math.PI * 2 * 34) * 0.5 + 0.5;
      return {
        height: (u, v) => fibre(u, v) * 0.75 + flute(u) * 0.25,
        color: (u, v) => {
          const f = fibre(u, v);
          const shade = 0.9 + f * 0.2 + (flute(u) - 0.5) * 0.05;
          return scaleColor(base, shade * staining(u, v, seed + 29, 0.12));
        },
        roughness: (u, v) => clamp01(0.88 - fbm(u, v, { octaves: 2, frequency: 12, seed: seed + 6 }) * 0.06),
      };
    },
  },

  // ------------------------------------------------------------------ PAINTED METAL
  paintedMetal: {
    tile: 1.6,
    base: "#5a6068",
    build: ({ base, seed }) => {
      const orangePeel = (u, v) => fbm(u, v, { octaves: 4, frequency: 34, seed });
      // Chipped paint at wear points, showing darker primer.
      const chips = (u, v) => {
        const random = makeRandom(seed + 401);
        let mask = 0;
        for (let index = 0; index < 14; index += 1) {
          const cx = random();
          const cy = random();
          const radius = 0.006 + random() * 0.016;
          mask = Math.max(mask, falloff(torusDistance(u, v, cx, cy), radius, 0.25));
        }
        return mask;
      };
      return {
        height: (u, v) => orangePeel(u, v) * 0.6 + chips(u, v) * 0.4,
        color: (u, v) => {
          const peel = orangePeel(u, v);
          const chip = chips(u, v);
          const painted = scaleColor(base, 0.94 + peel * 0.14);
          return mixColor(painted, scaleColor(base, 0.42), chip * 0.85);
        },
        roughness: (u, v) => clamp01(0.42 + chips(u, v) * 0.4 + fbm(u, v, { octaves: 2, frequency: 10, seed: seed + 12 }) * 0.08),
      };
    },
  },

  // ------------------------------------------------------------------ RAW METAL
  rawMetal: {
    tile: 1.1,
    base: "#a8afb6",
    build: ({ base, seed }) => {
      // Anisotropic scratches. Metal that is not directional reads as plastic.
      const brushed = (u, v) => streaks(u, v, { frequency: 140, warp: 0.02, seed }) * 0.6
        + streaks(u, v, { frequency: 40, warp: 0.05, seed: seed + 3 }) * 0.4;
      const gouges = (u, v) => fbm(u * 4, v * 0.2, { octaves: 3, frequency: 18, seed: seed + 7 });
      return {
        height: (u, v) => brushed(u, v) * 0.7 + gouges(u, v) * 0.3,
        color: (u, v) => scaleColor(base, 0.86 + brushed(u, v) * 0.26),
        // Roughness varies with the scratch direction, which is what produces the streaked
        // highlight a brushed surface has.
        roughness: (u, v) => clamp01(0.2 + brushed(u, v) * 0.24),
      };
    },
  },

  // ------------------------------------------------------------------ RUBBER
  rubber: {
    tile: 0.4,
    base: "#17171c",
    build: ({ base, seed }) => {
      const grain = (u, v) => worley(u, v, 60, seed) * 0.5 + fbm(u, v, { octaves: 4, frequency: 44, seed: seed + 2 }) * 0.5;
      // Moulding seams and a coarser blocky tread break up the grain.
      const tread = (u, v) => (worley(u, v, 9, seed + 31) > 0.42 ? 1 : 0.72);
      return {
        height: (u, v) => grain(u, v) * 0.7 + tread(u, v) * 0.3,
        /**
         * Rubber is nearly black, so a multiplicative range of 0.8 to 1.3 on a base of about 23
         * produced a total spread of twelve levels and measured as flat. Lifting the base and
         * widening the multiplier gives it visible grain without making the tyre grey.
         */
        color: (u, v) => scaleColor(base, (0.75 + grain(u, v) * 1.5) * tread(u, v) * 1.35),
        roughness: (u, v) => clamp01(0.9 + grain(u, v) * 0.08),
      };
    },
  },

  // ------------------------------------------------------------------ FABRIC
  // The most important material in the game: t-shirts are the subject, and a shirt that reads as
  // plastic undermines the premise. Visible weave, very high roughness, zero metallic.
  fabric: {
    tile: 0.35,
    base: "#f2ede4",
    build: ({ base, seed }) => {
      const weave = (u, v) => {
        /**
         * Warp and weft as a smooth product rather than a binary over-under step.
         *
         * The step version had a real seam, measured at 21x the local pixel difference: at u = 0 the
         * sine is exactly zero, and at the opposite edge it is zero from the other side, so the sign
         * test flipped across the wrap and produced a hard line down the tile. It also gave the
         * normal map near-infinite gradients, which is why its z channel failed validation.
         *
         * The product is continuous everywhere and still periodic, so the weave reads as quilted
         * cloth with no seam and a usable normal.
         */
        const threads = 42;
        const warp = Math.sin(u * Math.PI * 2 * threads);
        const weft = Math.sin(v * Math.PI * 2 * threads);
        const quilt = warp * weft * 0.5 + 0.5;
        const fuzz = fbm(u, v, { octaves: 4, frequency: 70, seed });
        return quilt * 0.6 + fuzz * 0.4;
      };
      return {
        height: weave,
        color: (u, v) => scaleColor(base, 0.84 + weave(u, v) * 0.3),
        // Flat and very high. Any specular concentration on cloth is wrong.
        roughness: () => 0.93,
      };
    },
  },

  // ------------------------------------------------------------------ PAPER
  paper: {
    tile: 0.8,
    base: "#f7f2e8",
    build: ({ base, seed }) => {
      const fibre = (u, v) => fbm(u, v, { octaves: 5, frequency: 55, seed });
      return {
        height: (u, v) => fibre(u, v),
        color: (u, v) => scaleColor(base, 0.96 + fibre(u, v) * 0.08),
        roughness: () => 0.86,
      };
    },
  },

  // ------------------------------------------------------------------ INK
  // The print factory's signature surface: wet, pooling, low grip.
  ink: {
    tile: 2.4,
    base: "#8f5cff",
    build: ({ base, seed }) => {
      const pools = (u, v) => {
        const random = makeRandom(seed + 991);
        let mask = 0;
        for (let index = 0; index < 22; index += 1) {
          const cx = random();
          const cy = random();
          const radius = 0.05 + random() * 0.14;
          mask = Math.max(mask, falloff(torusDistance(u, v, cx, cy), radius, 0.85));
        }
        return mask;
      };
      return {
        // Wet ink is flat; the relief is only the meniscus at a pool edge.
        height: (u, v) => 0.5 + pools(u, v) * 0.12,
        color: (u, v) => {
          const p = pools(u, v);
          const sheen = fbm(u, v, { octaves: 3, frequency: 8, seed: seed + 4 });
          return scaleColor(base, 0.7 + p * 0.5 + sheen * 0.12);
        },
        // Wet surfaces are smooth, which is exactly why they have no grip.
        roughness: (u, v) => clamp01(0.3 - pools(u, v) * 0.2),
      };
    },
  },

  // ------------------------------------------------------------------ PLASTIC
  plastic: {
    tile: 1.4,
    base: "#3e6e9e",
    build: ({ base, seed }) => {
      const texture = (u, v) => fbm(u, v, { octaves: 3, frequency: 30, seed });
      // Moulding marks: the faint concentric flow lines injection-moulded plastic has.
      const flow = (u, v) => (Math.sin(fbm(u, v, { octaves: 2, frequency: 4, seed: seed + 5 }) * 22) + 1) / 2;
      const scuff = (u, v) => fbm(u, v, { octaves: 5, frequency: 40, seed: seed + 9 });
      return {
        height: (u, v) => 0.5 + (texture(u, v) - 0.5) * 0.3 + flow(u, v) * 0.12,
        // The first version varied brightness by 6 %, which measured as a flat colour: a range of
        // nine levels out of 255. Plastic is smooth, but it is not featureless.
        color: (u, v) => scaleColor(base, 0.84 + texture(u, v) * 0.22 + flow(u, v) * 0.12),
        roughness: (u, v) => clamp01(0.32 + texture(u, v) * 0.1 + scuff(u, v) * 0.08),
      };
    },
  },

  // ------------------------------------------------------------------ SCREEN
  screen: {
    tile: 1,
    base: "#65d8ff",
    build: ({ base, seed }) => {
      // Scanline structure plus a subpixel grid. Reads as a panel rather than a glowing rectangle.
      const scan = (v) => (Math.sin(v * Math.PI * 2 * 96) * 0.5 + 0.5) * 0.3 + 0.7;
      const grid = (u) => (Math.sin(u * Math.PI * 2 * 128) * 0.5 + 0.5) * 0.15 + 0.85;
      return {
        height: () => 0.5,
        color: (u, v) => {
          const flicker = valueNoise(u * 8, v * 8, 8, seed) * 0.06;
          return scaleColor(base, scan(v) * grid(u) * (1 + flicker));
        },
        roughness: () => 0.18,
      };
    },
  },

  // ------------------------------------------------------------------ SAFETY MARKING
  // Hazard hatching for warehouse edges and dock lines. On-theme and functional: it tells the
  // player where the drivable surface ends.
  safety: {
    tile: 1.2,
    base: "#ffc02e",
    build: ({ base, seed }) => {
      const stripes = (u, v) => {
        const diagonal = (u + v) * 6;
        return diagonal - Math.floor(diagonal) < 0.5 ? 1 : 0;
      };
      const wear = (u, v) => fbm(u, v, { octaves: 4, frequency: 26, seed });
      return {
        height: (u, v) => 0.5 + wear(u, v) * 0.2,
        color: (u, v) => {
          const s = stripes(u, v);
          const w = wear(u, v);
          const painted = s ? base : { r: 0.1, g: 0.1, b: 0.12 };
          // Paint wears off where traffic crosses it, showing the concrete beneath.
          const scuffed = mixColor(painted, { r: 0.55, g: 0.55, b: 0.56 }, clamp01((w - 0.62) * 2.6));
          return scaleColor(scuffed, 0.92 + w * 0.16);
        },
        roughness: (u, v) => clamp01(0.7 + wear(u, v) * 0.2),
      };
    },
  },
};

/**
 * Per-circuit material variants. Same generator, different base colour and seed — which is how one
 * material class dresses five different spaces without five sets of code.
 */
export const MATERIAL_VARIANTS = [
  // Shared set, used by every circuit.
  { id: "asphalt_default", material: "asphalt", scope: "common" },
  { id: "concrete_default", material: "concrete", scope: "common" },
  { id: "rawmetal_default", material: "rawMetal", scope: "common" },
  { id: "rubber_default", material: "rubber", scope: "common" },
  { id: "cardboard_default", material: "cardboard", scope: "common" },
  { id: "paper_default", material: "paper", scope: "common" },
  { id: "fabric_white", material: "fabric", scope: "common" },
  { id: "fabric_magenta", material: "fabric", scope: "common", base: "#ff3da6" },
  { id: "fabric_cyan", material: "fabric", scope: "common", base: "#65d8ff" },
  { id: "screen_cyan", material: "screen", scope: "common" },
  { id: "safety_yellow", material: "safety", scope: "common" },

  // T-Shirt Megastore: warm timber and polished commercial floor.
  { id: "floortile_store", material: "floorTile", scope: "store", base: "#8e857b" },
  { id: "wood_store", material: "wood", scope: "store", base: "#c98a52" },
  { id: "carpet_store", material: "carpet", scope: "store", base: "#8a7f74" },

  // Warehouse: sealed concrete and painted racking.
  { id: "concrete_warehouse", material: "concrete", scope: "warehouse", base: "#6f7378" },
  { id: "paintedmetal_racking", material: "paintedMetal", scope: "warehouse", base: "#5a6068" },
  { id: "plastic_pallet", material: "plastic", scope: "warehouse", base: "#3e6e9e" },

  // Print factory: dark epoxy floor and the ink that defines the circuit.
  { id: "concrete_factory", material: "concrete", scope: "screenprinting", base: "#4a4550" },
  { id: "paintedmetal_press", material: "paintedMetal", scope: "screenprinting", base: "#3a3f49" },
  { id: "ink_violet", material: "ink", scope: "screenprinting", base: "#8f5cff" },
  { id: "ink_magenta", material: "ink", scope: "screenprinting", base: "#ff3da6" },
  { id: "ink_cyan", material: "ink", scope: "screenprinting", base: "#65d8ff" },
  { id: "ink_yellow", material: "ink", scope: "screenprinting", base: "#ffd43b" },

  // Office: carpet tiles and desk timber.
  { id: "carpet_office", material: "carpet", scope: "office", base: "#7d7469" },
  { id: "wood_desk", material: "wood", scope: "office", base: "#a2764b" },
  { id: "floortile_office", material: "floorTile", scope: "office", base: "#ddd8cf" },

  // Convention hall: dark event carpet and stage timber.
  { id: "carpet_manga", material: "carpet", scope: "manga", base: "#2f2a44" },
  { id: "wood_stage", material: "wood", scope: "manga", base: "#4a3b30" },
  { id: "screen_magenta", material: "screen", scope: "manga", base: "#ff3da6" },
];

/** Resolves a variant into its three shading functions. */
export function buildVariant(variant) {
  const definition = MATERIALS[variant.material];
  if (!definition) throw new Error(`unknown material class: ${variant.material}`);
  // A stable seed per id, so a variant's texture never changes between builds.
  let seed = 0;
  for (let index = 0; index < variant.id.length; index += 1) {
    seed = (seed * 31 + variant.id.charCodeAt(index)) >>> 0;
  }
  const base = hex(variant.base ?? definition.base);
  return { ...definition.build({ base, seed }), tile: definition.tile, class: variant.material };
}

export { lerp };
