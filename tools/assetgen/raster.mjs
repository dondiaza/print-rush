/**
 * Raster helpers.
 *
 * The generators are written as pure per-pixel functions rather than as a sequence of drawing
 * operations. That is deliberate: a per-pixel function of normalised (u, v) is trivially seamless
 * if its inputs are periodic, whereas a canvas-style `fillRect`/`arc` pipeline has to have its
 * edges patched up afterwards. It also means no canvas dependency.
 */

/** Clamps to the 0..255 byte range. */
export function byte(value) {
  return value < 0 ? 0 : value > 255 ? 255 : value | 0;
}

export function clamp01(value) {
  return value < 0 ? 0 : value > 1 ? 1 : value;
}

export function lerp(a, b, t) {
  return a + (b - a) * t;
}

/** Parses `#rrggbb` into linear-ish 0..1 components. Kept in sRGB; the shader handles conversion. */
export function hex(value) {
  const text = value.replace("#", "");
  return {
    r: parseInt(text.slice(0, 2), 16) / 255,
    g: parseInt(text.slice(2, 4), 16) / 255,
    b: parseInt(text.slice(4, 6), 16) / 255,
  };
}

export function mixColor(a, b, t) {
  return { r: lerp(a.r, b.r, t), g: lerp(a.g, b.g, t), b: lerp(a.b, b.b, t) };
}

export function scaleColor(color, factor) {
  return { r: color.r * factor, g: color.g * factor, b: color.b * factor };
}

/**
 * Renders an RGB image from a per-pixel function.
 * `shade(u, v, x, y)` returns `{ r, g, b }` in 0..1.
 */
export function renderRgb(size, shade) {
  const width = size.width ?? size;
  const height = size.height ?? size;
  const pixels = Buffer.alloc(width * height * 3);
  for (let y = 0; y < height; y += 1) {
    for (let x = 0; x < width; x += 1) {
      const color = shade(x / width, y / height, x, y);
      const offset = (y * width + x) * 3;
      pixels[offset] = byte(color.r * 255);
      pixels[offset + 1] = byte(color.g * 255);
      pixels[offset + 2] = byte(color.b * 255);
    }
  }
  return { pixels, width, height, channels: 3 };
}

/** Renders an RGBA image. `shade` returns `{ r, g, b, a }`. */
export function renderRgba(size, shade) {
  const width = size.width ?? size;
  const height = size.height ?? size;
  const pixels = Buffer.alloc(width * height * 4);
  for (let y = 0; y < height; y += 1) {
    for (let x = 0; x < width; x += 1) {
      const color = shade(x / width, y / height, x, y);
      const offset = (y * width + x) * 4;
      pixels[offset] = byte(color.r * 255);
      pixels[offset + 1] = byte(color.g * 255);
      pixels[offset + 2] = byte(color.b * 255);
      pixels[offset + 3] = byte((color.a ?? 1) * 255);
    }
  }
  return { pixels, width, height, channels: 4 };
}

/** Renders a single-channel image. `shade` returns 0..1. */
export function renderGrey(size, shade) {
  const width = size.width ?? size;
  const height = size.height ?? size;
  const pixels = Buffer.alloc(width * height);
  for (let y = 0; y < height; y += 1) {
    for (let x = 0; x < width; x += 1) {
      pixels[y * width + x] = byte(shade(x / width, y / height, x, y) * 255);
    }
  }
  return { pixels, width, height, channels: 1 };
}

/**
 * Derives a tangent-space normal map from a height function by central differences.
 *
 * Sampling the height function directly rather than the rendered basecolour matters: the basecolour
 * carries colour variation that has nothing to do with surface relief, and taking its luminance as
 * height produces bumps where there is only a stain.
 *
 * The sample offset wraps, so the normal map is seamless wherever the height function is.
 */
export function renderNormalFromHeight(size, height, strength = 1) {
  const width = size.width ?? size;
  const heightPx = size.height ?? size;
  const pixels = Buffer.alloc(width * heightPx * 3);
  const stepX = 1 / width;
  const stepY = 1 / heightPx;
  const wrap = (value) => value - Math.floor(value);

  for (let y = 0; y < heightPx; y += 1) {
    for (let x = 0; x < width; x += 1) {
      const u = x / width;
      const v = y / heightPx;
      const left = height(wrap(u - stepX), v);
      const right = height(wrap(u + stepX), v);
      const up = height(u, wrap(v - stepY));
      const down = height(u, wrap(v + stepY));

      // Scaled by the texel count so `strength` means the same thing at any resolution.
      const dx = (left - right) * strength * width * 0.02;
      const dy = (up - down) * strength * heightPx * 0.02;
      const length = Math.hypot(dx, dy, 1);

      const offset = (y * width + x) * 3;
      pixels[offset] = byte((dx / length * 0.5 + 0.5) * 255);
      pixels[offset + 1] = byte((dy / length * 0.5 + 0.5) * 255);
      pixels[offset + 2] = byte((1 / length * 0.5 + 0.5) * 255);
    }
  }
  return { pixels, width, height: heightPx, channels: 3 };
}

/**
 * A soft radial falloff, used for blobs, splashes and glows.
 * Returns 1 at the centre and 0 beyond `radius`, with a smooth shoulder.
 */
export function falloff(distance, radius, softness = 0.5) {
  if (distance >= radius) return 0;
  const t = 1 - distance / radius;
  return Math.pow(t, 1 / Math.max(0.05, softness));
}
