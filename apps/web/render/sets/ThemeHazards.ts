import { Mesh, TransformNode, Vector2, Vector3 } from "@babylonjs/core";
import { TerrainConfig } from "@print-rush/game-core";
import { beveledBox, ellipsoid, mergeParts, revolve, tube } from "../Geometry";
import type { Dressing, DressingContext } from "./types";

type AuthoredTheme = "FLAGSHIP" | "WAREHOUSE" | "OFFICE" | "MANGA";

export type ThemeHazardResources = {
  meshes: Mesh[];
  nodes: TransformNode[];
};

/**
 * Circuit-specific hazards whose pose is driven by the exact phase used by collision detection.
 * A generic bobbing crate communicated neither the place nor the moment of danger; these silhouettes
 * can be read at speed and their active pose agrees with `GameRuntime`'s `wave > 0.6` rule.
 */
export function createThemeHazardBuilder(
  context: DressingContext,
  theme: AuthoredTheme,
  resources: ThemeHazardResources,
): NonNullable<Dressing["buildHazard"]> {
  return (kind, holder, placement, lane) => {
    const phase = placement.node.progress * 11;
    if (kind === "CROWD_GATE") {
      buildCrowdGate(context, resources, holder, phase, theme === "MANGA" ? "#cf57ff" : "#ff3da6");
      return true;
    }
    if (kind === "FALLING_BOXES") {
      buildFallingBoxes(context, resources, holder, phase, placement.node.width, lane);
      return true;
    }
    if (kind === "FORKLIFT" && theme === "WAREHOUSE") {
      buildForklift(context, resources, holder, phase);
      return true;
    }
    if (kind === "OFFICE_CHAIRS" && theme === "OFFICE") {
      buildChairSweep(context, resources, holder, phase);
      return true;
    }
    if (kind === "PRINTER" && theme === "OFFICE") {
      buildPrinter(context, resources, holder, phase);
      return true;
    }
    return false;
  };
}

function buildCrowdGate(
  context: DressingContext,
  resources: ThemeHazardResources,
  holder: TransformNode,
  phase: number,
  accent: string,
): void {
  const { scene, materials } = context;
  const frame = materials.get({ materialClass: "PAINTED_METAL", color: "#30333b", tile: 0.8 });
  const stripe = materials.get({ materialClass: "PAINTED_METAL", color: accent, texture: "mat_safety_yellow", tile: 0.7 });
  const hinges: TransformNode[] = [];

  for (const side of [-1, 1] as const) {
    const post = beveledBox(scene, `crowd-gate-post-${side}-${phase}`, {
      width: 0.52,
      height: 3.5,
      depth: 0.68,
      bevel: 0.12,
    });
    post.parent = holder;
    post.position.set(side * 3.7, 1.75, 0);
    post.material = frame;
    resources.meshes.push(post);

    const hinge = new TransformNode(`crowd-gate-hinge-${side}-${phase}`, scene);
    hinge.parent = holder;
    hinge.position.set(side * 3.45, 2.5, 0);
    resources.nodes.push(hinge);
    hinges.push(hinge);

    const arm = beveledBox(scene, `crowd-gate-arm-${side}-${phase}`, {
      width: 3.35,
      height: 0.42,
      depth: 0.48,
      bevel: 0.12,
    });
    arm.parent = hinge;
    arm.position.x = -side * 1.68;
    arm.material = stripe;
    resources.meshes.push(arm);

    const lamp = ellipsoid(scene, `crowd-gate-lamp-${side}-${phase}`, { x: 0.24, y: 0.18, z: 0.24 }, 8, 5);
    lamp.parent = holder;
    lamp.position.set(side * 3.7, 3.72, 0);
    lamp.material = materials.get({ materialClass: "NEON", color: "#ff3b2f", emissive: 1 });
    resources.meshes.push(lamp);
  }

  context.animators.push((_dt, _nowMs, elapsedMs) => {
    const wave = Math.sin(elapsedMs * 0.0017 + phase);
    const down = smoothStep(0.25, 0.68, wave);
    hinges[0]!.rotation.z = -(1 - down) * 1.08;
    hinges[1]!.rotation.z = (1 - down) * 1.08;
  });
}

function buildFallingBoxes(
  context: DressingContext,
  resources: ThemeHazardResources,
  holder: TransformNode,
  phase: number,
  roadWidth: number,
  lane: number,
): void {
  const { scene, materials } = context;
  const span = roadWidth + TerrainConfig.vergeMetres * 2 + 2.4;
  const steel = materials.get({ materialClass: "PAINTED_METAL", color: "#45515c", tile: 1.1 });
  const frameParts: Mesh[] = [];
  for (const side of [-1, 1] as const) {
    const post = beveledBox(scene, `box-drop-post-${side}-${phase}`, { width: 0.55, height: 7.8, depth: 0.65, bevel: 0.08 });
    post.position.set(side * span * 0.5 - lane, 3.9, 0);
    post.material = steel;
    frameParts.push(post);
  }
  const beam = beveledBox(scene, `box-drop-beam-${phase}`, { width: span, height: 0.7, depth: 0.85, bevel: 0.12 });
  beam.position.set(-lane, 7.45, 0);
  beam.material = steel;
  frameParts.push(beam);
  const frame = mergeParts(`box-drop-frame-${phase}`, frameParts, true);
  frame.parent = holder;
  resources.meshes.push(frame);

  const crateGroup = new TransformNode(`box-drop-load-${phase}`, scene);
  crateGroup.parent = holder;
  resources.nodes.push(crateGroup);
  const crates: Mesh[] = [];
  const positions = [
    [-1.05, 0.7, 0.15, -0.08],
    [0.9, 0.62, -0.2, 0.12],
    [0, 1.85, 0.12, 0.04],
  ] as const;
  for (let index = 0; index < positions.length; index += 1) {
    const [x, y, z, rotation] = positions[index]!;
    const crate = beveledBox(scene, `box-drop-crate-${phase}-${index}`, {
      width: index === 2 ? 2.4 : 2.1,
      height: 1.55,
      depth: 1.8,
      bevel: 0.1,
    });
    crate.position.set(x, y, z);
    crate.rotation.y = rotation;
    crate.material = materials.get({ materialClass: "CARDBOARD", color: index === 1 ? "#a87648" : "#bd8b58", tile: 0.9 });
    crates.push(crate);
  }
  const load = mergeParts(`box-drop-crates-${phase}`, crates, true);
  load.parent = crateGroup;
  resources.meshes.push(load);
  context.addShadowCaster(load);

  const ring = warningRing(context, `box-drop-ring-${phase}`, "#ffc02e", 2.5);
  ring.parent = holder;
  resources.meshes.push(ring);
  context.animators.push((_dt, _nowMs, elapsedMs) => {
    const wave = Math.sin(elapsedMs * 0.0017 + phase);
    const down = smoothStep(0.28, 0.68, wave);
    crateGroup.position.y = 6.15 - down * down * 5.25;
    crateGroup.rotation.y = Math.sin(elapsedMs * 0.004 + phase) * 0.04;
  });
}

function buildForklift(
  context: DressingContext,
  resources: ThemeHazardResources,
  holder: TransformNode,
  phase: number,
): void {
  const { scene, materials } = context;
  const vehicle = new TransformNode(`forklift-${phase}`, scene);
  vehicle.parent = holder;
  resources.nodes.push(vehicle);
  const parts: Mesh[] = [];
  const body = beveledBox(scene, `forklift-body-${phase}`, { width: 3.2, height: 2.2, depth: 3.7, bevel: 0.35 });
  body.position.y = 1.35;
  body.material = materials.get({ materialClass: "PAINTED_METAL", color: "#ffc02e", tile: 0.9 });
  parts.push(body);
  const seat = beveledBox(scene, `forklift-seat-${phase}`, { width: 1.5, height: 1.45, depth: 1.2, bevel: 0.24 });
  seat.position.set(0, 2.65, -0.7);
  seat.material = materials.get({ materialClass: "RUBBER", color: "#20252b" });
  parts.push(seat);
  for (const side of [-1, 1] as const) {
    const mast = tube(scene, `forklift-mast-${phase}-${side}`, [new Vector3(side * 1.2, 0.4, 1.2), new Vector3(side * 1.2, 5.4, 1.2)], 0.14, 8);
    mast.material = materials.get({ materialClass: "RAW_METAL", color: "#65717b" });
    parts.push(mast);
    const fork = beveledBox(scene, `forklift-fork-${phase}-${side}`, { width: 0.24, height: 0.22, depth: 4.2, bevel: 0.05 });
    fork.position.set(side * 0.82, 0.45, 2.5);
    fork.material = materials.get({ materialClass: "RAW_METAL", color: "#69737c" });
    parts.push(fork);
  }
  const mesh = mergeParts(`forklift-mesh-${phase}`, parts, true);
  mesh.parent = vehicle;
  resources.meshes.push(mesh);
  context.addShadowCaster(mesh);

  const ring = warningRing(context, `forklift-ring-${phase}`, "#ffc02e", 2.8);
  ring.parent = holder;
  resources.meshes.push(ring);
  context.animators.push((_dt, _nowMs, elapsedMs) => {
    const wave = Math.sin(elapsedMs * 0.0017 + phase);
    vehicle.position.x = (wave - 0.8) * 8;
    vehicle.rotation.y = Math.PI * 0.5 + Math.sin(elapsedMs * 0.0017 + phase) * 0.04;
  });
}

function buildChairSweep(
  context: DressingContext,
  resources: ThemeHazardResources,
  holder: TransformNode,
  phase: number,
): void {
  const { scene, materials } = context;
  const cluster = new TransformNode(`chair-sweep-${phase}`, scene);
  cluster.parent = holder;
  resources.nodes.push(cluster);
  const parts: Mesh[] = [];
  for (let index = 0; index < 3; index += 1) {
    const z = (index - 1) * 2;
    const seat = beveledBox(scene, `chair-seat-${phase}-${index}`, { width: 1.7, height: 0.38, depth: 1.7, bevel: 0.24 });
    seat.position.set((index - 1) * 0.55, 1.55, z);
    seat.rotation.y = index * 0.3;
    seat.material = materials.get({ materialClass: "FABRIC", color: index === 1 ? "#ff8f4c" : "#475767", tile: 0.55 });
    parts.push(seat);
    const back = beveledBox(scene, `chair-back-${phase}-${index}`, { width: 1.7, height: 1.85, depth: 0.34, bevel: 0.25 });
    back.position.set((index - 1) * 0.55, 2.55, z - 0.68);
    back.rotation.x = -0.1;
    back.material = seat.material;
    parts.push(back);
    const stem = tube(scene, `chair-stem-${phase}-${index}`, [new Vector3((index - 1) * 0.55, 0.3, z), new Vector3((index - 1) * 0.55, 1.45, z)], 0.12, 7);
    stem.material = materials.get({ materialClass: "RAW_METAL", color: "#8b949d" });
    parts.push(stem);
    for (let leg = 0; leg < 5; leg += 1) {
      const angle = leg / 5 * Math.PI * 2;
      const x = (index - 1) * 0.55;
      const foot = tube(scene, `chair-foot-${phase}-${index}-${leg}`, [
        new Vector3(x, 0.32, z),
        new Vector3(x + Math.sin(angle) * 0.82, 0.18, z + Math.cos(angle) * 0.82),
      ], 0.07, 6);
      foot.material = stem.material;
      parts.push(foot);
    }
  }
  const chairs = mergeParts(`chair-sweep-mesh-${phase}`, parts, true);
  chairs.parent = cluster;
  resources.meshes.push(chairs);
  context.addShadowCaster(chairs);
  const ring = warningRing(context, `chair-sweep-ring-${phase}`, "#ff8f4c", 2.8);
  ring.parent = holder;
  resources.meshes.push(ring);
  context.animators.push((dt, _nowMs, elapsedMs) => {
    const wave = Math.sin(elapsedMs * 0.0017 + phase);
    cluster.position.x = (wave - 0.8) * 8;
    cluster.rotation.y += dt * 2.2;
  });
}

function buildPrinter(
  context: DressingContext,
  resources: ThemeHazardResources,
  holder: TransformNode,
  phase: number,
): void {
  const { scene, materials } = context;
  const body = beveledBox(scene, `printer-body-${phase}`, { width: 7.2, height: 3.3, depth: 4.8, bevel: 0.65 });
  body.parent = holder;
  body.position.y = 4.45;
  body.material = materials.get({ materialClass: "PLASTIC", color: "#e8e4dc", tile: 1.2 });
  resources.meshes.push(body);
  context.addShadowCaster(body);
  const slot = beveledBox(scene, `printer-slot-${phase}`, { width: 4.7, height: 0.55, depth: 0.35, bevel: 0.12 });
  slot.parent = holder;
  slot.position.set(0, 4.4, 2.42);
  slot.material = materials.get({ materialClass: "RUBBER", color: "#26313b" });
  resources.meshes.push(slot);

  const paper = new TransformNode(`printer-paper-carriage-${phase}`, scene);
  paper.parent = holder;
  paper.position.set(0, 4.05, 2.7);
  resources.nodes.push(paper);
  for (let sheet = 0; sheet < 4; sheet += 1) {
    const page = beveledBox(scene, `printer-page-${phase}-${sheet}`, { width: 4.1, height: 0.06, depth: 2.4, bevel: 0.04 });
    page.parent = paper;
    page.position.set(0, -sheet * 0.07, sheet * 0.11);
    page.rotation.x = 0.42;
    page.material = materials.get({ materialClass: "PAPER", color: sheet === 0 ? "#fff9ee" : "#e9edf1", tile: 0.5 });
    resources.meshes.push(page);
  }
  const ring = warningRing(context, `printer-ring-${phase}`, "#ff8f4c", 2.6);
  ring.parent = holder;
  resources.meshes.push(ring);
  context.animators.push((_dt, _nowMs, elapsedMs) => {
    const wave = Math.sin(elapsedMs * 0.0017 + phase);
    const down = smoothStep(0.25, 0.68, wave);
    paper.position.y = 4.05 - down * 3.15;
    paper.rotation.x = Math.sin(elapsedMs * 0.006) * 0.08;
  });
}

function warningRing(context: DressingContext, name: string, color: string, radius: number): Mesh {
  const ring = revolve(
    context.scene,
    name,
    [
      new Vector2(radius - 0.48, 0.02),
      new Vector2(radius, 0.02),
      new Vector2(radius, 0.06),
      new Vector2(radius - 0.48, 0.06),
    ],
    24,
    { capStart: false, capEnd: false },
  );
  ring.material = context.materials.get({ materialClass: "NEON", color, emissive: 0.8 });
  return ring;
}

function smoothStep(from: number, to: number, value: number): number {
  const t = Math.max(0, Math.min(1, (value - from) / (to - from)));
  return t * t * (3 - 2 * t);
}
