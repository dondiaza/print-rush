import { SurfaceConfig, TerrainConfig, type SurfaceName } from "./config.js";
import type { SurfaceGrip, TrackDefinition, TrackNode, Vec2, Vec3 } from "./types.js";

/**
 * V5 track sampling.
 *
 * The V4 track was `r(theta) * (cos theta, sin theta)` with theta monotonic, so it was a convex
 * star curve that could never cross itself: no bridges, no tunnels, no floors. V5 tracks are baked
 * node lists produced from authored control points, which means a circuit can pass over itself and
 * two nodes can share the same XZ at different heights.
 *
 * That breaks nearest-node-by-XZ, so sampling is done in a window around each kart's last known
 * index and disambiguated by height. Every consumer keeps its own cursor; the sampler is stateless.
 */

const SEARCH_WINDOW = 48;

export type TrackSample = {
  index: number;
  node: TrackNode;
  /** Distance from the centreline, signed. Positive is to the left of travel direction. */
  lateral: number;
  /** Height of the road surface under the kart, interpolated along and across the node. */
  groundY: number;
  /** Unit tangent of the centreline at this point. */
  tangent: Vec2;
  /** Unit normal pointing left of travel. */
  normal: Vec2;
  /** True when the kart is beyond the drivable width. */
  offRoad: boolean;
  /**
   * How far past the road edge, in metres. Zero on the road.
   *
   * `offRoad` answers whether; this answers how badly, which is what lets grip degrade with distance
   * and gives the recovery limit something to measure.
   */
  offRoadDistance: number;
  surface: SurfaceName;
  progress: number;
};

export function surfaceGrip(surface: SurfaceName): SurfaceGrip {
  return SurfaceConfig[surface] ?? SurfaceConfig.ASPHALT;
}

function tangentAt(nodes: readonly TrackNode[], index: number): Vec2 {
  const previous = nodes[(index - 1 + nodes.length) % nodes.length]!;
  const next = nodes[(index + 1) % nodes.length]!;
  const dx = next.x - previous.x;
  const dz = next.z - previous.z;
  const length = Math.hypot(dx, dz) || 1;
  return { x: dx / length, z: dz / length };
}

/**
 * Finds the node the kart is on. `cursor` is the index returned last frame; passing it keeps the
 * search local, which is what makes overlapping track sections resolve correctly and keeps the cost
 * constant as circuits grow from 240 nodes to several thousand.
 */
export function sampleTrack(track: TrackDefinition, position: Vec3, cursor = -1): TrackSample {
  const nodes = track.nodes;
  const count = nodes.length;

  let bestIndex = 0;
  let bestScore = Number.POSITIVE_INFINITY;

  const scan = (index: number): void => {
    const node = nodes[index]!;
    const dx = position.x - node.x;
    const dz = position.z - node.z;
    const dy = position.y - node.y;
    // Height is weighted heavily so a bridge does not capture a kart driving underneath it.
    const score = dx * dx + dz * dz + dy * dy * 9;
    if (score < bestScore) {
      bestScore = score;
      bestIndex = index;
    }
  };

  if (cursor >= 0 && cursor < count) {
    for (let offset = -SEARCH_WINDOW; offset <= SEARCH_WINDOW; offset += 1) {
      scan((cursor + offset + count * 2) % count);
    }
    // If the local window found nothing plausible the kart was teleported or fell; scan everything.
    if (bestScore > 900) {
      bestScore = Number.POSITIVE_INFINITY;
      for (let index = 0; index < count; index += 1) scan(index);
    }
  } else {
    for (let index = 0; index < count; index += 1) scan(index);
  }

  const node = nodes[bestIndex]!;
  const tangent = tangentAt(nodes, bestIndex);
  const normal: Vec2 = { x: -tangent.z, z: tangent.x };

  const dx = position.x - node.x;
  const dz = position.z - node.z;
  const lateral = dx * normal.x + dz * normal.z;
  const along = dx * tangent.x + dz * tangent.z;

  // Interpolate height both along the segment and across the banked road surface.
  const next = nodes[(bestIndex + 1) % count]!;
  const segmentLength = Math.hypot(next.x - node.x, next.z - node.z) || 1;
  const t = Math.min(1, Math.max(0, along / segmentLength));
  const centreY = node.y + (next.y - node.y) * t;

  const halfWidth = node.width * 0.5;
  /**
   * Banking stops at the road edge.
   *
   * The previous version extrapolated `tan(banking) * lateral` without limit, which was harmless
   * while walls made off-road unreachable and became an infinite ramp the moment they opened: thirty
   * metres off a banked corner put the ground thirty metres in the air. The verge is flat, at
   * whatever height the road edge reached, which is also what a real run-off looks like.
   */
  const bankedLateral = Math.max(-halfWidth, Math.min(halfWidth, lateral));
  const groundY = centreY + Math.tan(node.banking) * bankedLateral;

  const offRoadDistance = Math.max(0, Math.abs(lateral) - halfWidth);
  return {
    index: bestIndex,
    node,
    lateral,
    groundY,
    tangent,
    normal,
    offRoad: offRoadDistance > 0,
    offRoadDistance,
    surface: node.surface,
    progress: node.progress,
  };
}

/**
 * Wall query. Returns the push-out needed to keep a kart of `radius` inside the drivable surface,
 * or null when it is clear. Sections flagged without a wall let the kart leave the road instead —
 * that is what makes a shortcut or a fall possible.
 */
export function queryWall(sample: TrackSample, radius: number): { normal: Vec2; penetration: number } | null {
  /**
   * The barrier stands at the far edge of the verge, not at the edge of the road.
   *
   * This one line is what makes leaving the road possible. Before it, the limit was the tarmac's own
   * half-width, so every circuit was a corridor and the grass, sand and off-road entries in
   * `SurfaceConfig` could never be reached. Now there are sixteen metres of driveable dirt between
   * the racing surface and anything solid — enough to run wide, lose time to the lost grip, and get
   * back on.
   */
  const halfWidth = sample.node.width * 0.5 + TerrainConfig.vergeMetres;
  const limit = halfWidth - radius;

  if (sample.lateral > limit && sample.node.wallLeft) {
    return { normal: { x: -sample.normal.x, z: -sample.normal.z }, penetration: sample.lateral - limit };
  }
  if (sample.lateral < -limit && sample.node.wallRight) {
    return { normal: { x: sample.normal.x, z: sample.normal.z }, penetration: -limit - sample.lateral };
  }
  return null;
}

/** Total centreline length in metres. Baked at generation time; this recomputes it for validation. */
export function measureLength(nodes: readonly TrackNode[]): number {
  let total = 0;
  for (let index = 0; index < nodes.length; index += 1) {
    const node = nodes[index]!;
    const next = nodes[(index + 1) % nodes.length]!;
    total += Math.hypot(next.x - node.x, next.y - node.y, next.z - node.z);
  }
  return total;
}

/** Signed heading change per node, used by the track analyser to count corners. */
export function headingDeltas(nodes: readonly TrackNode[]): number[] {
  const headings = nodes.map((node, index) => {
    const next = nodes[(index + 1) % nodes.length]!;
    return Math.atan2(next.x - node.x, next.z - node.z);
  });
  return headings.map((heading, index) => {
    let delta = headings[(index + 1) % headings.length]! - heading;
    while (delta > Math.PI) delta -= Math.PI * 2;
    while (delta < -Math.PI) delta += Math.PI * 2;
    return delta;
  });
}

/**
 * Whether a kart has wandered far enough off the road to be put back.
 *
 * The counterpart to opening the walls. Without a limit, an open circuit is a plane you can drive
 * across until the backdrop, which is worse than a wall — a wall at least tells you where the track
 * is. The threshold is well outside the drivable verge so the boundary reads as "I am lost" rather
 * than as an invisible barrier beside the tarmac.
 */
export function needsRecovery(sample: TrackSample): boolean {
  return sample.offRoadDistance > TerrainConfig.recoveryMetres;
}

/**
 * Which surface a position is actually on.
 *
 * On the road it is the node's own surface. Past the edge it is the verge, and past the verge it is
 * rougher still — so running wide costs grip progressively instead of falling off a cliff edge in
 * the handling. One function, so the runtime, the bots and the handling lab cannot disagree.
 */
export function surfaceAt(sample: TrackSample): SurfaceName {
  if (!sample.offRoad) return sample.surface;
  return sample.offRoadDistance > TerrainConfig.vergeMetres ? "SAND" : "OFFROAD";
}
