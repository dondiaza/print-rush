import { Mesh, Scene, VertexData } from "@babylonjs/core";
import type { TrackNode } from "@print-rush/game-core";

/**
 * Road and wall geometry built directly from the baked node list.
 *
 * V4 drew the road as a Babylon ribbon between two point arrays and the barriers as 120 instanced
 * boxes placed every fourth node. That gave no banking on the surface, no continuous wall to slide
 * along, and no UV continuity for a tiling material.
 *
 * Here both are generated as explicit vertex data: the cross-section is rotated by the node's
 * banking, and V runs with distance travelled so any tiling material repeats at a constant rate
 * regardless of how the nodes are spaced.
 */

export type RoadMeshOptions = {
  /**
   * Metres represented by one UV unit. Keep this at 1 when MaterialLibrary owns the physical tile
   * size; larger values are only for callers using an unscaled material.
   */
  tileLength?: number;
  /** Extra width beyond the drivable surface, for a run-off or kerb shoulder. */
  shoulder?: number;
};

/** Unit tangent and left normal at a node, from its neighbours. */
export function frameAt(nodes: readonly TrackNode[], index: number): {
  tx: number;
  tz: number;
  nx: number;
  nz: number;
  heading: number;
} {
  const count = nodes.length;
  const previous = nodes[(index - 1 + count) % count]!;
  const next = nodes[(index + 1) % count]!;
  const dx = next.x - previous.x;
  const dz = next.z - previous.z;
  const length = Math.hypot(dx, dz) || 1;
  const tx = dx / length;
  const tz = dz / length;
  return { tx, tz, nx: -tz, nz: tx, heading: Math.atan2(tx, tz) };
}

export function buildRoadSurface(
  scene: Scene,
  nodes: readonly TrackNode[],
  name: string,
  options: RoadMeshOptions = {},
): Mesh {
  const tileLength = options.tileLength ?? 8;
  const shoulder = options.shoulder ?? 0;
  const count = nodes.length;
  const positions: number[] = [];
  const indices: number[] = [];
  const normals: number[] = [];
  const uvs: number[] = [];

  for (let index = 0; index < count; index += 1) {
    const node = nodes[index]!;
    const { nx, nz } = frameAt(nodes, index);
    const half = node.width * 0.5 + shoulder;
    // Banking rotates the cross-section about the tangent, so the two edges sit at different heights.
    const lift = Math.tan(node.banking) * half;
    positions.push(node.x + nx * half, node.y + lift, node.z + nz * half);
    positions.push(node.x - nx * half, node.y - lift, node.z - nz * half);
    // Physical density in both axes prevents a tile being stretched across the whole ribbon and
    // prevents geometry and MaterialLibrary from scaling the along-track coordinate twice.
    uvs.push(0, node.distance / tileLength, (half * 2) / tileLength, node.distance / tileLength);
  }

  for (let index = 0; index < count; index += 1) {
    const a = index * 2;
    const b = a + 1;
    const c = ((index + 1) % count) * 2;
    const d = c + 1;
    indices.push(a, b, c, b, d, c);
  }

  const mesh = new Mesh(name, scene);
  const data = new VertexData();
  data.positions = positions;
  data.indices = indices;
  data.uvs = uvs;
  VertexData.ComputeNormals(positions, indices, normals);
  data.normals = normals;
  data.applyToMesh(mesh);
  return mesh;
}

/**
 * One continuous band outside both road edges.
 *
 * A shoulder made from boxes or decals breaks on banking and flickers at every join. This mesh uses
 * the same local frame and distance UVs as the road, but only fills the annulus between two offsets
 * from the road edge. Both sides live in one mesh, so adding a real ROAD → SHOULDER transition costs
 * one draw rather than a source plus hundreds of instances.
 */
export function buildRoadBand(
  scene: Scene,
  nodes: readonly TrackNode[],
  name: string,
  innerOffset: number,
  outerOffset: number,
  heightOffset = 0,
): Mesh {
  const count = nodes.length;
  const positions: number[] = [];
  const indices: number[] = [];
  const normals: number[] = [];
  const uvs: number[] = [];
  const bandWidth = Math.max(0.01, outerOffset - innerOffset);

  for (const side of [1, -1] as const) {
    for (let index = 0; index < count; index += 1) {
      const node = nodes[index]!;
      const { nx, nz } = frameAt(nodes, index);
      const edge = node.width * 0.5;
      const outer = edge + outerOffset;
      const inner = edge + innerOffset;
      const outerLift = Math.tan(node.banking) * outer * side;
      const innerLift = Math.tan(node.banking) * inner * side;
      positions.push(
        node.x + nx * side * outer,
        node.y + outerLift + heightOffset,
        node.z + nz * side * outer,
        node.x + nx * side * inner,
        node.y + innerLift + heightOffset,
        node.z + nz * side * inner,
      );
      uvs.push(bandWidth, node.distance, 0, node.distance);
    }

    const base = side === 1 ? 0 : count * 2;
    for (let index = 0; index < count; index += 1) {
      const a = base + index * 2;
      const b = a + 1;
      const c = base + ((index + 1) % count) * 2;
      const d = c + 1;
      if (side === 1) indices.push(a, b, c, b, d, c);
      else indices.push(a, c, b, b, c, d);
    }
  }

  const mesh = new Mesh(name, scene);
  const data = new VertexData();
  data.positions = positions;
  data.indices = indices;
  data.uvs = uvs;
  VertexData.ComputeNormals(positions, indices, normals);
  data.normals = normals;
  data.applyToMesh(mesh);
  return mesh;
}

export function buildWallSurface(
  scene: Scene,
  nodes: readonly TrackNode[],
  side: 1 | -1,
  height: number,
  name: string,
  tileLength = 4,
): Mesh | null {
  const count = nodes.length;
  const positions: number[] = [];
  const indices: number[] = [];
  const normals: number[] = [];
  const uvs: number[] = [];
  const present: boolean[] = [];

  for (let index = 0; index < count; index += 1) {
    const node = nodes[index]!;
    const frame = frameAt(nodes, index);
    const nx = frame.nx * side;
    const nz = frame.nz * side;
    const half = node.width * 0.5;
    const baseY = node.y + Math.tan(node.banking) * half * side;
    positions.push(node.x + nx * half, baseY, node.z + nz * half);
    positions.push(node.x + nx * half, baseY + height, node.z + nz * half);
    uvs.push(node.distance / tileLength, 0, node.distance / tileLength, 1);
    present.push(side === 1 ? node.wallLeft : node.wallRight);
  }

  let quads = 0;
  for (let index = 0; index < count; index += 1) {
    // A gap in the wall is a shortcut mouth, a ledge or a fall, so the quad is simply skipped.
    if (!present[index] || !present[(index + 1) % count]) continue;
    const a = index * 2;
    const b = a + 1;
    const c = ((index + 1) % count) * 2;
    const d = c + 1;
    if (side === 1) indices.push(a, b, c, b, d, c);
    else indices.push(c, b, a, c, d, b);
    quads += 1;
  }
  if (quads === 0) return null;

  const mesh = new Mesh(name, scene);
  const data = new VertexData();
  data.positions = positions;
  data.indices = indices;
  data.uvs = uvs;
  VertexData.ComputeNormals(positions, indices, normals);
  data.normals = normals;
  data.applyToMesh(mesh);
  return mesh;
}

/**
 * A painted line along one edge of the road: a flat strip from `inset` to `inset + width` metres
 * inside the edge, lifted a few millimetres so it wins the depth test. Lane paint is what tells a
 * driver where the road ends before the kerb does, and a flat strip that follows the banking is the
 * only geometry that can do it without floating on a crest or sinking in a dip.
 */
export function buildEdgeLine(
  scene: Scene,
  nodes: readonly TrackNode[],
  side: 1 | -1,
  inset: number,
  width: number,
  name: string,
): Mesh | null {
  const count = nodes.length;
  const positions: number[] = [];
  const indices: number[] = [];
  const normals: number[] = [];
  const uvs: number[] = [];
  for (let index = 0; index < count; index += 1) {
    const node = nodes[index]!;
    const { nx, nz } = frameAt(nodes, index);
    const half = node.width * 0.5;
    const outer = half - inset;
    const inner = half - inset - width;
    const liftOuter = Math.tan(node.banking) * outer * side;
    const liftInner = Math.tan(node.banking) * inner * side;
    positions.push(node.x + nx * side * outer, node.y + liftOuter + 0.012, node.z + nz * side * outer);
    positions.push(node.x + nx * side * inner, node.y + liftInner + 0.012, node.z + nz * side * inner);
    uvs.push(0, node.distance / 4, 1, node.distance / 4);
  }
  for (let index = 0; index < count; index += 1) {
    const a = index * 2;
    const b = a + 1;
    const c = ((index + 1) % count) * 2;
    const d = c + 1;
    if (side === 1) indices.push(a, b, c, b, d, c);
    else indices.push(a, c, b, b, c, d);
  }
  if (indices.length === 0) return null;
  const mesh = new Mesh(name, scene);
  const data = new VertexData();
  data.positions = positions;
  data.indices = indices;
  data.uvs = uvs;
  VertexData.ComputeNormals(positions, indices, normals);
  data.normals = normals;
  data.applyToMesh(mesh);
  return mesh;
}

/**
 * Signed curvature at a node, in radians per node. Used to decide where kerbs and corner signage
 * belong, so that they mark real corners rather than being sprinkled evenly.
 */
export function curvatureAt(nodes: readonly TrackNode[], index: number): number {
  const count = nodes.length;
  const previous = nodes[(index - 1 + count) % count]!;
  const node = nodes[index]!;
  const next = nodes[(index + 1) % count]!;
  const incoming = Math.atan2(node.x - previous.x, node.z - previous.z);
  const outgoing = Math.atan2(next.x - node.x, next.z - node.z);
  let delta = outgoing - incoming;
  while (delta > Math.PI) delta -= Math.PI * 2;
  while (delta < -Math.PI) delta += Math.PI * 2;
  return delta;
}
