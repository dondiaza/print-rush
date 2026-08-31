import {
  Color3,
  MeshBuilder,
  PBRMaterial,
  Scene,
  StandardMaterial,
  TransformNode,
  Vector3,
} from "@babylonjs/core";
import type { CharacterDefinition, KartDefinition, RuntimeQuality } from "@print-rush/3d-factory";
import { createGeneratedCharacter } from "@/factory/GeneratedCharacter";
import { createGeneratedKart } from "@/factory/GeneratedKart";

export type KartPalette = { body: Color3; accent: Color3; shirt: Color3; skin: Color3 };
export type KartCustomization = { kart: KartDefinition; character: CharacterDefinition; quality?: RuntimeQuality };

export function createKart(scene: Scene, name: string, palette: KartPalette, withDriver = true, customization?: KartCustomization): TransformNode {
  if (customization) return createCustomizedKart(scene, name, customization, withDriver);
  const root = new TransformNode(name, scene);
  const bodyMaterial = toonMaterial(scene, `${name}-body`, palette.body);
  const accentMaterial = toonMaterial(scene, `${name}-accent`, palette.accent);
  const darkMaterial = toonMaterial(scene, `${name}-dark`, new Color3(0.025, 0.025, 0.035));
  const chromeMaterial = toonMaterial(scene, `${name}-chrome`, new Color3(0.55, 0.6, 0.64));

  const chassis = MeshBuilder.CreateBox(`${name}-chassis`, { width: 1.9, height: 0.46, depth: 2.9 }, scene);
  chassis.position.y = 0.62;
  chassis.material = bodyMaterial;
  chassis.parent = root;

  const nose = MeshBuilder.CreateBox(`${name}-nose`, { width: 1.65, height: 0.34, depth: 1.08 }, scene);
  nose.position.set(0, 0.88, 1.18);
  nose.rotation.x = -0.08;
  nose.material = accentMaterial;
  nose.parent = root;

  const bumper = MeshBuilder.CreateBox(`${name}-bumper`, { width: 2.14, height: 0.16, depth: 0.22 }, scene);
  bumper.position.set(0, 0.47, 1.56);
  bumper.material = chromeMaterial;
  bumper.parent = root;

  const seat = MeshBuilder.CreateBox(`${name}-seat`, { width: 1.05, height: 0.95, depth: 0.28 }, scene);
  seat.position.set(0, 1.22, -0.62);
  seat.rotation.x = -0.14;
  seat.material = darkMaterial;
  seat.parent = root;

  const spoiler = MeshBuilder.CreateBox(`${name}-spoiler`, { width: 1.8, height: 0.16, depth: 0.5 }, scene);
  spoiler.position.set(0, 1.08, -1.47);
  spoiler.material = accentMaterial;
  spoiler.parent = root;

  [-1, 1].forEach((side) => {
    [-1, 1].forEach((front) => {
      const wheel = MeshBuilder.CreateCylinder(`${name}-wheel`, { diameter: 0.72, height: 0.38, tessellation: 12 }, scene);
      wheel.rotation.z = Math.PI / 2;
      wheel.position.set(side * 1.05, 0.46, front * 1.03);
      wheel.material = darkMaterial;
      wheel.parent = root;
      wheel.metadata = { wheel: true, front };
    });
  });

  const number = MeshBuilder.CreatePlane(`${name}-number`, { width: 0.58, height: 0.42 }, scene);
  number.position.set(0, 0.9, 1.73);
  number.material = accentMaterial;
  number.parent = root;

  if (withDriver) {
    const torso = MeshBuilder.CreateBox(`${name}-shirt`, { width: 0.78, height: 0.86, depth: 0.5 }, scene);
    torso.position.set(0, 1.6, -0.35);
    torso.material = toonMaterial(scene, `${name}-shirt-mat`, palette.shirt);
    torso.parent = root;

    const head = MeshBuilder.CreateSphere(`${name}-head`, { diameter: 0.66, segments: 12 }, scene);
    head.position.set(0, 2.22, -0.27);
    head.scaling.y = 1.08;
    head.material = toonMaterial(scene, `${name}-skin`, palette.skin);
    head.parent = root;

    const cap = MeshBuilder.CreateCylinder(`${name}-cap`, { diameter: 0.69, height: 0.2, tessellation: 12 }, scene);
    cap.position.set(0, 2.53, -0.27);
    cap.material = accentMaterial;
    cap.parent = root;

    const capPeak = MeshBuilder.CreateBox(`${name}-cap-peak`, { width: 0.56, height: 0.08, depth: 0.38 }, scene);
    capPeak.position.set(0, 2.49, 0.02);
    capPeak.material = accentMaterial;
    capPeak.parent = root;
  }

  root.getChildMeshes().forEach((mesh) => {
    mesh.receiveShadows = true;
    mesh.isPickable = false;
  });
  return root;
}

function createCustomizedKart(scene: Scene, name: string, customization: KartCustomization, withDriver: boolean): TransformNode {
  const root = createGeneratedKart(scene, customization.kart, name, customization.quality ?? "HIGH");
  if (withDriver) {
    const driver = createGeneratedCharacter(scene, customization.character, `${name}-driver`, { pose: "DRIVING", quality: customization.quality ?? "HIGH" });
    driver.parent = root;
    driver.scaling.setAll(.76 * customization.kart.compatibility.driverScale);
    driver.position.set(0, customization.kart.compatibility.seatHeight - .03, -.38);
    driver.metadata = { ...driver.metadata, animationBaseY: driver.position.y };
  }
  return root;
}

export function animateKartWheels(root: TransformNode, distance: number, steer: number): void {
  root.getChildMeshes().forEach((mesh) => {
    if (!mesh.metadata?.wheel) return;
    mesh.rotation.x += distance * 0.035;
    if (mesh.metadata.front === 1) mesh.rotation.y = steer * 0.32;
  });
}

function toonMaterial(scene: Scene, name: string, color: Color3): PBRMaterial {
  const material = new PBRMaterial(name, scene);
  material.albedoColor = color;
  material.roughness = 0.76;
  material.metallic = 0.06;
  material.environmentIntensity = 0.45;
  return material;
}

export function createEmissiveMaterial(scene: Scene, name: string, color: Color3): StandardMaterial {
  const material = new StandardMaterial(name, scene);
  material.diffuseColor = color.scale(0.4);
  material.emissiveColor = color;
  material.specularColor = Color3.Black();
  return material;
}

export function setKartPose(root: TransformNode, position: Vector3, yaw: number): void {
  root.position.copyFrom(position);
  root.rotationQuaternion = null;
  root.rotation.set(0, yaw, 0);
}

export function setKartVisibility(root: TransformNode, visible: boolean): void {
  root.getChildMeshes(false).forEach((mesh) => { mesh.isVisible = visible; });
}
