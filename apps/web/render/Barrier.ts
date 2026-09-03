import { Color3, Color4, Mesh, TransformNode, Vector3, VertexData, type Scene } from "@babylonjs/core";
import type { TrackNode } from "@print-rush/game-core";
import type { MaterialLibrary, MaterialRequest } from "./MaterialLibrary";
import { beveledBox, tube } from "./Geometry";
import { frameAt } from "./RoadMesh";

/**
 * THE BARRIER.
 *
 * What stood here before was a 2.4 m sheet of tiling material along both sides of the whole lap. It
 * did the physics job — the collision line is unchanged — and it did the visual job badly: a sheet
 * that tall turns every circuit into a corridor, hides the environment the circuit was dressed with,
 * and reads as a wall of texture rather than as a thing a building has.
 *
 * A barrier is now a *profile swept along the road*: a chamfered plinth the tyres would touch, a
 * warning band, a steel rail on posts. It is low enough to see over, so the props, the columns and
 * the far wall all stay in shot, and it is a recognisable object — the same kind of object a real
 * hall of that type would have. Each theme has its own profile.
 *
 * The sweep is one mesh per side. Rails are tubes broken at openings; posts are instanced.
 */

export type BarrierStyle = {
  /** The plinth profile as (outward offset, height) pairs, from the road edge outward. */
  plinth: Array<[number, number]>;
  plinthMaterial: MaterialRequest;
  /** A warning or accent band on the plinth's inner face. Null for none. */
  band: { from: number; to: number; material: MaterialRequest } | null;
  rail: { height: number; radius: number; offset: number; material: MaterialRequest } | null;
  post: { size: number; every: number; material: MaterialRequest } | null;
  /** Kerb colour pair, for the rumble blocks the terrain paints at the road edge. */
  kerbLight: string;
  kerbDark: string;
};

export const BARRIERS: Record<string, BarrierStyle> = {
  PRINT_FACTORY: {
    plinth: [[0, 0], [0, 0.46], [0.1, 0.56], [0.5, 0.56], [0.6, 0.46], [0.6, 0]],
    plinthMaterial: { materialClass: "CONCRETE", color: "#6f6a7a", texture: "mat_concrete_factory", tile: 2 },
    band: { from: 0.14, to: 0.4, material: { materialClass: "PAINTED_METAL", color: "#ffd43b", texture: "mat_safety_yellow", tile: 1.2 } },
    rail: { height: 1.02, radius: 0.055, offset: 0.3, material: { materialClass: "RAW_METAL", color: "#aeb5bd", texture: "mat_rawmetal_default", tile: 1 } },
    post: { size: 0.11, every: 4, material: { materialClass: "PAINTED_METAL", color: "#3a3f49" } },
    kerbLight: "#e4b931",
    kerbDark: "#2b2732",
  },
  WAREHOUSE: {
    plinth: [[0, 0], [0, 0.5], [0.08, 0.58], [0.6, 0.58], [0.7, 0.5], [0.7, 0]],
    plinthMaterial: { materialClass: "CONCRETE", color: "#7d828b", texture: "mat_concrete_warehouse", tile: 2 },
    band: { from: 0.12, to: 0.44, material: { materialClass: "PAINTED_METAL", color: "#ffc02e", texture: "mat_safety_yellow", tile: 1.2 } },
    rail: { height: 1.1, radius: 0.07, offset: 0.35, material: { materialClass: "PAINTED_METAL", color: "#ffc02e" } },
    post: { size: 0.14, every: 4, material: { materialClass: "PAINTED_METAL", color: "#3a3f49" } },
    kerbLight: "#ffc02e",
    kerbDark: "#3a3f49",
  },
  FLAGSHIP: {
    plinth: [[0, 0], [0, 0.34], [0.06, 0.4], [0.42, 0.4], [0.48, 0.34], [0.48, 0]],
    plinthMaterial: { materialClass: "WOOD", color: "#c98a52", texture: "mat_wood_store", tile: 1.6 },
    band: null,
    rail: { height: 0.96, radius: 0.045, offset: 0.24, material: { materialClass: "RAW_METAL", color: "#c9ced4", texture: "mat_rawmetal_default", tile: 1 } },
    post: { size: 0.08, every: 3, material: { materialClass: "RAW_METAL", color: "#c9ced4" } },
    kerbLight: "#f7f2e8",
    kerbDark: "#ff3da6",
  },
  OFFICE: {
    plinth: [[0, 0], [0, 0.3], [0.05, 0.36], [0.4, 0.36], [0.45, 0.3], [0.45, 0]],
    plinthMaterial: { materialClass: "PLASTIC", color: "#e9e4da" },
    band: { from: 0.08, to: 0.2, material: { materialClass: "PLASTIC", color: "#65d8ff" } },
    rail: { height: 0.9, radius: 0.04, offset: 0.22, material: { materialClass: "RAW_METAL", color: "#c9ced4", texture: "mat_rawmetal_default", tile: 1 } },
    post: { size: 0.07, every: 3, material: { materialClass: "RAW_METAL", color: "#9fa6ad" } },
    kerbLight: "#f7f2e8",
    kerbDark: "#65d8ff",
  },
  MANGA: {
    plinth: [[0, 0], [0, 0.5], [0.06, 0.56], [0.5, 0.56], [0.56, 0.5], [0.56, 0]],
    plinthMaterial: { materialClass: "PLASTIC", color: "#1d1830" },
    band: { from: 0.3, to: 0.42, material: { materialClass: "NEON", color: "#ff3da6", emissive: 1 } },
    rail: { height: 1.05, radius: 0.05, offset: 0.28, material: { materialClass: "RAW_METAL", color: "#8f8ba6" } },
    post: { size: 0.1, every: 4, material: { materialClass: "PAINTED_METAL", color: "#2b2540" } },
    kerbLight: "#ff3da6",
    kerbDark: "#8f5cff",
  },
};

export function barrierStyleFor(theme: string): BarrierStyle {
  return BARRIERS[theme] ?? BARRIERS.PRINT_FACTORY!;
}

export type Barrier = {
  meshes: Mesh[];
  dispose: () => void;
};

/**
 * Sweeps a 2D profile along one side of the road.
 *
 * `profile` is a polyline of (outward offset, height) from the road edge; `present` says which nodes
 * carry a barrier on this side. Openings — shortcut mouths, ledges — are simply un-stitched. UVs run
 * with distance along the road and with arc length around the profile, so a tiling material repeats
 * at a constant rate.
 */
export function sweepProfile(
  scene: Scene,
  nodes: readonly TrackNode[],
  side: 1 | -1,
  profile: ReadonlyArray<readonly [number, number]>,
  present: (node: TrackNode) => boolean,
  name: string,
  tileLength = 2,
  lift = 0,
): Mesh | null {
  const count = nodes.length;
  const positions: number[] = [];
  const uvs: number[] = [];
  const indices: number[] = [];
  const stride = profile.length;

  // Arc length around the profile, for V.
  const arc: number[] = [0];
  for (let index = 1; index < profile.length; index += 1) {
    const [a, b] = [profile[index - 1]!, profile[index]!];
    arc.push(arc[index - 1]! + Math.hypot(b[0] - a[0], b[1] - a[1]));
  }

  for (let index = 0; index < count; index += 1) {
    const node = nodes[index]!;
    const frame = frameAt(nodes, index);
    const nx = frame.nx * side;
    const nz = frame.nz * side;
    const half = node.width * 0.5;
    const baseY = node.y + Math.tan(node.banking) * half * side + lift;
    for (let point = 0; point < stride; point += 1) {
      const [offset, height] = profile[point]!;
      positions.push(node.x + nx * (half + offset), baseY + height, node.z + nz * (half + offset));
      uvs.push(node.distance / tileLength, arc[point]! / tileLength);
    }
  }

  let quads = 0;
  for (let index = 0; index < count; index += 1) {
    const next = (index + 1) % count;
    if (!present(nodes[index]!) || !present(nodes[next]!)) continue;
    for (let point = 0; point < stride - 1; point += 1) {
      const a = index * stride + point;
      const b = a + 1;
      const c = next * stride + point;
      const d = c + 1;
      // Wound so the face points into the track on either side.
      if (side === 1) indices.push(a, c, b, b, c, d);
      else indices.push(a, b, c, b, d, c);
      quads += 1;
    }
  }
  if (quads === 0) return null;

  const mesh = new Mesh(name, scene);
  const data = new VertexData();
  data.positions = positions;
  data.indices = indices;
  data.uvs = uvs;
  const normals: number[] = [];
  VertexData.ComputeNormals(positions, indices, normals);
  data.normals = normals;
  data.applyToMesh(mesh);
  mesh.isPickable = false;
  return mesh;
}

export function buildBarrier(
  scene: Scene,
  nodes: readonly TrackNode[],
  theme: string,
  quality: string,
  materials: MaterialLibrary,
): Barrier {
  const style = barrierStyleFor(theme);
  const meshes: Mesh[] = [];
  const root = new TransformNode(`barrier-${theme}`, scene);
  const detailed = quality !== "LOW";

  for (const side of [1, -1] as const) {
    const present = (node: TrackNode): boolean => (side === 1 ? node.wallLeft : node.wallRight);

    const plinth = sweepProfile(scene, nodes, side, style.plinth, present, `barrier-plinth-${side}`, style.plinthMaterial.tile ?? 2);
    if (plinth) {
      plinth.material = materials.get(style.plinthMaterial);
      plinth.receiveShadows = true;
      plinth.parent = root;
      meshes.push(plinth);
    }

    if (style.band) {
      // A thin strip standing a centimetre off the plinth's inner face.
      const band = sweepProfile(
        scene,
        nodes,
        side,
        [[-0.012, style.band.from], [-0.012, style.band.to]],
        present,
        `barrier-band-${side}`,
        style.band.material.tile ?? 1.2,
      );
      if (band) {
        band.material = materials.get(style.band.material);
        band.parent = root;
        meshes.push(band);
      }
    }

    if (style.rail && detailed) {
      // Rails as tubes, one per continuous run so an opening is really open.
      const railMaterial = materials.get(style.rail.material);
      let run: Vector3[] = [];
      let runIndex = 0;
      const flush = (): void => {
        if (run.length >= 2) {
          const rail = tube(scene, `barrier-rail-${side}-${runIndex}`, run, style.rail!.radius, 7);
          rail.material = railMaterial;
          rail.parent = root;
          rail.isPickable = false;
          meshes.push(rail);
          runIndex += 1;
        }
        run = [];
      };
      for (let index = 0; index <= nodes.length; index += 1) {
        const node = nodes[index % nodes.length]!;
        if (!present(node) || index === nodes.length) {
          flush();
          if (index === nodes.length) break;
          continue;
        }
        if (index % 2 !== 0) continue;
        const frame = frameAt(nodes, index);
        const half = node.width * 0.5 + style.rail.offset;
        const baseY = node.y + Math.tan(node.banking) * (node.width * 0.5) * side;
        run.push(new Vector3(node.x + frame.nx * side * half, baseY + style.rail.height, node.z + frame.nz * side * half));
      }
    }

    if (style.post && style.rail) {
      const source = beveledBox(scene, `barrier-post-${side}`, {
        width: style.post.size,
        height: style.rail.height,
        depth: style.post.size,
        bevel: style.post.size * 0.18,
        cornerSegments: 2,
      });
      source.material = materials.get(style.post.material);
      source.isVisible = false;
      source.isPickable = false;
      source.parent = root;
      source.registerInstancedBuffer("color", 4);
      meshes.push(source);
      const tint = Color3.FromHexString(style.post.material.color);
      for (let index = 0; index < nodes.length; index += style.post.every) {
        const node = nodes[index]!;
        if (!present(node)) continue;
        const frame = frameAt(nodes, index);
        const half = node.width * 0.5 + style.rail.offset;
        const baseY = node.y + Math.tan(node.banking) * (node.width * 0.5) * side;
        const post = source.createInstance(`barrier-post-${side}-${index}`);
        post.position.set(node.x + frame.nx * side * half, baseY + style.rail.height / 2, node.z + frame.nz * side * half);
        post.rotation.y = frame.heading;
        post.instancedBuffers.color = new Color4(tint.r, tint.g, tint.b, 1);
        post.isPickable = false;
        post.freezeWorldMatrix();
      }
    }
  }

  return {
    meshes,
    dispose: () => {
      for (const mesh of meshes) mesh.dispose();
      root.dispose();
    },
  };
}
