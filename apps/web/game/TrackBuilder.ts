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
import { TerrainConfig, type BakedTrack, type TrackNode } from "@print-rush/game-core";
import { MaterialLibrary, type MaterialClass, type MaterialQuality } from "@/render/MaterialLibrary";
import { createPropSources, propSourceKey, type PropSpec } from "@/render/PropLibrary";
import { buildHero, heroesForTheme } from "@/render/HeroAssets";
import { beveledBox, ellipsoid, lofted, revolve, tube } from "@/render/Geometry";
import { LightingRig, zonesForTheme, type QualityLevel } from "@/render/LightingRig";
import { buildEdgeLine, buildRoadSurface, curvatureAt, frameAt } from "@/render/RoadMesh";
import { createBackdrop, type Backdrop } from "@/render/BackdropDome";
import type { AssetCatalog } from "@/render/AssetCatalog";
import { scatterDecals, type Decals } from "@/render/DecalScatter";
import { hangPosters, type Posters } from "@/render/PosterWall";
import { createCrowd, createSpriteDressing, type Crowd } from "@/render/CrowdSprites";
import { createTerrain, type Terrain } from "@/render/Terrain";
import { circuitKeyForTheme } from "@/render/AssetCatalog";
import { buildHall, type Hall } from "@/render/Hall";
import { buildBarrier, barrierStyleFor, type Barrier } from "@/render/Barrier";
import { buildSignage, createBoard, SignPainter, signageStyleFor, type Signage } from "@/render/Signage";
import { dressTrack, type Animator, type Dressing, type DressingContext, type Placement } from "@/render/sets";

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
  /**
   * Per-sector palettes, keyed by sector index. Where a sector has one the scatter draws from it
   * instead of `props`, so the design office gets desks and screens and the ink hall gets drums —
   * the story of the space told by what stands beside the road, not one mix repeated for a lap.
   */
  zoneProps?: Readonly<Record<number, readonly PropSpec[]>>;
  structureColor: string;
  structureClass: MaterialClass;
  /** Baked material for the big structures — pillars, gantries, the stage deck. */
  structureTexture?: string;
};

/**
 * The base tone of every driveable and structural surface.
 *
 * These were lifted as part of the restyling, and the reason is specific to a kart racer rather than
 * general taste. The darkest circuits had roads at 20% value — #2b2732 in the print factory, #252036
 * in the manga hall — which is the value of a *shadow*, not of a floor. Two things follow from that
 * and both were reported: a kart, an item and a rumble strip all read as light shapes on a black
 * ribbon instead of as objects on a surface, and the surface texture itself disappears, because
 * there is no room below 20% for a normal map or a roughness variation to show up in.
 *
 * Every tone here keeps its hue and its relationship to the others — the factory floor is still the
 * violet-grey one, the manga hall is still the purple one — and is raised to a value where the
 * material can actually be seen. Nothing was desaturated to get there.
 */
const THEME_VISUALS: Record<string, ThemeVisuals> = {
  FLAGSHIP: {
    // Carpet on the aisle, tile on the columns. Both are how a real shop is built, and it puts the
    // soft surface where the kart drives and the hard one where it reflects the lighting rig.
    road: { materialClass: "FLOOR_TILE", color: "#807267", texture: "mat_carpet_store" },
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
    road: { materialClass: "CONCRETE", color: "#707680", texture: "mat_concrete_warehouse" },
    wall: { materialClass: "PAINTED_METAL", color: "#727a85", texture: "mat_paintedmetal_racking" },
    kerbLight: "#ffc02e",
    kerbDark: "#3a3f49",
    accentA: "#ffc02e",
    accentB: "#3e6e9e",
    structureColor: "#727a85",
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
    road: { materialClass: "CONCRETE", color: "#5c546b", texture: "mat_concrete_factory" },
    wall: { materialClass: "PAINTED_METAL", color: "#5f6779", texture: "mat_paintedmetal_press" },
    kerbLight: "#ffd43b",
    kerbDark: "#8f5cff",
    accentA: "#8f5cff",
    accentB: "#ff6b2c",
    structureColor: "#5f6779",
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
    zoneProps: {
      // Design: screens, paper, plants, a rail of samples. Nothing industrial yet.
      1: [
        { materialClass: "SCREEN", color: "#65d8ff", kind: "SCREEN", weight: 3, texture: "mat_screen_cyan" },
        { materialClass: "PAPER", color: "#f7f2e8", kind: "BOX", weight: 3, texture: "mat_paper_default" },
        { materialClass: "PLASTIC", color: "#4c7a4e", kind: "PLANT", weight: 2 },
        { materialClass: "RAW_METAL", color: "#9fa6ad", kind: "RAIL", weight: 2, texture: "mat_rawmetal_default" },
        { materialClass: "PAINTED_METAL", color: "#4b5162", kind: "MACHINE", weight: 1, texture: "mat_paintedmetal_press" },
      ],
      // Screens: racking, machines, signage.
      2: [
        { materialClass: "PAINTED_METAL", color: "#5f6779", kind: "SHELF", weight: 4, texture: "mat_paintedmetal_press" },
        { materialClass: "PAINTED_METAL", color: "#3a3f49", kind: "MACHINE", weight: 3, texture: "mat_paintedmetal_press" },
        { materialClass: "PAPER", color: "#f7f2e8", kind: "SIGN", weight: 2, texture: "mat_paper_default" },
        { materialClass: "RAW_METAL", color: "#9fa6ad", kind: "TROLLEY", weight: 2, texture: "mat_rawmetal_default" },
      ],
      // Ink: the drums, the presses, the fresh shirts.
      3: [
        { materialClass: "INK", color: "#8f5cff", kind: "BOX", weight: 2, texture: "mat_ink_violet" },
        { materialClass: "INK", color: "#ff3da6", kind: "BOX", weight: 2, texture: "mat_ink_magenta" },
        { materialClass: "INK", color: "#65d8ff", kind: "BOX", weight: 2, texture: "mat_ink_cyan" },
        { materialClass: "INK", color: "#ffd43b", kind: "BOX", weight: 2, texture: "mat_ink_yellow" },
        { materialClass: "PAINTED_METAL", color: "#3a3f49", kind: "MACHINE", weight: 3, texture: "mat_paintedmetal_press" },
        { materialClass: "FABRIC", color: "#f7f2e8", kind: "SHELF", weight: 3, texture: "mat_fabricprint_splat" },
      ],
      // Drying: machinery, crates of cured shirts, rails.
      4: [
        { materialClass: "PAINTED_METAL", color: "#3a3f49", kind: "MACHINE", weight: 4, texture: "mat_paintedmetal_press" },
        { materialClass: "CARDBOARD", color: "#b98a57", kind: "CRATE_STACK", weight: 3, texture: "mat_cardboard_default" },
        { materialClass: "RAW_METAL", color: "#9fa6ad", kind: "RAIL", weight: 3, texture: "mat_rawmetal_default" },
      ],
      // Control and packing: cartons, trolleys, racking, the finished product.
      5: [
        { materialClass: "CARDBOARD", color: "#b98a57", kind: "CRATE_STACK", weight: 4, texture: "mat_cardboard_default" },
        { materialClass: "CARDBOARD", color: "#b98a57", kind: "BOX", weight: 3, texture: "mat_cardboard_default" },
        { materialClass: "RAW_METAL", color: "#9fa6ad", kind: "TROLLEY", weight: 3, texture: "mat_rawmetal_default" },
        { materialClass: "PAINTED_METAL", color: "#5f6779", kind: "SHELF", weight: 2, texture: "mat_paintedmetal_press" },
        { materialClass: "FABRIC", color: "#f7f2e8", kind: "SHELF", weight: 2, texture: "mat_fabricprint_splat" },
      ],
    },
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
    road: { materialClass: "FLOOR_TILE", color: "#453b68", texture: "mat_carpet_manga" },
    wall: { materialClass: "PAINTED_METAL", color: "#33285f" },
    kerbLight: "#ff3da6",
    kerbDark: "#8f5cff",
    accentA: "#ff3da6",
    accentB: "#65d8ff",
    structureColor: "#33285f",
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
  terrain: Terrain;
  decals: Decals;
  posters: Posters;
  crowd: Crowd;
  spriteDressing: Crowd;
  boostPads: BuiltFeature[];
  jumpPads: BuiltFeature[];
  itemBoxes: BuiltFeature[];
  hazards: BuiltFeature[];
  landmarks: BuiltFeature[];
  shortcuts: Array<{ from: number; to: number; pads: Vector3[] }>;
  /** Objects the runtime animates each frame. */
  animated: Array<{ mesh: TransformNode; phase: number; kind: string }>;
  /** Self-contained animation systems: machinery, conveyors, fans, hazards. Run every frame. */
  animators: Animator[];
  hall: Hall;
  barrier: Barrier;
  signage: Signage;
  dressing: Dressing | null;
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

  // ------------------------------------------------------------------ ground
  /**
   * The ground, first.
   *
   * There was none until now: a circuit was a road ribbon with walls and a backdrop, and beyond the
   * walls there was nothing at all. That is why the world looked unfinished *and* why the barrier had
   * to sit at the tarmac edge — there was nowhere to run wide to.
   *
   * Built before the road so the road's own surface is written over it, and before the backdrop so
   * the backdrop knows how far the ground reaches.
   */
  const terrain = createTerrain(scene, nodes, theme, options.quality, materials);

  // ------------------------------------------------------------- backdrop
  // After the ground, so that if the panorama is missing the fallback colour is already decided and
  // there is never a frame with nothing behind the track.
  const backdrop = createBackdrop(scene, theme, options.catalog ?? null, visuals.structureColor);

  // ------------------------------------------------------------------ the building
  // Walls, columns, ceiling, skylights, lamps and ducts around the whole circuit. Built before the
  // dressing so the set can hang things on its walls and reach its ceiling.
  const hall = buildHall(scene, nodes, theme, options.quality, materials, terrain);

  // ------------------------------------------------------------------ road
  // Road UVs are measured in metres; the material's `tile` is the authoritative repeat size.
  const road = buildRoadSurface(scene, nodes, "track-road", { tileLength: 1, shoulder: 0.4 });
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
  /**
   * The barrier, at the far edge of the verge.
   *
   * It used to stand at the edge of the tarmac, which is what made every circuit a corridor. It is
   * built from nodes widened by the same amount `queryWall` uses, so what the player can see and
   * what the physics enforces are the same line — the alternative is a barrier you drive through or
   * an invisible one you hit.
   *
   * Taller than before, too: at sixteen metres away a 1.1 m wall is a kerb on the horizon. A barrier
   * that reads as a boundary from the racing line is what tells a driver where the course ends.
   */
  const barrierNodes = nodes.map((node) => ({ ...node, width: node.width + TerrainConfig.vergeMetres * 2 }));
  /**
   * A profiled barrier — plinth, warning band, rail on posts — instead of the 2.4 m sheet. Low enough
   * to see the hall over, solid enough to read as the edge of the course. `buildBarrier` sweeps the
   * theme's profile along these widened nodes, so the visible line and the physics line coincide.
   */
  const barrier = buildBarrier(scene, barrierNodes, theme, options.quality, materials);
  const barrierStyle = barrierStyleFor(theme);
  void visuals.wall;

  // Painted edge lines: the mark that separates ROAD from SHOULDER before any kerb does.
  const signageStyle = signageStyleFor(theme);
  const edgeMaterial = materials.get({ materialClass: "PLASTIC", color: signageStyle.edgeLine, emissive: 0.08 });
  const edgeLines: Mesh[] = [];
  for (const side of [1, -1] as const) {
    const line = buildEdgeLine(scene, nodes, side, 0.32, 0.55, `track-edge-${side > 0 ? "l" : "r"}`);
    if (!line) continue;
    line.material = edgeMaterial;
    line.isPickable = false;
    edgeLines.push(line);
  }

  // ------------------------------------------------------------------ kerbs, lanes, markings
  // A kerb has a chamfered inner edge the tyre rides up. A box has none, which is why the V4 kerbs
  // read as painted stripes lying on the floor rather than as raised concrete.
  // Narrow and a little taller than before: a 1.3 m slab read as a plate lying on the verge from the
  // racing line, and a kerb has to read as a raised edge.
  const kerbSource = beveledBox(scene, "track-kerb", {
    width: 0.8,
    height: 0.2,
    depth: 2.5,
    bevel: 0.06,
    cornerRadius: 0.08,
  });
  kerbSource.material = materials.get({ materialClass: "CONCRETE", color: "#f7f2e8", tile: 1.2 });
  kerbSource.isVisible = false;
  kerbSource.registerInstancedBuffer("color", 4);

  // Painted marking, not an object: the art bible exempts road and signage planes from bevel.
  const laneSource = MeshBuilder.CreateBox("track-lane", { width: 0.3, height: 0.02, depth: 3.4 }, scene);
  laneSource.material = lineMaterial;
  laneSource.isVisible = false;

  const kerbLight = Color3.FromHexString(barrierStyle.kerbLight);
  const kerbDark = Color3.FromHexString(barrierStyle.kerbDark);
  void visuals.kerbLight;
  void visuals.kerbDark;

  let nextLane = 0;
  let nextProp = 0;
  const allProps: PropSpec[] = [...visuals.props];
  for (const zone of Object.values(visuals.zoneProps ?? {})) allProps.push(...zone);
  const propSources = createPropSources(scene, materials, allProps, options.quality);
  const propWeights = buildWeightTable(visuals.props);
  const zoneWeights = new Map<number, PropSpec[]>();
  for (const [sector, specs] of Object.entries(visuals.zoneProps ?? {})) zoneWeights.set(Number(sector), buildWeightTable(specs));
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
    // context-layer objects visible per side. Seventeen metres keeps the rhythm while leaving clear
    // breathing space for the larger authored midground and landmark silhouettes.
    if (node.distance >= nextProp) {
      nextProp = node.distance + 17 / Math.max(0.35, density);
      for (const side of [1, -1] as const) {
        if (random() > 0.74) continue;
        const table = zoneWeights.get(node.sector) ?? propWeights;
        const spec = table[Math.floor(random() * table.length)]!;
        // Keyed by kind *and* print: two shirt displays with different designs are two sources.
        const source = propSources.get(propSourceKey(spec.kind, spec.texture));
        if (!source) continue;
        /**
         * Props stand beyond the barrier, not on the verge.
         *
         * They used to be placed two to seven metres from the road edge, which was two to seven
         * metres from the wall — outside the world the kart could reach. The verge changed that: a
         * shelf at that offset is now sitting on driveable ground, with no collider, so a kart runs
         * wide and drives through a rack of shirts. The run-off has to stay clear of solid objects,
         * which is also true of the circuits this is modelled on: run-off is flat and empty, and
         * everything with a silhouette is behind the barrier.
         */
        const distance = half + TerrainConfig.vergeMetres + 2.6 + random() * 5;
        const instance = source.mesh.createInstance(`prop-${index}-${side}`);
        const propX = node.x + frame.nx * distance * side;
        const propZ = node.z + frame.nz * distance * side;
        instance.position.set(
          propX,
          // On the ground outside the barrier, plus a mount height for the things that hang.
          terrain.heightAt(propX, propZ) + (spec.kind === "SCREEN" || spec.kind === "SIGN" ? 2.6 + random() * 1.6 : 0),
          propZ,
        );
        instance.rotation.y = frame.heading + (side > 0 ? Math.PI : 0) + (random() - 0.5) * 0.3;
        // Seeded scale and tint variation: two identical copies of a prop in one frame is the
        // failure mode the art bible calls out.
        const scale = 1.02 + random() * 0.55;
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

  // ------------------------------------------------------- posters and crowd
  /**
   * Wall dressing and spectators.
   *
   * Both sample the track by lap fraction rather than by angle, so they follow the circuit's real
   * shape; both return null where there is nothing to attach to. Posters skip a node whose wall is
   * open — a poster floating across a shortcut mouth is worse than a bare wall.
   */
  const nodeAtFraction = (fraction: number): TrackNode => {
    const index = Math.floor(((fraction % 1) + 1) % 1 * nodes.length) % nodes.length;
    return nodes[index]!;
  };

  const posters = hangPosters(
    scene,
    theme,
    circuitKeyForTheme(theme),
    options.quality,
    options.catalog ?? null,
    random,
    (fraction, side) => {
      const index = Math.floor(((fraction % 1) + 1) % 1 * nodes.length) % nodes.length;
      const node = nodes[index]!;
      const frame = frameAt(nodes, index);
      /**
       * On the hall's wall, not on the barrier.
       *
       * The barrier is a metre high now, so a poster on it would float. The building has walls, and
       * a poster belongs on a wall: the anchor projects the point beside the road out to the nearest
       * wall and hangs the poster there, high, as a hoarding. Bigger and further, which is what a
       * background layer should be.
       */
      const half = node.width / 2 + TerrainConfig.vergeMetres + 20;
      const anchor = hall.wallAnchor(node.x + frame.nx * side * half, node.z + frame.nz * side * half, hall.floorY + 7 + random() * 6);
      return { position: anchor.position, facing: anchor.facing };
    },
  );

  const crowd = createCrowd(
    scene,
    theme,
    options.quality,
    options.catalog ?? null,
    random,
    (fraction, offset) => {
      const index = Math.floor(((fraction % 1) + 1) % 1 * nodes.length) % nodes.length;
      const node = nodes[index]!;
      const frame = frameAt(nodes, index);
      /**
       * `offset` is measured from the barrier, not from the tarmac.
       *
       * It used to be measured from the road edge, which was the same line — the wall stood there.
       * Now that there are sixteen metres of driveable verge between the two, measuring from the
       * tarmac would put the front rank of spectators seven metres into the run-off: standing on a
       * surface karts are meant to use, and driven straight through.
       */
      const half = node.width / 2 + TerrainConfig.vergeMetres;
      const distance = half + Math.abs(offset);
      const side = Math.sign(offset) || 1;
      const x = node.x + frame.nx * side * distance;
      const z = node.z + frame.nz * side * distance;
      // Standing on the ground, not at the height of the road they are watching. Outside the barrier
      // the terrain has its own elevation, so anchoring to `node.y` floats a whole grandstand above
      // a dip and sinks it into a rise.
      return new Vector3(x, terrain.heightAt(x, z), z);
    },
  );
  // Plants and hanging stock, on the same sampler as the crowd.
  const spriteDressing = createSpriteDressing(
    scene,
    theme,
    options.quality,
    options.catalog ?? null,
    random,
    (fraction, offset) => {
      const index = Math.floor(((fraction % 1) + 1) % 1 * nodes.length) % nodes.length;
      const node = nodes[index]!;
      const frame = frameAt(nodes, index);
      // Beyond the barrier, as the crowd is: a fern in the middle of the run-off is an obstacle, and
      // a rack of shirts there is a collision the physics knows nothing about.
      const half = node.width / 2 + TerrainConfig.vergeMetres;
      const side = Math.sign(offset) || 1;
      const distance = half + Math.abs(offset);
      const x = node.x + frame.nx * side * distance;
      const z = node.z + frame.nz * side * distance;
      // On the ground, as the crowd is.
      return new Vector3(x, terrain.heightAt(x, z), z);
    },
  );
  void nodeAtFraction;

  // ------------------------------------------------------------------ features
  const nodeAt = (progress: number): TrackNode => nodes[Math.floor(((progress % 1) + 1) % 1 * nodes.length) % nodes.length]!;

  // ------------------------------------------------------------------ the set
  /**
   * The theme's authored dressing: hero landmarks where the route was designed around them, the
   * zone-by-zone machinery, the moving parts and the hazards that belong to the process. Built
   * before the generic features so a set can claim the landmarks and the hazards.
   */
  const animators: Animator[] = [];
  /**
   * Sector ranges from contiguous runs, with the wrap handled.
   *
   * The bake gives the last node or two the first control point's attributes, so sector 1 has nodes
   * at progress 0.998 as well as at 0. Taking min and max over its nodes therefore gave sector 1 the
   * whole lap, and everything the set placed by "a third of the way into the design zone" landed a
   * third of the way round the circuit. A run that touches the end of the lap is folded onto the run
   * at the start with a negative `from`, which every consumer wraps modulo one.
   */
  const sectorRanges = new Map<number, { from: number; to: number }>();
  {
    const runs: Array<{ sector: number; from: number; to: number; length: number }> = [];
    for (let index = 0; index < nodes.length; index += 1) {
      const node = nodes[index]!;
      const last = runs[runs.length - 1];
      if (last && last.sector === node.sector) {
        last.to = node.progress;
        last.length += 1;
      } else {
        runs.push({ sector: node.sector, from: node.progress, to: node.progress, length: 1 });
      }
    }
    const first = runs[0];
    const tail = runs[runs.length - 1];
    if (first && tail && runs.length > 1 && first.sector === tail.sector) {
      first.from = tail.from - 1;
      first.length += tail.length;
      runs.pop();
    }
    for (const run of runs) {
      const existing = sectorRanges.get(run.sector);
      const previousLength = existing ? (existing.to - existing.from) * nodes.length : -1;
      if (!existing || run.length > previousLength) sectorRanges.set(run.sector, { from: run.from, to: run.to });
    }
  }
  const placementAt = (progress: number): Placement => {
    const index = Math.floor(((progress % 1) + 1) % 1 * nodes.length) % nodes.length;
    return { node: nodes[index]!, index, frame: frameAt(nodes, index) };
  };
  const dressingContext: DressingContext = {
    scene,
    materials,
    lighting,
    terrain,
    hall,
    baked,
    nodes,
    quality: options.quality,
    detailed: options.quality === "HIGH" || options.quality === "ULTRA",
    random,
    catalog: options.catalog ?? null,
    accentA: visuals.accentA,
    accentB: visuals.accentB,
    at: placementAt,
    sectorRange: (sector) => sectorRanges.get(sector) ?? { from: 0, to: 1 },
    heightAt: terrain.heightAt,
    beside: (progress, lateral, height = 0) => {
      const placement = placementAt(progress);
      const x = placement.node.x + placement.frame.nx * lateral;
      const z = placement.node.z + placement.frame.nz * lateral;
      const halfRoad = placement.node.width * 0.5;
      const onRoad = Math.abs(lateral) <= halfRoad + TerrainConfig.vergeMetres;
      const banked = Math.tan(placement.node.banking) * Math.max(-halfRoad, Math.min(halfRoad, lateral));
      const y = onRoad ? placement.node.y + banked : terrain.heightAt(x, z);
      return new Vector3(x, y + height, z);
    },
    animators,
    addShadowCaster: (mesh) => lighting.addShadowCaster(mesh),
  };
  const dressing = dressTrack(theme, dressingContext);

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
      holder.rotation.y = frame.heading;
      // A hazard that belongs to the world, when the set knows how to build one for this kind.
      if (dressing?.buildHazard?.(feature.hazard, holder, { node, index: nodes.indexOf(node), frame }, feature.lane)) {
        hazards.push({
          kind: feature.hazard,
          position: holder.position.clone(),
          node: holder,
          progress: feature.progress,
          cooldown: 0,
          power: 1,
        });
        continue;
      }
      holder.rotation.y = 0;
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
      if (dressing?.landmarksHandled) {
        // The set placed this circuit's landmarks where the route was designed around them.
        const placed = dressing.landmarks[landmarks.length];
        if (placed) {
          landmarks.push({ kind: "LANDMARK", position: placed.position.clone(), node: null, progress: placed.progress, cooldown: 0, power: 1, label: placed.label });
        }
        continue;
      }
      const node = nodeAt(feature.progress);
      const index = nodes.indexOf(node);
      const frame = frameAt(nodes, index);
      // Beyond the barrier, like the props: a landmark is the largest thing beside the track and the
      // worst thing to leave standing in the middle of the run-off.
      const offset = node.width * 0.5 + TerrainConfig.vergeMetres + 9;
      const holder = new TransformNode(`landmark-${feature.label}`, scene);
      const landmarkX = node.x + frame.nx * offset * feature.side;
      const landmarkZ = node.z + frame.nz * offset * feature.side;
      holder.position.set(landmarkX, terrain.heightAt(landmarkX, landmarkZ), landmarkZ);
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

  /**
   * The finish board carries the brand and the word META, painted, with a lit accent rule — a real
   * gate rather than a glowing bar. The painter is shared with the zone signs, so the finish reads
   * as part of the same signage system the player has followed round the lap.
   */
  const gatePainter = new SignPainter(scene);
  const gatePlate = materials.get({ materialClass: "PLASTIC", color: signageStyle.plate });
  const banner = createBoard(
    scene,
    "start-banner",
    { width: start.width - 1, height: 2.1, depth: 0.35 },
    gatePainter.material("PAMPLING", { width: 1024, height: 160, plate: signageStyle.plate, ink: signageStyle.ink, accent: visuals.accentA, caption: "META", glow: 0.5 }),
    gatePlate,
    { doubleSided: true },
  );
  banner.position.set(start.x, start.y + 8.1, start.z);
  banner.rotation.y = startFrame.heading;
  edgeLines.push(banner);
  // Chequered flags either side of the board.
  for (const side of [-1, 1] as const) {
    const flag = createBoard(
      scene,
      `start-flag-${side}`,
      { width: 1.9, height: 1.9, depth: 0.12 },
      gatePainter.material("CHEQUER", { width: 256, height: 256, plate: "#f7f2e8", ink: "#12101a", checker: true }),
      gatePlate,
      { doubleSided: true },
    );
    flag.position.set(
      start.x + startFrame.nx * side * (start.width * 0.5 + 0.9),
      start.y + 8.1,
      start.z + startFrame.nz * side * (start.width * 0.5 + 0.9),
    );
    flag.rotation.y = startFrame.heading;
    edgeLines.push(flag);
  }

  // ------------------------------------------------------------------ signage
  // Zone gates at every sector start and chevron boards before every real corner.
  const signage = buildSignage({
    scene,
    nodes,
    sectors: baked.blueprint.sectors,
    theme,
    quality: options.quality,
    materials,
    heightAt: terrain.heightAt,
    avoidProgress: [0, ...baked.blueprint.features.filter((feature) => feature.kind === "JUMP").map((feature) => feature.progress)],
  });

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
    terrain,
    decals,
    posters,
    crowd,
    spriteDressing,
    boostPads,
    jumpPads,
    itemBoxes,
    hazards,
    landmarks,
    shortcuts,
    animated,
    animators,
    hall,
    barrier,
    signage,
    dressing: dressing ?? null,
    dispose: () => {
      dressing?.dispose();
      signage.dispose();
      gatePainter.dispose();
      barrier.dispose();
      hall.dispose();
      lighting.dispose();
      materials.dispose();
      backdrop.dispose();
      terrain.dispose();
      decals.dispose();
      posters.dispose();
      crowd.dispose();
      spriteDressing.dispose();
      road.dispose();
      edgeLines.forEach((line) => line.dispose());
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
