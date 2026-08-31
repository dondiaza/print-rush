import {
  Color3,
  Mesh,
  MeshBuilder,
  PBRMaterial,
  Scene,
  StandardMaterial,
  TransformNode,
  Vector3,
} from "@babylonjs/core";
import type { TrackDefinition } from "@print-rush/game-core";
import { TrackPresets, type StoredTrack } from "@/factory/TrackFactory";
import { createEmissiveMaterial } from "./createKart";

export type BuiltTrack = {
  definition: TrackDefinition;
  itemBoxes: Array<{ node: TransformNode; position: Vector3; cooldown: number }>;
  boostPads: Vector3[];
  width: number;
};

export function buildFlagshipStore(scene: Scene, stored: StoredTrack = TrackPresets[0]!): BuiltTrack {
  const definition = stored.definition;
  const asphalt = material(scene, "track-ink", new Color3(0.095, 0.09, 0.12), 0.86);
  const floorMaterial = material(scene, "store-floor", new Color3(0.34, 0.31, 0.28), 0.95);
  const pink = createEmissiveMaterial(scene, "pink-ink", Color3.FromHexString("#ff3da6"));
  const acid = createEmissiveMaterial(scene, "acid-ink", Color3.FromHexString("#b9ff45"));
  const paper = material(scene, "paper", Color3.FromHexString("#f7f2e8"), 0.9);
  const dark = material(scene, "dark", Color3.FromHexString("#0b0b0f"), 0.8);

  const floor = MeshBuilder.CreateGround("store-floor", { width: 112, height: 84, subdivisions: 1 }, scene);
  floor.position.y = -0.08;
  floor.material = floorMaterial;
  floor.receiveShadows = true;

  const left: Vector3[] = [];
  const right: Vector3[] = [];
  definition.racingSpline.forEach((point, index) => {
    const previous = definition.racingSpline[(index - 1 + definition.racingSpline.length) % definition.racingSpline.length]!;
    const next = definition.racingSpline[(index + 1) % definition.racingSpline.length]!;
    const tangent = new Vector3(next.x - previous.x, 0, next.z - previous.z).normalize();
    const normal = new Vector3(-tangent.z, 0, tangent.x);
    const center = new Vector3(point.x, point.y + 0.03, point.z);
    left.push(center.add(normal.scale(stored.config.width / 2)));
    right.push(center.subtract(normal.scale(stored.config.width / 2)));
  });
  left.push(left[0]!.clone());
  right.push(right[0]!.clone());
  const road = MeshBuilder.CreateRibbon("track", { pathArray: [left, right], closePath: false, sideOrientation: Mesh.DOUBLESIDE }, scene);
  road.material = asphalt;
  road.receiveShadows = true;

  const barrierBase = MeshBuilder.CreateBox("barrier-base", { width: 1.35, height: 0.6, depth: 0.32 }, scene);
  barrierBase.material = pink;
  barrierBase.isVisible = false;
  for (let index = 0; index < definition.racingSpline.length; index += 3) {
    const point = definition.racingSpline[index]!;
    const next = definition.racingSpline[(index + 1) % definition.racingSpline.length]!;
    const tangent = new Vector3(next.x - point.x, 0, next.z - point.z).normalize();
    const normal = new Vector3(-tangent.z, 0, tangent.x);
    for (const side of [-1, 1]) {
      const instance = barrierBase.createInstance(`barrier-${index}-${side}`);
      instance.position.set(point.x + normal.x * (stored.config.width / 2 + .4) * side, point.y + 0.28, point.z + normal.z * (stored.config.width / 2 + .4) * side);
      instance.rotation.y = Math.atan2(tangent.x, tangent.z);
    }
  }

  definition.racingSpline.forEach((point, index) => {
    if (index % 8 !== 0) return;
    const next = definition.racingSpline[(index + 1) % definition.racingSpline.length]!;
    const dash = MeshBuilder.CreateBox(`dash-${index}`, { width: 0.16, height: 0.035, depth: 1.6 }, scene);
    dash.position.set(point.x, 0.08, point.z);
    dash.rotation.y = Math.atan2(next.x - point.x, next.z - point.z);
    dash.material = paper;
  });

  createStartLine(scene, paper, dark, definition, stored.config.width);
  createStoreProps(scene, pink, acid, paper, dark);

  const boostPads = [24, 48].map((index) => { const point = definition.racingSpline[index]!; return new Vector3(point.x, point.y + .11, point.z); });
  boostPads.forEach((position, index) => {
    const splineIndex = index === 0 ? 24 : 48;
    const point = definition.racingSpline[splineIndex]!;
    const next = definition.racingSpline[(splineIndex + 1) % definition.racingSpline.length]!;
    const pad = MeshBuilder.CreateBox(`boost-pad-${index}`, { width: 3.4, height: 0.08, depth: 5.2 }, scene);
    pad.position.copyFrom(position);
    pad.rotation.y = Math.atan2(next.x - point.x, next.z - point.z);
    pad.material = acid;
    for (let arrow = -1; arrow <= 1; arrow += 1) {
      const strip = MeshBuilder.CreateBox(`boost-strip-${index}-${arrow}`, { width: 0.34, height: 0.05, depth: 3.4 }, scene);
      strip.parent = pad;
      strip.position.x = arrow * 0.72;
      strip.position.y = 0.07;
      strip.material = dark;
    }
  });

  const itemIndexes = [13, 37, 61, 84];
  const itemBoxes = itemIndexes.map((splineIndex, index) => {
    const point = definition.racingSpline[splineIndex]!;
    const node = new TransformNode(`item-box-${index}`, scene);
    node.position.set(point.x, 1.18, point.z);
    const box = MeshBuilder.CreateBox(`item-cube-${index}`, { size: 1.3 }, scene);
    box.parent = node;
    box.rotation.set(0.35, 0.45, 0.12);
    box.material = index % 2 ? acid : pink;
    const core = MeshBuilder.CreateSphere(`item-core-${index}`, { diameter: 0.52, segments: 8 }, scene);
    core.parent = node;
    core.material = paper;
    return { node, position: node.position.clone(), cooldown: 0 };
  });

  return { definition, itemBoxes, boostPads, width: stored.config.width };
}

function createStartLine(scene: Scene, paper: PBRMaterial, dark: PBRMaterial, definition: TrackDefinition, width: number): void {
  const point = definition.racingSpline[0]!;
  const next = definition.racingSpline[1]!;
  const yaw = Math.atan2(next.x - point.x, next.z - point.z);
  const normal = new Vector3(-Math.cos(yaw), 0, Math.sin(yaw));
  for (let index = 0; index < 10; index += 1) {
    const stripe = MeshBuilder.CreateBox(`start-${index}`, { width: width / 10, height: 0.06, depth: 1.05 }, scene);
    const across = -width / 2 + (index + .5) * (width / 10);
    stripe.position.set(point.x + normal.x * across, point.y + .1, point.z + normal.z * across);
    stripe.rotation.y = yaw;
    stripe.material = index % 2 ? dark : paper;
  }
  const archLeft = MeshBuilder.CreateBox("start-arch-left", { width: 0.45, height: 6.5, depth: 0.45 }, scene);
  archLeft.position.set(point.x + normal.x * (width / 2 + .55), point.y + 3.2, point.z + normal.z * (width / 2 + .55));
  archLeft.material = dark;
  const archRight = archLeft.clone("start-arch-right");
  archRight.position.set(point.x - normal.x * (width / 2 + .55), point.y + 3.2, point.z - normal.z * (width / 2 + .55));
  const archTop = MeshBuilder.CreateBox("start-arch-top", { width: width + 1.5, height: 1.1, depth: .6 }, scene);
  archTop.position.set(point.x, point.y + 6.1, point.z);
  archTop.rotation.y = yaw;
  archTop.material = dark;
  const sign = MeshBuilder.CreatePlane("start-sign", { width: 8.2, height: 1.5 }, scene);
  sign.position.set(point.x - Math.sin(yaw) * .32, point.y + 6.1, point.z - Math.cos(yaw) * .32);
  sign.rotation.y = yaw + Math.PI;
  sign.material = createEmissiveMaterial(scene, "start-sign-mat", Color3.FromHexString("#ff3da6"));
}

function createStoreProps(scene: Scene, pink: StandardMaterial, acid: StandardMaterial, paper: PBRMaterial, dark: PBRMaterial): void {
  const backWall = MeshBuilder.CreateBox("store-back", { width: 108, height: 16, depth: 1 }, scene);
  backWall.position.set(0, 7.7, 41);
  backWall.material = dark;
  const sideWall = MeshBuilder.CreateBox("store-side", { width: 1, height: 16, depth: 82 }, scene);
  sideWall.position.set(53, 7.7, 0);
  sideWall.material = dark;

  for (let row = -1; row <= 1; row += 1) {
    for (let column = -2; column <= 2; column += 1) {
      const table = MeshBuilder.CreateBox(`shirt-table-${row}-${column}`, { width: 4.8, height: 1.2, depth: 2.4 }, scene);
      table.position.set(column * 7, 0.6, row * 5.4);
      table.material = dark;
      const folded = MeshBuilder.CreateBox(`folded-${row}-${column}`, { width: 2.7, height: 0.22, depth: 1.45 }, scene);
      folded.position.set(column * 7, 1.31, row * 5.4);
      folded.material = (row + column) % 2 ? pink : acid;
    }
  }

  for (let index = 0; index < 7; index += 1) {
    const rack = MeshBuilder.CreateBox(`rack-${index}`, { width: 0.18, height: 3.8, depth: 8 }, scene);
    rack.position.set(-42, 1.9, -26 + index * 8.5);
    rack.material = dark;
    for (let shirt = -2; shirt <= 2; shirt += 1) {
      const hanger = MeshBuilder.CreateBox(`hanger-${index}-${shirt}`, { width: 1.8, height: 1.7, depth: 0.18 }, scene);
      hanger.position.set(-41.85, 2.2, rack.position.z + shirt * 1.35);
      hanger.material = (index + shirt) % 2 ? pink : paper;
    }
  }

  const boxMaterial = material(scene, "cardboard", Color3.FromHexString("#bd7c43"), 1);
  for (let index = 0; index < 18; index += 1) {
    const box = MeshBuilder.CreateBox(`package-${index}`, { size: 1.5 + (index % 3) * 0.35 }, scene);
    box.position.set(37 + (index % 3) * 2, .8 + Math.floor(index / 9) * 1.8, -26 + (Math.floor(index / 3) % 3) * 3);
    box.rotation.y = (index % 4) * .18;
    box.material = boxMaterial;
  }

  const giantShirt = new TransformNode("giant-shirt-sign", scene);
  giantShirt.position.set(0, 9, 39.2);
  const torso = MeshBuilder.CreateBox("shirt-sign-body", { width: 8, height: 6, depth: .35 }, scene);
  torso.parent = giantShirt;
  torso.material = pink;
  [-1, 1].forEach((side) => {
    const sleeve = MeshBuilder.CreateBox(`shirt-sign-sleeve-${side}`, { width: 3.5, height: 2.4, depth: .35 }, scene);
    sleeve.parent = giantShirt;
    sleeve.position.set(side * 5, 1.25, 0);
    sleeve.rotation.z = side * .36;
    sleeve.material = pink;
  });
}

function material(scene: Scene, name: string, color: Color3, roughness: number): PBRMaterial {
  const result = new PBRMaterial(name, scene);
  result.albedoColor = color;
  result.roughness = roughness;
  result.metallic = 0.03;
  return result;
}
