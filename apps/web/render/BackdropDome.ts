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
 * What is behind the circuit. The first version of this had three defects that between them account
 * for most of "the backgrounds are incomplete and things half disappear", and all three came from
 * one misunderstanding of `infiniteDistance`.
 *
 * **It sat 73 metres above the camera.** Babylon implements `infiniteDistance` as
 * `translation = position + cameraPosition` — verified in `transformNode`, not assumed. So a
 * `position.y` of 73 does not raise the dome in the world, it raises it *relative to the viewer,
 * permanently*. The panorama's horizon lives at the middle of its height, so the horizon sat 73 m
 * overhead and the band actually at eye level was the picture's floor.
 *
 * **It was open at the bottom.** With the dome that high and no ground beyond the track, looking
 * down past the road found the hole and, through it, nothing.
 *
 * **It was smaller than the view.** Radius 260 against a far plane of 900: because the shell is
 * camera-relative, it formed a 260 m bubble that occluded every poster, spectator and prop further
 * away than that. On a long straight, half the dressing vanished — which is exactly what "elements
 * disappear in parts" describes.
 *
 * So: the horizon is at eye level, the shell reaches nearly to the far plane, and it is capped above.
 * Below it needs nothing — the ground plane `Terrain` builds now reaches to within a hundred metres
 * of the shell, which at eye height is a quarter of a degree of sky between them.
 */

export type Backdrop = {
  mesh: Mesh;
  /** The panorama's id, or null when the catalog had none and the fallback gradient is in use. */
  assetId: string | null;
  dispose: () => void;
};

/**
 * Just inside the camera's far plane, which is 900.
 *
 * The shell must be farther than anything the player can see or it clips the world; it must be
 * nearer than the far plane or it is clipped itself. There is exactly one band that satisfies both,
 * and this is it.
 */
const RADIUS = 820;

/**
 * Half the shell's height.
 *
 * Symmetric about the camera, and that is forced by the geometry rather than chosen: a cylinder maps
 * V linearly along its height, so the panorama's horizon always lands on the geometric centre. An
 * asymmetric shell would need the UVs remapped, which would buy nothing — the composition of each
 * panorama already decides how much sky it has.
 *
 * At radius 820 this puts the top and bottom rims 28 degrees off horizontal. The race camera's
 * vertical half-field is about 22 degrees and it looks slightly *down* at the kart, so neither rim
 * enters the view in normal driving; the cap covers above for the moments it does, and the terrain
 * covers below.
 */
const HALF_HEIGHT = 440;

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
      height: HALF_HEIGHT * 2,
      diameter: RADIUS * 2,
      tessellation: 96,
      // Open: the top gets its own cap below, and the bottom is covered by the terrain.
      cap: Mesh.NO_CAP,
      // Seen from the inside, so only the back faces are wanted.
      sideOrientation: Mesh.BACKSIDE,
    },
    scene,
  );
  /**
   * The horizon at eye level, which means no offset at all.
   *
   * `position` is added to the camera position, so zero is the only value that puts the geometric
   * centre — and therefore the panorama's horizon — on the viewer's eye. The previous version set
   * this to 73 and the one before this comment briefly set it to 180; both raised the horizon above
   * the player and left the picture's floor band filling the view.
   */
  mesh.position.y = 0;
  mesh.infiniteDistance = true;
  mesh.isPickable = false;
  mesh.doNotSyncBoundingInfo = true;
  // Nothing can be behind it, so it never needs to occlude, be lit, or be fogged.
  mesh.applyFog = false;
  mesh.receiveShadows = false;
  /**
   * Never culled.
   *
   * A camera-relative mesh has a bounding box that Babylon computes from its local transform, and a
   * frustum test against that can decide the sky is off screen. `alwaysSelectAsActiveMesh` is the
   * documented way out, and a missing sky is not a cost worth risking to skip one test.
   */
  mesh.alwaysSelectAsActiveMesh = true;

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
   * shader takes its other branch and adds the emissive to the output *after* that product.
   */
  material.useEmissiveAsIllumination = true;

  let assetId: string | null = null;
  if (texture) {
    const panorama = texture.clone();
    /**
     * Anisotropic filtering, on the one surface that most needs it.
     *
     * The horizon band is viewed at a grazing angle for the whole race — the shell is a cylinder, so
     * near the top and bottom of the visible band the texture is compressed almost to nothing along
     * one axis. That is the exact case isotropic mip filtering cannot handle, and it is why the
     * horizon shimmered even before the resolution was raised. Sixteen is the cap Babylon clamps to
     * the device's own maximum, so this asks for the best available rather than a guess.
     */
    panorama.anisotropicFilteringLevel = 16;
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

  /**
   * The cap.
   *
   * A disc rather than a hemisphere: the panoramas are cylindrical projections with no polar data, so
   * there is nothing to map onto a dome and a flat lid in the sky's own colour is both honest and
   * free. It is high enough above the horizon that it reads as haze rather than as a ceiling.
   */
  const cap = MeshBuilder.CreateDisc("backdrop-cap", { radius: RADIUS, tessellation: 64 }, scene);
  cap.parent = mesh;
  cap.position = new Vector3(0, HALF_HEIGHT, 0);
  cap.rotation.x = -Math.PI / 2;
  cap.isPickable = false;
  cap.applyFog = false;
  cap.alwaysSelectAsActiveMesh = true;
  const capMaterial = new StandardMaterial("backdrop-cap-mat", scene);
  capMaterial.disableLighting = true;
  // Same shader branch as the cylinder, for the same reason.
  capMaterial.useEmissiveAsIllumination = true;
  capMaterial.specularColor = Color3.Black();
  capMaterial.diffuseColor = Color3.Black();
  /**
   * Lit a touch brighter than the fallback tone.
   *
   * The panorama's top band is its ceiling or its sky, which is always the brightest part of these
   * images; a cap at the mid tone reads as a dark lid. Brightening it is what makes the join at the
   * top of the cylinder stop being the thing you notice when you look up.
   */
  capMaterial.emissiveColor = Color3.FromHexString(fallbackColor).scale(1.15);
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
