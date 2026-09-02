import type { Scene, TransformNode } from "@babylonjs/core";
import type { KartDefinition, RuntimeQuality } from "@print-rush/3d-factory";
import { buildKart } from "@/render/KartBuilder";

/**
 * Kart generation now delegates to `render/KartBuilder`, which models the kart from lofted
 * bodywork, swept tubes and revolved wheels instead of the seven boxes and four cylinders V4 used.
 *
 * The signature is unchanged so the studios and the preview keep working; the returned node carries
 * the full `KartVisual` in its metadata for callers that need to animate the wheels and steering.
 */
export function createGeneratedKart(
  scene: Scene,
  definition: KartDefinition,
  name: string,
  quality: RuntimeQuality = "HIGH",
): TransformNode {
  const visual = buildKart(scene, definition, name, quality);
  visual.root.metadata = { ...visual.root.metadata, kartVisual: visual };
  return visual.root;
}
