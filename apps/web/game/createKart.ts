import { Color3, Scene, StandardMaterial, TransformNode, Vector3 } from "@babylonjs/core";
import { KartPresets, type CharacterDefinition, type KartDefinition, type RuntimeQuality } from "@print-rush/3d-factory";
import { createGeneratedCharacter } from "@/factory/GeneratedCharacter";
import { animateKart, buildKart, type KartVisual } from "@/render/KartBuilder";

/**
 * Kart assembly: the modelled kart plus its driver.
 *
 * The V4 version had two code paths — a hand-written box kart for the menu and a "customized" path
 * for the race — which meant the thing shown in the menu was not the thing you drove. There is one
 * path now, and the palette argument seeds a definition when the caller has no full one.
 */

export type KartPalette = { body: Color3; accent: Color3; shirt: Color3; skin: Color3 };
export type KartCustomization = { kart: KartDefinition; character: CharacterDefinition; quality?: RuntimeQuality };

/** Builds a `KartDefinition` from a loose palette, for callers that only want a colour. */
function definitionFromPalette(palette: KartPalette): KartDefinition {
  const base = KartPresets[0]!;
  return {
    ...base,
    id: `palette-${palette.body.toHexString()}`,
    primaryColor: palette.body.toHexString(),
    secondaryColor: palette.accent.toHexString(),
    rimColor: "#c8ced6",
  };
}

export function createKart(
  scene: Scene,
  name: string,
  palette: KartPalette,
  withDriver = true,
  customization?: KartCustomization,
): TransformNode {
  const quality = customization?.quality ?? "HIGH";
  const definition = customization?.kart ?? definitionFromPalette(palette);
  const visual = buildKart(scene, definition, name, quality);
  const root = visual.root;
  root.metadata = { ...root.metadata, kartVisual: visual, spin: 0 };

  if (withDriver && customization?.character) {
    const driver = createGeneratedCharacter(scene, customization.character, `${name}-driver`, {
      pose: "DRIVING",
      quality,
    });
    driver.parent = root;
    driver.scaling.setAll(0.78 * definition.compatibility.driverScale);
    // Seated on the seat base, hands reaching the wheel the kart actually has.
    driver.position.set(0, definition.compatibility.seatHeight + 0.16, -0.44);
    driver.metadata = { ...driver.metadata, animationBaseY: driver.position.y };
  }

  return root;
}

/** Retrieves the rich visual stored on a kart root, when the caller only has the node. */
export function kartVisualOf(root: TransformNode): KartVisual | null {
  return (root.metadata as { kartVisual?: KartVisual } | undefined)?.kartVisual ?? null;
}

/**
 * Advances the wheel rotation and applies steering and suspension.
 * `distance` is metres travelled this frame; wheel radius converts that into rotation, so the
 * wheels roll at the speed the kart is actually moving instead of an arbitrary multiplier.
 */
export function animateKartWheels(
  root: TransformNode,
  distance: number,
  steer: number,
  suspension = 0,
): void {
  const visual = kartVisualOf(root);
  if (!visual) return;
  const metadata = root.metadata as { spin?: number };
  // Nominal rolling radius. Front and rear differ slightly; one value keeps them in visual sync,
  // which matters more than exact per-axle accuracy at racing speed.
  const spin = (metadata.spin ?? 0) + distance / 0.4;
  metadata.spin = spin;
  animateKart(visual, spin, steer, suspension);
}

/** Kept for the menu and podium scenes, which want a flat glowing surface. */
export function createEmissiveMaterial(scene: Scene, name: string, color: Color3): StandardMaterial {
  const material = new StandardMaterial(name, scene);
  material.diffuseColor = color.scale(0.4);
  material.emissiveColor = color;
  material.specularColor = Color3.Black();
  material.disableLighting = true;
  return material;
}

export function setKartPose(root: TransformNode, position: Vector3, yaw: number): void {
  root.position.copyFrom(position);
  root.rotationQuaternion = null;
  root.rotation.set(0, yaw, 0);
}

export function setKartVisibility(root: TransformNode, visible: boolean): void {
  root.getChildMeshes(false).forEach((mesh) => {
    mesh.isVisible = visible;
  });
}
