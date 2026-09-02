import {
  Color3,
  Mesh,
  MeshBuilder,
  StandardMaterial,
  Texture,
  Vector3,
  type Scene,
} from "@babylonjs/core";
import type { AssetCatalog } from "./AssetCatalog";

/**
 * BACKDROP DOME.
 *
 * What used to be behind the circuit: a flat clear colour. Whatever the theme, the world ended at
 * the last wall and the space beyond it was one unbroken tone, which is the single clearest tell
 * that a track is a box rather than a place.
 *
 * This puts the baked panorama there instead — a cylinder seen from the inside, plus a cap in the
 * panorama's own ceiling colour so looking up does not find a hole.
 *
 * Why a cylinder and not a sphere: the panoramas are cylindrical projections, generated as U around
 * and V floor-to-ceiling with no polar distortion. Mapping one onto a sphere would pinch it at the
 * poles and compress the horizon, which is exactly the band the player actually sees.
 *
 * `infiniteDistance` keeps it centred on the camera, so it reads as distance rather than as a wall
 * the kart could reach, and it can then be small enough to stay well inside the depth range.
 */

export type Backdrop = {
  mesh: Mesh;
  /** The panorama's id, or null when the catalog had none and the fallback gradient is in use. */
  assetId: string | null;
  dispose: () => void;
};

const RADIUS = 260;
const HEIGHT = 190;

/**
 * Builds the backdrop for a theme.
 *
 * Returns a cylinder textured with the theme's panorama when the catalog has it, and otherwise a
 * plain two-tone cylinder in `fallbackColor`. The fallback is not much, but it is still better than
 * the flat clear colour: it gives the horizon a line, and a horizon line is what speed reads against.
 */
export function createBackdrop(
  scene: Scene,
  theme: string,
  catalog: AssetCatalog | null,
  fallbackColor: string,
): Backdrop {
  const asset = catalog?.backdropFor(theme) ?? null;
  const texture = asset ? catalog?.texture(asset.id) ?? null : null;

  const mesh = MeshBuilder.CreateCylinder(
    "backdrop",
    {
      height: HEIGHT,
      diameter: RADIUS * 2,
      tessellation: 96,
      // Open at both ends: the top gets its own cap mesh below, and the bottom is under the track.
      cap: Mesh.NO_CAP,
      // Seen from the inside, so only the back faces are wanted.
      sideOrientation: Mesh.BACKSIDE,
    },
    scene,
  );
  // Sits with the horizon a little above the road, which is where the panoramas put theirs.
  mesh.position.y = HEIGHT / 2 - 22;
  mesh.infiniteDistance = true;
  mesh.isPickable = false;
  mesh.doNotSyncBoundingInfo = true;
  // Nothing in the world can be behind it, so it never needs to occlude or be lit.
  mesh.applyFog = false;
  mesh.receiveShadows = false;

  const material = new StandardMaterial("backdrop-mat", scene);
  // Unlit: a backdrop is a picture of a lit space, not a surface in this one. Leaving it lit would
  // let the track's own lamps fall across the horizon, which immediately reads as a curtain.
  material.disableLighting = true;
  material.backFaceCulling = false;
  material.specularColor = Color3.Black();
  /**
   * `useEmissiveAsIllumination` is load-bearing, not a preference.
   *
   * In Babylon's default fragment shader the ordinary emissive path computes
   * `finalDiffuse = clamp(diffuseBase * diffuseColor + emissiveColor + ambient) * baseColor.rgb`,
   * where `baseColor` is the diffuse texture times the diffuse colour. A backdrop wants a black
   * diffuse — there is nothing here for a light to hit — and a black `baseColor` multiplies the
   * emissive term to zero, so the panorama would render as a black cylinder. With this flag the
   * shader takes its other branch and adds the emissive to the output *after* that product, which
   * is what makes an emissive-only surface possible at all.
   */
  material.useEmissiveAsIllumination = true;

  let assetId: string | null = null;
  if (texture) {
    const panorama = texture.clone();
    panorama.wrapU = Texture.WRAP_ADDRESSMODE;
    // Vertically it must not repeat: the panorama is floor-to-ceiling, and wrapping would put the
    // ceiling directly above the floor at the top edge.
    panorama.wrapV = Texture.CLAMP_ADDRESSMODE;
    material.emissiveTexture = panorama;
    material.emissiveColor = Color3.White();
    material.diffuseColor = Color3.Black();
    assetId = asset!.id;
  } else {
    material.emissiveColor = Color3.FromHexString(fallbackColor);
    material.diffuseColor = Color3.Black();
  }
  mesh.material = material;

  // The cap. Its colour comes from the panorama's own top edge when there is one, so the join is
  // not visible; a sampled pixel is not available without reading the image back, so the theme's
  // structure colour stands in and the cap is kept dim enough that the seam is not the thing you
  // notice when you look straight up.
  const cap = MeshBuilder.CreateDisc("backdrop-cap", { radius: RADIUS, tessellation: 48 }, scene);
  // Parented to the cylinder, so it inherits `infiniteDistance` and follows the camera with it.
  cap.parent = mesh;
  cap.position = new Vector3(0, HEIGHT / 2, 0);
  cap.rotation.x = -Math.PI / 2;
  cap.isPickable = false;
  cap.applyFog = false;
  const capMaterial = new StandardMaterial("backdrop-cap-mat", scene);
  capMaterial.disableLighting = true;
  // Same shader branch as the cylinder, for the same reason.
  capMaterial.useEmissiveAsIllumination = true;
  capMaterial.specularColor = Color3.Black();
  capMaterial.diffuseColor = Color3.Black();
  capMaterial.emissiveColor = Color3.FromHexString(fallbackColor).scale(0.7);
  // Seen only from underneath.
  capMaterial.backFaceCulling = false;
  cap.material = capMaterial;

  return {
    mesh,
    assetId,
    dispose: () => {
      cap.material?.dispose();
      cap.dispose();
      mesh.material?.dispose();
      mesh.dispose();
    },
  };
}
