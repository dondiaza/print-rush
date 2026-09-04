import { fbm, makeRandom, valueNoise } from "./noise.mjs";
import { clamp01, hex, mixColor, scaleColor } from "./raster.mjs";

/**
 * Panoramic backdrops.
 *
 * These replace the flat clear-colour that sat behind every circuit. Each fallback is a 4096 × 2048
 * cylindrical panorama: a vertical gradient for the volume of the space, then layered silhouette
 * bands for depth, then practical lights.
 *
 * Production uses the authored WebP masters. These silhouette versions remain deliberately simple
 * fallbacks, so a missing bitmap degrades to a readable world instead of blocking the race. Their
 * parallax comes from three bands at different heights and contrasts: `far` is barely separated
 * from the sky, `near` is almost solid.
 *
 * Horizontal wrap: U is periodic, so every noise call uses the periodic generators and every
 * feature is placed with a wrapped X.
 */

/**
 * Splits U into `steps` cells, shifted by `phase` cell-widths, and returns the wrapped cell index
 * plus the position inside it.
 *
 * This is what makes a panorama actually seamless, and it took measuring to find. Every feature here
 * used to be placed with `(u * steps) % 1` or `Math.floor(u * steps)`, which puts a cell boundary
 * exactly on u = 0. Each such feature is hard-edged - a roof truss, a racking bay, a machine seam -
 * so the wrap column was the one column in the image where *every* feature changed at once, while
 * elsewhere their boundaries fell at different U and never coincided. Measured, the seam ran 9 to 17
 * against a 97th-percentile interior edge of 3 to 8: the worst edge in the picture not by accident
 * but by construction.
 *
 * With a `phase` anywhere in (0, 1) the wrap falls *inside* cell 0 rather than on its edge, so both
 * `index` and `local` are continuous across it. Giving each feature a different phase also spreads
 * their boundaries apart, so no column anywhere carries all of them at once.
 *
 * `index` is wrapped into [0, steps) so it is safe to use directly as a palette or lattice index:
 * at u = 0 and at u = 1 minus one pixel it is the same cell, which is the entire point.
 */
function cell(u, steps, phase = 0.5) {
  const shifted = u * steps + phase;
  const raw = Math.floor(shifted);
  return { index: ((raw % steps) + steps) % steps, local: shifted - raw };
}

/**
 * A skyline band: a stepped profile whose height varies with U. Returns the band's top, 0..1.
 *
 * Hard steps, deliberately. An earlier version blended the last 8 % of each bay into the next, which
 * left the final sampled column part-way between two bays while column zero held a pure bay value. A
 * building or racking profile has hard vertical edges anyway, so the blend bought nothing and cost
 * continuity. `cell` then keeps the remaining edge off the wrap.
 */
function skyline(u, { steps, base, variance, seed, phase = 0.5 }) {
  return base + valueNoise(cell(u, steps, phase).index, 0, steps, seed) * variance;
}

export const BACKDROPS = {
  /**
   * STORE — a deep commercial interior: a lit ceiling plane, distant display walls, warm bounce.
   */
  store: {
    build: ({ seed }) => {
      const ceiling = hex("#e8dfd0");
      const midWall = hex("#c9a074");
      const farWall = hex("#d8c8b2");
      const floor = hex("#6e6259");
      const accent = hex("#ff3da6");
      return (u, v) => {
        // Vertical gradient: bright ceiling, warm middle, darker floor.
        let color = v < 0.42
          ? mixColor(ceiling, farWall, v / 0.42)
          : mixColor(farWall, floor, clamp01((v - 0.42) / 0.58));

        // Ceiling light coffers, repeating around the panorama.
        if (v < 0.18) {
          const bay = cell(u, 22, 0.5).local;
          if (bay > 0.28 && bay < 0.72) color = scaleColor(ceiling, 1.12);
        }

        // Far display wall.
        const far = skyline(u, { steps: 26, base: 0.5, variance: 0.06, seed, phase: 0.5 });
        if (v > far) color = mixColor(color, scaleColor(farWall, 0.82), 0.7);

        // Near display wall, with lit shelf bands — the depth cue.
        const near = skyline(u, { steps: 13, base: 0.58, variance: 0.1, seed: seed + 31, phase: 0.31 });
        if (v > near) {
          color = mixColor(color, scaleColor(midWall, 0.66), 0.85);
          const shelf = ((v - near) * 26) % 1;
          if (shelf < 0.22) color = scaleColor(color, 1.35);
          // Occasional colour block: a garment display seen from a distance.
          const bay = cell(u, 13, 0.31).index;
          if (valueNoise(bay, 3, 13, seed + 7) > 0.72 && shelf > 0.3 && shelf < 0.8) {
            color = mixColor(color, accent, 0.4);
          }
        }

        return scaleColor(color, 0.96 + fbm(u, v, { octaves: 3, frequency: 6, seed }) * 0.08);
      };
    },
  },

  /**
   * WAREHOUSE — endless racking rows receding into haze. The one that has to sell scale.
   */
  warehouse: {
    build: ({ seed }) => {
      const roof = hex("#b8c4d0");
      const haze = hex("#8a97a4");
      const racking = hex("#5a6068");
      const carton = hex("#b98a57");
      const floor = hex("#4a4e54");
      return (u, v) => {
        let color = v < 0.3
          ? mixColor(roof, haze, v / 0.3)
          : mixColor(haze, floor, clamp01((v - 0.3) / 0.7));

        // Roof trusses.
        if (v < 0.22) {
          const truss = cell(u, 44, 0.5).local;
          if (truss < 0.06) color = scaleColor(roof, 0.72);
          const strip = cell(u, 11, 0.37).local;
          if (strip > 0.4 && strip < 0.6 && v > 0.06 && v < 0.1) color = scaleColor(roof, 1.3);
        }

        // Three receding racking rows. Each is taller, darker and more contrasted than the last,
        // which is what produces the parallax read.
        const rows = [
          { base: 0.44, variance: 0.05, steps: 40, tone: 0.55, seedOffset: 0, phase: 0.5 },
          { base: 0.5, variance: 0.08, steps: 24, tone: 0.72, seedOffset: 61, phase: 0.29 },
          { base: 0.58, variance: 0.12, steps: 14, tone: 0.9, seedOffset: 127, phase: 0.71 },
        ];
        for (const row of rows) {
          const top = skyline(u, { steps: row.steps, base: row.base, variance: row.variance, seed: seed + row.seedOffset, phase: row.phase });
          if (v <= top) continue;
          color = mixColor(color, scaleColor(racking, row.tone), 0.72);
          // Shelf decks, and cartons on them.
          const deck = ((v - top) * row.steps * 1.4) % 1;
          if (deck < 0.16) color = scaleColor(color, 1.28);
          else {
            const bay = cell(u, row.steps, row.phase).index;
            const level = Math.floor((v - top) * row.steps * 1.4);
            if (valueNoise(bay, level, row.steps, seed + row.seedOffset) > 0.42) {
              color = mixColor(color, scaleColor(carton, row.tone), 0.55);
            }
          }
        }
        return scaleColor(color, 0.96 + fbm(u, v, { octaves: 3, frequency: 5, seed }) * 0.08);
      };
    },
  },

  /**
   * SCREENPRINTING — the pilot circuit's backdrop. Machinery silhouettes, extraction ducting,
   * and the warm glow of the drying tunnels. This is the one that has to say "workshop" instantly.
   */
  screenprinting: {
    build: ({ seed }) => {
      const roof = hex("#5a5670");
      const haze = hex("#6a5a80");
      const machine = hex("#3a3f49");
      const floor = hex("#2b2732");
      const dryerGlow = hex("#ff6b2c");
      const inkViolet = hex("#8f5cff");
      const inkCyan = hex("#65d8ff");
      return (u, v) => {
        let color = v < 0.32
          ? mixColor(roof, haze, v / 0.32)
          : mixColor(haze, floor, clamp01((v - 0.32) / 0.68));

        // Extraction ducting across the ceiling: horizontal runs with periodic hangers.
        if (v > 0.08 && v < 0.16) {
          color = mixColor(color, scaleColor(machine, 1.1), 0.8);
          const rib = cell(u, 90, 0.5).local;
          if (rib < 0.14) color = scaleColor(color, 0.82);
        }
        if (v < 0.08) {
          const hanger = cell(u, 18, 0.43).local;
          if (hanger < 0.03) color = scaleColor(machine, 1.2);
        }

        // Far machinery line.
        const far = skyline(u, { steps: 30, base: 0.46, variance: 0.07, seed, phase: 0.5 });
        if (v > far) color = mixColor(color, scaleColor(machine, 0.8), 0.6);

        // Near machinery: taller blocks with lit control panels.
        const near = skyline(u, { steps: 12, base: 0.54, variance: 0.14, seed: seed + 53, phase: 0.27 });
        if (v > near) {
          color = mixColor(color, machine, 0.88);
          const bay = cell(u, 12, 0.27).index;
          const panelV = (v - near) / 0.4;
          // A lit control panel on some bays.
          if (panelV > 0.15 && panelV < 0.3 && valueNoise(bay, 1, 12, seed + 9) > 0.55) {
            const which = valueNoise(bay, 2, 12, seed + 13);
            color = which > 0.5 ? inkCyan : inkViolet;
          }
          // Vertical seams between machine bays.
          const seam = cell(u, 12, 0.27).local;
          if (seam < 0.02) color = scaleColor(color, 0.7);
        }

        // Drying tunnel mouths: warm glow low on the wall. The signature of the space.
        const tunnel = cell(u, 5, 0.5).local;
        if (v > 0.6 && v < 0.78 && tunnel > 0.34 && tunnel < 0.5) {
          const centre = 1 - Math.abs((tunnel - 0.42) / 0.08);
          const vertical = 1 - Math.abs((v - 0.69) / 0.09);
          color = mixColor(color, dryerGlow, clamp01(centre * vertical) * 0.95);
        }

        // Ink stains up the lower wall.
        if (v > 0.72) {
          const stain = fbm(u, v, { octaves: 4, frequency: 12, seed: seed + 21 });
          if (stain > 0.62) {
            color = mixColor(color, valueNoise(cell(u, 30, 0.5).index, 0, 30, seed) > 0.5 ? inkViolet : inkCyan, (stain - 0.62) * 1.4);
          }
        }

        return scaleColor(color, 0.95 + fbm(u, v, { octaves: 3, frequency: 6, seed }) * 0.1);
      };
    },
  },

  /**
   * OFFICE — a bright open plan continuing past the track: window bays, ceiling grid, desk rows.
   */
  office: {
    build: ({ seed }) => {
      const ceiling = hex("#f2f4f8");
      const wall = hex("#ded8cc");
      const glass = hex("#cfe4f2");
      const desk = hex("#a2764b");
      const floor = hex("#8c8378");
      const plant = hex("#4c7a4e");
      return (u, v) => {
        let color = v < 0.34 ? mixColor(ceiling, wall, v / 0.34) : mixColor(wall, floor, clamp01((v - 0.34) / 0.66));

        // Suspended ceiling grid.
        if (v < 0.2) {
          const gu = cell(u, 60, 0.5).local;
          const gv = (v * 12) % 1;
          if (gu < 0.05 || gv < 0.08) color = scaleColor(ceiling, 0.88);
          // Recessed light panels.
          const bay = cell(u, 15, 0.41).local;
          if (bay > 0.3 && bay < 0.7 && gv > 0.3 && gv < 0.7) color = scaleColor(ceiling, 1.14);
        }

        // Window bays: bright glass with mullions.
        if (v > 0.3 && v < 0.56) {
          const bay = cell(u, 16, 0.5).local;
          if (bay > 0.1 && bay < 0.9) {
            color = mixColor(color, glass, 0.7);
            // A hint of the city beyond, as a low-contrast band.
            if (v > 0.44 && v < 0.5) color = mixColor(color, scaleColor(glass, 0.78), 0.5);
          } else {
            color = scaleColor(wall, 0.9);
          }
        }

        // Desk row silhouette across the lower third.
        const desks = skyline(u, { steps: 20, base: 0.66, variance: 0.05, seed, phase: 0.33 });
        if (v > desks) {
          color = mixColor(color, desk, 0.6);
          // Monitors on some desks.
          const bay = cell(u, 20, 0.33).index;
          if ((v - desks) < 0.06 && valueNoise(bay, 1, 20, seed + 5) > 0.4) {
            color = mixColor(color, hex("#2b2732"), 0.8);
          }
          // The occasional plant breaking the line.
          if (valueNoise(bay, 7, 20, seed + 11) > 0.82 && (v - desks) < 0.1) {
            color = mixColor(color, plant, 0.7);
          }
        }
        return scaleColor(color, 0.97 + fbm(u, v, { octaves: 3, frequency: 5, seed }) * 0.06);
      };
    },
  },

  /**
   * MANGA — a dark convention hall: stand roofs, banner walls, screens and a crowd band.
   * The busiest of the five, which is what the circuit's identity asks for.
   */
  manga: {
    build: ({ seed }) => {
      const roof = hex("#241d3c");
      const haze = hex("#3c2a58");
      const floor = hex("#252036");
      const magenta = hex("#ff3da6");
      const cyan = hex("#65d8ff");
      const violet = hex("#8f5cff");
      const yellow = hex("#ffd43b");
      const neons = [magenta, cyan, violet, yellow];
      return (u, v) => {
        let color = v < 0.3 ? mixColor(roof, haze, v / 0.3) : mixColor(haze, floor, clamp01((v - 0.3) / 0.7));

        // Roof rigging and hanging banners.
        if (v < 0.1) {
          const truss = cell(u, 50, 0.5).local;
          if (truss < 0.08) color = scaleColor(roof, 1.5);
        }
        if (v > 0.1 && v < 0.34) {
          const bannerCell = cell(u, 9, 0.47);
          const banner = bannerCell.local;
          if (banner > 0.15 && banner < 0.85) {
            const which = bannerCell.index;
            const tint = neons[which % neons.length];
            // Banners as flat colour blocks with a horizontal rule: graphic, not illustrated.
            color = mixColor(color, scaleColor(tint, 0.55), 0.75);
            const rule = ((v - 0.1) * 14) % 1;
            if (rule < 0.14) color = scaleColor(color, 1.5);
          }
        }

        // Stand roofs: a busy silhouette line with lit signage.
        const stands = skyline(u, { steps: 18, base: 0.48, variance: 0.1, seed, phase: 0.23 });
        if (v > stands) {
          color = mixColor(color, scaleColor(floor, 1.2), 0.8);
          const bay = cell(u, 18, 0.23).index;
          const local = (v - stands) / 0.5;
          // Signage strip along the top of each stand.
          if (local < 0.1) {
            color = mixColor(color, neons[bay % neons.length], 0.85);
          } else if (local < 0.34 && valueNoise(bay, 2, 18, seed + 17) > 0.5) {
            // A lit screen inside the stand.
            color = mixColor(color, neons[(bay + 1) % neons.length], 0.4);
          }
        }

        // Crowd band along the bottom: many small silhouettes, deliberately low contrast.
        if (v > 0.78) {
          const crowd = cell(u, 220, 0.5);
          const heads = crowd.local;
          const headHeight = 0.82 + valueNoise(crowd.index, 0, 220, seed + 23) * 0.07;
          if (v > headHeight && heads > 0.2 && heads < 0.8) {
            color = scaleColor(floor, 0.62);
          }
        }

        return scaleColor(color, 0.94 + fbm(u, v, { octaves: 3, frequency: 7, seed }) * 0.12);
      };
    },
  },

  /** GREYBOX — a neutral studio surround for the handling lab, so it has depth without theme. */
  greybox: {
    build: ({ seed }) => {
      const top = hex("#cdd6e0");
      const bottom = hex("#4a4f57");
      return (u, v) => {
        const color = mixColor(top, bottom, v);
        // A faint horizon rule and 100 m grid posts, so speed reads even in the grey box.
        const horizon = Math.abs(v - 0.5) < 0.003 ? 1.25 : 1;
        const post = cell(u, 64, 0.5).local < 0.02 && v > 0.44 && v < 0.5 ? 0.8 : 1;
        return scaleColor(color, horizon * post * (0.98 + fbm(u, v, { octaves: 2, frequency: 4, seed }) * 0.04));
      };
    },
  },
};

export { makeRandom };
