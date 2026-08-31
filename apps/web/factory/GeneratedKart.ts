import { Color3, MeshBuilder, PBRMaterial, Scene, TransformNode } from "@babylonjs/core";
import type { KartDefinition, RuntimeQuality } from "@print-rush/3d-factory";

export function createGeneratedKart(scene: Scene, definition: KartDefinition, name: string, quality: RuntimeQuality = "HIGH"): TransformNode {
  const root = new TransformNode(name, scene);
  root.metadata = { factoryType: "KART", definitionId: definition.id, generatorVersion: definition.generatorVersion };
  const segments = quality === "LOW" ? 8 : 12;
  const primary = kartMaterial(scene, `${name}-primary`, definition.primaryColor, definition.finish);
  const secondary = kartMaterial(scene, `${name}-secondary`, definition.secondaryColor, definition.finish);
  const tire = kartMaterial(scene, `${name}-tire`, "#111116", "MATTE");
  const rim = kartMaterial(scene, `${name}-rim`, definition.rimColor, "METALLIC");

  const bodyDimensions: Record<KartDefinition["body"], readonly [number, number, number]> = {
    CLASSIC: [1.55, .38, 2.2], PACKAGE: [1.65, .52, 2.05], SPRINT: [1.42, .3, 2.48], ROLLER: [1.58, .34, 2.22], INK_TANK: [1.72, .48, 2.3],
  };
  const [bodyWidth, bodyHeight, bodyDepth] = bodyDimensions[definition.body];
  const chassis = MeshBuilder.CreateBox(`${name}-chassis`, { width: bodyWidth, height: bodyHeight, depth: bodyDepth }, scene);
  chassis.position.y = .48;
  chassis.material = primary;
  chassis.parent = root;

  const noseWidth = definition.nose === "TWIN" ? 1.3 : definition.nose === "BOX" ? 1.5 : 1.22;
  const nose = definition.nose === "ROUND"
    ? MeshBuilder.CreateCapsule(`${name}-nose`, { height: 1.05, radius: .42, tessellation: segments }, scene)
    : MeshBuilder.CreateBox(`${name}-nose`, { width: noseWidth, height: .3, depth: definition.nose === "WEDGE" ? 1.25 : .95 }, scene);
  nose.position.set(0, .72, 1.06);
  nose.rotation.x = definition.nose === "ROUND" ? Math.PI / 2 : -.06;
  nose.material = secondary;
  nose.parent = root;

  const seat = MeshBuilder.CreateCapsule(`${name}-seat`, { height: .86, radius: .4, tessellation: segments }, scene);
  seat.position.set(0, definition.compatibility.seatHeight + .36, -.42);
  seat.scaling.z = .34;
  seat.rotation.x = -.18;
  seat.material = kartMaterial(scene, `${name}-seat-mat`, "#17141b", "MATTE");
  seat.parent = root;

  if (definition.spoiler !== "NONE") {
    const wingWidth = definition.spoiler === "DOUBLE" ? 1.75 : definition.spoiler === "LOW" ? 1.25 : 1.55;
    const spoiler = MeshBuilder.CreateBox(`${name}-spoiler`, { width: wingWidth, height: .12, depth: .38 }, scene);
    spoiler.position.set(0, definition.spoiler === "LOW" ? .74 : .94, -1.18);
    spoiler.material = secondary;
    spoiler.parent = root;
    if (definition.spoiler === "DOUBLE") {
      const upper = spoiler.clone(`${name}-spoiler-upper`);
      upper.position.y += .22;
      upper.parent = root;
    }
  }

  [-1, 1].forEach((side) => [-1, 1].forEach((front) => {
    const diameter = definition.wheel === "CHUNKY" || definition.wheel === "OFFROAD" ? .68 : definition.wheel === "ROLLER" ? .52 : .58;
    const wheel = MeshBuilder.CreateCylinder(`${name}-wheel-${side}-${front}`, { diameter, height: definition.wheel === "SLICK" ? .3 : .38, tessellation: segments }, scene);
    wheel.position.set(side * .92, .38, front * .82);
    wheel.rotation.z = Math.PI / 2;
    wheel.material = tire;
    wheel.parent = root;
    wheel.metadata = { wheel: true, front };
    const hub = MeshBuilder.CreateCylinder(`${name}-rim-${side}-${front}`, { diameter: diameter * .48, height: .4, tessellation: definition.rim === "STAR" ? 10 : segments }, scene);
    hub.position.copyFrom(wheel.position);
    hub.rotation.z = Math.PI / 2;
    hub.material = rim;
    hub.parent = root;
  }));

  if (definition.antenna !== "NONE") {
    const pole = MeshBuilder.CreateCylinder(`${name}-antenna`, { height: .9, diameter: .035, tessellation: 6 }, scene);
    pole.position.set(.55, 1.12, -.78);
    pole.material = rim;
    pole.parent = root;
    const topper = MeshBuilder.CreateSphere(`${name}-antenna-top`, { diameter: definition.antenna === "BALL" ? .16 : .24, segments: 8 }, scene);
    topper.position.set(.55, 1.59, -.78);
    topper.scaling.set(definition.antenna === "SHIRT" ? 1.35 : 1, definition.antenna === "FLAG" ? .55 : 1, .35);
    topper.material = secondary;
    topper.parent = root;
  }

  if (definition.decal !== "NONE") {
    const decal = MeshBuilder.CreatePlane(`${name}-decal`, { width: .52, height: .35 }, scene);
    decal.position.set(0, .74, 1.58);
    const decalMaterial = new PBRMaterial(`${name}-decal-mat`, scene);
    decalMaterial.albedoColor = definition.decal === "INK" ? Color3.FromHexString("#4db7ff") : Color3.FromHexString("#f7f2e8");
    decalMaterial.emissiveColor = decalMaterial.albedoColor.scale(.22);
    decalMaterial.roughness = .65;
    decal.material = decalMaterial;
    decal.parent = root;
  }

  root.getChildMeshes().forEach((mesh) => { mesh.receiveShadows = true; mesh.isPickable = false; });
  return root;
}

function kartMaterial(scene: Scene, name: string, hex: string, finish: KartDefinition["finish"]): PBRMaterial {
  const material = new PBRMaterial(name, scene);
  material.albedoColor = Color3.FromHexString(hex);
  material.roughness = finish === "MATTE" ? .9 : finish === "GLOSS" ? .32 : .42;
  material.metallic = finish === "METALLIC" ? .72 : finish === "PEARL" ? .38 : .06;
  return material;
}
