/**
 * Typed access to the project's own PNG codec.
 *
 * `tools/assetgen` already contains a hand-written PNG encoder and decoder, written for the asset
 * bake to avoid a native dependency. The face pipeline needs exactly the same thing on the server,
 * so it reuses them rather than adding `sharp` — which would pull a platform-specific binary into a
 * serverless bundle for work these fifty lines already do.
 *
 * The imports carry a `ts-expect-error` because those modules are plain ESM JavaScript with no
 * declarations. Wrapping them once here, with real signatures, keeps that suppression out of every
 * call site.
 */

// @ts-expect-error — plain ESM JavaScript, deliberately dependency-free.
import { encodePng as encode } from "../../../tools/assetgen/png.mjs";
// @ts-expect-error — same.
import { decodePng as decode } from "../../../tools/assetgen/decode.mjs";

export type RasterImage = {
  width: number;
  height: number;
  /** 1 (grey), 3 (RGB) or 4 (RGBA). */
  channels: number;
  pixels: Buffer;
};

export function decodePng(buffer: Buffer): RasterImage {
  return decode(buffer) as RasterImage;
}

export function encodePng(image: RasterImage): Buffer {
  return encode(image.pixels, image.width, image.height, image.channels) as Buffer;
}
