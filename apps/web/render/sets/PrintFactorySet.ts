import {
  Color3,
  Color4,
  DynamicTexture,
  Mesh,
  ParticleSystem,
  PBRMaterial,
  PointLight,
  TransformNode,
  Vector2,
  Vector3,
  VertexData,
  type InstancedMesh,
  type Scene,
} from "@babylonjs/core";
import type { TrackNode } from "@print-rush/game-core";
import { TerrainConfig } from "@print-rush/game-core";
import { beveledBox, ellipsoid, lofted, mergeParts, revolve, tube } from "../Geometry";
import { curvatureAt, frameAt } from "../RoadMesh";
import { createBoard, SignPainter } from "../Signage";
import { createSoftSprite } from "../VFXSystem";
import type { Dressing, DressingContext } from "./types";

/**
 * INK & PRINT FACTORY — THE GOLDEN SET.
 *
 * The brief names this circuit the standard the other four are measured against, and it names the
 * hero moment: the player enters a great hall, ahead of them an enormous screen-printing carousel is
 * turning, its arms cross over the road, the floor is pooled with cyan, magenta and yellow, shirts
 * are heaped at the sides, the dryer glows at the back, and the air has steam and dust in it.
 *
 * Everything here is built to that moment and to the process around it. The lap is the process:
 *
 *   DISEÑO       a giant design desk, a light table, a swatch board — the artwork
 *   PANTALLAS    screen racks, the exposure unit, the washout booth — the stencil
 *   TINTA        the carousel, the ink vats, the overhead ink lines, the puddles — the print
 *   SECADO       the dryer tunnel the road runs through, its fans and its conveyor — the cure
 *   CONTROL      inspection tables, folded stacks, cartons — the finished shirt
 *
 * Sector by sector the set answers "what normally happens here", which is what makes a prop belong
 * rather than decorate. Scale is deliberately exaggerated: a marker pen is seven metres long because
 * the kart has to look small in a place built for people.
 */

const INKS = ["#65d8ff", "#ff3da6", "#ffd43b", "#12101a"] as const;
const INK_TEXTURES = ["mat_ink_cyan", "mat_ink_magenta", "mat_ink_yellow", "mat_ink_violet"] as const;

/** The process colour and its baked wet-ink texture for a station index. */
function inkOf(index: number): { color: string; texture: string } {
  const slot = ((index % INKS.length) + INKS.length) % INKS.length;
  return { color: INKS[slot] as string, texture: INK_TEXTURES[slot] as string };
}
const SHIRT_COLOURS = ["#f7f2e8", "#65d8ff", "#ff3da6", "#ffd43b", "#8f5cff", "#b9ff45", "#2c3e70", "#12101a"];

function canDraw(): boolean {
  return typeof document !== "undefined" || typeof OffscreenCanvas !== "undefined";
}

/** Nodes of one sector, as indices. */
function sectorNodes(nodes: readonly TrackNode[], sector: number): number[] {
  const indices: number[] = [];
  for (let index = 0; index < nodes.length; index += 1) if (nodes[index]!.sector === sector) indices.push(index);
  return indices;
}

/**
 * The centre of the sector's main arc: the point the carousel stands on.
 *
 * Every node on a curve has a centre of curvature at `node + normal * radius`; over a sustained arc
 * those centres cluster. The mean of the cluster is the circle's centre, and its distance to the
 * road is the radius the carousel's arms have to reach.
 */
function arcCentre(nodes: readonly TrackNode[], indices: readonly number[]): { x: number; y: number; z: number; radius: number; clearance: number } | null {
  /**
   * Only the sector's longest sustained arc. The ink sector is a spiral round the press followed by a
   * chicane through the vats, and the chicane's own centres of curvature lie on the far side of the
   * road; averaging them in pulled the pivot to within a few metres of the racing line, and the drum
   * stood on the kerb. The longest run of one-signed curvature is the spiral, and only the spiral.
   */
  let bestStart = 0;
  let bestLength = 0;
  let runStart = 0;
  let runSign = 0;
  for (let position = 0; position <= indices.length; position += 1) {
    const curvature = position < indices.length ? curvatureAt(nodes, indices[position]!) : 0;
    const sign = Math.abs(curvature) >= 0.03 ? Math.sign(curvature) : 0;
    if (sign !== 0 && sign === runSign) continue;
    if (runSign !== 0 && position - runStart > bestLength) {
      bestLength = position - runStart;
      bestStart = runStart;
    }
    runStart = position;
    runSign = sign;
  }
  if (bestLength < 8) return null;

  let sx = 0;
  let sz = 0;
  let sy = 0;
  let count = 0;
  for (let position = bestStart; position < bestStart + bestLength; position += 1) {
    const index = indices[position]!;
    const curvature = curvatureAt(nodes, index);
    const radius = 2.5 / Math.abs(curvature);
    if (radius > 120) continue;
    const frame = frameAt(nodes, index);
    // Positive curvature turns left, so the centre is on the left (the normal's side).
    const side = curvature > 0 ? 1 : -1;
    const node = nodes[index]!;
    sx += node.x + frame.nx * radius * side;
    sz += node.z + frame.nz * radius * side;
    sy += node.y;
    count += 1;
  }
  if (count < 6) return null;
  const x = sx / count;
  const z = sz / count;
  // The arc's own radius, from the run; and the clearance to the nearest road edge in the whole
  // sector, which is smaller when another leg passes through the loop — here the shortcut does.
  let radius = 0;
  for (let position = bestStart; position < bestStart + bestLength; position += 1) {
    const node = nodes[indices[position]!]!;
    radius += Math.hypot(node.x - x, node.z - z);
  }
  radius /= bestLength;
  let clearance = Infinity;
  for (const index of indices) clearance = Math.min(clearance, Math.hypot(nodes[index]!.x - x, nodes[index]!.z - z) - nodes[index]!.width * 0.5);
  return { x, y: sy / count, z, radius, clearance };
}

type SetState = {
  meshes: Mesh[];
  nodes: TransformNode[];
  particles: ParticleSystem[];
  lights: PointLight[];
  painter: SignPainter;
  sprite: ReturnType<typeof createSoftSprite> | null;
};

/** A lofted, folded shirt: the object this whole factory makes. Built once, instanced everywhere. */
function foldedShirtSource(context: DressingContext, name: string): Mesh {
  const { scene, materials } = context;
  const shirt = lofted(
    scene,
    name,
    [
      { z: -0.62, halfWidth: 0.44, halfHeight: 0.07, y: 0.07, radius: 0.06 },
      { z: -0.2, halfWidth: 0.5, halfHeight: 0.09, y: 0.09, radius: 0.08 },
      { z: 0.3, halfWidth: 0.48, halfHeight: 0.085, y: 0.085, radius: 0.08 },
      { z: 0.62, halfWidth: 0.4, halfHeight: 0.06, y: 0.06, radius: 0.05 },
    ],
    { cornerSegments: 3 },
  );
  shirt.material = materials.get({ materialClass: "FABRIC", color: "#ffffff", texture: "mat_fabric_white", tile: 0.35 });
  shirt.isVisible = false;
  shirt.isPickable = false;
  shirt.registerInstancedBuffer("color", 4);
  return shirt;
}

/**
 * A flat, irregular disc lying in the XZ plane: the shape of something spilled. One centre vertex
 * and a rim whose radius wanders with a couple of harmonics, so no two puddle sources are the same
 * outline and none is a circle. A hair above the floor, normals up, single-sided.
 */
function splatDisc(scene: Scene, name: string, segments: number, seed: number): Mesh {
  const positions: number[] = [0, 0.012, 0];
  const uvs: number[] = [0.5, 0.5];
  const indices: number[] = [];
  for (let step = 0; step < segments; step += 1) {
    const angle = (step / segments) * Math.PI * 2;
    const radius = 1 + Math.sin(angle * 3 + seed) * 0.18 + Math.sin(angle * 5 + seed * 1.7) * 0.11 + Math.sin(angle * 2 + seed * 0.4) * 0.14 + Math.sin(angle * 9 + seed * 2.3) * 0.05;
    positions.push(Math.cos(angle) * radius, 0.012, Math.sin(angle) * radius);
    uvs.push(0.5 + Math.cos(angle) * radius * 0.5, 0.5 + Math.sin(angle) * radius * 0.5);
  }
  for (let step = 0; step < segments; step += 1) {
    const a = 1 + step;
    const b = 1 + ((step + 1) % segments);
    indices.push(0, b, a);
  }
  const mesh = new Mesh(name, scene);
  const data = new VertexData();
  data.positions = positions;
  data.indices = indices;
  data.uvs = uvs;
  const normals: number[] = [];
  VertexData.ComputeNormals(positions, indices, normals);
  data.normals = normals;
  data.applyToMesh(mesh);
  return mesh;
}

function tint(instance: InstancedMesh, hex: string, shade = 1): void {
  const colour = Color3.FromHexString(hex);
  instance.instancedBuffers.color = new Color4(colour.r * shade, colour.g * shade, colour.b * shade, 1);
}

/** A soft particle system with sensible defaults; the caller sets what differs. */
function particles(context: DressingContext, state: SetState, name: string, capacity: number, emitter: Vector3): ParticleSystem | null {
  if (context.quality === "LOW" || !state.sprite) return null;
  const system = new ParticleSystem(name, capacity, context.scene);
  system.particleTexture = state.sprite;
  system.emitter = emitter;
  system.updateSpeed = 0.016;
  state.particles.push(system);
  return system;
}

// ---------------------------------------------------------------------------------- DISEÑO

function buildDesignStudio(context: DressingContext, state: SetState, landmarks: Dressing["landmarks"]): void {
  const { scene, materials, detailed } = context;
  const range = context.sectorRange(1);
  const span = range.to - range.from;
  const side = 1;
  const lateral = (progress: number, extra: number): number => {
    const node = context.at(progress).node;
    return side * (node.width * 0.5 + TerrainConfig.vergeMetres + extra);
  };

  // The desk: a slab on four legs, its top seven metres up, beside the opening straight.
  const deskAt = range.from + span * 0.42;
  const deskPos = context.beside(deskAt, lateral(deskAt, 14));
  const desk = new TransformNode("hero-design-desk", scene);
  desk.position.copyFrom(deskPos);
  desk.rotation.y = context.at(deskAt).frame.heading;
  state.nodes.push(desk);
  const parts: Mesh[] = [];
  const top = beveledBox(scene, "desk-top", { width: 26, height: 1.1, depth: 12, bevel: 0.18, cornerRadius: 0.4, uScale: 8, vScale: 2 });
  top.position.y = 6.4;
  top.material = materials.get({ materialClass: "WOOD", color: "#c9a074", tile: 2.5 });
  parts.push(top);
  for (const dx of [-11, 11]) {
    for (const dz of [-4.6, 4.6]) {
      const leg = beveledBox(scene, `desk-leg-${dx}-${dz}`, { width: 1.3, height: 5.9, depth: 1.3, bevel: 0.08 });
      leg.position.set(dx, 2.95, dz);
      leg.material = materials.get({ materialClass: "PAINTED_METAL", color: "#3a3f49", texture: "mat_paintedmetal_press", tile: 2 });
      parts.push(leg);
    }
  }
  // A drawer unit under one end, so the legs are not the only thing beneath the slab.
  const drawers = beveledBox(scene, "desk-drawers", { width: 7, height: 5.4, depth: 9, bevel: 0.12 });
  drawers.position.set(8.5, 2.7, 0);
  drawers.material = materials.get({ materialClass: "PAINTED_METAL", color: "#4b5162", tile: 2 });
  parts.push(drawers);
  for (let drawer = 0; drawer < 3; drawer += 1) {
    const handle = tube(scene, `desk-handle-${drawer}`, [new Vector3(7, 1.2 + drawer * 1.6, 4.55), new Vector3(10, 1.2 + drawer * 1.6, 4.55)], 0.12, 6);
    handle.material = materials.get({ materialClass: "RAW_METAL", color: "#b6bcc4" });
    parts.push(handle);
  }
  const deskMesh = mergeParts("hero-design-desk-mesh", parts, true);
  deskMesh.parent = desk;
  deskMesh.receiveShadows = true;
  state.meshes.push(deskMesh);
  context.addShadowCaster(deskMesh);

  // On the desk: a monitor showing the artwork, a marker, a mug, paper.
  const monitorParts: Mesh[] = [];
  const bezel = beveledBox(scene, "desk-monitor-bezel", { width: 11, height: 6.6, depth: 0.6, bevel: 0.12 });
  bezel.position.set(-3, 10.6, -3.4);
  bezel.material = materials.get({ materialClass: "PLASTIC", color: "#1c1b24" });
  monitorParts.push(bezel);
  const neck = beveledBox(scene, "desk-monitor-neck", { width: 1.4, height: 1.2, depth: 0.8, bevel: 0.08 });
  neck.position.set(-3, 7.55, -3.6);
  neck.material = materials.get({ materialClass: "PLASTIC", color: "#1c1b24" });
  monitorParts.push(neck);
  const foot = beveledBox(scene, "desk-monitor-foot", { width: 4.2, height: 0.3, depth: 2.4, bevel: 0.08 });
  foot.position.set(-3, 7.1, -3.4);
  foot.material = materials.get({ materialClass: "PLASTIC", color: "#1c1b24" });
  monitorParts.push(foot);
  const monitorMesh = mergeParts("desk-monitor", monitorParts, true);
  monitorMesh.parent = desk;
  state.meshes.push(monitorMesh);

  const panel = beveledBox(scene, "desk-monitor-panel", { width: 10.3, height: 5.9, depth: 0.1, bevel: 0.03 });
  panel.position.set(-3, 10.6, -3.05);
  panel.parent = desk;
  panel.material = artworkScreen(context, state, "desk-artwork");
  state.meshes.push(panel);

  const marker = revolve(
    scene,
    "desk-marker",
    [new Vector2(0.001, 0), new Vector2(0.28, 0.02), new Vector2(0.55, 0.9), new Vector2(0.55, 6.4), new Vector2(0.5, 6.5), new Vector2(0.5, 7.2), new Vector2(0.001, 7.25)],
    detailed ? 18 : 10,
  );
  marker.rotation.z = Math.PI / 2;
  marker.rotation.y = 0.35;
  marker.position.set(4.5, 7.5, 3.6);
  marker.parent = desk;
  marker.material = materials.get({ materialClass: "PLASTIC", color: "#ff3da6" });
  state.meshes.push(marker);

  const mug = revolve(
    scene,
    "desk-mug",
    [new Vector2(0.001, 0), new Vector2(1, 0.05), new Vector2(1.1, 2.4), new Vector2(1.15, 2.5), new Vector2(1, 2.5), new Vector2(0.9, 0.25), new Vector2(0.001, 0.22)],
    detailed ? 20 : 12,
  );
  mug.position.set(8, 6.95, -2.5);
  mug.parent = desk;
  mug.material = materials.get({ materialClass: "PLASTIC", color: "#f7f2e8" });
  state.meshes.push(mug);
  const handle = tube(scene, "desk-mug-handle", [new Vector3(9, 8.9, -2.5), new Vector3(9.9, 8.7, -2.5), new Vector3(9.9, 7.7, -2.5), new Vector3(9, 7.5, -2.5)], 0.14, 8);
  handle.parent = desk;
  handle.material = materials.get({ materialClass: "PLASTIC", color: "#f7f2e8" });
  state.meshes.push(handle);

  const paper = beveledBox(scene, "desk-paper", { width: 4.2, height: 0.5, depth: 5.8, bevel: 0.03 });
  paper.position.set(-9.5, 7.2, 3);
  paper.rotation.y = -0.2;
  paper.parent = desk;
  paper.material = materials.get({ materialClass: "PAPER", color: "#f7f2e8", texture: "mat_paper_default", tile: 1 });
  state.meshes.push(paper);
  landmarks.push({ label: "MESA DE DISEÑO", position: deskPos.clone(), progress: deskAt });

  // The light table: a glowing slab at ground level on the other side, close to the barrier.
  const tableAt = range.from + span * 0.7;
  const tablePos = context.beside(tableAt, -lateral(tableAt, 4));
  const table = new TransformNode("hero-light-table", scene);
  table.position.copyFrom(tablePos);
  table.rotation.y = context.at(tableAt).frame.heading;
  state.nodes.push(table);
  const tableBody = beveledBox(scene, "light-table-body", { width: 12, height: 3.2, depth: 6, bevel: 0.14 });
  tableBody.position.y = 1.6;
  tableBody.parent = table;
  tableBody.material = materials.get({ materialClass: "PAINTED_METAL", color: "#4b5162", texture: "mat_paintedmetal_press", tile: 2 });
  state.meshes.push(tableBody);
  const tableGlass = beveledBox(scene, "light-table-glass", { width: 11.2, height: 0.24, depth: 5.2, bevel: 0.05 });
  tableGlass.position.y = 3.3;
  tableGlass.parent = table;
  tableGlass.material = materials.get({ materialClass: "NEON", color: "#eaf3ff", emissive: 0.9 });
  state.meshes.push(tableGlass);
  // Film positives lying on it: dark translucent sheets.
  for (let sheet = 0; sheet < 3; sheet += 1) {
    const film = beveledBox(scene, `light-table-film-${sheet}`, { width: 3.6, height: 0.05, depth: 4.4, bevel: 0.01 });
    film.position.set(-3.6 + sheet * 3.6, 3.45, sheet % 2 === 0 ? 0.3 : -0.3);
    film.rotation.y = (sheet - 1) * 0.12;
    film.parent = table;
    film.material = materials.get({ materialClass: "GLASS", color: "#2a2438" });
    state.meshes.push(film);
  }

  // The swatch board: a wall of colour chips, which is what a design office has and a warehouse does not.
  const boardAt = range.from + span * 0.16;
  const boardPos = context.beside(boardAt, lateral(boardAt, 9));
  const board = new TransformNode("hero-swatch-board", scene);
  board.position.copyFrom(boardPos);
  board.rotation.y = context.at(boardAt).frame.heading + Math.PI / 2;
  state.nodes.push(board);
  const backing = beveledBox(scene, "swatch-backing", { width: 14, height: 9, depth: 0.5, bevel: 0.1 });
  backing.position.y = 5.5;
  backing.parent = board;
  backing.material = materials.get({ materialClass: "PAINTED_METAL", color: "#f0ece4", tile: 3 });
  state.meshes.push(backing);
  const chip = beveledBox(scene, "swatch-chip", { width: 1.7, height: 1.1, depth: 0.16, bevel: 0.03 });
  chip.material = materials.get({ materialClass: "PAPER", color: "#ffffff" });
  chip.isVisible = false;
  chip.registerInstancedBuffer("color", 4);
  chip.parent = board;
  state.meshes.push(chip);
  const palette = ["#ff3da6", "#ff6b2c", "#ffd43b", "#b9ff45", "#65d8ff", "#8f5cff", "#f7f2e8", "#2c3e70", "#12101a"];
  for (let row = 0; row < 6; row += 1) {
    for (let column = 0; column < 7; column += 1) {
      const instance = chip.createInstance(`swatch-${row}-${column}`);
      instance.position.set(-5.4 + column * 1.8, 9.2 - row * 1.3, 0.3);
      instance.isPickable = false;
      const base = palette[(row * 7 + column) % palette.length]!;
      tint(instance, base, 0.75 + ((row * 3 + column) % 4) * 0.1);
      instance.freezeWorldMatrix();
    }
  }
  landmarks.push({ label: "FOTOLITOS", position: tablePos.clone(), progress: tableAt });
}

/** A monitor showing a shirt mock-up, drawn once into a texture. */
function artworkScreen(context: DressingContext, state: SetState, name: string): PBRMaterial {
  const material = new PBRMaterial(name, context.scene);
  material.roughness = 0.2;
  material.metallic = 0;
  material.albedoColor = Color3.FromHexString("#1c2130");
  material.emissiveColor = Color3.FromHexString("#65d8ff").scale(0.5);
  if (canDraw()) {
    const texture = new DynamicTexture(`${name}-tex`, { width: 512, height: 288 }, context.scene, true);
    const ctx = texture.getContext() as unknown as CanvasRenderingContext2D;
    ctx.fillStyle = "#1c2130";
    ctx.fillRect(0, 0, 512, 288);
    // Tool panel and canvas.
    ctx.fillStyle = "#2a3142";
    ctx.fillRect(0, 0, 70, 288);
    ctx.fillRect(70, 0, 442, 34);
    ctx.fillStyle = "#3a4256";
    for (let icon = 0; icon < 8; icon += 1) ctx.fillRect(14, 48 + icon * 28, 42, 20);
    ctx.fillStyle = "#f7f2e8";
    ctx.fillRect(110, 58, 340, 210);
    // The shirt.
    ctx.fillStyle = "#65d8ff";
    ctx.beginPath();
    ctx.moveTo(200, 90);
    ctx.lineTo(240, 80);
    ctx.quadraticCurveTo(280, 100, 320, 80);
    ctx.lineTo(360, 90);
    ctx.lineTo(400, 140);
    ctx.lineTo(360, 160);
    ctx.lineTo(350, 250);
    ctx.lineTo(210, 250);
    ctx.lineTo(200, 160);
    ctx.lineTo(160, 140);
    ctx.closePath();
    ctx.fill();
    // A print on it: the splat.
    ctx.fillStyle = "#ff3da6";
    ctx.beginPath();
    ctx.arc(280, 185, 34, 0, Math.PI * 2);
    ctx.fill();
    for (let drop = 0; drop < 6; drop += 1) {
      const angle = (drop / 6) * Math.PI * 2;
      ctx.beginPath();
      ctx.arc(280 + Math.cos(angle) * 48, 185 + Math.sin(angle) * 44, 6 + (drop % 3) * 3, 0, Math.PI * 2);
      ctx.fill();
    }
    ctx.fillStyle = "#ffd43b";
    ctx.fillRect(470, 60, 30, 200);
    texture.update(false);
    material.albedoTexture = texture;
    material.emissiveTexture = texture;
    material.emissiveColor = Color3.White().scale(0.75);
    material.albedoColor = Color3.White();
  }
  material.onDisposeObservable.add(() => {
    material.albedoTexture?.dispose();
  });
  return material;
}

// ---------------------------------------------------------------------------------- PANTALLAS

function buildScreenHall(context: DressingContext, state: SetState, landmarks: Dressing["landmarks"]): void {
  const { scene, materials, detailed } = context;
  const range = context.sectorRange(2);
  const span = range.to - range.from;
  const steel = materials.get({ materialClass: "RAW_METAL", color: "#aeb5bd", texture: "mat_rawmetal_default", tile: 1 });
  const mesh = materials.get({ materialClass: "GLASS", color: "#7fdcff" });

  // A screen frame with its mesh, instanced across the racks.
  const frameParts: Mesh[] = [];
  for (const [w, h, x, y] of [[0.3, 4.2, -2.6, 0], [0.3, 4.2, 2.6, 0], [5.5, 0.3, 0, 2.05], [5.5, 0.3, 0, -2.05]] as const) {
    const bar = beveledBox(scene, `screen-bar-${x}-${y}`, { width: w, height: h, depth: 0.28, bevel: 0.04 });
    bar.position.set(x, y, 0);
    bar.material = steel;
    frameParts.push(bar);
  }
  const frameSource = mergeParts("screen-frame", frameParts, true);
  frameSource.isVisible = false;
  frameSource.isPickable = false;
  state.meshes.push(frameSource);
  const meshSource = beveledBox(scene, "screen-mesh", { width: 5, height: 3.8, depth: 0.04, bevel: 0.01 });
  meshSource.material = mesh;
  meshSource.isVisible = false;
  meshSource.isPickable = false;
  state.meshes.push(meshSource);

  // Racks on both sides through the technical section.
  const rackCount = detailed ? 6 : 4;
  for (let rack = 0; rack < rackCount; rack += 1) {
    const at = range.from + span * (0.12 + (rack / rackCount) * 0.7);
    const side = rack % 2 === 0 ? 1 : -1;
    const node = context.at(at).node;
    const offset = side * (node.width * 0.5 + TerrainConfig.vergeMetres + 5 + (rack % 3) * 2);
    const position = context.beside(at, offset);
    const holder = new TransformNode(`screen-rack-${rack}`, scene);
    holder.position.copyFrom(position);
    holder.rotation.y = context.at(at).frame.heading + (side > 0 ? 0.2 : -0.2);
    state.nodes.push(holder);
    // An A-frame: two leaning uprights with a top bar, screens leaning on both faces.
    const parts: Mesh[] = [];
    for (const lean of [-1, 1] as const) {
      for (const end of [-4.5, 4.5]) {
        const post = tube(scene, `rack-post-${rack}-${lean}-${end}`, [new Vector3(end, 0, lean * 2.2), new Vector3(end, 11, lean * 0.4)], 0.12, 7);
        post.material = steel;
        parts.push(post);
      }
    }
    const bar = tube(scene, `rack-bar-${rack}`, [new Vector3(-4.6, 11, 0), new Vector3(4.6, 11, 0)], 0.12, 7);
    bar.material = steel;
    parts.push(bar);
    const rackMesh = mergeParts(`screen-rack-mesh-${rack}`, parts, true);
    rackMesh.parent = holder;
    state.meshes.push(rackMesh);
    for (const lean of [-1, 1] as const) {
      for (let row = 0; row < 2; row += 1) {
        const frameInstance = frameSource.createInstance(`screen-frame-${rack}-${lean}-${row}`);
        frameInstance.parent = holder;
        frameInstance.position.set(0, 2.6 + row * 4.6, lean * (1.9 - row * 0.75));
        frameInstance.rotation.x = -lean * 0.17;
        frameInstance.isPickable = false;
        const meshInstance = meshSource.createInstance(`screen-mesh-${rack}-${lean}-${row}`);
        meshInstance.parent = holder;
        meshInstance.position.set(0, 2.6 + row * 4.6, lean * (1.9 - row * 0.75));
        meshInstance.rotation.x = -lean * 0.17;
        meshInstance.isPickable = false;
      }
    }
  }

  // The exposure unit: a big grey cabinet whose lid lifts to show a violet UV bed.
  const unitAt = range.from + span * 0.55;
  const unitNode = context.at(unitAt).node;
  const unitPos = context.beside(unitAt, unitNode.width * 0.5 + TerrainConfig.vergeMetres + 12);
  const unit = new TransformNode("hero-exposure-unit", scene);
  unit.position.copyFrom(unitPos);
  unit.rotation.y = context.at(unitAt).frame.heading;
  state.nodes.push(unit);
  const body = lofted(
    scene,
    "exposure-body",
    [
      { z: -5, halfWidth: 5.2, halfHeight: 2.6, y: 2.6, radius: 0.4 },
      { z: 0, halfWidth: 5.6, halfHeight: 2.9, y: 2.9, radius: 0.45 },
      { z: 5, halfWidth: 5.2, halfHeight: 2.6, y: 2.6, radius: 0.4 },
    ],
    { cornerSegments: 4 },
  );
  body.parent = unit;
  body.material = materials.get({ materialClass: "PAINTED_METAL", color: "#4b5162", texture: "mat_paintedmetal_press", tile: 2 });
  body.receiveShadows = true;
  state.meshes.push(body);
  context.addShadowCaster(body);
  const bed = beveledBox(scene, "exposure-bed", { width: 9.6, height: 0.3, depth: 8.6, bevel: 0.05 });
  bed.position.y = 5.5;
  bed.parent = unit;
  bed.material = materials.get({ materialClass: "NEON", color: "#b48cff", emissive: 1 });
  state.meshes.push(bed);
  const lid = new TransformNode("exposure-lid", scene);
  lid.parent = unit;
  lid.position.set(0, 5.7, -4.6);
  const lidMesh = beveledBox(scene, "exposure-lid-mesh", { width: 10.4, height: 0.7, depth: 9.6, bevel: 0.1 });
  lidMesh.position.set(0, 0.35, 4.8);
  lidMesh.parent = lid;
  lidMesh.material = materials.get({ materialClass: "PAINTED_METAL", color: "#3a3f49", texture: "mat_paintedmetal_press", tile: 2 });
  state.meshes.push(lidMesh);
  const readout = beveledBox(scene, "exposure-readout", { width: 2.2, height: 1, depth: 0.1, bevel: 0.02 });
  readout.position.set(3.6, 3.6, 5.05);
  readout.parent = unit;
  readout.material = materials.get({ materialClass: "SCREEN", color: "#65d8ff", texture: "mat_screen_cyan" });
  state.meshes.push(readout);
  // Violet light spilling from the bed when the lid is up.
  const uv = context.quality === "LOW" ? null : new PointLight("exposure-uv", new Vector3(0, 7.5, 0), scene);
  if (uv) {
    uv.parent = unit;
    uv.diffuse = Color3.FromHexString("#9d6bff");
    uv.intensity = 0;
    uv.range = 40;
    state.lights.push(uv);
  }
  context.animators.push((_dt, nowMs) => {
    const cycle = (nowMs * 0.00025) % 1;
    // Open for the middle third of the cycle, eased.
    const open = cycle < 0.33 ? cycle / 0.33 : cycle < 0.66 ? 1 : Math.max(0, 1 - (cycle - 0.66) / 0.34);
    const eased = open * open * (3 - 2 * open);
    lid.rotation.x = -eased * 1.15;
    if (uv) uv.intensity = eased * 420;
  });
  landmarks.push({ label: "TÚNEL UV", position: unitPos.clone(), progress: unitAt });

  // The washout booth: a three-sided bay with a mist of water hanging in it.
  const boothAt = range.from + span * 0.86;
  const boothNode = context.at(boothAt).node;
  const boothPos = context.beside(boothAt, -(boothNode.width * 0.5 + TerrainConfig.vergeMetres + 7));
  const booth = new TransformNode("washout-booth", scene);
  booth.position.copyFrom(boothPos);
  booth.rotation.y = context.at(boothAt).frame.heading + Math.PI / 2;
  state.nodes.push(booth);
  const boothParts: Mesh[] = [];
  const back = beveledBox(scene, "booth-back", { width: 10, height: 7, depth: 0.4, bevel: 0.06 });
  back.position.set(0, 3.5, -3.2);
  back.material = materials.get({ materialClass: "PAINTED_METAL", color: "#6b7385", tile: 2 });
  boothParts.push(back);
  for (const side of [-1, 1] as const) {
    const wing = beveledBox(scene, `booth-wing-${side}`, { width: 0.4, height: 7, depth: 6.4, bevel: 0.06 });
    wing.position.set(side * 4.8, 3.5, 0);
    wing.material = materials.get({ materialClass: "PAINTED_METAL", color: "#6b7385", tile: 2 });
    boothParts.push(wing);
  }
  const tray = beveledBox(scene, "booth-tray", { width: 9.6, height: 0.6, depth: 6.4, bevel: 0.05 });
  tray.position.y = 0.3;
  tray.material = materials.get({ materialClass: "RAW_METAL", color: "#8f979f" });
  boothParts.push(tray);
  const boothMesh = mergeParts("washout-booth-mesh", boothParts, true);
  boothMesh.parent = booth;
  state.meshes.push(boothMesh);
  const wash = particles(context, state, "booth-mist", 50, boothPos.add(new Vector3(0, 4.5, 0)));
  if (wash) {
    wash.minEmitBox = new Vector3(-3, -1, -2);
    wash.maxEmitBox = new Vector3(3, 1, 2);
    wash.color1 = new Color4(0.75, 0.9, 1, 0.22);
    wash.color2 = new Color4(0.6, 0.85, 1, 0.12);
    wash.colorDead = new Color4(0.6, 0.85, 1, 0);
    wash.minSize = 1.2;
    wash.maxSize = 3;
    wash.minLifeTime = 1.6;
    wash.maxLifeTime = 3.2;
    wash.emitRate = 14;
    wash.direction1 = new Vector3(-0.2, -0.6, -0.2);
    wash.direction2 = new Vector3(0.2, -1, 0.2);
    wash.minEmitPower = 0.4;
    wash.maxEmitPower = 1;
    wash.gravity = new Vector3(0, -0.6, 0);
    wash.start();
  }
}

// ---------------------------------------------------------------------------------- TINTA

function buildInkHall(context: DressingContext, state: SetState, landmarks: Dressing["landmarks"]): void {
  const { scene, materials, detailed, nodes } = context;
  const range = context.sectorRange(3);
  const span = range.to - range.from;
  const indices = sectorNodes(nodes, 3);
  const centre = arcCentre(nodes, indices);
  const midIndex = indices[Math.floor(indices.length * 0.35)] ?? 0;
  const mid = nodes[midIndex]!;
  const shell = materials.get({ materialClass: "PAINTED_METAL", color: "#3a3f49", texture: "mat_paintedmetal_press", tile: 2 });
  const steel = materials.get({ materialClass: "RAW_METAL", color: "#9fa6ad", texture: "mat_rawmetal_default", tile: 1 });

  // ---------------------------------------------------------------- the carousel
  const pivot = centre ?? { x: mid.x, y: mid.y, z: mid.z, radius: 30, clearance: 30 };
  // The arms reach from the pivot to the far edge of the spiral road: over it, not merely to its kerb.
  const reach = Math.max(24, pivot.radius + mid.width * 0.5 + TerrainConfig.vergeMetres);
  /**
   * The drum is as big as the space allows. The route was designed so the shortcut cuts *through* the
   * carousel — the blueprint calls it "bajo el carrusel" — which puts a leg of road seven metres from
   * the pivot. The drum stops a lane short of that road, and the reach of the arms is independent of
   * it, so the machine is a column the shortcut skirts and a canopy the main road passes under.
   */
  const drum = Math.max(3.6, Math.min(12, pivot.clearance - 1.8));
  const scale = drum / 12;
  const groundY = context.heightAt(pivot.x, pivot.z);
  const carousel = new TransformNode("hero-carousel", scene);
  carousel.position.set(pivot.x, groundY, pivot.z);
  state.nodes.push(carousel);

  const staticParts: Mesh[] = [];
  /**
   * The body is deliberately oversized. The road circles this machine at forty-odd metres, so from
   * the racing line a normal-sized press would be a dot: the drum is twelve metres across and the
   * column four, which is what lets the carousel stay the biggest thing in the frame for the whole
   * spiral. Its arms then do the rest by coming to the road.
   */
  const base = revolve(
    scene,
    "carousel-base",
    [new Vector2(0.001, 0), new Vector2(12, 0), new Vector2(12.4, 0.8), new Vector2(11.8, 1.8), new Vector2(9.6, 5.4), new Vector2(9.9, 6), new Vector2(4.6, 6.4), new Vector2(0.001, 6.4)],
    detailed ? 32 : 16,
  );
  base.material = shell;
  staticParts.push(base);
  const baseBand = revolve(scene, "carousel-base-band", [new Vector2(12.45, 0.9), new Vector2(12.45, 1.7)], detailed ? 32 : 16, { capStart: false, capEnd: false });
  baseBand.material = materials.get({ materialClass: "PAINTED_METAL", color: "#ffd43b", texture: "mat_safety_yellow", tile: 1.2 });
  staticParts.push(baseBand);
  const column = revolve(
    scene,
    "carousel-column",
    [new Vector2(4.5, 6.4), new Vector2(4.1, 8), new Vector2(4, 10.6), new Vector2(4.4, 11.2)],
    detailed ? 28 : 14,
  );
  column.material = shell;
  staticParts.push(column);
  // Brand stripes on the column: the shop's own colours, wide enough to read from the road.
  for (const [y, colour] of [[7.2, "#65d8ff"], [8.1, "#ff3da6"], [9.0, "#ffd43b"]] as const) {
    const ring = revolve(scene, `carousel-stripe-${y}`, [new Vector2(4.13, y), new Vector2(4.13, y + 0.7)], detailed ? 28 : 14, { capStart: false, capEnd: false });
    ring.material = materials.get({ materialClass: "NEON", color: colour, emissive: 0.7 });
    staticParts.push(ring);
  }
  // Access platform with a rail, and a ladder up the drum: the human scale beside the giant one.
  const platform = revolve(scene, "carousel-platform", [new Vector2(4.2, 6.4), new Vector2(7.4, 6.4), new Vector2(7.4, 6.7), new Vector2(4.2, 6.7)], detailed ? 28 : 14);
  platform.material = steel;
  staticParts.push(platform);
  const railRing = revolve(scene, "carousel-rail", [new Vector2(7.3, 7.7), new Vector2(7.3, 7.78)], detailed ? 28 : 14, { capStart: false, capEnd: false });
  railRing.material = steel;
  staticParts.push(railRing);
  for (let post = 0; post < 12; post += 1) {
    const angle = (post / 12) * Math.PI * 2;
    const upright = tube(scene, `carousel-railpost-${post}`, [new Vector3(Math.sin(angle) * 7.3, 6.7, Math.cos(angle) * 7.3), new Vector3(Math.sin(angle) * 7.3, 7.75, Math.cos(angle) * 7.3)], 0.04, 5);
    upright.material = steel;
    staticParts.push(upright);
  }
  for (let rung = 0; rung < 9; rung += 1) {
    const step = tube(scene, `carousel-rung-${rung}`, [new Vector3(12.5, 0.6 + rung * 0.65, -0.6), new Vector3(12.5, 0.6 + rung * 0.65, 0.6)], 0.05, 5);
    step.material = steel;
    staticParts.push(step);
  }
  // Warning lamps around the drum's shoulder.
  for (let lamp = 0; lamp < 8; lamp += 1) {
    const angle = (lamp / 8) * Math.PI * 2 + 0.2;
    const bulb = ellipsoid(scene, `carousel-lamp-${lamp}`, { x: 0.35, y: 0.3, z: 0.35 }, 10, 6);
    bulb.position.set(Math.sin(angle) * 9.9, 6.2, Math.cos(angle) * 9.9);
    bulb.material = materials.get({ materialClass: "NEON", color: lamp % 2 === 0 ? "#ff6b2c" : "#ffd43b", emissive: 1 });
    staticParts.push(bulb);
  }
  const staticMesh = mergeParts("hero-carousel-static", staticParts, true);
  // Scaled in plan only, so a narrow drum is still full height.
  staticMesh.scaling.set(scale, 1, scale);
  staticMesh.parent = carousel;
  staticMesh.receiveShadows = true;
  state.meshes.push(staticMesh);
  context.addShadowCaster(staticMesh);

  // The rotating assembly: hub, arms, heads, platens, hoses.
  /**
   * The rotor sits at eleven metres: high enough that the platens swing clear over a kart, low
   * enough that the arms genuinely cross *over the road* rather than somewhere near the roof. This
   * is the hero moment the brief describes, and its height is what makes it one.
   */
  const rotor = new TransformNode("carousel-rotor", scene);
  rotor.parent = carousel;
  rotor.position.y = 11.2;
  const rotorParts: Mesh[] = [];
  const hub = revolve(
    scene,
    "carousel-hub",
    [new Vector2(0.001, -0.6), new Vector2(6.2, -0.4), new Vector2(6.6, 0.6), new Vector2(6.4, 2.2), new Vector2(5.2, 2.8), new Vector2(0.001, 3)],
    detailed ? 32 : 16,
  );
  hub.material = shell;
  rotorParts.push(hub);
  const beacon = ellipsoid(scene, "carousel-beacon", { x: 0.7, y: 0.6, z: 0.7 }, 12, 7);
  beacon.position.y = 3.4;
  beacon.material = materials.get({ materialClass: "NEON", color: "#ff6b2c", emissive: 1 });
  rotorParts.push(beacon);

  const arms = 8;
  const heads: Array<{ node: TransformNode; housing: Mesh; blade: Mesh; phase: number }> = [];
  for (let index = 0; index < arms; index += 1) {
    const angle = (index / arms) * Math.PI * 2;
    const dx = Math.sin(angle);
    const dz = Math.cos(angle);
    const ink = INKS[index % INKS.length]!;
    // A tapering arm, braced from above by a tie rod.
    const arm = tube(
      scene,
      `carousel-arm-${index}`,
      [new Vector3(dx * 3.8, 0.8, dz * 3.8), new Vector3(dx * reach * 0.55, 0.9, dz * reach * 0.55), new Vector3(dx * reach, 0.6, dz * reach)],
      (t) => 1.1 - t * 0.55,
      detailed ? 12 : 7,
    );
    arm.material = shell;
    rotorParts.push(arm);
    const tie = tube(scene, `carousel-tie-${index}`, [new Vector3(dx * 2.5, 2.9, dz * 2.5), new Vector3(dx * reach * 0.82, 1.1, dz * reach * 0.82)], 0.14, 6);
    tie.material = steel;
    rotorParts.push(tie);
    // The ink line, in its colour, running along the arm to the head.
    const hose = tube(
      scene,
      `carousel-hose-${index}`,
      [new Vector3(dx * 4.2, 1.7, dz * 4.2), new Vector3(dx * reach * 0.5, 1.9, dz * reach * 0.5), new Vector3(dx * (reach - 3), 1.4, dz * (reach - 3)), new Vector3(dx * (reach - 2.6), -0.6, dz * (reach - 2.6))],
      0.22,
      detailed ? 9 : 6,
    );
    hose.material = materials.get({ materialClass: "INK", ...inkOf(index) });
    rotorParts.push(hose);

    // Print head over the road: a housing with a screen frame under it and a squeegee that strokes.
    const headNode = new TransformNode(`carousel-head-${index}`, scene);
    headNode.parent = rotor;
    headNode.position.set(dx * (reach - 3.2), -0.3, dz * (reach - 3.2));
    headNode.rotation.y = angle;
    const housing = beveledBox(scene, `carousel-housing-${index}`, { width: 6.4, height: 2, depth: 7.6, bevel: 0.14 });
    housing.position.y = -0.4;
    housing.parent = headNode;
    housing.material = shell;
    state.meshes.push(housing);
    const inkPot = revolve(scene, `carousel-pot-${index}`, [new Vector2(0.001, 0), new Vector2(1.3, 0.05), new Vector2(1.2, 2.2), new Vector2(0.001, 2.3)], detailed ? 14 : 9);
    inkPot.position.set(0, 0.6, -2.2);
    inkPot.parent = headNode;
    inkPot.material = materials.get({ materialClass: "INK", ...inkOf(index) });
    state.meshes.push(inkPot);
    const screenFrame = beveledBox(scene, `carousel-screen-${index}`, { width: 5.6, height: 0.3, depth: 6.8, bevel: 0.05 });
    screenFrame.position.y = -1.8;
    screenFrame.parent = headNode;
    screenFrame.material = steel;
    state.meshes.push(screenFrame);
    const screenMesh = beveledBox(scene, `carousel-screenmesh-${index}`, { width: 5, height: 0.06, depth: 6.2, bevel: 0.01 });
    screenMesh.position.y = -1.75;
    screenMesh.parent = headNode;
    screenMesh.material = materials.get({ materialClass: "GLASS", color: "#a7ecff" });
    state.meshes.push(screenMesh);
    const blade = beveledBox(scene, `carousel-blade-${index}`, { width: 5.2, height: 1.4, depth: 0.5, bevel: 0.05 });
    blade.position.set(0, -0.9, 0);
    blade.parent = headNode;
    blade.material = materials.get({ materialClass: "PLASTIC", color: ink });
    state.meshes.push(blade);
    // Spot pod under the head, lighting the platen.
    const pod = revolve(scene, `carousel-pod-${index}`, [new Vector2(0.001, 0), new Vector2(0.55, 0), new Vector2(0.45, -0.5), new Vector2(0.001, -0.5)], 10);
    pod.position.set(2.6, -1.3, 3.2);
    pod.parent = headNode;
    pod.material = materials.get({ materialClass: "NEON", color: "#fff3dc", emissive: 1 });
    state.meshes.push(pod);
    heads.push({ node: headNode, housing, blade, phase: index * 0.7 });

    // The platen and its shirt, well below the head — and well above a kart.
    const platenNode = new TransformNode(`carousel-platen-${index}`, scene);
    platenNode.parent = rotor;
    // 5.6 m over the road: a kart is 1.4 m tall and the platen's shadow sweeps across the ink.
    platenNode.position.set(dx * (reach - 3.2), -5.6, dz * (reach - 3.2));
    platenNode.rotation.y = angle;
    const drop = tube(scene, `carousel-drop-${index}`, [new Vector3(0, 5.0, 0), new Vector3(0, 0.2, 0)], 0.3, 7);
    drop.parent = platenNode;
    drop.material = steel;
    state.meshes.push(drop);
    const platen = beveledBox(scene, `carousel-platenmesh-${index}`, { width: 5.4, height: 0.36, depth: 6.6, bevel: 0.06 });
    platen.parent = platenNode;
    platen.material = steel;
    state.meshes.push(platen);
    const shirt = beveledBox(scene, `carousel-platenshirt-${index}`, { width: 4.6, height: 0.16, depth: 5.8, bevel: 0.06 });
    shirt.position.y = 0.26;
    shirt.parent = platenNode;
    shirt.material = materials.get(
      index % 2 === 0
        ? { materialClass: "FABRIC", color: "#f7f2e8", texture: "mat_fabric_white", tile: 0.5 }
        : { materialClass: "FABRIC", color: "#2c3e70", tile: 0.5 },
    );
    state.meshes.push(shirt);
  }
  const rotorMesh = mergeParts("hero-carousel-rotor", rotorParts, true);
  rotorMesh.parent = rotor;
  state.meshes.push(rotorMesh);
  context.addShadowCaster(rotorMesh);

  // Key light on the hero: a warm point under the hub, so the machine is lit as well as big.
  if (context.quality !== "LOW") {
    const light = new PointLight("carousel-light", new Vector3(pivot.x, groundY + 9, pivot.z), scene);
    light.diffuse = Color3.FromHexString("#fff0d6");
    light.intensity = 900;
    light.range = 120;
    state.lights.push(light);
  }

  // Drips from the heads, and steam off the platens.
  for (let index = 0; index < 4; index += 1) {
    const ink = Color3.FromHexString(INKS[index]!);
    const drip = particles(context, state, `carousel-drip-${index}`, 30, new Vector3(0, -2.4, 0));
    if (drip) {
      // The housing turns with the rotor, so the drips follow the head across the road.
      drip.emitter = heads[index * 2]!.housing;
      drip.minEmitBox = new Vector3(-2, 0, -2.4);
      drip.maxEmitBox = new Vector3(2, 0, 2.4);
      drip.color1 = new Color4(ink.r, ink.g, ink.b, 0.95);
      drip.color2 = new Color4(ink.r, ink.g, ink.b, 0.8);
      drip.colorDead = new Color4(ink.r, ink.g, ink.b, 0);
      drip.minSize = 0.18;
      drip.maxSize = 0.4;
      drip.minLifeTime = 0.9;
      drip.maxLifeTime = 1.4;
      drip.emitRate = 6;
      drip.direction1 = new Vector3(0, -1, 0);
      drip.direction2 = new Vector3(0, -1, 0);
      drip.minEmitPower = 0.2;
      drip.maxEmitPower = 0.6;
      drip.gravity = new Vector3(0, -9, 0);
      drip.start();
    }
  }
  const dust = particles(context, state, "carousel-dust", detailed ? 90 : 40, new Vector3(pivot.x, groundY + 8, pivot.z));
  if (dust) {
    dust.minEmitBox = new Vector3(-reach, -6, -reach);
    dust.maxEmitBox = new Vector3(reach, 8, reach);
    dust.color1 = new Color4(1, 0.95, 0.85, 0.14);
    dust.color2 = new Color4(1, 0.9, 0.95, 0.08);
    dust.colorDead = new Color4(1, 1, 1, 0);
    dust.minSize = 0.4;
    dust.maxSize = 1.4;
    dust.minLifeTime = 6;
    dust.maxLifeTime = 12;
    dust.emitRate = detailed ? 9 : 4;
    dust.blendMode = ParticleSystem.BLENDMODE_ADD;
    dust.direction1 = new Vector3(-0.2, 0.05, -0.2);
    dust.direction2 = new Vector3(0.2, 0.2, 0.2);
    dust.minEmitPower = 0.1;
    dust.maxEmitPower = 0.4;
    dust.gravity = new Vector3(0, 0.02, 0);
    dust.start();
  }

  context.animators.push((dt, nowMs) => {
    rotor.rotation.y += dt * 0.055;
    for (const head of heads) {
      // The squeegee strokes across the screen and lifts back.
      const stroke = Math.sin(nowMs * 0.0011 + head.phase);
      head.blade.position.z = stroke * 2.4;
      head.blade.position.y = -0.9 - Math.max(0, Math.cos(nowMs * 0.0011 + head.phase)) * 0.35;
    }
  });
  landmarks.push({ label: "CARRUSEL", position: new Vector3(pivot.x, groundY, pivot.z), progress: range.from + span * 0.3 });

  // ---------------------------------------------------------------- ink on the floor
  /**
   * Puddles on the road through the ink sector, in the four process colours. Real geometry with the
   * wet INK material rather than decals, so they catch the lights and read as liquid — and because
   * the INK surface has 0.35 grip, the puddles are the visible reason the car is sliding.
   */
  const puddleSources = INK_TEXTURES.map((texture, index) => {
    const source = splatDisc(scene, `ink-puddle-${index}`, detailed ? 26 : 16, index * 17 + 3);
    source.material = materials.get({ materialClass: "INK", color: INKS[index] as string, texture: texture as string, tile: 1.6, emissive: 0.0 });
    source.isVisible = false;
    source.isPickable = false;
    state.meshes.push(source);
    return source;
  });
  const puddleCount = detailed ? 26 : 14;
  for (let index = 0; index < puddleCount; index += 1) {
    const at = range.from + span * (0.05 + (index / puddleCount) * 0.9) + (context.random() - 0.5) * 0.01;
    const placement = context.at(at);
    if (placement.node.surface !== "INK") continue;
    const lateral = (context.random() - 0.5) * placement.node.width * 0.55;
    const position = context.beside(at, lateral, 0.03);
    const source = puddleSources[index % puddleSources.length]!;
    const puddle = source.createInstance(`ink-puddle-${index}`);
    puddle.position.copyFrom(position);
    puddle.scaling.set(2.2 + context.random() * 3, 1, 1.6 + context.random() * 2.4);
    puddle.rotation.y = context.random() * Math.PI;
    // Laid on the banked surface: the disc's local X follows the road's cross-section.
    puddle.rotation.z = -placement.node.banking * Math.cos(puddle.rotation.y - placement.frame.heading);
    puddle.isPickable = false;
    puddle.freezeWorldMatrix();
  }

  // ---------------------------------------------------------------- vats and overhead lines
  const vatAt = range.from + span * 0.72;
  const vatNode = context.at(vatAt).node;
  const vatSide = -1;
  const vatPos = context.beside(vatAt, vatSide * (vatNode.width * 0.5 + TerrainConfig.vergeMetres + 9));
  const vats = new TransformNode("hero-ink-vats", scene);
  vats.position.copyFrom(vatPos);
  vats.rotation.y = context.at(vatAt).frame.heading;
  state.nodes.push(vats);
  const vatParts: Mesh[] = [];
  const bund = beveledBox(scene, "vats-bund", { width: 24, height: 0.7, depth: 9, bevel: 0.1 });
  bund.position.y = 0.35;
  bund.material = materials.get({ materialClass: "CONCRETE", color: "#4a4550", texture: "mat_concrete_factory", tile: 3 });
  vatParts.push(bund);
  for (let index = 0; index < 4; index += 1) {
    const x = -9 + index * 6;
    const vat = revolve(
      scene,
      `vat-${index}`,
      [new Vector2(0.001, 0.7), new Vector2(2.4, 0.75), new Vector2(2.5, 1.4), new Vector2(2.4, 5.4), new Vector2(2.5, 5.9), new Vector2(2.2, 6.1), new Vector2(0.001, 6.1)],
      detailed ? 22 : 12,
    );
    vat.position.x = x;
    vat.material = materials.get({ materialClass: "PAINTED_METAL", color: "#6b7385", tile: 2 });
    vatParts.push(vat);
    const fill = revolve(scene, `vat-fill-${index}`, [new Vector2(0.001, 6.05), new Vector2(2.1, 6.05), new Vector2(2.1, 6.2), new Vector2(0.001, 6.2)], detailed ? 22 : 12);
    fill.position.x = x;
    fill.material = materials.get({ materialClass: "INK", ...inkOf(index), tile: 1.6, emissive: 0.15 });
    vatParts.push(fill);
    const label = beveledBox(scene, `vat-label-${index}`, { width: 2.4, height: 1.6, depth: 0.08, bevel: 0.02 });
    label.position.set(x, 3.4, 2.53);
    label.material = materials.get({ materialClass: "PLASTIC", color: INKS[index]! });
    vatParts.push(label);
    // Stirrer motor on top.
    const motor = beveledBox(scene, `vat-motor-${index}`, { width: 1.4, height: 1.2, depth: 1.4, bevel: 0.08 });
    motor.position.set(x, 6.9, 0);
    motor.material = materials.get({ materialClass: "PAINTED_METAL", color: "#3a3f49", texture: "mat_paintedmetal_press", tile: 2 });
    vatParts.push(motor);
  }
  const vatMesh = mergeParts("hero-ink-vats-mesh", vatParts, true);
  vatMesh.parent = vats;
  vatMesh.receiveShadows = true;
  state.meshes.push(vatMesh);
  context.addShadowCaster(vatMesh);
  landmarks.push({ label: "CUBAS DE TINTA", position: vatPos.clone(), progress: vatAt });

  /**
   * Four coloured ink lines running above the road through the whole ink sector, from the vats
   * toward the carousel. They are the flow line of this zone: continuous, coloured, and they turn
   * with the road, so the player sees the next corner in them before the road shows it.
   */
  const from = indices[0]!;
  const to = indices[indices.length - 1]!;
  for (let line = 0; line < 4; line += 1) {
    const path: Vector3[] = [];
    const lateral = -4.5 + line * 3;
    for (let index = from; index <= to; index += 4) {
      const node = nodes[index]!;
      const frame = frameAt(nodes, index);
      path.push(new Vector3(node.x + frame.nx * lateral, node.y + 8.4 + line * 0.3, node.z + frame.nz * lateral));
    }
    if (path.length < 2) continue;
    const pipe = tube(scene, `ink-line-${line}`, path, 0.16, detailed ? 9 : 6);
    pipe.material = materials.get({ materialClass: "INK", ...inkOf(line), tile: 2, emissive: 0.1 });
    pipe.isPickable = false;
    state.meshes.push(pipe);
  }
  // Gantry frames carrying the lines, every forty metres.
  const gantryParts: Mesh[] = [];
  for (let index = from; index <= to; index += 16) {
    const node = nodes[index]!;
    const frame = frameAt(nodes, index);
    const half = node.width * 0.5 + TerrainConfig.vergeMetres + 0.6;
    for (const side of [-1, 1] as const) {
      const post = beveledBox(scene, `ink-gantry-post-${index}-${side}`, { width: 0.4, height: 8.8, depth: 0.4, bevel: 0.03 });
      post.position.set(node.x + frame.nx * side * half, node.y + 4.4, node.z + frame.nz * side * half);
      post.rotation.y = frame.heading;
      post.material = shell;
      gantryParts.push(post);
    }
    const beam = beveledBox(scene, `ink-gantry-beam-${index}`, { width: half * 2 + 0.4, height: 0.5, depth: 0.4, bevel: 0.03 });
    beam.position.set(node.x, node.y + 8.6, node.z);
    beam.rotation.y = frame.heading;
    beam.material = shell;
    gantryParts.push(beam);
  }
  if (gantryParts.length > 0) {
    const gantry = mergeParts("ink-gantries", gantryParts, true);
    gantry.isPickable = false;
    state.meshes.push(gantry);
  }

  // ---------------------------------------------------------------- shirt mountains
  const shirtSource = foldedShirtSource(context, "mountain-shirt");
  state.meshes.push(shirtSource);
  for (const [offsetProgress, side] of [[0.18, -1], [0.5, 1], [0.86, 1]] as const) {
    const at = range.from + span * offsetProgress;
    const node = context.at(at).node;
    const distance = node.width * 0.5 + TerrainConfig.vergeMetres + 8;
    const position = context.beside(at, side * distance);
    /**
     * A heap of shirts: a soft mound of cloth with folded shirts lying on its surface. The mound
     * carries the silhouette and the shirts carry the colour; both are needed, because a mound alone
     * reads as a rock and shirts alone read as litter.
     */
    const mound = ellipsoid(scene, `shirt-mound-${offsetProgress}`, { x: 10, y: 4.6, z: 7.5 }, detailed ? 22 : 12, 10);
    mound.position.copyFrom(position);
    mound.position.y -= 1.2;
    mound.rotation.y = context.at(at).frame.heading + context.random();
    mound.material = materials.get({ materialClass: "FABRIC", color: "#f0e9dc", texture: "mat_fabric_white", tile: 0.5 });
    mound.receiveShadows = true;
    state.meshes.push(mound);
    context.addShadowCaster(mound);
    const count = detailed ? 70 : 30;
    for (let index = 0; index < count; index += 1) {
      const u = context.random() * Math.PI * 2;
      const v = context.random() * 0.4 + 0.04;
      const local = new Vector3(Math.cos(u) * Math.sin(v * Math.PI) * 10, Math.cos(v * Math.PI) * 4.6, Math.sin(u) * Math.sin(v * Math.PI) * 7.5);
      const shirt = shirtSource.createInstance(`mountain-shirt-${offsetProgress}-${index}`);
      shirt.position.copyFrom(mound.position.add(local.scale(0.97)));
      // Lying on the slope: tilted with the surface, turned at random.
      shirt.rotation.set(Math.sin(u) * v * 1.4 + (context.random() - 0.5) * 0.4, context.random() * Math.PI * 2, -Math.cos(u) * v * 1.4 + (context.random() - 0.5) * 0.4);
      shirt.scaling.set(1.7 + context.random() * 0.7, 2.6, 1.7 + context.random() * 0.7);
      tint(shirt, SHIRT_COLOURS[index % SHIRT_COLOURS.length]!, 0.85 + context.random() * 0.3);
      shirt.isPickable = false;
      shirt.freezeWorldMatrix();
    }
  }

  // Steam off the floor where the press hall is warmest.
  for (const offsetProgress of [0.3, 0.62]) {
    const at = range.from + span * offsetProgress;
    const node = context.at(at).node;
    const position = context.beside(at, (node.width * 0.5 + TerrainConfig.vergeMetres + 2) * (offsetProgress > 0.5 ? -1 : 1), 1.6);
    const steam = particles(context, state, `press-steam-${offsetProgress}`, 40, position);
    if (!steam) continue;
    steam.minEmitBox = new Vector3(-1.5, 0, -1.5);
    steam.maxEmitBox = new Vector3(1.5, 0.4, 1.5);
    steam.color1 = new Color4(1, 1, 1, 0.22);
    steam.color2 = new Color4(0.95, 0.92, 1, 0.12);
    steam.colorDead = new Color4(1, 1, 1, 0);
    steam.minSize = 1.2;
    steam.maxSize = 3.2;
    steam.minLifeTime = 2.2;
    steam.maxLifeTime = 4;
    steam.emitRate = 9;
    steam.direction1 = new Vector3(-0.3, 1, -0.3);
    steam.direction2 = new Vector3(0.3, 1.4, 0.3);
    steam.minEmitPower = 0.6;
    steam.maxEmitPower = 1.4;
    steam.gravity = new Vector3(0, 0.4, 0);
    steam.start();
  }
}

// ---------------------------------------------------------------------------------- SECADO

function buildDryer(context: DressingContext, state: SetState, landmarks: Dressing["landmarks"]): void {
  const { scene, materials, detailed, nodes } = context;
  const indices = sectorNodes(nodes, 4);
  if (indices.length < 20) return;
  const range = context.sectorRange(4);
  // The tunnel covers the middle of the sector: open at both ends so the entry reads as a mouth.
  const start = indices[Math.floor(indices.length * 0.08)]!;
  const end = indices[Math.floor(indices.length * 0.86)]!;
  const shell = materials.get({ materialClass: "PAINTED_METAL", color: "#6a7186", texture: "mat_cladding_factory", tile: 5 });
  const dark = materials.get({ materialClass: "PAINTED_METAL", color: "#3a3d4c", tile: 2 });
  const heater = materials.get({ materialClass: "NEON", color: "#ff7a2e", emissive: 0.85 });

  /**
   * The housing: a profile swept along the road, over it, with the sides open above kart height so the
   * player sees the belts and the heaters as they pass. Built directly here rather than through the
   * barrier's sweep because the profile has to reach across the road, whose width changes.
   */
  const positions: number[] = [];
  const uvs: number[] = [];
  const indexList: number[] = [];
  const profile = (half: number): Array<[number, number]> => [
    [half + 1.4, 3.4],
    [half + 1.4, 8.4],
    [half + 0.6, 9.4],
    [-(half + 0.6), 9.4],
    [-(half + 1.4), 8.4],
    [-(half + 1.4), 3.4],
  ];
  const stride = 6;
  let ring = 0;
  for (let index = start; index <= end; index += 1) {
    const node = nodes[index]!;
    const frame = frameAt(nodes, index);
    for (const [offset, height] of profile(node.width * 0.5 + TerrainConfig.vergeMetres)) {
      positions.push(node.x + frame.nx * offset, node.y + height, node.z + frame.nz * offset);
      uvs.push(node.distance / 3, height / 3);
    }
    ring += 1;
  }
  for (let r = 0; r < ring - 1; r += 1) {
    for (let point = 0; point < stride - 1; point += 1) {
      const a = r * stride + point;
      const b = a + 1;
      const c = (r + 1) * stride + point;
      const d = c + 1;
      indexList.push(a, c, b, b, c, d);
    }
  }
  const housing = new Mesh("dryer-housing", scene);
  const data = new VertexData();
  data.positions = positions;
  data.indices = indexList;
  data.uvs = uvs;
  const normals: number[] = [];
  VertexData.ComputeNormals(positions, indexList, normals);
  data.normals = normals;
  data.applyToMesh(housing);
  /**
   * Seen from inside and outside, so one winding with culling off and two-sided lighting. Duplicating
   * the triangles with both windings was the first attempt, and it rendered black: the averaged
   * normals of two opposed faces sharing vertices cancel to zero.
   */
  const housingMaterial = shell.clone("dryer-housing-material");
  housingMaterial.backFaceCulling = false;
  housingMaterial.twoSidedLighting = true;
  housing.material = housingMaterial;
  housing.onDisposeObservable.add(() => housingMaterial.dispose());
  housing.isPickable = false;
  housing.receiveShadows = true;
  state.meshes.push(housing);

  // Portal ribs every twelve metres, heaters between them, a fan on every other rib.
  const ribParts: Mesh[] = [];
  const fanSource = (() => {
    const hubMesh = revolve(scene, "dryer-fan-hub", [new Vector2(0.001, -0.2), new Vector2(0.5, -0.2), new Vector2(0.5, 0.2), new Vector2(0.001, 0.2)], 12);
    hubMesh.material = dark;
    const blades: Mesh[] = [hubMesh];
    for (let blade = 0; blade < 4; blade += 1) {
      const b = beveledBox(scene, `dryer-fan-blade-${blade}`, { width: 0.5, height: 0.08, depth: 2.6, bevel: 0.02 });
      b.position.set(Math.sin((blade / 4) * Math.PI * 2) * 1.4, 0, Math.cos((blade / 4) * Math.PI * 2) * 1.4);
      b.rotation.y = (blade / 4) * Math.PI * 2;
      b.rotation.z = 0.5;
      b.material = materials.get({ materialClass: "RAW_METAL", color: "#8f979f" });
      blades.push(b);
    }
    const fan = mergeParts("dryer-fan", blades, true);
    fan.isVisible = false;
    fan.isPickable = false;
    state.meshes.push(fan);
    return fan;
  })();
  const fans: InstancedMesh[] = [];
  const heaterSource = beveledBox(scene, "dryer-heater", { width: 1, height: 0.22, depth: 9.5, bevel: 0.03 });
  heaterSource.material = heater;
  heaterSource.isVisible = false;
  heaterSource.isPickable = false;
  state.meshes.push(heaterSource);
  const heaters: InstancedMesh[] = [];
  let ribIndex = 0;
  for (let index = start; index <= end; index += 5) {
    const node = nodes[index]!;
    const frame = frameAt(nodes, index);
    const half = node.width * 0.5 + TerrainConfig.vergeMetres + 1.6;
    for (const side of [-1, 1] as const) {
      const post = beveledBox(scene, `dryer-rib-post-${index}-${side}`, { width: 0.7, height: 9.8, depth: 0.9, bevel: 0.05 });
      post.position.set(node.x + frame.nx * side * half, node.y + 4.9, node.z + frame.nz * side * half);
      post.rotation.y = frame.heading;
      post.material = dark;
      ribParts.push(post);
    }
    const lintel = beveledBox(scene, `dryer-rib-lintel-${index}`, { width: half * 2 + 0.7, height: 0.9, depth: 0.9, bevel: 0.05 });
    lintel.position.set(node.x, node.y + 9.9, node.z);
    lintel.rotation.y = frame.heading;
    lintel.material = dark;
    ribParts.push(lintel);
    // Heaters under the roof, across the road, in pairs.
    if (index + 2 <= end) {
      for (const lateral of [-node.width * 0.28, node.width * 0.28]) {
        const h = heaterSource.createInstance(`dryer-heater-${index}-${lateral}`);
        h.position.set(node.x + frame.nx * lateral, node.y + 9.1, node.z + frame.nz * lateral);
        h.rotation.y = frame.heading;
        h.isPickable = false;
        heaters.push(h);
      }
    }
    if (ribIndex % 2 === 0 && detailed) {
      const fan = fanSource.createInstance(`dryer-fan-${index}`);
      fan.position.set(node.x, node.y + 10.6, node.z);
      fan.isPickable = false;
      fans.push(fan);
      // A stack above the fan to the ceiling.
      const stack = revolve(scene, `dryer-stack-${index}`, [new Vector2(1.7, 0), new Vector2(1.7, context.hall.ceilingY - node.y - 10.6)], 12, { capStart: false, capEnd: false });
      stack.position.set(node.x, node.y + 10.6, node.z);
      stack.material = shell;
      ribParts.push(stack);
    }
    ribIndex += 1;
  }
  const ribs = mergeParts("dryer-ribs", ribParts, true);
  ribs.isPickable = false;
  ribs.receiveShadows = true;
  state.meshes.push(ribs);

  // The conveyor inside the tunnel: a belt along the left wall carrying shirts that move.
  const beltPath: Vector3[] = [];
  const beltLateral = (node: TrackNode): number => node.width * 0.5 + TerrainConfig.vergeMetres - 0.2;
  for (let index = start; index <= end; index += 2) {
    const node = nodes[index]!;
    const frame = frameAt(nodes, index);
    const lateral = beltLateral(node);
    beltPath.push(new Vector3(node.x + frame.nx * lateral, node.y + 3.9, node.z + frame.nz * lateral));
  }
  if (beltPath.length >= 2) {
    const belt = tube(scene, "dryer-belt", beltPath, 0.5, 8);
    belt.scaling.y = 0.18;
    belt.material = materials.get({ materialClass: "RUBBER", color: "#1c1c22", texture: "mat_rubber_default", tile: 0.6 });
    belt.isPickable = false;
    state.meshes.push(belt);
    const rollerSource = revolve(scene, "dryer-roller", [new Vector2(0.28, -1.1), new Vector2(0.28, 1.1)], 10, { capStart: true, capEnd: true });
    rollerSource.material = materials.get({ materialClass: "RAW_METAL", color: "#8f979f" });
    rollerSource.isVisible = false;
    state.meshes.push(rollerSource);
    const shirtSource = foldedShirtSource(context, "belt-shirt");
    state.meshes.push(shirtSource);
    const shirtCount = detailed ? 22 : 10;
    const riders: Array<{ mesh: InstancedMesh; offset: number }> = [];
    const total = end - start;
    for (let index = 0; index < shirtCount; index += 1) {
      const shirt = shirtSource.createInstance(`belt-shirt-${index}`);
      shirt.scaling.setAll(2.4);
      tint(shirt, SHIRT_COLOURS[index % SHIRT_COLOURS.length]!);
      shirt.isPickable = false;
      riders.push({ mesh: shirt, offset: (index / shirtCount) * total });
    }
    const placeRider = (rider: { mesh: InstancedMesh; offset: number }): void => {
      const along = ((rider.offset % total) + total) % total;
      const index = start + Math.floor(along);
      const fraction = along - Math.floor(along);
      const node = nodes[Math.min(end, index)]!;
      const next = nodes[Math.min(end, index + 1)]!;
      const frame = frameAt(nodes, Math.min(end, index));
      const lateral = beltLateral(node);
      rider.mesh.position.set(
        node.x + (next.x - node.x) * fraction + frame.nx * lateral,
        node.y + (next.y - node.y) * fraction + 4.05,
        node.z + (next.z - node.z) * fraction + frame.nz * lateral,
      );
      rider.mesh.rotation.y = frame.heading;
    };
    riders.forEach(placeRider);
    context.animators.push((dt) => {
      for (const rider of riders) {
        // Two metres a second down the belt, wrapping back to the start out of sight.
        rider.offset += dt * 0.8;
        placeRider(rider);
      }
      for (const fan of fans) fan.rotation.y += dt * 4.2;
    });
  }

  // Heaters breathe; the glow at the far end pulses.
  context.animators.push((_dt, nowMs) => {
    const pulse = 0.82 + Math.sin(nowMs * 0.0016) * 0.18;
    for (let index = 0; index < heaters.length; index += 1) {
      heaters[index]!.scaling.y = pulse + (index % 3) * 0.06;
    }
  });

  // Heat shimmer at the tunnel mouth.
  const exitNode = nodes[end]!;
  const shimmer = particles(context, state, "dryer-heat", 40, new Vector3(exitNode.x, exitNode.y + 3, exitNode.z));
  if (shimmer) {
    shimmer.minEmitBox = new Vector3(-6, 0, -2);
    shimmer.maxEmitBox = new Vector3(6, 2, 2);
    shimmer.color1 = new Color4(1, 0.6, 0.3, 0.16);
    shimmer.color2 = new Color4(1, 0.45, 0.2, 0.1);
    shimmer.colorDead = new Color4(1, 0.5, 0.2, 0);
    shimmer.minSize = 2;
    shimmer.maxSize = 5;
    shimmer.minLifeTime = 1.5;
    shimmer.maxLifeTime = 3;
    shimmer.emitRate = 10;
    shimmer.blendMode = ParticleSystem.BLENDMODE_ADD;
    shimmer.direction1 = new Vector3(-0.2, 1, -0.2);
    shimmer.direction2 = new Vector3(0.2, 1.6, 0.2);
    shimmer.minEmitPower = 0.8;
    shimmer.maxEmitPower = 1.6;
    shimmer.gravity = new Vector3(0, 0.8, 0);
    shimmer.start();
  }
  // Orange light inside the tunnel.
  if (context.quality !== "LOW") {
    const midNode = nodes[Math.floor((start + end) / 2)]!;
    const glow = new PointLight("dryer-glow", new Vector3(midNode.x, midNode.y + 6, midNode.z), scene);
    glow.diffuse = Color3.FromHexString("#ff7a2e");
    glow.intensity = 700;
    glow.range = 90;
    state.lights.push(glow);
  }
  const span = range.to - range.from;
  landmarks.push({ label: "SECADOR", position: new Vector3(nodes[start]!.x, nodes[start]!.y, nodes[start]!.z), progress: range.from + span * 0.1 });
}

// ---------------------------------------------------------------------------------- CONTROL

function buildControl(context: DressingContext, state: SetState, landmarks: Dressing["landmarks"]): void {
  const { scene, materials, detailed } = context;
  const range = context.sectorRange(5);
  const span = range.to - range.from;
  const steel = materials.get({ materialClass: "RAW_METAL", color: "#9fa6ad", texture: "mat_rawmetal_default", tile: 1 });
  const shirtSource = foldedShirtSource(context, "stack-shirt");
  state.meshes.push(shirtSource);
  const cartonSource = beveledBox(scene, "control-carton", { width: 1.6, height: 1.3, depth: 1.5, bevel: 0.04, uScale: 1.6, vScale: 1.3 });
  cartonSource.material = materials.get({ materialClass: "CARDBOARD", color: "#ffffff", texture: "mat_cardboard_default", tile: 0.9 });
  cartonSource.isVisible = false;
  cartonSource.isPickable = false;
  cartonSource.registerInstancedBuffer("color", 4);
  state.meshes.push(cartonSource);

  // Inspection tables with stacks of folded shirts, on the outside of the closing corners.
  const tableCount = detailed ? 5 : 3;
  for (let table = 0; table < tableCount; table += 1) {
    const at = range.from + span * (0.12 + (table / tableCount) * 0.62);
    const side = table % 2 === 0 ? 1 : -1;
    const node = context.at(at).node;
    const position = context.beside(at, side * (node.width * 0.5 + TerrainConfig.vergeMetres + 5.5));
    const holder = new TransformNode(`control-table-${table}`, scene);
    holder.position.copyFrom(position);
    holder.rotation.y = context.at(at).frame.heading;
    state.nodes.push(holder);
    const parts: Mesh[] = [];
    const top = beveledBox(scene, `control-top-${table}`, { width: 9, height: 0.4, depth: 3.6, bevel: 0.06, uScale: 4, vScale: 1 });
    top.position.y = 2.2;
    top.material = materials.get({ materialClass: "WOOD", color: "#c9a074", tile: 2 });
    parts.push(top);
    for (const dx of [-4, 4]) {
      for (const dz of [-1.4, 1.4]) {
        const leg = tube(scene, `control-leg-${table}-${dx}-${dz}`, [new Vector3(dx, 0, dz), new Vector3(dx, 2, dz)], 0.12, 6);
        leg.material = steel;
        parts.push(leg);
      }
    }
    const lamp = tube(scene, `control-lamp-arm-${table}`, [new Vector3(-4.2, 2.4, -1.5), new Vector3(-4.2, 4.8, -1.5), new Vector3(-1, 4.9, -0.6)], 0.07, 6);
    lamp.material = steel;
    parts.push(lamp);
    const shade = revolve(scene, `control-lamp-shade-${table}`, [new Vector2(0.05, 0), new Vector2(0.7, -0.6), new Vector2(0.72, -0.62)], 12, { capStart: false, capEnd: false });
    shade.position.set(-1, 4.9, -0.6);
    shade.material = materials.get({ materialClass: "PAINTED_METAL", color: "#ffd43b" });
    parts.push(shade);
    const tableMesh = mergeParts(`control-table-mesh-${table}`, parts, true);
    tableMesh.parent = holder;
    tableMesh.receiveShadows = true;
    state.meshes.push(tableMesh);
    // Stacks: five shirts per pile, three piles per table, colour-sorted like a real QC bench.
    for (let pile = 0; pile < 3; pile += 1) {
      const colour = SHIRT_COLOURS[(table * 3 + pile) % SHIRT_COLOURS.length]!;
      const height = 3 + ((table + pile) % 3);
      for (let layer = 0; layer < height; layer += 1) {
        const shirt = shirtSource.createInstance(`stack-${table}-${pile}-${layer}`);
        shirt.parent = holder;
        shirt.position.set(-2.8 + pile * 2.8, 2.5 + layer * 0.34, 0);
        shirt.rotation.y = (context.random() - 0.5) * 0.25;
        shirt.scaling.setAll(2);
        tint(shirt, colour, 0.9 + (layer % 2) * 0.08);
        shirt.isPickable = false;
      }
    }
  }

  // Cartons stacked and palletised toward the finish, plus a roll cage or two.
  const cartonCount = detailed ? 54 : 26;
  for (let index = 0; index < cartonCount; index += 1) {
    const at = range.from + span * (0.55 + context.random() * 0.4);
    const side = context.random() > 0.5 ? 1 : -1;
    const node = context.at(at).node;
    const position = context.beside(at, side * (node.width * 0.5 + TerrainConfig.vergeMetres + 3 + context.random() * 6));
    const stackHeight = 1 + Math.floor(context.random() * 3);
    for (let layer = 0; layer < stackHeight; layer += 1) {
      const carton = cartonSource.createInstance(`control-carton-${index}-${layer}`);
      carton.position.set(position.x, position.y + 0.65 + layer * 1.3, position.z);
      carton.rotation.y = context.at(at).frame.heading + (context.random() - 0.5) * 0.3;
      carton.scaling.setAll(0.9 + context.random() * 0.35);
      tint(carton, "#ffffff", 0.86 + context.random() * 0.24);
      carton.isPickable = false;
      carton.freezeWorldMatrix();
    }
  }
  for (let cage = 0; cage < (detailed ? 3 : 1); cage += 1) {
    const at = range.from + span * (0.3 + cage * 0.22);
    const node = context.at(at).node;
    const position = context.beside(at, -(node.width * 0.5 + TerrainConfig.vergeMetres + 4));
    const holder = new TransformNode(`roll-cage-${cage}`, scene);
    holder.position.copyFrom(position);
    holder.rotation.y = context.at(at).frame.heading;
    state.nodes.push(holder);
    const parts: Mesh[] = [];
    for (const dx of [-1.2, 1.2]) {
      for (const dz of [-0.9, 0.9]) {
        const post = tube(scene, `cage-post-${cage}-${dx}-${dz}`, [new Vector3(dx, 0.2, dz), new Vector3(dx, 3.4, dz)], 0.05, 5);
        post.material = steel;
        parts.push(post);
      }
    }
    for (let rail = 0; rail < 5; rail += 1) {
      const y = 0.5 + rail * 0.7;
      for (const dz of [-0.9, 0.9]) {
        const bar = tube(scene, `cage-bar-${cage}-${rail}-${dz}`, [new Vector3(-1.2, y, dz), new Vector3(1.2, y, dz)], 0.03, 4);
        bar.material = steel;
        parts.push(bar);
      }
    }
    const cageMesh = mergeParts(`roll-cage-mesh-${cage}`, parts, true);
    cageMesh.parent = holder;
    state.meshes.push(cageMesh);
    for (let layer = 0; layer < 6; layer += 1) {
      const shirt = shirtSource.createInstance(`cage-shirt-${cage}-${layer}`);
      shirt.parent = holder;
      shirt.position.set(0, 0.5 + layer * 0.36, 0);
      shirt.scaling.setAll(2.1);
      tint(shirt, SHIRT_COLOURS[(cage + layer) % SHIRT_COLOURS.length]!);
      shirt.isPickable = false;
    }
  }

  // The control board, lit, on the wall behind the finish approach.
  /**
   * A banner hung from the ceiling over the inspection tables, turned across the road so it is read
   * from the racing line. It was on the hall wall first, and the wall nearest this sector is the one
   * behind the finish gantry — so it appeared through the gantry as a second finish board.
   */
  const boardAt = range.from + span * 0.4;
  const boardNode = context.at(boardAt).node;
  const boardSide = 1;
  const boardPos = context.beside(boardAt, boardSide * (boardNode.width * 0.5 + TerrainConfig.vergeMetres + 6), 11);
  const boardMesh = createBoard(
    scene,
    "control-board",
    { width: 18, height: 3.8, depth: 0.4 },
    state.painter.material("CONTROL DE CALIDAD", { width: 1024, height: 220, plate: "#1c1b24", ink: "#f7f2e8", accent: "#b9ff45", caption: "ZONA 5", glow: 0.45 }),
    materials.get({ materialClass: "PLASTIC", color: "#1c1b24" }),
    { doubleSided: true },
  );
  boardMesh.position.copyFrom(boardPos);
  boardMesh.rotation.y = context.at(boardAt).frame.heading;
  state.meshes.push(boardMesh);
  for (const dx of [-8, 8]) {
    const cable = tube(scene, `control-board-cable-${dx}`, [new Vector3(dx, 1.9, 0), new Vector3(dx, context.hall.ceilingY - boardPos.y, 0)], 0.04, 5);
    cable.parent = boardMesh;
    cable.material = steel;
    state.meshes.push(cable);
  }
  landmarks.push({ label: "CONTROL", position: context.beside(boardAt, 0), progress: boardAt });
}

// ---------------------------------------------------------------------------------- HAZARDS

/**
 * Hazards that belong to the process. A press station over the lane whose head slams down; a floor
 * vent that blows steam. Both are timed by the same phase the runtime uses to decide when a hazard
 * hits, so what the player sees is what the physics does.
 */
function makeHazardBuilder(context: DressingContext, state: SetState): NonNullable<Dressing["buildHazard"]> {
  return (kind, holder, placement, lane) => {
    const { scene, materials } = context;
    const steel = materials.get({ materialClass: "PAINTED_METAL", color: "#3a3f49", texture: "mat_paintedmetal_press", tile: 2 });
    const phase = placement.node.progress * 11;
    if (kind === "PRESS") {
      const width = placement.node.width;
      const parts: Mesh[] = [];
      for (const side of [-1, 1] as const) {
        const post = beveledBox(scene, `press-post-${side}`, { width: 0.7, height: 7.4, depth: 0.7, bevel: 0.05 });
        post.position.set(side * (width * 0.5 + TerrainConfig.vergeMetres + 0.5) - lane, 3.7, 0);
        post.material = steel;
        parts.push(post);
      }
      const beam = beveledBox(scene, "press-beam", { width: width + TerrainConfig.vergeMetres * 2 + 1.8, height: 1, depth: 1.2, bevel: 0.06 });
      beam.position.set(-lane, 7.4, 0);
      beam.material = steel;
      parts.push(beam);
      const frame = mergeParts("press-frame", parts, true);
      frame.parent = holder;
      state.meshes.push(frame);
      const band = beveledBox(scene, "press-band", { width: width + TerrainConfig.vergeMetres * 2 + 1.8, height: 0.32, depth: 1.25, bevel: 0.02 });
      band.position.set(-lane, 6.6, 0);
      band.parent = holder;
      band.material = materials.get({ materialClass: "PAINTED_METAL", color: "#ffd43b", texture: "mat_safety_yellow", tile: 1.2 });
      state.meshes.push(band);
      const ram = new TransformNode("press-ram", scene);
      ram.parent = holder;
      const piston = tube(scene, "press-piston", [new Vector3(0, 6.9, 0), new Vector3(0, 2.4, 0)], 0.42, 9);
      piston.parent = ram;
      piston.material = materials.get({ materialClass: "RAW_METAL", color: "#b6bcc4", texture: "mat_rawmetal_default", tile: 1 });
      state.meshes.push(piston);
      const head = beveledBox(scene, "press-head", { width: 3.6, height: 1.2, depth: 3.6, bevel: 0.1 });
      head.position.y = 1.8;
      head.parent = ram;
      head.material = steel;
      state.meshes.push(head);
      const plate = beveledBox(scene, "press-plate", { width: 3.3, height: 0.2, depth: 3.3, bevel: 0.04 });
      plate.position.y = 1.15;
      plate.parent = ram;
      plate.material = materials.get({ materialClass: "INK", color: "#ff3da6", texture: "mat_ink_magenta", tile: 1.2 });
      state.meshes.push(plate);
      const warn = ellipsoid(scene, "press-warn", { x: 0.3, y: 0.3, z: 0.3 }, 8, 5);
      warn.position.set(-lane, 8.2, 0);
      warn.parent = holder;
      warn.material = materials.get({ materialClass: "NEON", color: "#ff3020", emissive: 1 });
      state.meshes.push(warn);
      context.animators.push((_dt, _nowMs, elapsedMs) => {
        const wave = Math.sin(elapsedMs * 0.0017 + phase);
        // Down when the runtime says active (wave > 0.6), eased hard so the slam reads as a slam.
        const down = Math.max(0, Math.min(1, (wave - 0.35) / 0.35));
        ram.position.y = -down * down * 1.05;
        warn.scaling.setAll(wave > 0.3 ? 1.6 : 1);
      });
      return true;
    }
    if (kind === "STEAM") {
      const grate = beveledBox(scene, "steam-grate", { width: 3.2, height: 0.18, depth: 3.2, bevel: 0.03 });
      grate.position.y = 0.05;
      grate.parent = holder;
      grate.material = materials.get({ materialClass: "RAW_METAL", color: "#5d636b", texture: "mat_rawmetal_default", tile: 0.6 });
      state.meshes.push(grate);
      const ringMesh = revolve(scene, "steam-ring", [new Vector2(1.9, 0.02), new Vector2(2.4, 0.02), new Vector2(2.4, 0.05), new Vector2(1.9, 0.05)], 20, { capStart: false, capEnd: false });
      ringMesh.parent = holder;
      ringMesh.material = materials.get({ materialClass: "PAINTED_METAL", color: "#ffd43b", texture: "mat_safety_yellow", tile: 0.8 });
      state.meshes.push(ringMesh);
      const jet = particles(context, state, "steam-jet", 60, holder.position.add(new Vector3(0, 0.3, 0)));
      if (jet) {
        jet.minEmitBox = new Vector3(-1.2, 0, -1.2);
        jet.maxEmitBox = new Vector3(1.2, 0.2, 1.2);
        jet.color1 = new Color4(1, 1, 1, 0.55);
        jet.color2 = new Color4(0.9, 0.9, 1, 0.35);
        jet.colorDead = new Color4(1, 1, 1, 0);
        jet.minSize = 1.2;
        jet.maxSize = 3.4;
        jet.minLifeTime = 0.8;
        jet.maxLifeTime = 1.6;
        jet.emitRate = 0;
        jet.direction1 = new Vector3(-0.4, 3, -0.4);
        jet.direction2 = new Vector3(0.4, 4.5, 0.4);
        jet.minEmitPower = 2;
        jet.maxEmitPower = 4;
        jet.gravity = new Vector3(0, 1, 0);
        jet.start();
        context.animators.push((_dt, _nowMs, elapsedMs) => {
          const active = Math.sin(elapsedMs * 0.0017 + phase) > 0.6;
          jet.emitRate = active ? 70 : 2;
        });
      }
      return true;
    }
    return false;
  };
}

// ---------------------------------------------------------------------------------- entry

export function buildPrintFactorySet(context: DressingContext): Dressing {
  const state: SetState = {
    meshes: [],
    nodes: [],
    particles: [],
    lights: [],
    painter: new SignPainter(context.scene),
    sprite: context.quality === "LOW" ? null : createSoftSprite(context.scene),
  };
  const landmarks: Dressing["landmarks"] = [];

  buildDesignStudio(context, state, landmarks);
  buildScreenHall(context, state, landmarks);
  buildInkHall(context, state, landmarks);
  buildDryer(context, state, landmarks);
  buildControl(context, state, landmarks);

  return {
    landmarksHandled: true,
    landmarks,
    buildHazard: makeHazardBuilder(context, state),
    dispose: () => {
      for (const system of state.particles) system.dispose();
      for (const light of state.lights) light.dispose();
      for (const mesh of state.meshes) mesh.dispose();
      for (const node of state.nodes) node.dispose();
      state.sprite?.dispose();
      state.painter.dispose();
    },
  };
}
