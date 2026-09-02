import type { Scene, TransformNode } from "@babylonjs/core";
import type { CharacterDefinition } from "@print-rush/3d-factory";
import {
  animateCharacter,
  buildCharacter,
  type CharacterBuildOptions,
  type CharacterVisual,
} from "@/render/CharacterBuilder";

/**
 * Character generation delegates to `render/CharacterBuilder`, which models the rider from lofted
 * volumes, swept limbs and a face with eyelids instead of the ten spheres and five capsules V4 used.
 *
 * The signature is unchanged so the podium, the preview and the studio keep working. The rich
 * `CharacterVisual` — the nodes the animation needs — is stored in the returned node's metadata.
 */
export function createGeneratedCharacter(
  scene: Scene,
  definition: CharacterDefinition,
  name: string,
  options: CharacterBuildOptions = {},
): TransformNode {
  const visual = buildCharacter(scene, definition, name, options);
  visual.root.metadata = { ...visual.root.metadata, characterVisual: visual };
  return visual.root;
}

export function characterVisualOf(root: TransformNode): CharacterVisual | null {
  return (root.metadata as { characterVisual?: CharacterVisual } | undefined)?.characterVisual ?? null;
}

/**
 * Idle animation for the studio and podium: a bob, a look around and blinking.
 * `personality` comes from the character schema and changes the tempo and amplitude, so the four
 * personalities are visibly different rather than being a stored string nothing reads.
 *
 * The race runtime drives `animateCharacter` directly from real vehicle state instead.
 */
export function animateGeneratedCharacter(
  root: TransformNode,
  seconds: number,
  personality: CharacterDefinition["personality"] = "ENERGETIC",
): void {
  const tempo = personality === "ENERGETIC" ? 2.2 : personality === "FUNNY" ? 1.9 : personality === "COOL" ? 1.2 : 1;
  const amplitude = personality === "CALM" ? 0.006 : personality === "COOL" ? 0.009 : 0.016;

  const base = (root.metadata as { animationBaseY?: number } | undefined)?.animationBaseY ?? 0;
  root.position.y = base + Math.sin(seconds * tempo) * amplitude;

  const visual = characterVisualOf(root);
  if (!visual) return;
  animateCharacter(visual, {
    steer: Math.sin(seconds * tempo * 0.32) * (personality === "COOL" ? 0.2 : 0.45),
    lean: Math.sin(seconds * tempo * 0.21) * 0.12,
    time: seconds,
  });
}
