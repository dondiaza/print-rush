/**
 * Periodic noise.
 *
 * Every function here wraps exactly at the tile boundary. That is the whole point: a texture that
 * repeats across a warehouse floor cannot have a visible seam, and the reliable way to guarantee
 * that is to build the noise on a lattice that is periodic by construction rather than to blend the
 * edges of an aperiodic one afterwards.
 *
 * All of it is deterministic from a seed, so a rebuild produces byte-identical files and the repo
 * does not churn.
 */

/** Integer hash. Deterministic, no allocation, good enough distribution for texture work. */
function hash3(x, y, seed) {
  let h = (x | 0) * 374_761_393 + (y | 0) * 668_265_263 + (seed | 0) * 1_442_695_040;
  h = (h ^ (h >>> 13)) * 1_274_126_177;
  h ^= h >>> 16;
  return (h >>> 0) / 4_294_967_295;
}

/** Smoothstep. Cheaper than a cosine and visually indistinguishable at texture scale. */
function smooth(t) {
  return t * t * (3 - 2 * t);
}

/**
 * Value noise on a lattice of `period` cells that wraps at `period`.
 * `x` and `y` are in lattice units, not pixels.
 */
export function valueNoise(x, y, period, seed) {
  const x0 = Math.floor(x);
  const y0 = Math.floor(y);
  const fx = smooth(x - x0);
  const fy = smooth(y - y0);

  // Wrapping the lattice coordinates is what makes the result periodic.
  const wrap = (value) => ((value % period) + period) % period;
  const xa = wrap(x0);
  const xb = wrap(x0 + 1);
  const ya = wrap(y0);
  const yb = wrap(y0 + 1);

  const v00 = hash3(xa, ya, seed);
  const v10 = hash3(xb, ya, seed);
  const v01 = hash3(xa, yb, seed);
  const v11 = hash3(xb, yb, seed);

  const top = v00 + (v10 - v00) * fx;
  const bottom = v01 + (v11 - v01) * fx;
  return top + (bottom - top) * fy;
}

/**
 * Fractal sum of periodic value noise. `u` and `v` are normalised 0..1 across the tile, so the
 * result is seamless for any octave count.
 */
export function fbm(u, v, { octaves = 4, frequency = 4, gain = 0.5, lacunarity = 2, seed = 1 } = {}) {
  let sum = 0;
  let amplitude = 1;
  let total = 0;
  let period = frequency;
  for (let octave = 0; octave < octaves; octave += 1) {
    sum += valueNoise(u * period, v * period, period, seed + octave * 101) * amplitude;
    total += amplitude;
    amplitude *= gain;
    period = Math.round(period * lacunarity);
  }
  return sum / total;
}

/**
 * Periodic Worley (cellular) noise, returning the distance to the nearest feature point.
 * Used for pebbled surfaces: concrete aggregate, asphalt chippings, rubber grain.
 */
export function worley(u, v, cells, seed) {
  const cx = u * cells;
  const cy = v * cells;
  const ix = Math.floor(cx);
  const iy = Math.floor(cy);
  let nearest = Number.POSITIVE_INFINITY;

  for (let dy = -1; dy <= 1; dy += 1) {
    for (let dx = -1; dx <= 1; dx += 1) {
      const gx = ix + dx;
      const gy = iy + dy;
      // Wrap the cell index so features repeat across the tile edge.
      const wx = ((gx % cells) + cells) % cells;
      const wy = ((gy % cells) + cells) % cells;
      const px = gx + hash3(wx, wy, seed);
      const py = gy + hash3(wx, wy, seed + 7919);
      const distance = (px - cx) ** 2 + (py - cy) ** 2;
      if (distance < nearest) nearest = distance;
    }
  }
  return Math.min(1, Math.sqrt(nearest));
}

/** Directional streaks, for brushed metal and wood grain. Periodic along both axes. */
export function streaks(u, v, { frequency = 60, warp = 0.06, seed = 1 } = {}) {
  const offset = fbm(u, v, { octaves: 3, frequency: 5, seed }) * warp;
  return (Math.sin((v + offset) * Math.PI * 2 * frequency) + 1) / 2;
}

/** A deterministic sequence, for placing discrete features like labels or spatter blobs. */
export function makeRandom(seed) {
  let state = (seed >>> 0) || 1;
  return () => {
    state ^= state << 13;
    state ^= state >>> 17;
    state ^= state << 5;
    return ((state >>> 0) % 1_000_000) / 1_000_000;
  };
}

/**
 * Toroidal distance between two normalised points. Needed whenever a feature is placed on a tile
 * and has to be measured across the wrap — a blob near the right edge is close to the left edge.
 */
export function torusDistance(ax, ay, bx, by) {
  let dx = Math.abs(ax - bx);
  let dy = Math.abs(ay - by);
  if (dx > 0.5) dx = 1 - dx;
  if (dy > 0.5) dy = 1 - dy;
  return Math.hypot(dx, dy);
}
