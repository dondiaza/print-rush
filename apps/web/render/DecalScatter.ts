import {
  Color3,
  Mesh,
  MeshBuilder,
  PBRMaterial,
  Vector3,
  type Scene,
  type Texture,
} from "@babylonjs/core";
import type { AssetCatalog, VisualAsset } from "./AssetCatalog";

/**
 * DECAL SCATTER.
 *
 * Projects the baked decals onto the road: ink splashes, ground dirt, tyre marks, scuffs.
 *
 * This is the layer that stops a floor reading as new. A road with a perfectly uniform surface looks
 * manufactured however good its material is, and no amount of normal-map detail substitutes for
 * marks that are clearly *incidents* — something spilled here, something was dragged there. It is
 * also the cheapest way to make one road material look like five different stretches of road.
 *
 * `MeshBuilder.CreateDecal` bakes a projected copy of the target's geometry, so each decal is real
 * geometry sitting a fraction above the road rather than a texture blend. That costs one draw call
 * each, which is why the count is budgeted per quality tier and why the whole scatter is skipped on
 * the LOW tier — where the frame budget is tight and the camera is usually too close to see them.
 */

export type DecalFamily = "ink_splash" | "dirt" | "floor_mark" | "scratch" | "tape" | "label" | "sticker";

/** How many decals each quality tier may spend a draw call on. */
const BUDGET: Record<string, number> = { LOW: 0, MEDIUM: 10, HIGH: 22, ULTRA: 34 };

/**
 * Which families dress which theme, in the order they are drawn from.
 *
 * Per-theme rather than one global mix, because the marks are a big part of what says *where* you
 * are: violet ink belongs on a print-shop floor and would be inexplicable in an office, and the
 * office gets the paper and tape a warehouse floor would not.
 */
export const FAMILIES_BY_THEME: Record<string, readonly DecalFamily[]> = {
  PRINT_FACTORY: ["ink_splash", "ink_splash", "floor_mark", "dirt", "scratch"],
  WAREHOUSE: ["dirt", "floor_mark", "tape", "label", "scratch"],
  FLAGSHIP: ["floor_mark", "dirt", "sticker", "scratch"],
  OFFICE: ["floor_mark", "label", "tape", "dirt"],
  MANGA: ["sticker", "floor_mark", "dirt", "ink_splash"],
  GREYBOX: [],
};

/** Metres across, per family. A splash is a puddle; a scuff is a shoe. */
const SIZE_BY_FAMILY: Record<DecalFamily, [number, number]> = {
  ink_splash: [2.4, 4.6],
  dirt: [3.2, 6.4],
  floor_mark: [1.6, 3.4],
  scratch: [1.2, 2.6],
  tape: [0.7, 1.4],
  label: [0.5, 0.9],
  sticker: [0.4, 0.8],
};

export type Decals = {
  meshes: Mesh[];
  /** Manifest ids actually used, for the asset report. Empty when nothing was placed. */
  usedAssetIds: string[];
  dispose: () => void;
};

/**
 * Scatters decals along the road.
 *
 * `sampleAt` maps a lap-distance fraction to a point and a facing, so placement follows the track
 * rather than a bounding box — a decal in a wall is worse than no decal. `random` is the track's own
 * seeded generator, so a circuit is always dressed the same way and a screenshot is reproducible.
 */
export function scatterDecals(
  scene: Scene,
  road: Mesh,
  theme: string,
  quality: string,
  catalog: AssetCatalog | null,
  random: () => number,
  sampleAt: (fraction: number) => { position: Vector3; up: Vector3; side: Vector3 } | null,
): Decals {
  const budget = BUDGET[quality] ?? 0;
  const families = FAMILIES_BY_THEME[theme] ?? [];
  if (!catalog || budget === 0 || families.length === 0) {
    return { meshes: [], usedAssetIds: [], dispose: () => {} };
  }

  const meshes: Mesh[] = [];
  const usedAssetIds: string[] = [];
  // One material per asset, shared by every decal that uses it. Without this, twenty-two decals
  // would be twenty-two materials and would blow the art bible's forty-material budget on dirt.
  const materials = new Map<string, PBRMaterial>();

  const materialFor = (asset: VisualAsset, texture: Texture): PBRMaterial => {
    const existing = materials.get(asset.id);
    if (existing) return existing;
    const material = new PBRMaterial(`decal-${asset.id}`, scene);
    material.albedoTexture = texture;
    material.useAlphaFromAlbedoTexture = true;
    material.transparencyMode = PBRMaterial.PBRMATERIAL_ALPHABLEND;
    // A decal must never write depth: two overlapping marks would then cut holes in each other.
    material.needDepthPrePass = false;
    material.disableDepthWrite = true;
    // Pulled toward the camera so it wins the depth test against the road it sits on.
    material.zOffset = -2;
    material.roughness = asset.id.startsWith("decal_ink_splash") ? 0.24 : 0.85;
    material.metallic = 0;
    material.albedoColor = Color3.White();
    material.backFaceCulling = true;
    materials.set(asset.id, material);
    if (!usedAssetIds.includes(asset.id)) usedAssetIds.push(asset.id);
    return material;
  };

  for (let index = 0; index < budget; index += 1) {
    const family = families[index % families.length]!;
    const pool = catalog.decals(family).filter((asset) => catalog.texture(asset.id) !== null);
    if (pool.length === 0) continue;
    const asset = pool[Math.floor(random() * pool.length)]!;
    const texture = catalog.texture(asset.id)!;

    // Spread around the lap with jitter rather than at even intervals, so the marks do not read as
    // a repeating pattern — which is exactly how a decal scatter gives itself away.
    const at = (index + random() * 0.8) / budget;
    const frame = sampleAt(at % 1);
    if (!frame) continue;

    const [minSize, maxSize] = SIZE_BY_FAMILY[family];
    const size = minSize + random() * (maxSize - minSize);
    const offset = (random() - 0.5) * 2;

    // Lifted 2 cm off the road so the projection has something to bite into rather than landing
    // exactly coplanar with it, which produces z-fighting on some drivers however low the zOffset.
    const position = frame.position.add(frame.side.scale(offset * 3)).add(frame.up.scale(0.02));

    const decal = MeshBuilder.CreateDecal(`decal-${family}-${index}`, road, {
      position,
      normal: frame.up,
      size: new Vector3(size, size, size),
      angle: random() * Math.PI * 2,
      // Lets a mark bend over a kerb or a banked section instead of clipping through it.
      localMode: false,
    });
    decal.material = materialFor(asset, texture);
    decal.isPickable = false;
    decal.receiveShadows = false;
    // Above the road in render order, and never a shadow caster — a flat mark casting a shadow is
    // the single most obvious way a decal system announces itself.
    decal.renderingGroupId = 0;
    decal.alwaysSelectAsActiveMesh = false;
    meshes.push(decal);
  }

  return {
    meshes,
    usedAssetIds,
    dispose: () => {
      meshes.forEach((mesh) => mesh.dispose());
      materials.forEach((material) => material.dispose());
    },
  };
}
