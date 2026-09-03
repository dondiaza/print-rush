import {
  Color3,
  Mesh,
  MeshBuilder,
  PBRMaterial,
  Vector3,
  VertexBuffer,
  type Scene,
} from "@babylonjs/core";
import type { AssetCatalog } from "./AssetCatalog";

/**
 * POSTERS ON WALLS.
 *
 * The audit's bluntest finding was empty walls: every circuit's barrier was a tiling material in a
 * flat colour, from the start line to the finish. A shop's graphics wall, a workshop's proof board
 * and a convention hall's poster run are most of what makes those places identifiable, and none of
 * them existed.
 *
 * How this stays cheap. Each poster is a quad whose UVs are rewritten to its frame in the circuit's
 * atlas; quads sharing a frame are merged into one mesh. So a wall of twenty-four posters drawn from
 * six designs costs six draw calls and *one* material, rather than twenty-four of each. The merge is
 * what makes the frame-per-mesh grouping worth doing at all — without it, per-frame materials would
 * be strictly worse than one material with per-instance UVs.
 *
 * Why UV rewriting rather than `uOffset`/`uScale`: those live on the texture, so two materials
 * sharing a texture cannot address different frames. Baking the frame into the geometry's UVs is the
 * only way one texture serves every design, and it is free — the vertices are written once at build.
 */

export type Posters = {
  meshes: Mesh[];
  /** Manifest ids in use, for the asset report. */
  usedAssetIds: string[];
  count: number;
  dispose: () => void;
};

/**
 * How many posters each quality tier may hang.
 *
 * `LOW` used to be zero, which meant the cheapest devices got bare walls — and since most phones
 * were being classed as LOW, that was most phones. Posters are the wrong thing to cut: they cost one
 * draw call per *design*, not per poster, and an empty wall is the most visible possible saving.
 */
const BUDGET: Record<string, number> = { LOW: 10, MEDIUM: 18, HIGH: 30, ULTRA: 44 };

/** Metres. A poster is roughly A1 to A0 on a wall; the big ones are hoardings. */
const SIZES: Array<[number, number]> = [
  [1.6, 2.2],
  [2.4, 3.2],
  [3.6, 2.4],
];

export type PosterAnchor = {
  position: Vector3;
  /** Unit vector pointing away from the wall, into the track. The poster faces this way. */
  facing: Vector3;
};

/**
 * Hangs posters along the walls.
 *
 * `anchor` maps a lap fraction and a side to a point on the wall plus its inward normal; returning
 * null skips that spot, which is how a wall opening or a shortcut mouth stays clear.
 */
export function hangPosters(
  scene: Scene,
  theme: string,
  circuit: string,
  quality: string,
  catalog: AssetCatalog | null,
  random: () => number,
  anchor: (fraction: number, side: 1 | -1) => PosterAnchor | null,
): Posters {
  const budget = BUDGET[quality] ?? 0;
  if (!catalog || budget === 0) return { meshes: [], usedAssetIds: [], count: 0, dispose: () => {} };

  const asset = catalog.get(`poster_${circuit}_atlas`);
  const texture = asset ? catalog.texture(asset.id) : null;
  if (!asset || !texture || !asset.frames) {
    return { meshes: [], usedAssetIds: [], count: 0, dispose: () => {} };
  }

  const frameIds = Object.keys(asset.frames);
  // One material for the whole wall. The frames are addressed in the geometry, not the material.
  const material = new PBRMaterial(`poster-${circuit}`, scene);
  material.albedoTexture = texture;
  material.albedoColor = Color3.White();
  // Paper: matte, non-metallic, and it must not pick up a specular highlight or it reads as a
  // laminated sign rather than as a printed poster.
  material.roughness = 0.88;
  material.metallic = 0;
  material.backFaceCulling = true;

  // Group the placements by which design they use, so each group can be merged.
  const byFrame = new Map<string, Mesh[]>();
  let placed = 0;

  for (let index = 0; index < budget; index += 1) {
    const fraction = (index / budget + random() * 0.03) % 1;
    const side: 1 | -1 = random() > 0.5 ? 1 : -1;
    const spot = anchor(fraction, side);
    if (!spot) continue;

    const frameId = frameIds[Math.floor(random() * frameIds.length)]!;
    const frame = asset.frames[frameId]!;
    const [width, height] = SIZES[Math.floor(random() * SIZES.length)]!;
    // Portrait designs stay portrait: use the frame's own aspect to pick the orientation.
    const portrait = frame.height >= frame.width;
    const quadWidth = portrait ? width : height;
    const quadHeight = portrait ? height : width;

    const quad = MeshBuilder.CreatePlane(
      `poster-${circuit}-${index}`,
      { width: quadWidth, height: quadHeight, sideOrientation: Mesh.FRONTSIDE },
      scene,
    );

    /**
     * The frame's UVs, written into the geometry.
     *
     * `CreatePlane` gives UVs running 0..1 over the quad, so remapping them onto the frame's
     * sub-rectangle is a straight lerp. The half-texel inset that `packAtlas` already applied to
     * `u0..u1` is what keeps bilinear filtering from reaching into the neighbouring design.
     */
    const uvs = quad.getVerticesData(VertexBuffer.UVKind);
    // The UV bounds are optional on the type because a grid atlas has none; a poster atlas is
    // shelf-packed and always does, so a missing bound means the atlas format changed under us and
    // the poster is skipped rather than mapped to garbage.
    const bounds = frame.u0 !== undefined && frame.u1 !== undefined && frame.v0 !== undefined && frame.v1 !== undefined
      ? { u0: frame.u0, u1: frame.u1, v0: frame.v0, v1: frame.v1 }
      : null;
    if (uvs && bounds) {
      for (let i = 0; i < uvs.length; i += 2) {
        uvs[i] = bounds.u0 + uvs[i]! * (bounds.u1 - bounds.u0);
        // V is flipped relative to the atlas: the frame map is in image space, top row first.
        uvs[i + 1] = bounds.v1 + uvs[i + 1]! * (bounds.v0 - bounds.v1);
      }
      quad.setVerticesData(VertexBuffer.UVKind, uvs);
    } else if (!bounds) {
      quad.dispose();
      continue;
    }

    // Stand it off the wall by a couple of centimetres, so it never z-fights with the barrier.
    quad.position = spot.position.add(spot.facing.scale(0.03));
    // Face the track. `lookAt` points -Z at the target, and a plane's front face is +Z, so the
    // target is behind it.
    quad.lookAt(quad.position.subtract(spot.facing));
    quad.isPickable = false;

    if (!byFrame.has(frameId)) byFrame.set(frameId, []);
    byFrame.get(frameId)!.push(quad);
    placed += 1;
  }

  const meshes: Mesh[] = [];
  for (const [frameId, quads] of byFrame) {
    if (quads.length === 1) {
      quads[0]!.material = material;
      meshes.push(quads[0]!);
      continue;
    }
    const merged = Mesh.MergeMeshes(quads, true, true, undefined, false, false);
    if (merged) {
      merged.name = `posters-${circuit}-${frameId}`;
      merged.material = material;
      merged.isPickable = false;
      merged.freezeWorldMatrix();
      meshes.push(merged);
    }
  }

  return {
    meshes,
    usedAssetIds: placed > 0 ? [asset.id] : [],
    count: placed,
    dispose: () => {
      meshes.forEach((mesh) => mesh.dispose());
      material.dispose();
    },
  };
}
