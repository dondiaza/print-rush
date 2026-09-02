import { inflateSync } from "node:zlib";

/**
 * Minimal PNG decoder, for validation only.
 *
 * The pipeline writes images that nobody in this environment can look at, so the only way to know
 * whether a generator produced a usable texture is to read the file back and measure it. This
 * decoder exists to make that possible: seam checks, alpha-border checks, uniformity checks.
 *
 * Handles exactly what `png.mjs` writes: 8-bit, non-interlaced, colour types 0, 2 and 6.
 */

const CHANNELS_BY_COLOR_TYPE = { 0: 1, 2: 3, 6: 4 };

function paeth(a, b, c) {
  const p = a + b - c;
  const pa = Math.abs(p - a);
  const pb = Math.abs(p - b);
  const pc = Math.abs(p - c);
  if (pa <= pb && pa <= pc) return a;
  if (pb <= pc) return b;
  return c;
}

export function decodePng(buffer) {
  if (buffer.readUInt32BE(0) !== 0x89504e47) throw new Error("not a PNG");

  let offset = 8;
  let width = 0;
  let height = 0;
  let channels = 0;
  const idat = [];

  while (offset < buffer.length) {
    const length = buffer.readUInt32BE(offset);
    const type = buffer.toString("ascii", offset + 4, offset + 8);
    const data = buffer.subarray(offset + 8, offset + 8 + length);

    if (type === "IHDR") {
      width = data.readUInt32BE(0);
      height = data.readUInt32BE(4);
      const bitDepth = data[8];
      const colorType = data[9];
      if (bitDepth !== 8) throw new Error(`unsupported bit depth ${bitDepth}`);
      channels = CHANNELS_BY_COLOR_TYPE[colorType];
      if (!channels) throw new Error(`unsupported colour type ${colorType}`);
      if (data[12] !== 0) throw new Error("interlaced PNGs are not supported");
    } else if (type === "IDAT") {
      idat.push(data);
    } else if (type === "IEND") {
      break;
    }
    offset += 12 + length;
  }

  const raw = inflateSync(Buffer.concat(idat));
  const stride = width * channels;
  const pixels = Buffer.alloc(stride * height);

  for (let y = 0; y < height; y += 1) {
    const filter = raw[y * (stride + 1)];
    const rowIn = y * (stride + 1) + 1;
    const rowOut = y * stride;
    for (let x = 0; x < stride; x += 1) {
      const value = raw[rowIn + x];
      const left = x >= channels ? pixels[rowOut + x - channels] : 0;
      const up = y > 0 ? pixels[rowOut - stride + x] : 0;
      const upLeft = y > 0 && x >= channels ? pixels[rowOut - stride + x - channels] : 0;
      let restored;
      switch (filter) {
        case 0: restored = value; break;
        case 1: restored = value + left; break;
        case 2: restored = value + up; break;
        case 3: restored = value + ((left + up) >> 1); break;
        case 4: restored = value + paeth(left, up, upLeft); break;
        default: throw new Error(`unknown filter type ${filter}`);
      }
      pixels[rowOut + x] = restored & 0xff;
    }
  }

  return { width, height, channels, pixels };
}

/** Mean absolute difference between two edge lines, 0..255. The seam metric. */
export function edgeDifference(image, axis) {
  const { width, height, channels, pixels } = image;
  let total = 0;
  let samples = 0;

  if (axis === "horizontal") {
    // Right-most column against left-most: what a tile shows where it repeats sideways.
    for (let y = 0; y < height; y += 1) {
      for (let c = 0; c < channels; c += 1) {
        const left = pixels[y * width * channels + c];
        const right = pixels[(y * width + width - 1) * channels + c];
        total += Math.abs(left - right);
        samples += 1;
      }
    }
  } else {
    for (let x = 0; x < width; x += 1) {
      for (let c = 0; c < channels; c += 1) {
        const top = pixels[x * channels + c];
        const bottom = pixels[((height - 1) * width + x) * channels + c];
        total += Math.abs(top - bottom);
        samples += 1;
      }
    }
  }
  return total / samples;
}

/**
 * Mean absolute difference between two adjacent interior lines, used as the control for a seam
 * check. A tileable texture's wrap difference should be no worse than its ordinary neighbour
 * difference — comparing against a fixed threshold would fail noisy textures and pass smooth ones.
 */
export function interiorDifference(image, axis) {
  const { width, height, channels, pixels } = image;
  let total = 0;
  let samples = 0;
  // Averaged across 32 positions rather than measured at one. A single column can land in a flat
  // band and report zero, which would make any wrap difference at all look like a seam.
  const probes = 32;

  if (axis === "horizontal") {
    for (let probe = 1; probe <= probes; probe += 1) {
      const a = Math.floor((width * probe) / (probes + 1));
      for (let y = 0; y < height; y += 1) {
        for (let c = 0; c < channels; c += 1) {
          total += Math.abs(
            pixels[(y * width + a) * channels + c] - pixels[(y * width + a + 1) * channels + c],
          );
          samples += 1;
        }
      }
    }
  } else {
    for (let probe = 1; probe <= probes; probe += 1) {
      const a = Math.floor((height * probe) / (probes + 1));
      for (let x = 0; x < width; x += 1) {
        for (let c = 0; c < channels; c += 1) {
          total += Math.abs(
            pixels[(a * width + x) * channels + c] - pixels[((a + 1) * width + x) * channels + c],
          );
          samples += 1;
        }
      }
    }
  }
  return total / samples;
}

/** Per-channel min, max, mean. A generator that produced a flat image shows up here immediately. */
export function statistics(image) {
  const { width, height, channels, pixels } = image;
  const min = new Array(channels).fill(255);
  const max = new Array(channels).fill(0);
  const sum = new Array(channels).fill(0);
  const count = width * height;

  for (let index = 0; index < count; index += 1) {
    for (let c = 0; c < channels; c += 1) {
      const value = pixels[index * channels + c];
      if (value < min[c]) min[c] = value;
      if (value > max[c]) max[c] = value;
      sum[c] += value;
    }
  }
  return { min, max, mean: sum.map((total) => total / count) };
}

/** Maximum alpha found in the outermost `margin` pixels. Catches a decal showing its own bounds. */
export function borderAlpha(image, margin = 2) {
  const { width, height, channels, pixels } = image;
  if (channels !== 4) return 0;
  let peak = 0;
  const check = (x, y) => {
    const alpha = pixels[(y * width + x) * 4 + 3];
    if (alpha > peak) peak = alpha;
  };
  for (let x = 0; x < width; x += 1) {
    for (let m = 0; m < margin; m += 1) {
      check(x, m);
      check(x, height - 1 - m);
    }
  }
  for (let y = 0; y < height; y += 1) {
    for (let m = 0; m < margin; m += 1) {
      check(m, y);
      check(width - 1 - m, y);
    }
  }
  return peak;
}
