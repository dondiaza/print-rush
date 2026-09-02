import {
  Color3,
  Color4,
  Mesh,
  MeshBuilder,
  Scene,
  TransformNode,
  Vector2,
  Vector3,
} from "@babylonjs/core";
import type { BakedTrack, TrackNode } from "@print-rush/game-core";
import { MaterialLibrary, type MaterialClass, type MaterialQuality } from "@/render/MaterialLibrary";
import { createPropSources, propSourceKey, type PropSpec } from "@/render/PropLibrary";
import { buildHero, heroesForTheme } from "@/render/HeroAssets";
import { beveledBox, ellipsoid, lofted, revolve, tube } from "@/render/Geometry";
import { LightingRig, zonesForTheme, type QualityLevel } from "@/render/LightingRig";
import { buildRoadSurface, buildWallSurface, curvatureAt, frameAt } from "@/render/RoadMesh";
import { createBackdrop, type Backdrop } from "@/render/BackdropDome";
import type { AssetCatalog } from "@/render/AssetCatalog";
import { scatterDecals, type Decals } from "@/render/DecalScatter";

/**
 * TRACK BUILDER V5.
 *
 * Replaces the V4 builder, which drew the road as a flat ribbon, the barriers as 120 instanced boxes
 * every fourth node, and the entire environment as 42 randomly sized cubes arranged in an ellipse
 * outside the track.
 *
 * What changed structurally:
 *  - the road is real geometry with banking and distance-based UVs, and it has kerbs on the inside
 *    of corners, lane markings and a painted racing line;
 *  - walls are continuous surfaces that open where a shortcut or a ledge exists;
 *  - trackside props are placed by lap distance rather than by angle, so no stretch of road is empty
 *    and the objects that make speed legible are always present;
 *  - everything repeated is instanced with per-instance colour, so a hundred boxes cost one material.
 */

/**
 * A surface's material.
 *
 * `texture` names a baked material from `assets.manifest.json` whose base colour, normal and
 * roughness maps should be used as a set. It is optional on purpose: where it is absent the surface
 * still gets the class's baked normal and roughness and takes its colour from `color`, which is the
 * path every prop uses. `color` therefore stays meaningful everywhere, and a theme opts into a baked
 * base colour only where a specific one exists — there is no invented id here, and a name the
 * manifest does not carry falls back rather than failing.
 */
type SurfaceVisual = { materialClass: MaterialClass; color: string; texture?: string };

export type ThemeVisuals = {
  road: SurfaceVisual;
  wall: SurfaceVisual;
  kerbLight: string;
  kerbDark: string;
  accentA: string;
  accentB: string;
  /** Prop palette used by the seeded scatter. */
  props: readonly PropSpec[];
  structureColor: string;
  structureClass: MaterialClass;
  /** Baked material for the big structures — pillars, gantries, the stage deck. */
  structureTexture?: string;
};

const THEME_VISUALS: Record<string, ThemeVisuals> = {
  FLAGSHIP: {
    // Carpet on the aisle, tile on the columns. Both are how a real shop is built, and it puts the
    // soft surface where the kart drives and the hard one where it reflects the lighting rig.
    road: { materialClass: "FLOOR_TILE", color: "#6e6259", texture: "mat_carpet_store" },
    wall: { materialClass: "WOOD", color: "#c98a52", texture: "mat_wood_store" },
    kerbLight: "#f7f2e8",
    kerbDark: "#ff3da6",
    accentA: "#ff3da6",
    accentB: "#b9ff45",
    structureColor: "#e8dfd0",
    structureClass: "FLOOR_TILE",
    structureTexture: "mat_floortile_store",
    props: [
      // The shirts are the shop. Two plain colourways and two printed designs, so a wall of
      // displays is four different things rather than one repeated.
      { materialClass: "FABRIC", color: "#ff3da6", kind: "SHELF", weight: 2, texture: "mat_fabric_magenta" },
      { materialClass: "FABRIC", color: "#65d8ff", kind: "SHELF", weight: 2, texture: "mat_fabric_cyan" },
      { materialClass: "FABRIC", color: "#f7f2e8", kind: "SHELF", weight: 2, texture: "mat_fabricprint_bolt" },
      { materialClass: "FABRIC", color: "#f7f2e8", kind: "SHELF", weight: 2, texture: "mat_fabricprint_wave" },
      { materialClass: "WOOD", color: "#c98a52", kind: "RAIL", weight: 3 },
      { materialClass: "CARDBOARD", color: "#b98a57", kind: "BOX", weight: 2, texture: "mat_cardboard_default" },
      { materialClass: "SCREEN", color: "#65d8ff", kind: "SCREEN", weight: 1, texture: "mat_screen_cyan" },
      { materialClass: "PLASTIC", color: "#4c7a4e", kind: "PLANT", weight: 1 },
    ],
  },
  WAREHOUSE: {
    road: { materialClass: "CONCRETE", color: "#4a4e54", texture: "mat_concrete_warehouse" },
    wall: { materialClass: "PAINTED_METAL", color: "#5a6068", texture: "mat_paintedmetal_racking" },
    kerbLight: "#ffc02e",
    kerbDark: "#3a3f49",
    accentA: "#ffc02e",
    accentB: "#3e6e9e",
    structureColor: "#5a6068",
    structureClass: "PAINTED_METAL",
    structureTexture: "mat_paintedmetal_racking",
    props: [
      { materialClass: "PAINTED_METAL", color: "#5a6068", kind: "SHELF", weight: 4, texture: "mat_paintedmetal_racking" },
      { materialClass: "CARDBOARD", color: "#b98a57", kind: "BOX", weight: 5, texture: "mat_cardboard_default" },
      { materialClass: "PLASTIC", color: "#3e6e9e", kind: "PALLET", weight: 3, texture: "mat_plastic_pallet" },
      { materialClass: "PAINTED_METAL", color: "#ffc02e", kind: "MACHINE", weight: 2 },
      { materialClass: "RAW_METAL", color: "#9fa6ad", kind: "RAIL", weight: 2, texture: "mat_rawmetal_default" },
      { materialClass: "PAPER", color: "#f7f2e8", kind: "SIGN", weight: 1, texture: "mat_paper_default" },
    ],
  },
  PRINT_FACTORY: {
    road: { materialClass: "CONCRETE", color: "#2b2732", texture: "mat_concrete_factory" },
    wall: { materialClass: "PAINTED_METAL", color: "#3a3f49", texture: "mat_paintedmetal_press" },
    kerbLight: "#ffd43b",
    kerbDark: "#8f5cff",
    accentA: "#8f5cff",
    accentB: "#ff6b2c",
    structureColor: "#3a3f49",
    structureClass: "PAINTED_METAL",
    structureTexture: "mat_paintedmetal_press",
    props: [
      { materialClass: "PAINTED_METAL", color: "#3a3f49", kind: "MACHINE", weight: 5, texture: "mat_paintedmetal_press" },
      // The four process inks, which is what a screen-printing floor is actually stacked with.
      { materialClass: "INK", color: "#8f5cff", kind: "BOX", weight: 2, texture: "mat_ink_violet" },
      { materialClass: "INK", color: "#ff3da6", kind: "BOX", weight: 2, texture: "mat_ink_magenta" },
      { materialClass: "INK", color: "#65d8ff", kind: "BOX", weight: 2, texture: "mat_ink_cyan" },
      { materialClass: "INK", color: "#ffd43b", kind: "BOX", weight: 2, texture: "mat_ink_yellow" },
      { materialClass: "RAW_METAL", color: "#9fa6ad", kind: "RAIL", weight: 3, texture: "mat_rawmetal_default" },
      { materialClass: "SCREEN", color: "#65d8ff", kind: "SCREEN", weight: 2, texture: "mat_screen_cyan" },
      // Shirts fresh off the press, still on the rack.
      { materialClass: "FABRIC", color: "#f7f2e8", kind: "SHELF", weight: 2, texture: "mat_fabricprint_splat" },
    ],
  },
  OFFICE: {
    // Carpet where the kart drives; the tile goes on the structures, as in the Megastore.
    road: { materialClass: "FLOOR_TILE", color: "#8c8378", texture: "mat_carpet_office" },
    wall: { materialClass: "WOOD", color: "#a2764b", texture: "mat_wood_desk" },
    kerbLight: "#f7f2e8",
    kerbDark: "#65d8ff",
    accentA: "#65d8ff",
    accentB: "#b9ff45",
    structureColor: "#e6e1d8",
    structureClass: "FLOOR_TILE",
    structureTexture: "mat_floortile_office",
    props: [
      { materialClass: "WOOD", color: "#a2764b", kind: "MACHINE", weight: 4, texture: "mat_wood_desk" },
      { materialClass: "SCREEN", color: "#65d8ff", kind: "SCREEN", weight: 3, texture: "mat_screen_cyan" },
      { materialClass: "PLASTIC", color: "#4c7a4e", kind: "PLANT", weight: 3 },
      { materialClass: "PAPER", color: "#f7f2e8", kind: "BOX", weight: 3, texture: "mat_paper_default" },
      { materialClass: "PLASTIC", color: "#2b2732", kind: "MACHINE", weight: 2 },
      { materialClass: "FABRIC", color: "#ff3da6", kind: "SHELF", weight: 1, texture: "mat_fabric_magenta" },
    ],
  },
  MANGA: {
    // Carpet, not tile: a convention hall floor is carpeted, and it is the one surface here that
    // should look soft. The wall keeps no named base colour, so it takes the theme's own dark violet
    // over the class's baked normal and roughness — the fallback path, exercised in a shipped circuit.
    road: { materialClass: "FLOOR_TILE", color: "#252036", texture: "mat_carpet_manga" },
    wall: { materialClass: "PAINTED_METAL", color: "#1b1630" },
    kerbLight: "#ff3da6",
    kerbDark: "#8f5cff",
    accentA: "#ff3da6",
    accentB: "#65d8ff",
    structureColor: "#1b1630",
    // The stands are built on timber decking, which is what a convention hall actually is under the
    // carpet, and it gives the one warm surface in an otherwise cold neon space.
    structureClass: "WOOD",
    structureTexture: "mat_wood_stage",
    props: [
      { materialClass: "NEON", color: "#ff3da6", kind: "SIGN", weight: 4 },
      { materialClass: "NEON", color: "#65d8ff", kind: "SIGN", weight: 3 },
      { materialClass: "SCREEN", color: "#8f5cff", kind: "SCREEN", weight: 3, texture: "mat_screen_magenta" },
      { materialClass: "FABRIC", color: "#8f5cff", kind: "CROWD", weight: 4 },
      { materialClass: "FABRIC", color: "#ff3da6", kind: "CROWD", weight: 3 },
      // A merch stand: halftone print on black, which is what a stand sells.
      { materialClass: "FABRIC", color: "#f7f2e8", kind: "SHELF", weight: 2, texture: "mat_fabricprint_grid" },
      { materialClass: "PAINTED_METAL", color: "#3a3f49", kind: "MACHINE", weight: 2 },
    ],
  },
};

export function visualsForTheme(theme: string): ThemeVisuals {
  return THEME_VISUALS[theme] ?? THEME_VISUALS.FLAGSHIP!;
}

export type BuiltFeature = {
  kind: string;
  position: Vector3;
  node: TransformNode | null;
  progress: number;
  cooldown: number;
  power: number;
  label?: string;
};

export type BuiltTrack = {
  baked: BakedTrack;
  lighting: LightingRig;
  materials: MaterialLibrary;
  backdrop: Backdrop;
  decals: Decals;
  boostPads: BuiltFeature[];
  jumpPads: BuiltFeature[];
  itemBoxes: BuiltFeature[];
  hazards: BuiltFeature[];
  landmarks: BuiltFeature[];
  shortcuts: Array<{ from: number; to: number; pads: Vector3[] }>;
  /** Objects the runtime animates each frame. */
  animated: Array<{ mesh: TransformNode; phase: number; kind: string }>;
  dispose: () => void;
};

/** Deterministic per-track scatter, so the same circuit always dresses itself the same way. */
function seededRandom(seed: number): () => number {
  let state = (seed >>> 0) || 1;
  return () => {
    state ^= state << 13;
    state ^= state >>> 17;
    state ^= state << 5;
    return ((state >>> 0) % 1_000_000) / 1_000_000;
  };
}

export type BuildTrackOptions = {
  quality: QualityLevel;
  /** Reduces trackside prop density on weaker devices. 1 is full. */
  density?: number;
  /** Baked assets, already preloaded. Null builds the circuit from the procedural generator alone. */
  catalog?: AssetCatalog | null;
};

export function buildTrack(scene: Scene, baked: BakedTrack, options: BuildTrackOptions): BuiltTrack {
  const theme = baked.blueprint.theme;
  const visuals = visualsForTheme(theme);
  const materialQuality: MaterialQuality = options.quality;
  const materials = new MaterialLibrary(scene, materialQuality, options.catalog ?? null);
  const nodes = baked.definition.nodes;
  const density = options.density ?? 1;
  const random = seededRandom(hashString(baked.blueprint.id));

  const lighting = new LightingRig(scene, {
    quality: options.quality,
    zones: zonesForTheme(theme),
    clearColor: visuals.structureColor,
    theme,
  });

  // ------------------------------------------------------------- backdrop
  // Before the road, so that if the panorama is missing the fallback colour is already decided and
  // there is never a frame with nothing behind the track.
  const backdrop = createBackdrop(scene, theme, options.catalog ?? null, visuals.structureColor);

  // ------------------------------------------------------------------ road
  const road = buildRoadSurface(scene, nodes, "track-road", { tileLength: 8, shoulder: 0.4 });
  road.material = materials.get({ ...visuals.road, tile: 6 });
  road.receiveShadows = true;

  // Wear on the road: ink, dirt, tyre marks. Placed on the finished surface so the projection picks
  // up its banking, and seeded from the same generator as the props so a circuit dresses identically
  // every time it is built.
  const decals = scatterDecals(scene, road, theme, options.quality, options.catalog ?? null, random, (fraction) => {
    const index = Math.floor(fraction * nodes.length) % nodes.length;
    const node = nodes[index];
    if (!node) return null;
    const frame = frameAt(nodes, index);
    // `frameAt` works in the XZ plane and returns the left normal, so the surface normal is rebuilt
    // here from the node's banking — a decal laid flat across a banked corner would float off it.
    const bank = node.banking;
    const up = new Vector3(frame.nx * Math.sin(bank), Math.cos(bank), frame.nz * Math.sin(bank)).normalize();
    return {
      position: new Vector3(node.x, node.y, node.z),
      up,
      side: new Vector3(frame.nx, 0, frame.nz),
    };
  });

  // A painted racing line. It tells the player where to be before any HUD does, and it gives the
  // ground a feature that passes at speed, which is half of speed perception.
  const lineMaterial = materials.glow("racing-line", visuals.accentA, 0.35);

  // ------------------------------------------------------------------ walls
  const wallMaterial = materials.get({ ...visuals.wall, tile: 3 });
  const walls: Mesh[] = [];
  for (const side of [1, -1] as const) {
    const wall = buildWallSurface(scene, nodes, side, 1.1, `track-wall-${side > 0 ? "l" : "r"}`, 3);
    if (!wall) continue;
    wall.material = wallMaterial;
    wall.receiveShadows = true;
    walls.push(wall);
  }

  // ------------------------------------------------------------------ kerbs, lanes, markings
  // A kerb has a chamfered inner edge the tyre rides up. A box has none, which is why the V4 kerbs
  // read as painted stripes lying on the floor rather than as raised concrete.
  const kerbSource = beveledBox(scene, "track-kerb", {
    width: 1.3,
    height: 0.15,
    depth: 2.5,
    bevel: 0.05,
    cornerRadius: 0.06,
  });
  kerbSource.material = materials.get({ materialClass: "CONCRETE", color: "#f7f2e8", tile: 1.2 });
  kerbSource.isVisible = false;
  kerbSource.registerInstancedBuffer("color", 4);

  // Painted marking, not an object: the art bible exempts road and signage planes from bevel.
  const laneSource = MeshBuilder.CreateBox("track-lane", { width: 0.3, height: 0.02, depth: 3.4 }, scene);
  laneSource.material = lineMaterial;
  laneSource.isVisible = false;

  const kerbLight = Color3.FromHexString(visuals.kerbLight);
  const kerbDark = Color3.FromHexString(visuals.kerbDark);

  let nextLane = 0;
  let nextProp = 0;
  const propSources = createPropSources(scene, materials, visuals.props, options.quality);
  const propWeights = buildWeightTable(visuals.props);
  const animated: BuiltTrack["animated"] = [];
  let propCount = 0;

  for (let index = 0; index < nodes.length; index += 1) {
    const node = nodes[index]!;
    const frame = frameAt(nodes, index);
    const half = node.width * 0.5;
    const curvature = curvatureAt(nodes, index);

    // Kerbs mark the inside of real corners rather than being spread evenly.
    if (Math.abs(curvature) > 0.014 && index % 2 === 0) {
      const side = curvature > 0 ? -1 : 1;
      const kerb = kerbSource.createInstance(`kerb-${index}`);
      kerb.position.set(node.x + frame.nx * half * side, node.y + 0.08, node.z + frame.nz * half * side);
      kerb.rotation.y = frame.heading;
      kerb.rotation.z = node.banking * side;
      const stripe = Math.floor(node.distance / 2.5) % 2 === 0;
      kerb.instancedBuffers.color = stripe
        ? new Color4(kerbLight.r, kerbLight.g, kerbLight.b, 1)
        : new Color4(kerbDark.r, kerbDark.g, kerbDark.b, 1);
    }

    if (node.distance >= nextLane) {
      nextLane = node.distance + 9;
      const lane = laneSource.createInstance(`lane-${index}`);
      lane.position.set(node.x, node.y + 0.035, node.z);
      lane.rotation.y = frame.heading;
    }

    // ---------------------------------------------------------------- trackside props
    // Placed by distance so no stretch of road is ever empty. The art bible requires at least four
    // context-layer objects visible per side; one cluster every 11 m at full density delivers that.
    if (node.distance >= nextProp) {
      nextProp = node.distance + 11 / Math.max(0.35, density);
      for (const side of [1, -1] as const) {
        if (random() > 0.86) continue;
        const spec = propWeights[Math.floor(random() * propWeights.length)]!;
        // Keyed by kind *and* print: two shirt displays with different designs are two sources.
        const source = propSources.get(propSourceKey(spec.kind, spec.texture));
        if (!source) continue;
        const distance = half + 2.6 + random() * 5;
        const instance = source.mesh.createInstance(`prop-${index}-${side}`);
        instance.position.set(
          node.x + frame.nx * distance * side,
          node.y + (spec.kind === "SCREEN" || spec.kind === "SIGN" ? 2.6 + random() * 1.6 : 0),
          node.z + frame.nz * distance * side,
        );
        instance.rotation.y = frame.heading + (side > 0 ? Math.PI : 0) + (random() - 0.5) * 0.3;
        // Seeded scale and tint variation: two identical copies of a prop in one frame is the
        // failure mode the art bible calls out.
        const scale = 0.82 + random() * 0.5;
        instance.scaling.setAll(scale);
        /**
         * Per-instance variation, but not at the cost of the artwork.
         *
         * An untextured prop takes the theme's colour times a random shade, which is what lets one
         * mesh serve six colours. A textured one takes a neutral shade only: multiplying a printed
         * design by a hue would tint the print, and a magenta bolt on a cyan shirt is not what the
         * file says. Both still vary in brightness, which is what stops two neighbours looking
         * stamped from the same die.
         */
        const shade = 0.86 + random() * 0.3;
        const tint = source.textured ? Color3.White() : Color3.FromHexString(spec.color);
        instance.instancedBuffers.color = new Color4(tint.r * shade, tint.g * shade, tint.b * shade, 1);
        propCount += 1;
        if (spec.kind === "SCREEN" || spec.kind === "SIGN") {
          animated.push({ mesh: instance as unknown as TransformNode, phase: random() * 6.28, kind: spec.kind });
        }
      }
    }
  }

  // ------------------------------------------------------------------ features
  const nodeAt = (progress: number): TrackNode => nodes[Math.floor(((progress % 1) + 1) % 1 * nodes.length) % nodes.length]!;

  const boostPads: BuiltFeature[] = [];
  const jumpPads: BuiltFeature[] = [];
  const itemBoxes: BuiltFeature[] = [];
  const hazards: BuiltFeature[] = [];
  const landmarks: BuiltFeature[] = [];
  const shortcuts: BuiltTrack["shortcuts"] = [];

  const boostMaterial = materials.glow("boost-pad", visuals.accentB, 1.2);
  const itemMaterialA = materials.glow("item-a", visuals.accentA, 0.9);
  const itemMaterialB = materials.glow("item-b", visuals.accentB, 0.9);
  // Safety yellow rather than the theme accent: a hazard reads faster when it looks like a
  // hazard everywhere, and the baked stripe was made for this. The theme accent still
  // telegraphs the hazard through its warning light and its VFX.
  const hazardMaterial = materials.get({
    materialClass: "PAINTED_METAL",
    color: visuals.accentA,
    texture: "mat_safety_yellow",
  });

  for (const feature of baked.blueprint.features) {
    if (feature.kind === "BOOST") {
      const node = nodeAt(feature.progress);
      const frame = frameAt(nodes, nodes.indexOf(node));
      // A recessed plate with three chevrons pointing down the track. The direction cue is the whole
      // point of a boost pad, and a plain glowing rectangle does not carry one.
      const pad = new TransformNode(`boost-${feature.progress}`, scene);
      pad.position.set(node.x + frame.nx * feature.lane, node.y + 0.06, node.z + frame.nz * feature.lane);
      pad.rotation.y = frame.heading;
      const plate = beveledBox(scene, `boost-plate-${feature.progress}`, {
        width: 5,
        height: 0.1,
        depth: 7,
        bevel: 0.04,
      });
      plate.parent = pad;
      plate.material = materials.get({ materialClass: "PAINTED_METAL", color: "#1c1b22" });
      for (let chevron = 0; chevron < 3; chevron += 1) {
        for (const side of [-1, 1] as const) {
          const blade = beveledBox(scene, `boost-chevron-${feature.progress}-${chevron}-${side}`, {
            width: 2.1,
            height: 0.07,
            depth: 0.55,
            bevel: 0.03,
          });
          blade.parent = pad;
          blade.position.set(side * 1.05, 0.09, -2 + chevron * 2);
          blade.rotation.y = side * 0.42;
          blade.material = boostMaterial;
        }
      }
      boostPads.push({ kind: "BOOST", position: pad.position.clone(), node: pad, progress: feature.progress, cooldown: 0, power: 1 });
      animated.push({ mesh: pad, phase: feature.progress * 12, kind: "BOOST" });
    } else if (feature.kind === "JUMP") {
      const node = nodeAt(feature.progress);
      const frame = frameAt(nodes, nodes.indexOf(node));
      // A wedge that actually rises, with a lip at the top and rails down each side.
      const rampWidth = node.width * 0.78;
      const ramp = new TransformNode(`jump-${feature.progress}`, scene);
      ramp.position.set(node.x, node.y, node.z);
      ramp.rotation.y = frame.heading;
      const wedge = lofted(
        scene,
        `jump-wedge-${feature.progress}`,
        [
          { z: -4, halfWidth: rampWidth / 2, halfHeight: 0.06, y: 0.06, radius: 0.05 },
          { z: 0, halfWidth: rampWidth / 2, halfHeight: 0.42, y: 0.42, radius: 0.12 },
          { z: 3.6, halfWidth: rampWidth / 2, halfHeight: 0.86, y: 0.86, radius: 0.14 },
          { z: 4, halfWidth: rampWidth / 2, halfHeight: 0.8, y: 0.92, radius: 0.1 },
        ],
        { cornerSegments: 3 },
      );
      wedge.parent = ramp;
      wedge.material = materials.get({ materialClass: "PAINTED_METAL", color: visuals.accentB, tile: 2 });
      for (const side of [-1, 1] as const) {
        const rail = tube(
          scene,
          `jump-rail-${feature.progress}-${side}`,
          [
            new Vector3((side * rampWidth) / 2, 0.2, -4),
            new Vector3((side * rampWidth) / 2, 0.7, 0),
            new Vector3((side * rampWidth) / 2, 1.3, 4),
          ],
          0.09,
          6,
        );
        rail.parent = ramp;
        rail.material = materials.get({ materialClass: "RAW_METAL", color: "#b6bcc4" });
      }
      jumpPads.push({ kind: "JUMP", position: ramp.position.clone(), node: ramp, progress: feature.progress, cooldown: 0, power: feature.power });
    } else if (feature.kind === "ITEM_ROW") {
      const node = nodeAt(feature.progress);
      const frame = frameAt(nodes, nodes.indexOf(node));
      feature.lanes.forEach((lane, slot) => {
        const holder = new TransformNode(`item-${feature.progress}-${slot}`, scene);
        holder.position.set(node.x + frame.nx * lane, node.y + 1.5, node.z + frame.nz * lane);
        // A framed crate with a glowing core rather than a solid emissive cube: the frame gives it a
        // silhouette against a bright floor, and the core is what actually feeds the bloom.
        const cube = beveledBox(scene, `item-cube-${feature.progress}-${slot}`, {
          width: 1.4,
          height: 1.4,
          depth: 1.4,
          bevel: 0.09,
          cornerRadius: 0.14,
        });
        cube.parent = holder;
        cube.rotation.set(0.4, 0.5, 0.15);
        cube.material = materials.get({ materialClass: "CARDBOARD", color: "#c9a271" });
        const core = ellipsoid(scene, `item-core-${feature.progress}-${slot}`, { x: 0.42, y: 0.42, z: 0.42 }, 12, 8);
        core.parent = cube;
        core.material = slot % 2 === 0 ? itemMaterialA : itemMaterialB;
        for (const axis of [0, 1, 2]) {
          const band = beveledBox(scene, `item-band-${feature.progress}-${slot}-${axis}`, {
            width: axis === 0 ? 1.48 : 0.11,
            height: axis === 1 ? 1.48 : 0.11,
            depth: axis === 2 ? 1.48 : 0.11,
            bevel: 0.03,
          });
          band.parent = cube;
          band.material = slot % 2 === 0 ? itemMaterialA : itemMaterialB;
        }
        itemBoxes.push({
          kind: "ITEM",
          position: holder.position.clone(),
          node: holder,
          progress: feature.progress,
          cooldown: 0,
          power: 1,
        });
        animated.push({ mesh: holder, phase: slot * 1.4 + feature.progress * 9, kind: "ITEM" });
      });
    } else if (feature.kind === "HAZARD") {
      const node = nodeAt(feature.progress);
      const frame = frameAt(nodes, nodes.indexOf(node));
      const holder = new TransformNode(`hazard-${feature.progress}`, scene);
      holder.position.set(node.x + frame.nx * feature.lane, node.y, node.z + frame.nz * feature.lane);
      // A crate hanging from a chain, over a painted warning ring on the floor. The ring is the
      // telegraph: a hazard the player cannot see coming is a cheap hazard.
      const body = beveledBox(scene, `hazard-body-${feature.progress}`, {
        width: 2.2,
        height: 2.1,
        depth: 2.2,
        bevel: 0.07,
      });
      body.parent = holder;
      body.position.y = 1.3;
      body.material = hazardMaterial;
      lighting.addShadowCaster(body);

      const chain = tube(
        scene,
        `hazard-chain-${feature.progress}`,
        [new Vector3(0, 2.3, 0), new Vector3(0, 7.5, 0)],
        0.06,
        6,
      );
      chain.parent = holder;
      chain.material = materials.get({ materialClass: "RAW_METAL", color: "#7c838b" });

      const ring = revolve(
        scene,
        `hazard-ring-${feature.progress}`,
        [
          new Vector2(2.3, 0.02),
          new Vector2(2.9, 0.02),
          new Vector2(2.9, 0.05),
          new Vector2(2.3, 0.05),
        ],
        24,
        { capStart: false, capEnd: false },
      );
      ring.parent = holder;
      ring.material = materials.glow(`hazard-ring-glow-${feature.progress}`, visuals.accentA, 0.7);
      hazards.push({
        kind: feature.hazard,
        position: holder.position.clone(),
        node: holder,
        progress: feature.progress,
        cooldown: 0,
        power: 1,
      });
      animated.push({ mesh: holder, phase: feature.progress * 11, kind: "HAZARD" });
    } else if (feature.kind === "LANDMARK") {
      const node = nodeAt(feature.progress);
      const index = nodes.indexOf(node);
      const frame = frameAt(nodes, index);
      const offset = node.width * 0.5 + 9;
      const holder = new TransformNode(`landmark-${feature.label}`, scene);
      holder.position.set(node.x + frame.nx * offset * feature.side, node.y, node.z + frame.nz * offset * feature.side);
      /**
       * A landmark is a hero asset with its own silhouette, chosen from the theme's set and turned to
       * face the track. V4 used the same 7 x 13 x 7 box with a glowing band for every landmark on
       * every circuit, which meant they identified nothing and navigated nothing.
       */
      const heroKinds = heroesForTheme(theme);
      const hero = buildHero(
        scene,
        materials,
        heroKinds[landmarks.length % heroKinds.length]!,
        `landmark-${feature.label}`,
        { quality: options.quality, accentA: visuals.accentA, accentB: visuals.accentB },
      );
      hero.parent = holder;
      // Turned so its front faces the racing line, which is the only angle the driver ever sees.
      holder.rotation.y = frame.heading + (feature.side > 0 ? Math.PI * 0.5 : -Math.PI * 0.5);
      lighting.addShadowCaster(hero as Mesh);
      landmarks.push({
        kind: "LANDMARK",
        position: holder.position.clone(),
        node: holder,
        progress: feature.progress,
        cooldown: 0,
        power: 1,
        label: feature.label,
      });
    } else if (feature.kind === "SHORTCUT") {
      const pads: Vector3[] = [];
      const steps = 14;
      for (let step = 0; step <= steps; step += 1) {
        const progress = feature.from + (feature.to - feature.from) * (step / steps);
        const node = nodeAt(progress);
        pads.push(new Vector3(node.x, node.y, node.z));
      }
      shortcuts.push({ from: feature.from, to: feature.to, pads });
    }
  }

  // ------------------------------------------------------------------ start line
  const start = nodes[0]!;
  const startFrame = frameAt(nodes, 0);
  // Chequered start line, laid as alternating painted blocks rather than one white bar.
  const startGroup = new TransformNode("start-line", scene);
  startGroup.position.set(start.x, start.y, start.z);
  startGroup.rotation.y = startFrame.heading;
  const squares = 14;
  for (let column = 0; column < squares; column += 1) {
    for (let row = 0; row < 2; row += 1) {
      const square = MeshBuilder.CreateBox(
        `start-square-${column}-${row}`,
        { width: start.width / squares, height: 0.03, depth: 1.1 },
        scene,
      );
      square.parent = startGroup;
      square.position.set(
        -start.width / 2 + (column + 0.5) * (start.width / squares),
        0.06,
        -0.55 + row * 1.1,
      );
      square.material = (column + row) % 2 === 0
        ? materials.get({ materialClass: "CONCRETE", color: "#f7f2e8", tile: 0.6 })
        : materials.get({ materialClass: "CONCRETE", color: "#1b1a20", tile: 0.6 });
    }
  }

  /**
   * A trussed gantry with five light pods. A start line is the first thing the player looks at, and
   * the countdown needs something in the world to happen on rather than only in the HUD.
   */
  for (const side of [-1, 1] as const) {
    const pillar = lofted(
      scene,
      `start-pillar-${side}`,
      [
        { z: 0, halfWidth: 0.85, halfHeight: 0.85, y: 0, radius: 0.18 },
        { z: 3, halfWidth: 0.6, halfHeight: 0.6, y: 0, radius: 0.14 },
        { z: 9.4, halfWidth: 0.5, halfHeight: 0.5, y: 0, radius: 0.12 },
      ],
      { cornerSegments: 4 },
    );
    // Built along Z, stood upright at the trackside.
    pillar.rotation.x = -Math.PI / 2;
    pillar.position.set(
      start.x + startFrame.nx * (start.width * 0.5 + 1.8) * side,
      start.y,
      start.z + startFrame.nz * (start.width * 0.5 + 1.8) * side,
    );
    pillar.material = materials.get({
      materialClass: visuals.structureClass,
      color: visuals.structureColor,
      tile: 2,
      ...(visuals.structureTexture ? { texture: visuals.structureTexture } : {}),
    });
    lighting.addShadowCaster(pillar);
  }

  const spanHalf = start.width * 0.5 + 1.8;
  const truss = tube(
    scene,
    "start-truss",
    [
      new Vector3(start.x + startFrame.nx * -spanHalf, start.y + 9.2, start.z + startFrame.nz * -spanHalf),
      new Vector3(start.x, start.y + 9.6, start.z),
      new Vector3(start.x + startFrame.nx * spanHalf, start.y + 9.2, start.z + startFrame.nz * spanHalf),
    ],
    0.24,
    8,
  );
  truss.material = materials.get({ materialClass: "RAW_METAL", color: "#8f979f" });
  lighting.addShadowCaster(truss);

  const banner = beveledBox(scene, "start-banner", {
    width: start.width + 3,
    height: 1.7,
    depth: 0.35,
    bevel: 0.07,
  });
  banner.position.set(start.x, start.y + 8.1, start.z);
  banner.rotation.y = startFrame.heading;
  banner.material = materials.glow("start-banner-glow", visuals.accentA, 0.9);

  for (let pod = 0; pod < 5; pod += 1) {
    const across = (pod - 2) * 1.5;
    const lamp = revolve(
      scene,
      `start-lamp-${pod}`,
      [
        new Vector2(0.001, 0),
        new Vector2(0.34, 0.03),
        new Vector2(0.36, 0.36),
        new Vector2(0.28, 0.42),
        new Vector2(0.001, 0.44),
      ],
      12,
    );
    lamp.position.set(
      start.x + startFrame.nx * across,
      start.y + 7.1,
      start.z + startFrame.nz * across,
    );
    lamp.rotation.x = Math.PI;
    lamp.material = materials.glow(`start-lamp-glow-${pod}`, "#ff3020", 0.35);
    animated.push({ mesh: lamp, phase: pod, kind: "START_LAMP" });
  }

  return {
    baked,
    lighting,
    materials,
    backdrop,
    decals,
    boostPads,
    jumpPads,
    itemBoxes,
    hazards,
    landmarks,
    shortcuts,
    animated,
    dispose: () => {
      lighting.dispose();
      materials.dispose();
      backdrop.dispose();
      decals.dispose();
      road.dispose();
      walls.forEach((wall) => wall.dispose());
      kerbSource.dispose();
      laneSource.dispose();
      propSources.forEach((source) => source.mesh.dispose());
      void propCount;
    },
  };
}

/** The scatter draws from this: one entry per unit of weight, so weights are real probabilities. */
function buildWeightTable(props: ThemeVisuals["props"]): PropSpec[] {
  const table: PropSpec[] = [];
  for (const prop of props) {
    for (let repeat = 0; repeat < prop.weight; repeat += 1) table.push(prop);
  }
  return table;
}

function hashString(value: string): number {
  let hash = 2_166_136_261;
  for (let index = 0; index < value.length; index += 1) {
    hash ^= value.charCodeAt(index);
    hash = Math.imul(hash, 16_777_619);
  }
  return hash >>> 0;
}
