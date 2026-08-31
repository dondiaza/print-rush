import {
  Color3,
  MeshBuilder,
  PBRMaterial,
  Scene,
  StandardMaterial,
  TransformNode,
  Vector3,
} from "@babylonjs/core";
import type { CharacterDefinition, RuntimeQuality } from "@print-rush/3d-factory";

type CharacterBuildOptions = { pose?: "STANDING" | "DRIVING" | "CELEBRATE"; quality?: RuntimeQuality };

export function createGeneratedCharacter(
  scene: Scene,
  definition: CharacterDefinition,
  name: string,
  options: CharacterBuildOptions = {},
): TransformNode {
  const quality = options.quality ?? "HIGH";
  const pose = options.pose ?? "STANDING";
  const segments = quality === "LOW" ? 6 : quality === "MEDIUM" ? 8 : 12;
  const root = new TransformNode(name, scene);
  root.metadata = { factoryType: "CHARACTER", definitionId: definition.id, generatorVersion: definition.generatorVersion, animationBaseY: 0 };

  const skin = material(scene, `${name}-skin`, definition.face.skinTone, .82);
  const shirt = material(scene, `${name}-shirt`, definition.shirt.baseColor, .72);
  const sleeve = material(scene, `${name}-sleeve`, definition.shirt.sleeveColor, .72);
  const pants = material(scene, `${name}-pants`, definition.pants.color, .84);
  const shoe = material(scene, `${name}-shoe`, definition.shoes.color, .66);
  const sole = material(scene, `${name}-sole`, definition.shoes.soleColor, .9);
  const hair = material(scene, `${name}-hair`, definition.hair.color, definition.hair.roughness);
  const eyeWhite = material(scene, `${name}-eye-white`, "#fffaf0", .9);
  const iris = material(scene, `${name}-iris`, definition.face.eyes.irisColor, .65);
  const dark = material(scene, `${name}-dark`, "#141219", .82);

  const exaggeration = definition.caricature === "SOFT" ? .92 : definition.caricature === "BOLD" ? 1.1 : 1;
  const totalHeight = 1.72 * definition.body.height;
  const legHeight = .58 * definition.body.legLength;
  const torsoHeight = .58 * definition.body.torsoLength;
  const torsoY = legHeight + torsoHeight * .53;
  const shoulder = .55 * definition.body.shoulderWidth;

  const torso = MeshBuilder.CreateCapsule(`${name}-torso`, { height: torsoHeight, radius: .28 * definition.body.torsoWidth * definition.body.volume, tessellation: segments, subdivisions: 2 }, scene);
  torso.position.set(0, torsoY, 0);
  torso.scaling.z = .68;
  torso.material = shirt;
  torso.parent = root;

  const collar = MeshBuilder.CreateTorus(`${name}-collar`, { diameter: .24, thickness: .045, tessellation: segments }, scene);
  collar.position.set(0, torsoY + torsoHeight * .42, .18);
  collar.rotation.x = Math.PI / 2;
  collar.material = dark;
  collar.parent = root;

  const headScale = definition.body.headScale * exaggeration;
  const headY = Math.min(totalHeight, torsoY + torsoHeight * .67 + .38 * headScale);
  const head = MeshBuilder.CreateSphere(`${name}-head`, { diameter: .62, segments }, scene);
  head.position.set(0, headY, 0);
  head.scaling.set(definition.face.width * headScale, definition.face.height * headScale, (.92 + definition.face.cheekVolume * .13) * headScale);
  head.material = skin;
  head.parent = root;

  const jaw = MeshBuilder.CreateSphere(`${name}-jaw`, { diameter: .42, segments }, scene);
  jaw.position.set(0, headY - .19 * headScale, .015);
  jaw.scaling.set(definition.face.jawWidth * headScale, (.72 + definition.face.jawRoundness * .25) * headScale, .88 * headScale);
  jaw.material = skin;
  jaw.parent = root;

  const eyeY = headY + (.035 + definition.face.eyes.height * .025) * headScale;
  const eyeGap = .145 * definition.face.eyes.spacing * headScale;
  [-1, 1].forEach((side) => {
    const eye = MeshBuilder.CreateSphere(`${name}-eye-${side}`, { diameter: .15 * definition.face.eyes.size, segments }, scene);
    eye.position.set(side * eyeGap, eyeY, .285 * headScale);
    eye.scaling.y = definition.face.eyes.roundness;
    eye.rotation.z = side * definition.face.eyes.angle;
    eye.material = eyeWhite;
    eye.parent = root;
    const pupil = MeshBuilder.CreateSphere(`${name}-iris-${side}`, { diameter: .072 * definition.face.eyes.size, segments: 8 }, scene);
    pupil.position.set(side * eyeGap, eyeY, .355 * headScale);
    pupil.scaling.z = .35;
    pupil.material = iris;
    pupil.parent = root;
    const brow = MeshBuilder.CreateBox(`${name}-brow-${side}`, { width: .16, height: .025 + definition.face.eyebrows.thickness * .025, depth: .025 }, scene);
    brow.position.set(side * eyeGap, eyeY + .12 * headScale + definition.face.eyebrows.height * .025, .32 * headScale);
    brow.rotation.z = side * (definition.face.eyebrows.angle + (definition.face.eyebrows.preset === "ARCHED" ? .12 : 0));
    brow.material = material(scene, `${name}-brow-mat-${side}`, definition.face.eyebrows.color, .88);
    brow.parent = root;
  });

  const nose = MeshBuilder.CreateSphere(`${name}-nose`, { diameter: .105 + definition.face.nose.width * .075, segments: 8 }, scene);
  nose.position.set(0, headY - .045 * headScale, (.315 + definition.face.nose.length * .045) * headScale);
  nose.scaling.y = .72 + definition.face.nose.height * .34;
  nose.material = skin;
  nose.parent = root;

  const mouth = MeshBuilder.CreateTorus(`${name}-mouth`, { diameter: .105 + definition.face.mouth.width * .12, thickness: .014 + definition.face.mouth.lipThickness * .018, tessellation: 12 }, scene);
  mouth.position.set(0, headY - .15 * headScale + definition.face.mouth.height * .02, .326 * headScale);
  mouth.rotation.set(Math.PI / 2, 0, definition.face.mouth.curve * .45);
  mouth.material = material(scene, `${name}-mouth-mat`, "#8f4050", .75);
  mouth.parent = root;

  [-1, 1].forEach((side) => {
    const ear = MeshBuilder.CreateSphere(`${name}-ear-${side}`, { diameter: .13 * (.75 + definition.face.ears.size * .5), segments: 8 }, scene);
    ear.position.set(side * .315 * definition.face.width * headScale * (1 + definition.face.ears.separation * .08), headY + (definition.face.ears.height - .5) * .1, 0);
    ear.material = skin;
    ear.parent = root;
  });

  buildHair(scene, root, definition, hair, headY, headScale, segments, name);
  buildFacialHair(scene, root, definition, hair, headY, headScale, name);
  buildGlasses(scene, root, definition, headY, headScale, name);
  buildShirtDesign(scene, root, definition, torsoY, name);

  const armY = torsoY + torsoHeight * .26;
  [-1, 1].forEach((side) => {
    const arm = MeshBuilder.CreateCapsule(`${name}-arm-${side}`, { height: .5 * definition.body.armLength, radius: .095 * definition.body.volume, tessellation: segments }, scene);
    arm.position.set(side * shoulder, armY, pose === "DRIVING" ? .18 : 0);
    arm.rotation.z = side * (pose === "CELEBRATE" ? 2.25 : pose === "DRIVING" ? .58 : .14);
    arm.rotation.x = pose === "DRIVING" ? -1.02 : 0;
    arm.material = sleeve;
    arm.parent = root;
    const hand = MeshBuilder.CreateSphere(`${name}-hand-${side}`, { diameter: .19 * definition.body.handScale, segments: 8 }, scene);
    hand.position.set(side * (shoulder + (pose === "DRIVING" ? .19 : .07)), armY - (pose === "CELEBRATE" ? -.28 : .23), pose === "DRIVING" ? .43 : 0);
    hand.material = skin;
    hand.parent = root;
  });

  [-1, 1].forEach((side) => {
    const leg = MeshBuilder.CreateCapsule(`${name}-leg-${side}`, { height: legHeight, radius: .12 * definition.body.volume, tessellation: segments }, scene);
    leg.position.set(side * .15, legHeight * .5, pose === "DRIVING" ? .24 : 0);
    leg.rotation.x = pose === "DRIVING" ? -1.12 : 0;
    leg.material = pants;
    leg.parent = root;
    const foot = MeshBuilder.CreateBox(`${name}-shoe-${side}`, { width: .22 * definition.body.footScale, height: .15, depth: .34 * definition.body.footScale }, scene);
    foot.position.set(side * .15, .12, pose === "DRIVING" ? .52 : .08);
    foot.material = shoe;
    foot.parent = root;
    const shoeSole = MeshBuilder.CreateBox(`${name}-sole-${side}`, { width: .225 * definition.body.footScale, height: .035, depth: .36 * definition.body.footScale }, scene);
    shoeSole.position.set(side * .15, .045, pose === "DRIVING" ? .53 : .09);
    shoeSole.material = sole;
    shoeSole.parent = root;
  });

  root.getChildMeshes().forEach((mesh) => { mesh.isPickable = false; mesh.receiveShadows = true; });
  return root;
}

function buildHair(scene: Scene, root: TransformNode, definition: CharacterDefinition, hair: PBRMaterial, headY: number, headScale: number, segments: number, name: string): void {
  if (definition.hair.style === "BALD") return;
  const style = definition.hair.style;
  const long = /LONG|PONY|BRAID|LOC/.test(style);
  const curly = /CURLY|AFRO|BUN/.test(style);
  const short = /BUZZ|CREW|SHORT|PIXIE|UNDERCUT|REC/.test(style);
  const cap = MeshBuilder.CreateSphere(`${name}-hair-cap`, { diameter: .64 * definition.hair.scale, segments }, scene);
  cap.position.set(0, headY + .13 * headScale, -.02);
  cap.scaling.set(1.03 * definition.hair.volume, short ? .63 : .82, 1.02 * definition.hair.volume);
  cap.material = hair;
  cap.parent = root;
  if (style === "BUZZ" || style === "RECEDING") return;

  const count = curly ? (style.includes("AFRO") ? 11 : 7) : long ? 5 : 3;
  for (let index = 0; index < count; index += 1) {
    const angle = (index / count) * Math.PI * 2;
    const lock = MeshBuilder.CreateSphere(`${name}-hair-lock-${index}`, { diameter: curly ? .22 : .18, segments: 8 }, scene);
    lock.position.set(Math.sin(angle) * .25 * headScale, headY + .23 * headScale - (long && index > 2 ? .32 : 0), Math.cos(angle) * .22 * headScale - .05);
    lock.scaling.y = long ? 2.2 : curly ? 1.05 : .8;
    lock.material = hair;
    lock.parent = root;
  }
  if (/PONYTAIL|BRAID|LOCS/.test(style)) {
    const tail = MeshBuilder.CreateCapsule(`${name}-ponytail`, { height: style === "BRAID" ? .7 : .52, radius: .11, tessellation: 8 }, scene);
    tail.position.set(0, headY - .12, -.34 * headScale);
    tail.rotation.x = -.18;
    tail.material = hair;
    tail.parent = root;
  }
}

function buildFacialHair(scene: Scene, root: TransformNode, definition: CharacterDefinition, fallback: PBRMaterial, headY: number, headScale: number, name: string): void {
  const style = definition.facialHair.style;
  if (style === "NONE") return;
  const beardMaterial = definition.facialHair.color === definition.hair.color ? fallback : material(scene, `${name}-beard-mat`, definition.facialHair.color, .9);
  const mustache = MeshBuilder.CreateCapsule(`${name}-mustache`, { height: .2, radius: .03 + definition.facialHair.density * .018, tessellation: 8 }, scene);
  mustache.position.set(0, headY - .105 * headScale, .325 * headScale);
  mustache.rotation.z = Math.PI / 2;
  mustache.material = beardMaterial;
  mustache.parent = root;
  if (style === "MUSTACHE") return;
  const beard = MeshBuilder.CreateSphere(`${name}-beard`, { diameter: style === "STUBBLE" ? .42 : style === "FULL" ? .5 : .45, segments: 8 }, scene);
  beard.position.set(0, headY - .215 * headScale, .17 * headScale);
  beard.scaling.set(.9, style === "FULL" || style === "MEDIUM" ? .85 : .5, .55);
  beard.material = beardMaterial;
  beard.parent = root;
}

function buildGlasses(scene: Scene, root: TransformNode, definition: CharacterDefinition, headY: number, headScale: number, name: string): void {
  if (definition.glasses.style === "NONE") return;
  const frame = material(scene, `${name}-glasses`, definition.glasses.frameColor, .45, .25);
  const size = definition.glasses.size;
  [-1, 1].forEach((side) => {
    const lens = definition.glasses.style === "ROUND"
      ? MeshBuilder.CreateTorus(`${name}-lens-${side}`, { diameter: .19 * size, thickness: .018, tessellation: 10 }, scene)
      : MeshBuilder.CreateBox(`${name}-lens-${side}`, { width: .2 * size, height: .14 * size, depth: .018 }, scene);
    lens.position.set(side * .135 * headScale, headY + .035 * headScale, .36 * headScale);
    lens.material = frame;
    lens.parent = root;
  });
  const bridge = MeshBuilder.CreateBox(`${name}-glasses-bridge`, { width: .09, height: .018, depth: .018 }, scene);
  bridge.position.set(0, headY + .035 * headScale, .36 * headScale);
  bridge.material = frame;
  bridge.parent = root;
}

function buildShirtDesign(scene: Scene, root: TransformNode, definition: CharacterDefinition, torsoY: number, name: string): void {
  if (definition.shirt.frontDesign === "NONE") return;
  const colors: Record<string, string> = { INK_BOLT: "#b9ff45", THREAD_WAVE: "#4db7ff", PRINT_SKULL: "#f7f2e8", PACKAGE_CAT: "#ff7b2f", CUSTOM: "#8f5cff" };
  const design = MeshBuilder.CreatePlane(`${name}-shirt-design`, { width: .23 * definition.shirt.designScale, height: .27 * definition.shirt.designScale }, scene);
  design.position.set(definition.shirt.designX * .08, torsoY + definition.shirt.designY * .08, .207);
  design.rotation.z = definition.shirt.designRotation;
  const designMaterial = new StandardMaterial(`${name}-design-mat`, scene);
  designMaterial.diffuseColor = Color3.FromHexString(colors[definition.shirt.frontDesign] ?? "#f7f2e8");
  designMaterial.emissiveColor = designMaterial.diffuseColor.scale(.25);
  designMaterial.backFaceCulling = false;
  design.material = designMaterial;
  design.parent = root;
}

function material(scene: Scene, name: string, hex: string, roughness: number, metallic = .03): PBRMaterial {
  const result = new PBRMaterial(name, scene);
  result.albedoColor = Color3.FromHexString(hex);
  result.roughness = roughness;
  result.metallic = metallic;
  return result;
}

export function disposeGenerated(root: TransformNode): void {
  const materials = new Set(root.getChildMeshes().map((mesh) => mesh.material).filter(Boolean));
  root.dispose(false, true);
  materials.forEach((entry) => entry?.dispose());
}

export function animateGeneratedCharacter(root: TransformNode, time: number, personality: CharacterDefinition["personality"]): void {
  const amplitude = personality === "ENERGETIC" ? .035 : personality === "FUNNY" ? .045 : .018;
  const baseY = typeof root.metadata?.animationBaseY === "number" ? root.metadata.animationBaseY : 0;
  root.position.y = baseY + Math.sin(time * (personality === "CALM" ? 1.2 : 2)) * amplitude;
  root.rotation.z = Math.sin(time * .7) * amplitude * .35;
}

export const CharacterRigBones = [
  "root", "hips", "spine", "chest", "neck", "head", "clavicle_L", "upperArm_L", "lowerArm_L", "hand_L",
  "clavicle_R", "upperArm_R", "lowerArm_R", "hand_R", "upperLeg_L", "lowerLeg_L", "foot_L", "upperLeg_R", "lowerLeg_R", "foot_R",
] as const;

export function characterBounds(definition: CharacterDefinition): { min: Vector3; max: Vector3 } {
  const height = 1.72 * definition.body.height * definition.body.headScale;
  const width = Math.max(.7, definition.body.shoulderWidth * .82);
  return { min: new Vector3(-width / 2, 0, -.38), max: new Vector3(width / 2, height, .38) };
}
