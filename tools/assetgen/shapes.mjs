/**
 * Signed distance fields, for drawing shapes.
 *
 * Everything else in this pipeline is texture: noise, weave, aggregate — content where a per-pixel
 * function of (u, v) is the natural description. Icons and graphic marks are not that. They are
 * *shapes*, and a shape drawn by thresholding noise looks like a shape drawn by thresholding noise.
 *
 * An SDF returns the distance from a point to a shape's edge, negative inside. That buys three
 * things this pipeline needs and had no way to get:
 *
 *  - **Crisp edges at any size**, because coverage comes from the distance, not from a pixel grid.
 *  - **Free anti-aliasing**, by mapping the last fraction of a pixel of distance to alpha. Hand-
 *    written shape rasterisation without this produces the jagged edges that immediately read as
 *    programmer art.
 *  - **Composition**, because union, intersection and subtraction on distances are min, max and
 *    negation. An icon is then a short expression rather than a rasterisation routine.
 *
 * Distances are in the same units as the coordinates passed in — normalised 0..1 across the image
 * throughout this pipeline, so `0.01` is one percent of the width.
 */

/** Distance to a circle of `radius` centred at (cx, cy). */
export function sdCircle(x, y, cx, cy, radius) {
  return Math.hypot(x - cx, y - cy) - radius;
}

/**
 * Distance to a rounded box, half-extents (hx, hy), corner radius `r`.
 * The standard formulation: push the box in by r, then subtract r back out.
 */
export function sdBox(x, y, cx, cy, hx, hy, r = 0) {
  const dx = Math.abs(x - cx) - (hx - r);
  const dy = Math.abs(y - cy) - (hy - r);
  const outside = Math.hypot(Math.max(dx, 0), Math.max(dy, 0));
  const inside = Math.min(Math.max(dx, dy), 0);
  return outside + inside - r;
}

/** Distance to a line segment from (ax, ay) to (bx, by), with round caps of `width` half-thickness. */
export function sdSegment(x, y, ax, ay, bx, by, width = 0) {
  const vx = bx - ax;
  const vy = by - ay;
  const lengthSquared = vx * vx + vy * vy || 1e-9;
  const t = Math.max(0, Math.min(1, ((x - ax) * vx + (y - ay) * vy) / lengthSquared));
  return Math.hypot(x - (ax + vx * t), y - (ay + vy * t)) - width;
}

/**
 * Distance to a convex or concave polygon given as a flat list of points.
 *
 * Winding-number sign test plus nearest-edge distance, so it is correct for any simple polygon —
 * which matters because half the icons here (a T-shirt, a hanger, a tag) are not convex.
 */
export function sdPolygon(x, y, points) {
  const count = points.length;
  let distance = Infinity;
  let inside = false;

  for (let i = 0, j = count - 1; i < count; j = i, i += 1) {
    const [ix, iy] = points[i];
    const [jx, jy] = points[j];
    // Nearest point on this edge.
    const ex = jx - ix;
    const ey = jy - iy;
    const wx = x - ix;
    const wy = y - iy;
    const t = Math.max(0, Math.min(1, (wx * ex + wy * ey) / (ex * ex + ey * ey || 1e-9)));
    distance = Math.min(distance, Math.hypot(wx - ex * t, wy - ey * t));
    // Crossing test for the sign.
    if (iy > y !== jy > y && x < ix + ((y - iy) / (jy - iy || 1e-9)) * (jx - ix)) inside = !inside;
  }
  return inside ? -distance : distance;
}

/**
 * Distance to an annular arc: a ring of `radius` and half-thickness `width`, kept between two
 * angles. Used for the magnet's horseshoe and the shuffle arrows.
 */
export function sdArc(x, y, cx, cy, radius, width, fromAngle, toAngle) {
  const dx = x - cx;
  const dy = y - cy;
  let angle = Math.atan2(dy, dx);
  // Normalise into [fromAngle, fromAngle + 2pi) so the sweep test is a simple comparison.
  const span = toAngle - fromAngle;
  while (angle < fromAngle) angle += Math.PI * 2;
  if (angle - fromAngle <= span) return Math.abs(Math.hypot(dx, dy) - radius) - width;
  // Outside the sweep: the nearest part of the arc is one of its two ends.
  const endA = [cx + Math.cos(fromAngle) * radius, cy + Math.sin(fromAngle) * radius];
  const endB = [cx + Math.cos(toAngle) * radius, cy + Math.sin(toAngle) * radius];
  return Math.min(Math.hypot(x - endA[0], y - endA[1]), Math.hypot(x - endB[0], y - endB[1])) - width;
}

/** Union: the nearer of two shapes. */
export function union(a, b) {
  return Math.min(a, b);
}

/** Intersection: the further of two shapes. */
export function intersect(a, b) {
  return Math.max(a, b);
}

/** Subtraction: `a` minus `b`. */
export function subtract(a, b) {
  return Math.max(a, -b);
}

/** A shape's outline: keep only the band within `width` of its edge. */
export function outline(distance, width) {
  return Math.abs(distance) - width;
}

/**
 * Coverage from a distance, 0 outside to 1 inside, anti-aliased across `softness`.
 *
 * `softness` should be roughly one pixel in the coordinate system being used — pass
 * `1 / size` and edges land exactly one pixel wide, which is what makes these read as drawn
 * rather than as thresholded.
 */
export function fill(distance, softness) {
  if (distance <= -softness) return 1;
  if (distance >= softness) return 0;
  const t = 0.5 - distance / (softness * 2);
  // Smoothstep, so the edge does not have a visible linear ramp at large softness.
  return t * t * (3 - 2 * t);
}

/**
 * Renders an RGBA image from a shape function.
 *
 * `draw(x, y, softness)` returns `{ r, g, b, a }` with components in 0..1, and receives the pixel
 * size so it can anti-alias correctly at whatever resolution the caller asked for. Coordinates are
 * normalised, so one shape definition works at 64 px and at 512 px.
 */
export function renderShape(size, draw) {
  const width = size.width ?? size;
  const height = size.height ?? size;
  const pixels = Buffer.alloc(width * height * 4);
  const softness = 1 / Math.min(width, height);

  for (let y = 0; y < height; y += 1) {
    for (let x = 0; x < width; x += 1) {
      // Pixel centres, so a shape centred at 0.5 is actually centred.
      const color = draw((x + 0.5) / width, (y + 0.5) / height, softness);
      const offset = (y * width + x) * 4;
      const alpha = Math.max(0, Math.min(1, color.a ?? 1));
      pixels[offset] = Math.round(Math.max(0, Math.min(1, color.r)) * 255);
      pixels[offset + 1] = Math.round(Math.max(0, Math.min(1, color.g)) * 255);
      pixels[offset + 2] = Math.round(Math.max(0, Math.min(1, color.b)) * 255);
      pixels[offset + 3] = Math.round(alpha * 255);
    }
  }
  return { width, height, channels: 4, pixels };
}

/**
 * Composites a layer over an accumulator, in place, premultiplied-correctly.
 *
 * Icons are built as a stack — glyph, then accent, then highlight — and each layer has its own
 * alpha. Compositing them by simple assignment would let a later layer's transparent region erase
 * an earlier layer, which is the single easiest way to produce an icon with holes in it.
 */
export function over(base, layer) {
  const alpha = layer.a + base.a * (1 - layer.a);
  if (alpha <= 1e-6) return { r: 0, g: 0, b: 0, a: 0 };
  return {
    r: (layer.r * layer.a + base.r * base.a * (1 - layer.a)) / alpha,
    g: (layer.g * layer.a + base.g * base.a * (1 - layer.a)) / alpha,
    b: (layer.b * layer.a + base.b * base.a * (1 - layer.a)) / alpha,
    a: alpha,
  };
}
