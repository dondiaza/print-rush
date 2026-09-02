import { deflateSync } from "node:zlib";

/**
 * Minimal PNG encoder.
 *
 * Written by hand rather than pulled in as a dependency for one reason: the alternatives
 * (`canvas`, `sharp`, `@napi-rs/canvas`) are native modules, and a native build step in the asset
 * pipeline is the kind of thing that works on one machine and breaks CI. Everything here uses only
 * `node:zlib`, which is built in.
 *
 * Supports the three colour types the pipeline actually needs:
 *   0 — greyscale, for roughness and height maps
 *   2 — RGB, for basecolour, normal maps and backdrops
 *   6 — RGBA, for decals and sprites
 */

const SIGNATURE = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);

/** CRC-32 table, built once. */
const CRC_TABLE = (() => {
  const table = new Int32Array(256);
  for (let index = 0; index < 256; index += 1) {
    let value = index;
    for (let bit = 0; bit < 8; bit += 1) {
      value = value & 1 ? 0xedb88320 ^ (value >>> 1) : value >>> 1;
    }
    table[index] = value;
  }
  return table;
})();

function crc32(buffer) {
  let crc = -1;
  for (let index = 0; index < buffer.length; index += 1) {
    crc = CRC_TABLE[(crc ^ buffer[index]) & 0xff] ^ (crc >>> 8);
  }
  return (crc ^ -1) >>> 0;
}

function chunk(type, data) {
  const length = Buffer.alloc(4);
  length.writeUInt32BE(data.length, 0);
  const typeBuffer = Buffer.from(type, "ascii");
  const body = Buffer.concat([typeBuffer, data]);
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(body), 0);
  return Buffer.concat([length, body, crc]);
}

/**
 * Paeth predictor, filter type 4. Chosen because these are procedural textures: noise compresses
 * badly with no filter, and Paeth is the general-purpose best of the five for continuous-tone data.
 */
function paeth(a, b, c) {
  const p = a + b - c;
  const pa = Math.abs(p - a);
  const pb = Math.abs(p - b);
  const pc = Math.abs(p - c);
  if (pa <= pb && pa <= pc) return a;
  if (pb <= pc) return b;
  return c;
}

function filterScanlines(pixels, width, height, channels) {
  const stride = width * channels;
  // One extra byte per row for the filter type.
  const out = Buffer.alloc((stride + 1) * height);
  for (let y = 0; y < height; y += 1) {
    const rowStart = y * stride;
    const outStart = y * (stride + 1);
    out[outStart] = 4;
    for (let x = 0; x < stride; x += 1) {
      const raw = pixels[rowStart + x];
      const left = x >= channels ? pixels[rowStart + x - channels] : 0;
      const up = y > 0 ? pixels[rowStart - stride + x] : 0;
      const upLeft = y > 0 && x >= channels ? pixels[rowStart - stride + x - channels] : 0;
      out[outStart + 1 + x] = (raw - paeth(left, up, upLeft)) & 0xff;
    }
  }
  return out;
}

const COLOR_TYPE_BY_CHANNELS = { 1: 0, 3: 2, 4: 6 };

/**
 * Encodes raw 8-bit samples to a PNG buffer.
 * `pixels` is row-major, `channels` samples per pixel, no padding.
 */
export function encodePng(pixels, width, height, channels) {
  const colorType = COLOR_TYPE_BY_CHANNELS[channels];
  if (colorType === undefined) throw new Error(`unsupported channel count: ${channels}`);
  if (pixels.length !== width * height * channels) {
    throw new Error(
      `pixel buffer is ${pixels.length} bytes, expected ${width * height * channels}`,
    );
  }

  const header = Buffer.alloc(13);
  header.writeUInt32BE(width, 0);
  header.writeUInt32BE(height, 4);
  header[8] = 8; // bit depth
  header[9] = colorType;
  header[10] = 0; // deflate
  header[11] = 0; // adaptive filtering
  header[12] = 0; // no interlace

  const filtered = filterScanlines(pixels, width, height, channels);
  // Level 9: these are baked once at build time, so the extra time is free and the bytes are not.
  const compressed = deflateSync(filtered, { level: 9 });

  return Buffer.concat([
    SIGNATURE,
    chunk("IHDR", header),
    chunk("IDAT", compressed),
    chunk("IEND", Buffer.alloc(0)),
  ]);
}
