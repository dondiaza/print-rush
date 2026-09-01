import {
  Color3,
  DynamicTexture,
  Mesh,
  MeshBuilder,
  PBRMaterial,
  Scene,
  StandardMaterial,
  TransformNode,
  Vector3,
} from "@babylonjs/core";
import type { TrackDefinition } from "@print-rush/game-core";
import { TrackPresets, type StoredTrack, type TrackSurface } from "@/factory/TrackFactory";
import { createEmissiveMaterial } from "./createKart";

export type BuiltHazard = {
  node: TransformNode;
  position: Vector3;
  progress: number;
  kind: string;
  phase: number;
  cooldown: number;
};

export type BuiltTrack = {
  definition: TrackDefinition;
  itemBoxes: Array<{ node: TransformNode; position: Vector3; cooldown: number }>;
  boostPads: Vector3[];
  jumpPads: Vector3[];
  hazards: BuiltHazard[];
  shortcutPads: Vector3[];
  width: number;
  lengthMeters: number;
  stored: StoredTrack;
};

const SURFACE_COLORS: Record<TrackSurface, string> = {
  ASPHALT: "#17151c",
  CARDBOARD: "#7b5435",
  METAL: "#343a43",
  WOOD: "#654635",
  INK: "#342041",
};

const THEME_ACCENTS = {
  FLAGSHIP: ["#ff3da6", "#b9ff45"],
  WAREHOUSE: ["#ffb547", "#ff623d"],
  PRINT_FACTORY: ["#8f5cff", "#65d8ff"],
  OFFICE: ["#65d8ff", "#b9ff45"],
  MANGA: ["#ff3da6", "#8f5cff"],
} as const;

export function buildFlagshipStore(scene: Scene, stored: StoredTrack = TrackPresets[0]!): BuiltTrack {
  const definition = stored.definition;
  const [accentAHex, accentBHex] = THEME_ACCENTS[stored.config.theme];
  const accentA = createEmissiveMaterial(scene, "track-accent-a", Color3.FromHexString(accentAHex));
  const accentB = createEmissiveMaterial(scene, "track-accent-b", Color3.FromHexString(accentBHex));
  const paper = material(scene, "paper", Color3.FromHexString("#f7f2e8"), .9);
  const dark = material(scene, "dark", Color3.FromHexString("#0b0b0f"), .82);
  const floorMaterial = material(scene, "venue-floor", Color3.FromHexString("#242128"), .98);
  const maxSpan = Math.max(stored.config.radiusX, stored.config.radiusZ) * 2 + 54;
  const floor = MeshBuilder.CreateGround("venue-floor", { width: maxSpan, height: maxSpan, subdivisions: 1 }, scene);
  floor.position.y = -1.15;
  floor.material = floorMaterial;
  floor.receiveShadows = true;

  const left: Vector3[] = [];
  const right: Vector3[] = [];
  definition.racingSpline.forEach((point, index) => {
    const previous = definition.racingSpline[(index - 1 + definition.racingSpline.length) % definition.racingSpline.length]!;
    const next = definition.racingSpline[(index + 1) % definition.racingSpline.length]!;
    const tangent = new Vector3(next.x - previous.x, next.y - previous.y, next.z - previous.z).normalize();
    const normal = new Vector3(-tangent.z, 0, tangent.x).normalize();
    const center = new Vector3(point.x, point.y + .04, point.z);
    const halfWidth = stored.segments[index]!.width / 2;
    left.push(center.add(normal.scale(halfWidth)));
    right.push(center.subtract(normal.scale(halfWidth)));
  });
  left.push(left[0]!.clone());
  right.push(right[0]!.clone());
  const road = MeshBuilder.CreateRibbon("track-road", { pathArray: [left, right], closePath: false, sideOrientation: Mesh.DOUBLESIDE }, scene);
  road.material = material(scene, "track-road-material", Color3.FromHexString("#15131a"), .9);
  road.receiveShadows = true;

  const surfaceMaterials = new Map<TrackSurface, PBRMaterial>();
  (Object.keys(SURFACE_COLORS) as TrackSurface[]).forEach((surface) => surfaceMaterials.set(surface, material(scene, `surface-${surface}`, Color3.FromHexString(SURFACE_COLORS[surface]), .82)));
  const barrierBase = MeshBuilder.CreateBox("barrier-base", { width: 1.45, height: .62, depth: .32 }, scene);
  barrierBase.material = accentA;
  barrierBase.isVisible = false;
  const dashBase = MeshBuilder.CreateBox("dash-base", { width: .14, height: .035, depth: 1.7 }, scene);
  dashBase.material = paper;
  dashBase.isVisible = false;

  for (let index = 0; index < definition.racingSpline.length; index += 4) {
    const point = definition.racingSpline[index]!;
    const next = definition.racingSpline[(index + 1) % definition.racingSpline.length]!;
    const tangent = new Vector3(next.x - point.x, 0, next.z - point.z).normalize();
    const normal = new Vector3(-tangent.z, 0, tangent.x);
    const segment = stored.segments[index]!;
    for (const side of [-1, 1]) {
      const barrier = barrierBase.createInstance(`barrier-${index}-${side}`);
      barrier.position.set(point.x + normal.x * (segment.width / 2 + .36) * side, point.y + .31, point.z + normal.z * (segment.width / 2 + .36) * side);
      barrier.rotation.y = Math.atan2(tangent.x, tangent.z);
      barrier.rotation.z = segment.banking * side;
    }
    if (index % 8 === 0) {
      const dash = dashBase.createInstance(`dash-${index}`);
      dash.position.set(point.x, point.y + .11, point.z);
      dash.rotation.y = Math.atan2(tangent.x, tangent.z);
    }
    if (index % 20 === 0) {
      const zone = MeshBuilder.CreateBox(`surface-zone-${index}`, { width: segment.width - 1.25, height: .025, depth: 4 }, scene);
      zone.position.set(point.x, point.y + .085, point.z);
      zone.rotation.y = Math.atan2(tangent.x, tangent.z);
      zone.material = surfaceMaterials.get(segment.surface)!;
    }
  }

  createStartLine(scene, paper, dark, accentA, definition, stored.config.width);
  createLandmarks(scene, stored, accentA, accentB, dark);
  createVenue(scene, stored, accentA, accentB, paper, dark);

  const boostIndexes = [.12, .46, .81].map((value) => Math.floor(definition.racingSpline.length * value));
  const boostPads = boostIndexes.map((index, padIndex) => createTrackPad(scene, definition, index, `boost-${padIndex}`, accentB, dark, 3.6, 5.4));
  const jumpIndexes = [.235, .625].map((value) => Math.floor(definition.racingSpline.length * value));
  const jumpPads = jumpIndexes.map((index, padIndex) => createRamp(scene, definition, index, `jump-${padIndex}`, accentA, dark));
  const shortcutPads = stored.shortcuts.flatMap((shortcut, index) => createShortcut(scene, stored, shortcut.startProgress, shortcut.endProgress, shortcut.risk, index, accentA, dark));

  const itemIndexes = [.07, .18, .31, .42, .54, .66, .77, .89].map((value) => Math.floor(definition.racingSpline.length * value));
  const itemBoxes = itemIndexes.map((splineIndex, index) => {
    const point = definition.racingSpline[splineIndex]!;
    const next = definition.racingSpline[(splineIndex + 1) % definition.racingSpline.length]!;
    const tangent = new Vector3(next.x - point.x, 0, next.z - point.z).normalize();
    const normal = new Vector3(-tangent.z, 0, tangent.x);
    const lane = index % 2 ? -1.8 : 1.8;
    const node = new TransformNode(`item-box-${index}`, scene);
    node.position.set(point.x + normal.x * lane, point.y + 1.28, point.z + normal.z * lane);
    const frame = MeshBuilder.CreateBox(`item-cube-${index}`, { size: 1.18 }, scene);
    frame.parent = node;
    frame.rotation.set(.35, .45, .12);
    frame.material = index % 2 ? accentB : accentA;
    const core = MeshBuilder.CreateSphere(`item-core-${index}`, { diameter: .46, segments: 8 }, scene);
    core.parent = node;
    core.material = paper;
    return { node, position: node.position.clone(), cooldown: 0 };
  });

  const hazards = stored.segments.filter((segment) => segment.hazard !== "NONE").map((segment, index) => {
    const point = definition.racingSpline[segment.index]!;
    const node = new TransformNode(`hazard-${index}`, scene);
    node.position.set(point.x, point.y, point.z);
    const warning = MeshBuilder.CreateTorus(`hazard-warning-${index}`, { diameter: 5.4, thickness: .16, tessellation: 24 }, scene);
    warning.parent = node;
    warning.position.y = .14;
    warning.material = accentA;
    const obstacle = MeshBuilder.CreateBox(`hazard-body-${index}`, { width: 1.8, height: 1.8, depth: 1.8 }, scene);
    obstacle.parent = node;
    obstacle.position.y = 1.2;
    obstacle.material = dark;
    return { node, position: node.position.clone(), progress: segment.progress, kind: segment.hazard, phase: index * 1.17, cooldown: 0 };
  });

  return { definition, itemBoxes, boostPads, jumpPads, hazards, shortcutPads, width: stored.config.width, lengthMeters: stored.metrics.lengthMeters, stored };
}

function createTrackPad(scene: Scene, definition: TrackDefinition, index: number, name: string, glow: StandardMaterial, contrast: PBRMaterial, width: number, depth: number): Vector3 {
  const point = definition.racingSpline[index]!;
  const next = definition.racingSpline[(index + 1) % definition.racingSpline.length]!;
  const pad = MeshBuilder.CreateBox(name, { width, height: .08, depth }, scene);
  pad.position.set(point.x, point.y + .13, point.z);
  pad.rotation.y = Math.atan2(next.x - point.x, next.z - point.z);
  pad.material = glow;
  for (let arrow = -1; arrow <= 1; arrow += 1) {
    const strip = MeshBuilder.CreateBox(`${name}-strip-${arrow}`, { width: .28, height: .05, depth: depth * .64 }, scene);
    strip.parent = pad;
    strip.position.x = arrow * .7;
    strip.position.y = .07;
    strip.material = contrast;
  }
  return pad.position.clone();
}

function createRamp(scene: Scene, definition: TrackDefinition, index: number, name: string, glow: StandardMaterial, dark: PBRMaterial): Vector3 {
  const point = definition.racingSpline[index]!;
  const next = definition.racingSpline[(index + 1) % definition.racingSpline.length]!;
  const ramp = MeshBuilder.CreateBox(name, { width: 4.4, height: .34, depth: 5.8 }, scene);
  ramp.position.set(point.x, point.y + .22, point.z);
  ramp.rotation.y = Math.atan2(next.x - point.x, next.z - point.z);
  ramp.rotation.x = -.09;
  ramp.material = dark;
  const lip = MeshBuilder.CreateBox(`${name}-lip`, { width: 3.5, height: .08, depth: 1 }, scene);
  lip.parent = ramp;
  lip.position.set(0, .24, -1.8);
  lip.material = glow;
  return ramp.position.clone();
}

function createShortcut(scene: Scene, stored: StoredTrack, startProgress: number, endProgress: number, risk: "LOW" | "MEDIUM" | "HIGH", index: number, glow: StandardMaterial, dark: PBRMaterial): Vector3[] {
  const definition = stored.definition;
  const startIndex = Math.floor(startProgress * definition.racingSpline.length);
  const endIndex = Math.floor(endProgress * definition.racingSpline.length);
  const start = definition.racingSpline[startIndex]!;
  const end = definition.racingSpline[endIndex]!;
  const centers: Vector3[] = [];
  const steps = 12;
  for (let step = 0; step <= steps; step += 1) {
    const t = step / steps;
    const point = new Vector3(
      start.x + (end.x - start.x) * t,
      start.y + (end.y - start.y) * t + Math.sin(t * Math.PI) * (risk === "HIGH" ? 1.15 : .35),
      start.z + (end.z - start.z) * t,
    );
    centers.push(point);
    if (step === steps) continue;
    const nextT = (step + 1) / steps;
    const next = new Vector3(start.x + (end.x - start.x) * nextT, start.y + (end.y - start.y) * nextT, start.z + (end.z - start.z) * nextT);
    const length = Vector3.Distance(point, next) + .25;
    const slab = MeshBuilder.CreateBox(`shortcut-${index}-${step}`, { width: risk === "HIGH" ? 3.1 : 3.8, height: .1, depth: length }, scene);
    slab.position.copyFrom(point);
    slab.position.y += .08;
    slab.rotation.y = Math.atan2(next.x - point.x, next.z - point.z);
    slab.material = step % 3 === 0 ? glow : dark;
  }
  createTextSign(scene, `SHORTCUT ${index + 1} / ${risk}`, centers[1]!.add(new Vector3(0, 2.4, 0)), Math.atan2(end.x - start.x, end.z - start.z) + Math.PI, 5.8, 1, "#b9ff45", "#0b0b0f");
  return centers;
}

function createStartLine(scene: Scene, paper: PBRMaterial, dark: PBRMaterial, accent: StandardMaterial, definition: TrackDefinition, width: number): void {
  const point = definition.racingSpline[0]!;
  const next = definition.racingSpline[1]!;
  const yaw = Math.atan2(next.x - point.x, next.z - point.z);
  const normal = new Vector3(Math.cos(yaw), 0, -Math.sin(yaw));
  for (let index = 0; index < 12; index += 1) {
    const stripe = MeshBuilder.CreateBox(`start-${index}`, { width: width / 12, height: .06, depth: 1.1 }, scene);
    const across = -width / 2 + (index + .5) * width / 12;
    stripe.position.set(point.x + normal.x * across, point.y + .12, point.z + normal.z * across);
    stripe.rotation.y = yaw;
    stripe.material = index % 2 ? dark : paper;
  }
  [-1, 1].forEach((side) => {
    const pillar = MeshBuilder.CreateBox(`start-pillar-${side}`, { width: .55, height: 6.8, depth: .55 }, scene);
    pillar.position.set(point.x + normal.x * (width / 2 + .65) * side, point.y + 3.35, point.z + normal.z * (width / 2 + .65) * side);
    pillar.material = dark;
  });
  const top = MeshBuilder.CreateBox("start-top", { width: width + 1.8, height: 1, depth: .65 }, scene);
  top.position.set(point.x, point.y + 6.45, point.z);
  top.rotation.y = yaw;
  top.material = accent;
  createTextSign(scene, "PRINT RUSH V4", new Vector3(point.x - Math.sin(yaw) * .36, point.y + 6.45, point.z - Math.cos(yaw) * .36), yaw + Math.PI, 7.6, 1.25, "#f7f2e8", "transparent");
}

function createLandmarks(scene: Scene, stored: StoredTrack, accentA: StandardMaterial, accentB: StandardMaterial, dark: PBRMaterial): void {
  stored.landmarks.forEach((landmark, index) => {
    const splineIndex = Math.floor(landmark.progress * stored.definition.racingSpline.length);
    const point = stored.definition.racingSpline[splineIndex]!;
    const next = stored.definition.racingSpline[(splineIndex + 1) % stored.definition.racingSpline.length]!;
    const tangent = new Vector3(next.x - point.x, 0, next.z - point.z).normalize();
    const normal = new Vector3(-tangent.z, 0, tangent.x);
    const width = stored.segments[splineIndex]!.width;
    const position = new Vector3(point.x + normal.x * (width / 2 + 4.6) * landmark.side, point.y + 3.4, point.z + normal.z * (width / 2 + 4.6) * landmark.side);
    const tower = MeshBuilder.CreateBox(`landmark-tower-${index}`, { width: 2.2 + index % 2, height: 6 + index, depth: 2.2 }, scene);
    tower.position.copyFrom(position);
    tower.position.y = point.y + tower.scaling.y + (3 + index * .5);
    tower.material = index % 2 ? accentB : accentA;
    const signPosition = position.add(new Vector3(0, 3.1 + index * .25, 0));
    createTextSign(scene, `${index + 1} / ${landmark.label}`, signPosition, Math.atan2(tangent.x, tangent.z) + (landmark.side > 0 ? Math.PI : 0), 8, 1.6, landmark.color, "#0b0b0f");
    const beacon = MeshBuilder.CreateCylinder(`landmark-beacon-${index}`, { height: 7, diameterTop: .08, diameterBottom: .5, tessellation: 12 }, scene);
    beacon.position.copyFrom(position.add(new Vector3(0, 5.4 + index * .45, 0)));
    beacon.material = dark;
  });
}

function createVenue(scene: Scene, stored: StoredTrack, accentA: StandardMaterial, accentB: StandardMaterial, paper: PBRMaterial, dark: PBRMaterial): void {
  const count = window.innerWidth < 800 ? 24 : 42;
  for (let index = 0; index < count; index += 1) {
    const angle = index / count * Math.PI * 2;
    const radiusX = stored.config.radiusX + 14 + (index % 3) * 3;
    const radiusZ = stored.config.radiusZ + 14 + (index % 4) * 2;
    const height = 2.4 + (index % 5) * 1.25;
    const prop = MeshBuilder.CreateBox(`venue-prop-${index}`, { width: 2 + index % 3, height, depth: 2.1 + index % 2 }, scene);
    prop.position.set(Math.cos(angle) * radiusX, height / 2 - .9, Math.sin(angle) * radiusZ);
    prop.rotation.y = -angle + (index % 2 ? .15 : -.12);
    prop.material = index % 7 === 0 ? accentA : index % 5 === 0 ? accentB : index % 3 === 0 ? paper : dark;
  }
  const center = MeshBuilder.CreateCylinder("venue-center", { height: 3.2, diameter: 13, tessellation: 24 }, scene);
  center.position.y = .5;
  center.material = dark;
  const crown = MeshBuilder.CreateTorus("venue-crown", { diameter: 10.5, thickness: .32, tessellation: 32 }, scene);
  crown.position.y = 2.25;
  crown.material = accentA;
  createTextSign(scene, stored.config.theme.replace("_", " "), new Vector3(0, 4.1, 0), Math.PI, 10, 2, "#f7f2e8", "#0b0b0f");
}

function createTextSign(scene: Scene, text: string, position: Vector3, yaw: number, width: number, height: number, color: string, background: string): void {
  const texture = new DynamicTexture(`sign-texture-${text}`, { width: 1024, height: 256 }, scene, true);
  texture.hasAlpha = background === "transparent";
  texture.drawText(text, null, 168, "800 72px Arial", color, background, true, true);
  const signMaterial = new StandardMaterial(`sign-material-${text}`, scene);
  signMaterial.diffuseTexture = texture;
  signMaterial.emissiveTexture = texture;
  signMaterial.opacityTexture = background === "transparent" ? texture : null;
  signMaterial.disableLighting = true;
  const sign = MeshBuilder.CreatePlane(`sign-${text}`, { width, height }, scene);
  sign.position.copyFrom(position);
  sign.rotation.y = yaw;
  sign.material = signMaterial;
}

function material(scene: Scene, name: string, color: Color3, roughness: number): PBRMaterial {
  const result = new PBRMaterial(name, scene);
  result.albedoColor = color;
  result.roughness = roughness;
  result.metallic = .04;
  return result;
}
