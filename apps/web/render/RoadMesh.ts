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
  /** Metres of texture repeat along the direction of travel. */
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
    uvs.push(0, node.distance / tileLength, 1, node.distance / tileLength);
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
