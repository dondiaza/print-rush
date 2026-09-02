import { decodePng, encodePng, type RasterImage } from "./png";

/**
 * FACE STYLING.
 *
 * What this is, stated plainly so nobody mistakes it for something else: a **deterministic
 * stylisation pass**, not a repaint. There is no image model in this environment, so the pipeline
 * cannot paint a portrait from a photograph. What it can do — and what it does — is take the
 * photograph the owner chose and cropped, and remap it so it belongs in the game's lighting instead
 * of in whatever room it was taken in.
 *
 * That ordering is the brief's own priority: identity above stylisation. Every operation here is a
 * transform of the pixels that were already there, so the face that comes out is the face that went
 * in — the features that make a person recognisable are untouched by construction. A generative pass
 * would risk them; this cannot.
 *
 * The steps, and why each one earns its place:
 *
 *  1. **Resample to 512.** A runtime face texture has no business being larger, and the brief caps
 *     it there. Box-filtered, because a photograph downscaled by point sampling aliases into noise.
 *  2. **Edge-preserving smoothing.** A bilateral-style filter: average nearby pixels, but only ones
 *     of similar brightness. That removes sensor noise and skin micro-detail — which read as dirt at
 *     game distance — while leaving every edge that carries a feature. This is the single step that
 *     makes a photo look drawn rather than photographed.
 *  3. **Tonal S-curve.** Arcade contrast. Deepens the shadow, holds the highlight, and crucially
 *     leaves the midtones — where a face lives — close to where they were.
 *  4. **Lighting harmonisation.** Highlights shift toward the key light's warmth and shadows toward
 *     the fill's coolness, matching the lighting rig the karts are lit by. A photograph lit by an
 *     office ceiling sits wrong in a screen-printing workshop until this happens.
 *  5. **Rim light.** A cool edge along the upper left of the silhouette. It is what separates a head
 *     from the background at speed, and it is the most recognisable convention of stylised game
 *     portraits.
 *  6. **Alpha vignette.** A soft oval mask, so the result is a head on transparency. No white box,
 *     no halo — the two defects the brief names.
 */

/** Bumped whenever anything below changes, so stored faces can be spotted as stale and reprocessed. */
export const PROCESSING_VERSION = 1;

export const FACE_TEXTURE_SIZE = 512;
export const THUMBNAIL_SIZES = [256, 128, 64] as const;

/** The lighting rig's key and fill, as the face pipeline sees them. */
const KEY_LIGHT = { r: 1.045, g: 1.008, b: 0.955 };
const FILL_LIGHT = { r: 0.955, g: 0.985, b: 1.06 };

export class FaceProcessingError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "FaceProcessingError";
  }
}

/**
 * Validates a decoded upload.
 *
 * Deliberately about *usability*, not about who is in the picture. The brief rules out biometrics and
 * it is right to: nothing here detects, measures or compares a face. It checks that the image is big
 * enough to make a texture from and not degenerate — which is the only thing that can be checked
 * without crossing that line.
 */
export function inspectUpload(image: RasterImage): { ok: boolean; warnings: string[] } {
  const warnings: string[] = [];
  const shortest = Math.min(image.width, image.height);
  if (shortest < 128) {
    return { ok: false, warnings: ["La imagen es demasiado pequeña; usa al menos 128 píxeles de lado."] };
  }
  if (shortest < 320) {
    warnings.push("La resolución es baja: la cara puede verse borrosa de cerca.");
  }
  // A near-uniform image is a blank, a lens cap or a failed export, and it is cheap to catch.
  const stats = channelSpread(image);
  if (stats < 12) {
    return { ok: false, warnings: ["La imagen parece estar en blanco o corrupta."] };
  }
  if (stats < 40) warnings.push("La foto tiene muy poco contraste; el resultado puede quedar plano.");
  return { ok: true, warnings };
}

function channelSpread(image: RasterImage): number {
  const { pixels, channels } = image;
  let min = 255;
  let max = 0;
  // Sampled rather than exhaustive: a spread estimate does not need every pixel, and an 8 MP upload
  // would otherwise cost a full pass for a number used once.
  const step = Math.max(1, Math.floor(pixels.length / channels / 4096)) * channels;
  for (let i = 0; i < pixels.length; i += step) {
    const luma = pixels[i]!;
    if (luma < min) min = luma;
    if (luma > max) max = luma;
  }
  return max - min;
}

/** Box-filtered resample. Averages the source rectangle covering each destination pixel. */
export function resample(image: RasterImage, size: number): RasterImage {
  const { width, height, channels, pixels } = image;
  const out = Buffer.alloc(size * size * channels);
  const scaleX = width / size;
  const scaleY = height / size;

  for (let y = 0; y < size; y += 1) {
    const y0 = Math.floor(y * scaleY);
    const y1 = Math.max(y0 + 1, Math.floor((y + 1) * scaleY));
    for (let x = 0; x < size; x += 1) {
      const x0 = Math.floor(x * scaleX);
      const x1 = Math.max(x0 + 1, Math.floor((x + 1) * scaleX));
      for (let c = 0; c < channels; c += 1) {
        let total = 0;
        let count = 0;
        for (let sy = y0; sy < y1 && sy < height; sy += 1) {
          for (let sx = x0; sx < x1 && sx < width; sx += 1) {
            total += pixels[(sy * width + sx) * channels + c]!;
            count += 1;
          }
        }
        out[(y * size + x) * channels + c] = count > 0 ? Math.round(total / count) : 0;
      }
    }
  }
  return { width: size, height: size, channels, pixels: out };
}

/**
 * Edge-preserving smoothing.
 *
 * A separable-in-space, non-separable-in-range approximation of a bilateral filter: for each pixel,
 * average the neighbourhood weighted by how close each neighbour's luminance is to the centre's. The
 * range term is what preserves the edges — an eyelid or a nostril has a large luminance step across
 * it, so its neighbours contribute almost nothing and the edge survives at full sharpness.
 *
 * `radius` 2 at 512 px is about a millimetre of face. Enough to erase grain, far too small to move
 * a feature.
 */
export function smoothPreservingEdges(image: RasterImage, radius = 2, rangeSigma = 26): RasterImage {
  const { width, height, channels, pixels } = image;
  const out = Buffer.from(pixels);
  const rangeFactor = -1 / (2 * rangeSigma * rangeSigma);

  const luma = new Float32Array(width * height);
  for (let i = 0; i < width * height; i += 1) {
    const o = i * channels;
    luma[i] = 0.299 * pixels[o]! + 0.587 * pixels[o + 1]! + 0.114 * pixels[o + 2]!;
  }

  for (let y = 0; y < height; y += 1) {
    for (let x = 0; x < width; x += 1) {
      const centre = y * width + x;
      const centreLuma = luma[centre]!;
      let weightSum = 0;
      // Three scalars rather than an array: `noUncheckedIndexedAccess` makes every element read a
      // possibly-undefined, and this is the innermost loop in the whole pipeline.
      let accumR = 0;
      let accumG = 0;
      let accumB = 0;

      for (let dy = -radius; dy <= radius; dy += 1) {
        const sy = y + dy;
        if (sy < 0 || sy >= height) continue;
        for (let dx = -radius; dx <= radius; dx += 1) {
          const sx = x + dx;
          if (sx < 0 || sx >= width) continue;
          const sample = sy * width + sx;
          const delta = luma[sample]! - centreLuma;
          // Spatial falloff is a simple inverse-distance rather than a gaussian: at radius 2 the
          // difference is invisible and this avoids 25 exponentials per pixel.
          const spatial = 1 / (1 + dx * dx + dy * dy);
          const weight = spatial * Math.exp(delta * delta * rangeFactor);
          weightSum += weight;
          const o = sample * channels;
          accumR += pixels[o]! * weight;
          accumG += pixels[o + 1]! * weight;
          accumB += pixels[o + 2]! * weight;
        }
      }

      const o = centre * channels;
      out[o] = Math.round(accumR / weightSum);
      out[o + 1] = Math.round(accumG / weightSum);
      out[o + 2] = Math.round(accumB / weightSum);
    }
  }
  return { width, height, channels, pixels: out };
}

/** Smoothstep, used for every soft threshold below. */
function smooth(t: number): number {
  const c = Math.min(1, Math.max(0, t));
  return c * c * (3 - 2 * c);
}

/**
 * The grade: tone curve, lighting harmonisation, saturation, rim light and the alpha vignette.
 *
 * One pass, because every operation is a function of the pixel and its position, and doing them
 * together avoids five full-image copies.
 */
export function grade(image: RasterImage, options: { rim?: number; saturation?: number } = {}): RasterImage {
  const { width, height, pixels, channels } = image;
  const rim = options.rim ?? 0.34;
  const saturation = options.saturation ?? 1.16;
  const out = Buffer.alloc(width * height * 4);

  for (let y = 0; y < height; y += 1) {
    for (let x = 0; x < width; x += 1) {
      const source = (y * width + x) * channels;
      const target = (y * width + x) * 4;

      let r = pixels[source]! / 255;
      let g = pixels[source + 1]! / 255;
      let b = pixels[source + 2]! / 255;

      // 3. Tonal S-curve. Anchored so 0.5 stays 0.5: the midtones are the face.
      const curve = (v: number): number => {
        const t = v - 0.5;
        return Math.min(1, Math.max(0, 0.5 + t * (1.18 - 0.36 * t * t * 4)));
      };
      r = curve(r);
      g = curve(g);
      b = curve(b);

      // 4. Lighting harmonisation, by luminance: warm where the key would fall, cool in the fill.
      const luma = 0.299 * r + 0.587 * g + 0.114 * b;
      const keyMix = smooth((luma - 0.42) / 0.5);
      r *= FILL_LIGHT.r + (KEY_LIGHT.r - FILL_LIGHT.r) * keyMix;
      g *= FILL_LIGHT.g + (KEY_LIGHT.g - FILL_LIGHT.g) * keyMix;
      b *= FILL_LIGHT.b + (KEY_LIGHT.b - FILL_LIGHT.b) * keyMix;

      // Saturation, around the graded luminance so a lift never shifts hue.
      const grey = 0.299 * r + 0.587 * g + 0.114 * b;
      r = grey + (r - grey) * saturation;
      g = grey + (g - grey) * saturation;
      b = grey + (b - grey) * saturation;

      // 6. The vignette, computed first because the rim light rides on its gradient.
      const u = (x + 0.5) / width;
      const v = (y + 0.5) / height;
      // An oval, not a circle: a head is taller than it is wide, and a circular mask clips the chin.
      const dx = (u - 0.5) / 0.46;
      const dy = (v - 0.48) / 0.52;
      const distance = Math.hypot(dx, dy);
      const alpha = 1 - smooth((distance - 0.82) / 0.2);

      // 5. Rim light: the outer band of the mask, biased to the upper left.
      const band = smooth((distance - 0.6) / 0.28) * (1 - smooth((distance - 0.92) / 0.1));
      const direction = smooth((0.55 - u) * 1.4 + (0.55 - v) * 1.1);
      const rimAmount = band * direction * rim;
      r += rimAmount * 0.72;
      g += rimAmount * 0.86;
      b += rimAmount;

      out[target] = Math.round(Math.min(1, Math.max(0, r)) * 255);
      out[target + 1] = Math.round(Math.min(1, Math.max(0, g)) * 255);
      out[target + 2] = Math.round(Math.min(1, Math.max(0, b)) * 255);
      // The source alpha is respected when there is one, so a client that already cut the background
      // out is not overridden.
      const sourceAlpha = channels === 4 ? pixels[source + 3]! / 255 : 1;
      out[target + 3] = Math.round(Math.min(1, alpha) * sourceAlpha * 255);
    }
  }
  return { width, height, channels: 4, pixels: out };
}

export type StyledFace = {
  texture: Buffer;
  thumbnails: { size: number; png: Buffer }[];
  warnings: string[];
};

/**
 * The whole pipeline, from an uploaded PNG to what the game and the library need.
 *
 * Throws `FaceProcessingError` with a message a person can act on — the brief is explicit that a
 * failure must not surface as "500 processing failed", and that the character survives it.
 */
export function styleFace(png: Buffer): StyledFace {
  let decoded: RasterImage;
  try {
    decoded = decodePng(png);
  } catch {
    throw new FaceProcessingError("No hemos podido leer la imagen. Prueba con otra foto.");
  }

  const inspection = inspectUpload(decoded);
  if (!inspection.ok) throw new FaceProcessingError(inspection.warnings[0] ?? "La imagen no es utilizable.");

  const square = decoded.width === decoded.height ? decoded : centreCrop(decoded);
  const resized = resample(square, FACE_TEXTURE_SIZE);
  const smoothed = smoothPreservingEdges(resized);
  const styled = grade(smoothed);

  const thumbnails = THUMBNAIL_SIZES.map((size) => ({
    size,
    // Downscaled from the styled result, so a thumbnail always matches the face it stands for.
    png: encodePng(resample(styled, size)),
  }));

  return { texture: encodePng(styled), thumbnails, warnings: inspection.warnings };
}

/**
 * Centre crop to a square.
 *
 * A safety net, not the crop. The studio's editor is what decides framing, and it uploads a square;
 * this only catches a client that did not, so the pipeline never has to reason about aspect ratio.
 */
function centreCrop(image: RasterImage): RasterImage {
  const { width, height, channels, pixels } = image;
  const size = Math.min(width, height);
  const offsetX = Math.floor((width - size) / 2);
  const offsetY = Math.floor((height - size) / 2);
  const out = Buffer.alloc(size * size * channels);
  for (let y = 0; y < size; y += 1) {
    const from = ((offsetY + y) * width + offsetX) * channels;
    pixels.copy(out, y * size * channels, from, from + size * channels);
  }
  return { width: size, height: size, channels, pixels: out };
}
