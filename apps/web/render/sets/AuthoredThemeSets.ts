import {
  Mesh,
  PointLight,
  TransformNode,
  Vector2,
  Vector3,
  type Scene,
} from "@babylonjs/core";
import { TerrainConfig } from "@print-rush/game-core";
import { buildHero, type HeroKind } from "../HeroAssets";
import { beveledBox, ellipsoid, mergeParts, revolve, tube } from "../Geometry";
import { createBoard, SignPainter } from "../Signage";
import type { MaterialLibrary } from "../MaterialLibrary";
import { createThemeHazardBuilder } from "./ThemeHazards";
import type { Dressing, DressingContext } from "./types";

type AuthoredTheme = "FLAGSHIP" | "WAREHOUSE" | "OFFICE" | "MANGA";
type SignatureKind = HeroKind | "STAIRCASE" | "BOOTHS" | "DOCK" | "BRIDGE" | "CONVEYOR" | "RECEPTION" | "KEYBOARD" | "MEETING" | "PORTAL" | "ARTIST_ALLEY" | "CUP";

type ThemeRecipe = {
  theme: AuthoredTheme;
  plate: string;
  structure: string;
  floor: string;
  ink: string;
  accents: readonly string[];
  pieces: readonly SignatureKind[];
};

type State = {
  meshes: Mesh[];
  nodes: TransformNode[];
  lights: PointLight[];
  painter: SignPainter;
};

const RECIPES: Record<AuthoredTheme, ThemeRecipe> = {
  FLAGSHIP: {
    theme: "FLAGSHIP",
    plate: "#25212b",
    structure: "#6f5541",
    floor: "#302733",
    ink: "#fff8ef",
    accents: ["#ff3da6", "#65d8ff", "#b9ff45", "#ffb347"],
    pieces: ["PORTAL", "SHIRT_WALL", "STAIRCASE", "BOOTHS", "PALLET_TOWER", "CASH_REGISTER"],
  },
  WAREHOUSE: {
    theme: "WAREHOUSE",
    plate: "#182430",
    structure: "#44515e",
    floor: "#29323a",
    ink: "#f4f7fa",
    accents: ["#ffc02e", "#6bb8ef", "#ff713d", "#9fe870"],
    pieces: ["DOCK", "PALLET_TOWER", "LOGISTICS_ROBOT", "BRIDGE", "CONVEYOR", "DOCK", "PORTAL"],
  },
  OFFICE: {
    theme: "OFFICE",
    plate: "#28313a",
    structure: "#715a46",
    floor: "#2e343a",
    ink: "#fff8ee",
    accents: ["#ff8f4c", "#65d8ff", "#a8d85f", "#f05fa8"],
    pieces: ["RECEPTION", "GIANT_MONITOR", "KEYBOARD", "CUP", "MEETING", "COFFEE_MACHINE"],
  },
  MANGA: {
    theme: "MANGA",
    plate: "#19152c",
    structure: "#3c2869",
    floor: "#241d42",
    ink: "#fff9ff",
    accents: ["#cf57ff", "#45e2ff", "#ff4fa7", "#ffe24b"],
    pieces: ["PORTAL", "ARTIST_ALLEY", "GIANT_MONITOR", "BRIDGE", "ARCADE_BANK", "STAGE", "SHIRT_WALL"],
  },
};

/**
 * Shared authoring grammar, distinct worlds.
 *
 * Every landmark gets a dark architectural backing, a readable name, a unique signature object and
 * one practical light. The backing is important: the old heroes were small bright shapes against an
 * equally bright kilometre-wide hall, so their silhouette disappeared even though the meshes were
 * present. These frames make each part of the lap a room and keep the accent share below the scene's
 * neutral surfaces.
 */
function buildThemeSet(context: DressingContext, recipe: ThemeRecipe): Dressing {
  const state: State = {
    meshes: [],
    nodes: [],
    lights: [],
    painter: new SignPainter(context.scene),
  };
  const landmarks: Dressing["landmarks"] = [];
  const features = context.baked.blueprint.features.filter((feature) => feature.kind === "LANDMARK");

  features.forEach((feature, index) => {
    if (feature.kind !== "LANDMARK") return;
    const placement = context.at(feature.progress);
    const offset = placement.node.width * 0.5 + TerrainConfig.vergeMetres + (recipe.theme === "MANGA" ? 9 : 8);
    const holder = new TransformNode(`set-${recipe.theme.toLowerCase()}-${index}-${feature.label}`, context.scene);
    holder.position.copyFrom(context.beside(feature.progress, offset * feature.side));
    holder.rotation.y = placement.frame.heading + (feature.side > 0 ? Math.PI * 0.5 : -Math.PI * 0.5);
    state.nodes.push(holder);

    const accent = recipe.accents[index % recipe.accents.length]!;
    buildZoneGateway(context, state, feature.progress, recipe, accent, index);
    buildLandmarkFrame(context, state, holder, feature.label, recipe, accent, index);
    const signature = buildSignature(
      context.scene,
      context.materials,
      recipe.pieces[index % recipe.pieces.length]!,
      `set-${recipe.theme.toLowerCase()}-signature-${index}`,
      context,
      accent,
    );
    signature.parent = holder;
    signature.position.z = 0.1;
    const scale = recipe.theme === "MANGA" ? 1.38 : recipe.theme === "WAREHOUSE" ? 1.3 : 1.22;
    signature.scaling.setAll(scale);
    state.nodes.push(signature);
    signature.getChildMeshes(false).forEach((mesh) => {
      if (mesh instanceof Mesh) context.addShadowCaster(mesh);
    });
    if (signature instanceof Mesh) context.addShadowCaster(signature);

    // Keep three practical pools at most. A light per landmark made the set more expensive without
    // improving the driver's read; emissive beacons carry the colour on the remaining zones.
    const lightSlots = new Set([0, Math.floor(features.length / 2), features.length - 1]);
    if (context.quality !== "LOW" && lightSlots.has(index)) {
      const lamp = new PointLight(`set-${recipe.theme.toLowerCase()}-light-${index}`, new Vector3(0, 8.5, 3), context.scene);
      lamp.parent = holder;
      lamp.diffuse.set(...hexChannels(accent));
      lamp.intensity = index === 0 ? 9 : 7;
      lamp.range = 24;
      state.lights.push(lamp);
    }

    const beacon = ellipsoid(context.scene, `set-${recipe.theme.toLowerCase()}-beacon-${index}`, { x: 0.34, y: 0.2, z: 0.34 }, 10, 5);
    beacon.parent = holder;
    beacon.position.set(index % 2 === 0 ? -11 : 11, 15.6, 1.2);
    beacon.material = context.materials.get({ materialClass: "NEON", color: accent, emissive: 1 });
    state.meshes.push(beacon);
    context.animators.push((_dt, nowMs) => {
      const pulse = 0.82 + Math.sin(nowMs * 0.003 + index * 0.9) * 0.18;
      beacon.scaling.setAll(pulse);
    });

    landmarks.push({ label: feature.label, position: holder.position.clone(), progress: feature.progress });
  });

  buildFlowMarkers(context, state, recipe);
  buildMidgroundRhythm(context, state, recipe);
  buildFarWorld(context, state, recipe);

  return {
    landmarksHandled: true,
    landmarks,
    buildHazard: createThemeHazardBuilder(context, recipe.theme, state),
    dispose: () => {
      for (const light of state.lights) light.dispose();
      for (const mesh of state.meshes) mesh.dispose();
      for (const node of state.nodes) node.dispose();
      state.painter.dispose();
    },
  };
}

/**
 * A full-width threshold before each authored room.
 *
 * Side landmarks alone disappear in a fast forward view. These gates sit outside the physical
 * barrier and put a strong horizontal beat over the route, so a driver reads an upcoming zone from
 * its silhouette well before the label is legible. Six two-material gates are substantially cheaper
 * than filling the hall with more small props.
 */
function buildZoneGateway(
  context: DressingContext,
  state: State,
  progress: number,
  recipe: ThemeRecipe,
  accent: string,
  index: number,
): void {
  const gateProgress = (progress - 0.018 + 1) % 1;
  const placement = context.at(gateProgress);
  const holder = new TransformNode(`set-${recipe.theme.toLowerCase()}-gateway-${index}`, context.scene);
  holder.position.copyFrom(context.beside(gateProgress, 0, 0));
  holder.rotation.y = placement.frame.heading;
  state.nodes.push(holder);

  const span = placement.node.width + TerrainConfig.vergeMetres * 2 + 3.2;
  const height = recipe.theme === "OFFICE" ? 10.2 : recipe.theme === "MANGA" ? 13.2 : 11.8;
  const structure = context.materials.get({ materialClass: "PAINTED_METAL", color: recipe.plate, tile: 1.4 });
  const parts: Mesh[] = [];
  for (const side of [-1, 1] as const) {
    const post = beveledBox(context.scene, `set-gateway-post-${index}-${side}`, {
      width: recipe.theme === "WAREHOUSE" ? 0.95 : 0.64,
      height,
      depth: recipe.theme === "MANGA" ? 0.65 : 0.9,
      bevel: 0.14,
    });
    post.position.set(side * span * 0.5, height * 0.5, 0);
    post.rotation.z = recipe.theme === "FLAGSHIP" ? -side * 0.055 : recipe.theme === "MANGA" ? side * 0.04 : 0;
    post.material = structure;
    parts.push(post);
  }
  const crown = beveledBox(context.scene, `set-gateway-crown-${index}`, {
    width: span + 1.3,
    height: recipe.theme === "WAREHOUSE" ? 1.05 : 0.72,
    depth: 1.05,
    bevel: 0.16,
  });
  crown.position.y = height;
  crown.material = structure;
  parts.push(crown);
  const arch = mergeParts(`set-gateway-arch-${recipe.theme.toLowerCase()}-${index}`, parts, false);
  arch.parent = holder;
  state.meshes.push(arch);

  const signal = beveledBox(context.scene, `set-gateway-signal-${index}`, {
    width: span * (recipe.theme === "MANGA" ? 0.7 : 0.46),
    height: 0.2,
    depth: 1.18,
    bevel: 0.06,
  });
  signal.position.y = height - 0.12;
  signal.material = context.materials.get({ materialClass: "NEON", color: accent, emissive: 0.85 });
  signal.parent = holder;
  state.meshes.push(signal);
}

function buildLandmarkFrame(
  context: DressingContext,
  state: State,
  holder: TransformNode,
  label: string,
  recipe: ThemeRecipe,
  accent: string,
  index: number,
): void {
  const { scene, materials } = context;
  const structure = materials.get({ materialClass: "PAINTED_METAL", color: recipe.structure, tile: 2 });
  const plate = materials.get({ materialClass: "PLASTIC", color: recipe.plate, tile: 2 });
  const parts: Mesh[] = [];

  const plinth = beveledBox(scene, `set-plinth-${index}`, { width: 24, height: 0.7, depth: 13, bevel: 0.22 });
  plinth.position.set(0, 0.26, -0.2);
  plinth.material = materials.get({ materialClass: "CONCRETE", color: recipe.floor, tile: 2.4 });
  parts.push(plinth);

  const back = beveledBox(scene, `set-back-${index}`, { width: 24.5, height: 15.2, depth: 0.7, bevel: 0.18 });
  back.position.set(0, 7.8, -5.8);
  back.material = plate;
  parts.push(back);

  for (const side of [-1, 1] as const) {
    const column = beveledBox(scene, `set-column-${index}-${side}`, { width: 0.9, height: 16.4, depth: 1.05, bevel: 0.15 });
    column.position.set(side * 11.6, 8.2, -5.2);
    column.material = structure;
    parts.push(column);
    const fin = beveledBox(scene, `set-fin-${index}-${side}`, { width: 0.38, height: 9.2 + ((index + side + 2) % 3), depth: 3.2, bevel: 0.1 });
    fin.position.set(side * 10.2, 7.4, -4.2);
    fin.rotation.z = side * 0.08;
    fin.material = materials.get({ materialClass: "PAINTED_METAL", color: accent, tile: 1.2 });
    parts.push(fin);
  }

  const header = beveledBox(scene, `set-header-${index}`, { width: 24.5, height: 1, depth: 1.45, bevel: 0.2 });
  header.position.set(0, 15.5, -4.8);
  header.material = structure;
  parts.push(header);
  const architecture = mergeParts(`set-frame-${recipe.theme.toLowerCase()}-${index}`, parts, true);
  architecture.parent = holder;
  state.meshes.push(architecture);

  const board = createBoard(
    scene,
    `set-label-${recipe.theme.toLowerCase()}-${index}`,
    { width: 15.8, height: 1.8, depth: 0.32 },
    state.painter.material(label, {
      width: 1024,
      height: 160,
      plate: recipe.plate,
      ink: recipe.ink,
      accent,
      caption: `ZONA ${index + 1}`,
      glow: 0.32,
    }),
    plate,
    { doubleSided: true },
  );
  board.parent = holder;
  board.position.set(0, 14, 1.25);
  state.meshes.push(board);
}

/** Small repeated flow markers close to the track, placed sparsely and instanced by source. */
function buildFlowMarkers(context: DressingContext, state: State, recipe: ThemeRecipe): void {
  const source = beveledBox(context.scene, `set-${recipe.theme.toLowerCase()}-flow-source`, {
    width: 0.26,
    height: 2.8,
    depth: 0.26,
    bevel: 0.06,
  });
  source.material = context.materials.get({ materialClass: "PAINTED_METAL", color: recipe.accents[0]!, tile: 0.7 });
  source.isVisible = false;
  state.meshes.push(source);
  const stride = context.quality === "LOW" ? 115 : context.quality === "MEDIUM" ? 80 : 60;
  for (let metres = stride * 0.5, slot = 0; metres < context.baked.definition.lengthMeters; metres += stride, slot += 1) {
    const progress = metres / context.baked.definition.lengthMeters;
    const placement = context.at(progress);
    const side = slot % 2 === 0 ? 1 : -1;
    const lateral = side * (placement.node.width * 0.5 + TerrainConfig.vergeMetres + 1.25);
    const marker = source.createInstance(`set-${recipe.theme.toLowerCase()}-flow-${slot}`);
    marker.position.copyFrom(context.beside(progress, lateral, 1.4));
    marker.rotation.y = placement.frame.heading;
    marker.scaling.y = 0.72 + (slot % 3) * 0.14;
    marker.isPickable = false;
  }
}

/**
 * Large midground rhythm, not more small clutter.
 *
 * The first authored pass added one hero every 350–450 m and left the space between them to the
 * generic prop scatter. In a hall this large those shelves read as miniatures. One instanced module
 * every ~95 m gives the eye a world-scale beat while keeping one source mesh and a handful of
 * sub-material draws per theme.
 */
function buildMidgroundRhythm(context: DressingContext, state: State, recipe: ThemeRecipe): void {
  const source = buildMidgroundSource(context.scene, context.materials, recipe);
  source.isVisible = false;
  source.isPickable = false;
  state.meshes.push(source);
  const stride = context.quality === "LOW" ? 180 : context.quality === "MEDIUM" ? 140 : 110;
  const length = context.baked.definition.lengthMeters;
  for (let metres = stride * 0.72, slot = 0; metres < length; metres += stride, slot += 1) {
    const progress = metres / length;
    const placement = context.at(progress);
    const side = slot % 2 === 0 ? 1 : -1;
    const distance = placement.node.width * 0.5 + TerrainConfig.vergeMetres + 10 + (slot % 3) * 3.2;
    const setPiece = source.createInstance(`set-${recipe.theme.toLowerCase()}-mid-${slot}`);
    setPiece.position.copyFrom(context.beside(progress, distance * side));
    setPiece.rotation.y = placement.frame.heading + (side > 0 ? Math.PI * 0.5 : -Math.PI * 0.5);
    const scale = 1.12 + (slot % 4) * 0.09;
    setPiece.scaling.set(scale * (slot % 3 === 0 ? 1.12 : 1), scale, scale);
    setPiece.isPickable = false;
  }
}

/**
 * Sparse world-scale silhouettes behind the useful trackside layer.
 *
 * Small props establish texture but cannot make a 700 m hall feel inhabited. These modules sit
 * thirty to fifty metres beyond the barrier, use one subdued material and reach toward the roof.
 * They produce a real far layer without stealing contrast from the road. The source is instanced,
 * and LOW receives roughly a third as many copies as HIGH/ULTRA.
 */
function buildFarWorld(context: DressingContext, state: State, recipe: ThemeRecipe): void {
  const source = buildFarWorldSource(context.scene, context.materials, recipe);
  source.isVisible = false;
  source.isPickable = false;
  state.meshes.push(source);
  const stride = context.quality === "LOW" ? 390 : context.quality === "MEDIUM" ? 285 : 210;
  const length = context.baked.definition.lengthMeters;
  for (let metres = stride * 0.45, slot = 0; metres < length; metres += stride, slot += 1) {
    const progress = metres / length;
    const placement = context.at(progress);
    const side = slot % 2 === 0 ? -1 : 1;
    const distance = placement.node.width * 0.5 + TerrainConfig.vergeMetres + 30 + (slot % 3) * 7;
    const silhouette = source.createInstance(`set-${recipe.theme.toLowerCase()}-far-${slot}`);
    silhouette.position.copyFrom(context.beside(progress, distance * side));
    silhouette.rotation.y = placement.frame.heading + (side > 0 ? Math.PI * 0.5 : -Math.PI * 0.5);
    const scale = 0.92 + (slot % 4) * 0.09;
    silhouette.scaling.set(scale * (slot % 2 === 0 ? 1.12 : 0.94), scale, scale);
    silhouette.isPickable = false;
  }
}

function buildFarWorldSource(scene: Scene, materials: MaterialLibrary, recipe: ThemeRecipe): Mesh {
  const parts: Mesh[] = [];
  const silhouette = materials.get({ materialClass: "PAINTED_METAL", color: recipe.structure, tile: 3 });
  const addBox = (name: string, width: number, height: number, depth: number, x: number, y: number, z: number): void => {
    const part = beveledBox(scene, name, { width, height, depth, bevel: Math.min(0.35, width * 0.04), cornerRadius: 0.12 });
    part.position.set(x, y, z);
    part.material = silhouette;
    parts.push(part);
  };

  if (recipe.theme === "FLAGSHIP") {
    addBox("far-retail-pavilion", 26, 7, 8, 0, 3.5, 0);
    addBox("far-retail-tower-a", 7, 21, 7, -8.5, 10.5, -2);
    addBox("far-retail-tower-b", 9, 15, 6, 7.5, 7.5, -1);
    addBox("far-retail-canopy", 28, 1.2, 9, 0, 16.5, 0);
  } else if (recipe.theme === "WAREHOUSE") {
    for (const x of [-11, 0, 11]) addBox(`far-rack-upright-${x}`, 1.2, 24, 3, x, 12, 0);
    for (const y of [4, 11, 18, 24]) addBox(`far-rack-beam-${y}`, 25, 0.9, 3.4, 0, y, 0);
    addBox("far-rack-load-a", 8, 5, 5, -5.8, 7.2, -1);
    addBox("far-rack-load-b", 8, 7, 5, 5.2, 14.5, -1);
  } else if (recipe.theme === "OFFICE") {
    addBox("far-office-core", 11, 22, 7, 0, 11, -1);
    addBox("far-office-wing-a", 9, 14, 8, -9.5, 7, 0);
    addBox("far-office-wing-b", 8, 17, 6, 9, 8.5, 0);
    addBox("far-office-bridge", 27, 1.1, 4, 0, 13.5, 0);
  } else {
    for (const x of [-11, 11]) addBox(`far-con-tower-${x}`, 1.4, 26, 2.2, x, 13, 0);
    addBox("far-con-header", 24, 1.4, 2.4, 0, 25, 0);
    addBox("far-con-screen", 18, 13, 1.2, 0, 13.5, -1.4);
    addBox("far-con-stage", 28, 2.2, 8, 0, 1.1, 0);
  }
  return mergeParts(`set-${recipe.theme.toLowerCase()}-far-source`, parts, false);
}

function buildMidgroundSource(scene: Scene, materials: MaterialLibrary, recipe: ThemeRecipe): Mesh {
  switch (recipe.theme) {
    case "FLAGSHIP": return retailIsland(scene, materials, "retail-island-source", recipe.accents[0]!);
    case "WAREHOUSE": return warehouseBay(scene, materials, "warehouse-bay-source", recipe.accents[0]!);
    case "OFFICE": return officePod(scene, materials, "office-pod-source", recipe.accents[1]!);
    case "MANGA": return conventionBooth(scene, materials, "convention-booth-source", recipe.accents[0]!);
  }
}

function retailIsland(scene: Scene, materials: MaterialLibrary, name: string, accent: string): Mesh {
  const parts: Mesh[] = [];
  const table = beveledBox(scene, `${name}-table`, { width: 8.8, height: 1.15, depth: 4.4, bevel: 0.32 });
  table.position.y = 1.25;
  table.material = materials.get({ materialClass: "WOOD", color: "#9b6b45", tile: 1.2 });
  parts.push(table);
  for (const x of [-3.05, -1.02, 1.02, 3.05]) {
    for (let layer = 0; layer < 3; layer += 1) {
      const shirt = beveledBox(scene, `${name}-shirt-${x}-${layer}`, { width: 1.62, height: 0.14, depth: 1.35, bevel: 0.08 });
      shirt.position.set(x, 1.9 + layer * 0.15, 0);
      shirt.rotation.y = x * 0.018;
      shirt.material = materials.get({ materialClass: "FABRIC", color: layer === 2 ? accent : layer === 1 ? "#65d8ff" : "#f7f2e8", tile: 0.45 });
      parts.push(shirt);
    }
  }
  for (const side of [-1, 1] as const) {
    const upright = tube(scene, `${name}-upright-${side}`, [new Vector3(side * 4.1, 2.25, 0), new Vector3(side * 4.1, 6.7, 0)], 0.15, 8);
    upright.material = materials.get({ materialClass: "RAW_METAL", color: "#a7adb3" });
    parts.push(upright);
  }
  const rail = tube(scene, `${name}-rail`, [new Vector3(-4.1, 6.65, 0), new Vector3(4.1, 6.65, 0)], 0.17, 8);
  rail.material = materials.get({ materialClass: "PAINTED_METAL", color: accent });
  parts.push(rail);
  // Midground modules repeat dozens of times. One restrained silhouette material keeps the module
  // to one draw per visible instance; the landmark frames carry the full colour/material story.
  return mergeParts(name, parts, false);
}

function warehouseBay(scene: Scene, materials: MaterialLibrary, name: string, accent: string): Mesh {
  const parts: Mesh[] = [];
  const steel = materials.get({ materialClass: "PAINTED_METAL", color: "#46525d", tile: 1.1 });
  for (const side of [-1, 1] as const) {
    const upright = beveledBox(scene, `${name}-upright-${side}`, { width: 0.6, height: 10.5, depth: 1, bevel: 0.12 });
    upright.position.set(side * 4.6, 5.25, 0);
    upright.material = steel;
    parts.push(upright);
  }
  for (let shelf = 0; shelf < 4; shelf += 1) {
    const beam = beveledBox(scene, `${name}-beam-${shelf}`, { width: 9.8, height: 0.42, depth: 1.2, bevel: 0.08 });
    beam.position.set(0, 1 + shelf * 2.85, 0);
    beam.material = materials.get({ materialClass: "PAINTED_METAL", color: shelf === 3 ? accent : "#61707d", tile: 0.8 });
    parts.push(beam);
    for (let box = 0; box < 3; box += 1) {
      const parcel = beveledBox(scene, `${name}-parcel-${shelf}-${box}`, { width: 2.35, height: 1.65, depth: 2.1, bevel: 0.12 });
      parcel.position.set(-2.8 + box * 2.8, 2 + shelf * 2.85, 0);
      parcel.rotation.y = (box - 1) * 0.04;
      parcel.material = materials.get({ materialClass: "CARDBOARD", color: box === 1 ? "#aa784b" : "#c08b58", tile: 0.75 });
      parts.push(parcel);
    }
  }
  return mergeParts(name, parts, false);
}

function officePod(scene: Scene, materials: MaterialLibrary, name: string, accent: string): Mesh {
  const parts: Mesh[] = [];
  for (const side of [-1, 1] as const) {
    const desk = beveledBox(scene, `${name}-desk-${side}`, { width: 4.2, height: 0.55, depth: 4.4, bevel: 0.28 });
    desk.position.set(side * 2.25, 2.8, 0);
    desk.material = materials.get({ materialClass: "WOOD", color: "#9a704f", tile: 1.15 });
    parts.push(desk);
    const screen = beveledBox(scene, `${name}-screen-${side}`, { width: 2.8, height: 2.1, depth: 0.28, bevel: 0.2 });
    screen.position.set(side * 2.25, 4.45, -0.6);
    screen.rotation.y = -side * 0.12;
    screen.material = materials.get({ materialClass: "SCREEN", color: side > 0 ? accent : "#ff8f4c", emissive: 0.65 });
    parts.push(screen);
    for (const legSide of [-1, 1] as const) {
      const leg = tube(scene, `${name}-leg-${side}-${legSide}`, [new Vector3(side * 2.25 + legSide * 1.45, 0, 0), new Vector3(side * 2.25 + legSide * 1.45, 2.55, 0)], 0.1, 7);
      leg.material = materials.get({ materialClass: "RAW_METAL", color: "#8d959d" });
      parts.push(leg);
    }
  }
  const divider = beveledBox(scene, `${name}-divider`, { width: 0.22, height: 2.5, depth: 4.1, bevel: 0.08 });
  divider.position.y = 4.1;
  divider.material = materials.get({ materialClass: "FABRIC", color: "#657482", tile: 0.8 });
  parts.push(divider);
  return mergeParts(name, parts, false);
}

function conventionBooth(scene: Scene, materials: MaterialLibrary, name: string, accent: string): Mesh {
  const parts: Mesh[] = [];
  const truss = materials.get({ materialClass: "RAW_METAL", color: "#76808b" });
  for (const side of [-1, 1] as const) {
    const post = tube(scene, `${name}-post-${side}`, [new Vector3(side * 4.4, 0, 0), new Vector3(side * 4.4, 8.6, 0)], 0.18, 8);
    post.material = truss;
    parts.push(post);
  }
  const crown = tube(scene, `${name}-crown`, [new Vector3(-4.4, 8.6, 0), new Vector3(4.4, 8.6, 0)], 0.2, 8);
  crown.material = truss;
  parts.push(crown);
  const banner = beveledBox(scene, `${name}-banner`, { width: 7.2, height: 4.9, depth: 0.24, bevel: 0.2 });
  banner.position.set(0, 5.3, -0.2);
  banner.material = materials.get({ materialClass: "FABRIC", color: accent, tile: 0.8 });
  parts.push(banner);
  for (const x of [-3, 0, 3]) {
    const lamp = ellipsoid(scene, `${name}-lamp-${x}`, { x: 0.32, y: 0.18, z: 0.32 }, 10, 5);
    lamp.position.set(x, 8.25, 0.35);
    lamp.material = materials.get({ materialClass: "NEON", color: x === 0 ? "#45e2ff" : accent, emissive: 1 });
    parts.push(lamp);
  }
  return mergeParts(name, parts, false);
}

function buildSignature(
  scene: Scene,
  materials: MaterialLibrary,
  kind: SignatureKind,
  name: string,
  context: DressingContext,
  accent: string,
): TransformNode {
  if (isHeroKind(kind)) {
    return buildHero(scene, materials, kind, name, {
      quality: context.quality,
      accentA: accent,
      accentB: context.accentB,
    });
  }
  switch (kind) {
    case "STAIRCASE": return staircase(scene, materials, name, accent);
    case "BOOTHS": return booths(scene, materials, name, accent);
    case "DOCK": return dock(scene, materials, name, accent);
    case "BRIDGE": return bridge(scene, materials, name, accent);
    case "CONVEYOR": return conveyor(scene, materials, name, accent, context.detailed);
    case "RECEPTION": return reception(scene, materials, name, accent);
    case "KEYBOARD": return keyboard(scene, materials, name, accent, context.detailed);
    case "MEETING": return meeting(scene, materials, name, accent);
    case "PORTAL": return portal(scene, materials, name, accent);
    case "ARTIST_ALLEY": return artistAlley(scene, materials, name, accent);
    case "CUP": return giantCup(scene, materials, name, accent);
  }
}

function isHeroKind(kind: SignatureKind): kind is HeroKind {
  return ["SHIRT_WALL", "CASH_REGISTER", "LOGISTICS_ROBOT", "PALLET_TOWER", "PRINT_CAROUSEL", "INK_DRUMS", "GIANT_MONITOR", "COFFEE_MACHINE", "STAGE", "ARCADE_BANK"].includes(kind);
}

function staircase(scene: Scene, materials: MaterialLibrary, name: string, accent: string): Mesh {
  const parts: Mesh[] = [];
  for (let step = 0; step < 11; step += 1) {
    const tread = beveledBox(scene, `${name}-step-${step}`, { width: 10, height: 0.38, depth: 0.92, bevel: 0.08 });
    tread.position.set(0, step * 0.48 + 0.2, -3.7 + step * 0.7);
    tread.material = materials.get({ materialClass: "WOOD", color: step % 2 === 0 ? "#9b6d48" : "#b17f55", tile: 1.2 });
    parts.push(tread);
  }
  for (const side of [-1, 1] as const) {
    const rail = tube(scene, `${name}-rail-${side}`, [new Vector3(side * 4.6, 1.1, -3.7), new Vector3(side * 4.6, 6.1, 3.3)], 0.12, 8);
    rail.material = materials.get({ materialClass: "PAINTED_METAL", color: accent });
    parts.push(rail);
  }
  return mergeParts(name, parts, true);
}

function booths(scene: Scene, materials: MaterialLibrary, name: string, accent: string): Mesh {
  const parts: Mesh[] = [];
  for (let booth = 0; booth < 4; booth += 1) {
    const x = -5.7 + booth * 3.8;
    for (const side of [-1, 1] as const) {
      const post = beveledBox(scene, `${name}-post-${booth}-${side}`, { width: 0.24, height: 6, depth: 0.35, bevel: 0.05 });
      post.position.set(x + side * 1.55, 3, 0);
      post.material = materials.get({ materialClass: "PAINTED_METAL", color: "#3d3442" });
      parts.push(post);
    }
    const top = beveledBox(scene, `${name}-top-${booth}`, { width: 3.35, height: 0.3, depth: 0.4, bevel: 0.06 });
    top.position.set(x, 5.85, 0);
    top.material = materials.get({ materialClass: "PAINTED_METAL", color: accent });
    parts.push(top);
    const curtain = beveledBox(scene, `${name}-curtain-${booth}`, { width: 2.9, height: 4.9, depth: 0.12, bevel: 0.08 });
    curtain.position.set(x, 3, -0.08);
    curtain.material = materials.get({ materialClass: "FABRIC", color: booth % 2 === 0 ? accent : "#efe5da", tile: 0.55 });
    parts.push(curtain);
  }
  return mergeParts(name, parts, true);
}

function dock(scene: Scene, materials: MaterialLibrary, name: string, accent: string): Mesh {
  const parts: Mesh[] = [];
  const frameMat = materials.get({ materialClass: "PAINTED_METAL", color: "#35424e", tile: 1.5 });
  for (const side of [-1, 1] as const) {
    const post = beveledBox(scene, `${name}-post-${side}`, { width: 0.9, height: 9.5, depth: 1.3, bevel: 0.12 });
    post.position.set(side * 6.4, 4.75, 0);
    post.material = frameMat;
    parts.push(post);
    const bumper = beveledBox(scene, `${name}-bumper-${side}`, { width: 0.65, height: 2.6, depth: 0.75, bevel: 0.22 });
    bumper.position.set(side * 5.45, 1.3, 1);
    bumper.material = materials.get({ materialClass: "RUBBER", color: "#171b20" });
    parts.push(bumper);
  }
  const header = beveledBox(scene, `${name}-header`, { width: 13.7, height: 1.1, depth: 1.4, bevel: 0.16 });
  header.position.set(0, 9.1, 0);
  header.material = frameMat;
  parts.push(header);
  for (let panel = 0; panel < 5; panel += 1) {
    const door = beveledBox(scene, `${name}-door-${panel}`, { width: 2.35, height: 7.4, depth: 0.2, bevel: 0.04 });
    door.position.set(-4.8 + panel * 2.4, 4.1, -0.65);
    door.material = materials.get({ materialClass: "PAINTED_METAL", color: panel % 2 === 0 ? "#64717c" : "#56626d", tile: 1 });
    parts.push(door);
  }
  const stripe = beveledBox(scene, `${name}-stripe`, { width: 13.1, height: 0.34, depth: 0.3, bevel: 0.03 });
  stripe.position.set(0, 7.35, 0);
  stripe.material = materials.get({ materialClass: "PAINTED_METAL", color: accent, tile: 0.6 });
  parts.push(stripe);
  return mergeParts(name, parts, true);
}

function bridge(scene: Scene, materials: MaterialLibrary, name: string, accent: string): Mesh {
  const parts: Mesh[] = [];
  const deck = beveledBox(scene, `${name}-deck`, { width: 15, height: 0.65, depth: 4.2, bevel: 0.14 });
  deck.position.y = 6.8;
  deck.material = materials.get({ materialClass: "RAW_METAL", color: "#6f7b85", tile: 1.4 });
  parts.push(deck);
  for (const side of [-1, 1] as const) {
    const support = tube(scene, `${name}-support-${side}`, [new Vector3(side * 6.5, 0, 0), new Vector3(side * 6.5, 6.5, 0)], 0.28, 8);
    support.material = materials.get({ materialClass: "PAINTED_METAL", color: accent });
    parts.push(support);
    const rail = tube(scene, `${name}-rail-${side}`, [new Vector3(-7, 8.2, side * 1.65), new Vector3(7, 8.2, side * 1.65)], 0.09, 7);
    rail.material = materials.get({ materialClass: "PAINTED_METAL", color: accent });
    parts.push(rail);
  }
  return mergeParts(name, parts, true);
}

function conveyor(scene: Scene, materials: MaterialLibrary, name: string, accent: string, detailed: boolean): Mesh {
  const parts: Mesh[] = [];
  const frame = beveledBox(scene, `${name}-frame`, { width: 14, height: 1.1, depth: 4.8, bevel: 0.14 });
  frame.position.y = 1.8;
  frame.material = materials.get({ materialClass: "PAINTED_METAL", color: "#46525d" });
  parts.push(frame);
  const rollers = detailed ? 13 : 8;
  for (let roller = 0; roller < rollers; roller += 1) {
    const x = -6 + roller * (12 / (rollers - 1));
    const mesh = revolve(scene, `${name}-roller-${roller}`, [new Vector2(0.001, 0), new Vector2(0.22, 0.02), new Vector2(0.22, 4.1), new Vector2(0.001, 4.12)], 10);
    mesh.rotation.x = Math.PI / 2;
    mesh.position.set(x, 2.48, -2.05);
    mesh.material = materials.get({ materialClass: "RAW_METAL", color: "#b0bac2" });
    parts.push(mesh);
  }
  for (let parcel = 0; parcel < 4; parcel += 1) {
    const box = beveledBox(scene, `${name}-parcel-${parcel}`, { width: 1.8, height: 1.45, depth: 1.6, bevel: 0.08 });
    box.position.set(-4.6 + parcel * 3, 3.25, 0);
    box.rotation.y = parcel % 2 === 0 ? 0.08 : -0.1;
    box.material = materials.get({ materialClass: "CARDBOARD", color: "#b88755", tile: 0.8 });
    parts.push(box);
  }
  const stripe = beveledBox(scene, `${name}-stripe`, { width: 14.2, height: 0.24, depth: 4.95, bevel: 0.04 });
  stripe.position.y = 1.9;
  stripe.material = materials.get({ materialClass: "PAINTED_METAL", color: accent });
  parts.push(stripe);
  return mergeParts(name, parts, true);
}

function reception(scene: Scene, materials: MaterialLibrary, name: string, accent: string): Mesh {
  const parts: Mesh[] = [];
  const desk = beveledBox(scene, `${name}-desk`, { width: 13, height: 3.6, depth: 4.6, bevel: 0.55 });
  desk.position.y = 1.8;
  desk.material = materials.get({ materialClass: "WOOD", color: "#9a6a43", tile: 1.6 });
  parts.push(desk);
  const inset = beveledBox(scene, `${name}-inset`, { width: 8.5, height: 1.3, depth: 0.28, bevel: 0.16 });
  inset.position.set(0, 2.05, 2.35);
  inset.material = materials.get({ materialClass: "SCREEN", color: accent });
  parts.push(inset);
  for (const x of [-3.8, 0, 3.8]) {
    const lamp = ellipsoid(scene, `${name}-lamp-${x}`, { x: 0.55, y: 0.3, z: 0.55 }, 12, 6);
    lamp.position.set(x, 5.3, 0);
    lamp.material = materials.get({ materialClass: "NEON", color: accent, emissive: 1 });
    parts.push(lamp);
  }
  return mergeParts(name, parts, true);
}

function keyboard(scene: Scene, materials: MaterialLibrary, name: string, accent: string, detailed: boolean): Mesh {
  const parts: Mesh[] = [];
  const deck = beveledBox(scene, `${name}-deck`, { width: 14, height: 0.65, depth: 7.5, bevel: 0.35 });
  deck.position.y = 0.35;
  deck.rotation.x = -0.05;
  deck.material = materials.get({ materialClass: "PLASTIC", color: "#2f343c" });
  parts.push(deck);
  const columns = detailed ? 12 : 8;
  for (let row = 0; row < 4; row += 1) {
    for (let column = 0; column < columns; column += 1) {
      const key = beveledBox(scene, `${name}-key-${row}-${column}`, { width: 0.8, height: 0.32, depth: 0.78, bevel: 0.09 });
      key.position.set(-5.4 + column * (10.8 / (columns - 1)), 0.82, -2.25 + row * 1.45);
      key.material = materials.get({ materialClass: "PLASTIC", color: (row + column) % 9 === 0 ? accent : "#e7e9ec" });
      parts.push(key);
    }
  }
  return mergeParts(name, parts, true);
}

function meeting(scene: Scene, materials: MaterialLibrary, name: string, accent: string): Mesh {
  const parts: Mesh[] = [];
  const table = beveledBox(scene, `${name}-table`, { width: 14, height: 0.72, depth: 6, bevel: 0.7 });
  table.position.y = 3.4;
  table.material = materials.get({ materialClass: "WOOD", color: "#8f6548", tile: 1.5 });
  parts.push(table);
  for (const x of [-5, 0, 5]) {
    const leg = revolve(scene, `${name}-leg-${x}`, [new Vector2(0.8, 0), new Vector2(0.65, 3.1), new Vector2(0.8, 3.2)], 12);
    leg.position.x = x;
    leg.material = materials.get({ materialClass: "RAW_METAL", color: "#8b949d" });
    parts.push(leg);
  }
  for (let chair = 0; chair < 8; chair += 1) {
    const side = chair < 4 ? -1 : 1;
    const column = chair % 4;
    const seat = beveledBox(scene, `${name}-chair-${chair}`, { width: 1.5, height: 1.9, depth: 0.38, bevel: 0.18 });
    seat.position.set(-4.7 + column * 3.1, 2.2, side * 4.2);
    seat.rotation.x = side * 0.12;
    seat.material = materials.get({ materialClass: "FABRIC", color: chair % 3 === 0 ? accent : "#46505b", tile: 0.6 });
    parts.push(seat);
  }
  return mergeParts(name, parts, true);
}

function giantCup(scene: Scene, materials: MaterialLibrary, name: string, accent: string): Mesh {
  const parts: Mesh[] = [];
  const cup = revolve(scene, `${name}-body`, [
    new Vector2(3.5, 0),
    new Vector2(3.35, 0.35),
    new Vector2(3.05, 5.5),
    new Vector2(3.35, 6),
    new Vector2(3.15, 6.35),
  ], 28, { capStart: true, capEnd: true });
  cup.material = materials.get({ materialClass: "PAPER", color: "#f4eee4", tile: 1.3 });
  parts.push(cup);
  const sleeve = revolve(scene, `${name}-sleeve`, [
    new Vector2(3.16, 1.8),
    new Vector2(3.25, 1.95),
    new Vector2(3.18, 4.1),
    new Vector2(3.1, 4.25),
  ], 28, { capStart: false, capEnd: false });
  sleeve.material = materials.get({ materialClass: "CARDBOARD", color: accent, tile: 0.8 });
  parts.push(sleeve);
  const handle = tube(scene, `${name}-handle`, [
    new Vector3(3, 4.9, 0),
    new Vector3(5.15, 4.4, 0),
    new Vector3(5.55, 2.8, 0),
    new Vector3(3.15, 2.25, 0),
  ], 0.34, 10);
  handle.material = materials.get({ materialClass: "PLASTIC", color: "#f4eee4" });
  parts.push(handle);
  return mergeParts(name, parts, true);
}

function portal(scene: Scene, materials: MaterialLibrary, name: string, accent: string): Mesh {
  const parts: Mesh[] = [];
  for (const side of [-1, 1] as const) {
    const post = tube(scene, `${name}-post-${side}`, [new Vector3(side * 6, 0, 0), new Vector3(side * 6, 9, 0), new Vector3(side * 4.8, 10.6, 0)], 0.38, 10);
    post.material = materials.get({ materialClass: "PAINTED_METAL", color: side > 0 ? accent : "#f2edf5" });
    parts.push(post);
  }
  const crown = tube(scene, `${name}-crown`, [new Vector3(-4.8, 10.6, 0), new Vector3(0, 11.7, 0), new Vector3(4.8, 10.6, 0)], 0.4, 10);
  crown.material = materials.get({ materialClass: "NEON", color: accent, emissive: 0.8 });
  parts.push(crown);
  const disc = revolve(scene, `${name}-disc`, [new Vector2(0.001, 0), new Vector2(2.1, 0.08), new Vector2(2.35, 0.34), new Vector2(0.001, 0.4)], 24);
  disc.rotation.x = Math.PI / 2;
  disc.position.set(0, 10.7, 0.2);
  disc.material = materials.get({ materialClass: "SCREEN", color: accent });
  parts.push(disc);
  return mergeParts(name, parts, true);
}

function artistAlley(scene: Scene, materials: MaterialLibrary, name: string, accent: string): Mesh {
  const parts: Mesh[] = [];
  for (let stand = 0; stand < 5; stand += 1) {
    const x = -6 + stand * 3;
    const table = beveledBox(scene, `${name}-table-${stand}`, { width: 2.6, height: 1.1, depth: 2.2, bevel: 0.16 });
    table.position.set(x, 1.1, 0);
    table.material = materials.get({ materialClass: "WOOD", color: "#a67954", tile: 0.7 });
    parts.push(table);
    const banner = beveledBox(scene, `${name}-banner-${stand}`, { width: 2.3, height: 4.7, depth: 0.2, bevel: 0.12 });
    banner.position.set(x, 4.35, -0.8);
    banner.rotation.z = stand % 2 === 0 ? 0.035 : -0.035;
    banner.material = materials.get({ materialClass: "FABRIC", color: stand % 2 === 0 ? accent : "#45e2ff", tile: 0.75 });
    parts.push(banner);
    for (let print = 0; print < 3; print += 1) {
      const sheet = beveledBox(scene, `${name}-print-${stand}-${print}`, { width: 0.65, height: 0.08, depth: 0.9, bevel: 0.03 });
      sheet.position.set(x - 0.7 + print * 0.7, 1.72, 0.25);
      sheet.material = materials.get({ materialClass: "PAPER", color: print === 1 ? accent : "#fff8ed", tile: 0.35 });
      parts.push(sheet);
    }
  }
  return mergeParts(name, parts, true);
}

function hexChannels(value: string): [number, number, number] {
  const hex = value.replace("#", "");
  return [
    Number.parseInt(hex.slice(0, 2), 16) / 255,
    Number.parseInt(hex.slice(2, 4), 16) / 255,
    Number.parseInt(hex.slice(4, 6), 16) / 255,
  ];
}

export function buildFlagshipSet(context: DressingContext): Dressing {
  return buildThemeSet(context, RECIPES.FLAGSHIP);
}

export function buildWarehouseSet(context: DressingContext): Dressing {
  return buildThemeSet(context, RECIPES.WAREHOUSE);
}

export function buildOfficeSet(context: DressingContext): Dressing {
  return buildThemeSet(context, RECIPES.OFFICE);
}

export function buildMangaSet(context: DressingContext): Dressing {
  return buildThemeSet(context, RECIPES.MANGA);
}
