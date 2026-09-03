import { Color3, Color4, Mesh, TransformNode, Vector2, Vector3, type Scene } from "@babylonjs/core";
import type { TrackNode } from "@print-rush/game-core";
import { TerrainConfig } from "@print-rush/game-core";
import type { MaterialLibrary, MaterialClass, MaterialRequest } from "./MaterialLibrary";
import { beveledBox, mergeParts, revolve, tube } from "./Geometry";
import { frameAt } from "./RoadMesh";
import type { Terrain } from "./Terrain";

/**
 * THE HALL.
 *
 * Every Pampling circuit is indoors — a shop, a warehouse, a print works, an office, a convention
 * hall — and until now none of them had a building. A circuit was a road on an open plain under a
 * painted sky, which is the single reason a frame read as "a game built out of geometry": there was
 * no space for the track to be *in*.
 *
 * This builds the space. From the circuit's own bounding box it raises perimeter walls, stands a
 * column grid that keeps clear of the road, closes the volume with a ceiling carried on trusses, cuts
 * skylights into it, hangs lamps along the route at a constant height above the road, and runs the
 * ducts and cable trays that a real hall has — which happen to be the flow lines the brief asks for,
 * because they follow the track.
 *
 * Six depth layers come out of it for free: the road (L0), the barrier (L1), the trackside props
 * (L2), the columns and machinery (L3), the far walls with their window band (L4) and the panorama
 * seen through and above them (L5). Before this there were two.
 *
 * Everything repeated is instanced from one source, so the whole hall — several hundred columns,
 * lamps, windows, trusses and skylights — costs under twenty draw calls.
 */

export type HallBand = {
  /** Height of the band in metres. The last band stretches to the ceiling. */
  height: number;
  materialClass: MaterialClass;
  color: string;
  texture?: string;
  tile?: number;
  /** A lit band: window glass or a light box. */
  emissive?: number;
  /**
   * Panes rather than a continuous surface: individual lit rectangles with mullions between them,
   * which is what a window band or a run of light boxes is.
   */
  panes?: { width: number; gap: number; color: string; emissive: number };
};

export type HallSpec = {
  /** Metres from the outermost piece of road to the wall. */
  margin: number;
  /** Ceiling height above the circuit's lowest road. */
  ceilingHeight: number;
  ceiling: MaterialRequest;
  walls: HallBand[];
  /** Pilasters on the walls and the free-standing grid inside. */
  columns: { spacing: number; size: number; material: MaterialRequest; base?: MaterialRequest; baseHeight?: number };
  trusses: { spacing: number; depth: number; material: MaterialRequest } | null;
  skylights: { rows: number; width: number; length: number; color: string; emissive: number } | null;
  /** Lamps hung along the route, at `height` above the road. */
  lamps: { spacing: number; height: number; color: string; shade: string; size: number } | null;
  /** A duct or cable tray that follows the road beside the lamps. */
  duct: { radius: number; height: number; material: MaterialRequest } | null;
  /** Big services along the long axis of the ceiling. */
  ceilingDucts: { count: number; radius: number; material: MaterialRequest } | null;
};

/**
 * The five halls.
 *
 * Read against `docs/ART_BIBLE_V5.md` §2: each is the world palette expressed as a building. The
 * print works is the golden standard and the most fully specified; the others take the same
 * structure with their own proportions and materials.
 */
export const HALLS: Record<string, HallSpec> = {
  PRINT_FACTORY: {
    margin: 58,
    ceilingHeight: 27,
    ceiling: { materialClass: "PAINTED_METAL", color: "#3d404f", tile: 6 },
    walls: [
      { height: 3.2, materialClass: "CONCRETE", color: "#5c5866", texture: "mat_concrete_factory", tile: 3 },
      { height: 0.5, materialClass: "PAINTED_METAL", color: "#ffd43b", texture: "mat_safety_yellow", tile: 1.4 },
      { height: 9.8, materialClass: "PAINTED_METAL", color: "#5b6274", texture: "mat_cladding_factory", tile: 2.6 },
      { height: 5.2, materialClass: "SCREEN", color: "#a9a2d6", emissive: 0.32, panes: { width: 7, gap: 1.2, color: "#cfc6ff", emissive: 0.55 } },
      { height: 8.3, materialClass: "PAINTED_METAL", color: "#4b5162", texture: "mat_cladding_factory", tile: 2.6 },
    ],
    columns: {
      spacing: 44,
      size: 1.5,
      material: { materialClass: "PAINTED_METAL", color: "#3a3f49", texture: "mat_paintedmetal_press", tile: 2 },
      base: { materialClass: "PAINTED_METAL", color: "#ffd43b", texture: "mat_safety_yellow", tile: 1.2 },
      baseHeight: 1.4,
    },
    trusses: { spacing: 22, depth: 2.2, material: { materialClass: "PAINTED_METAL", color: "#4d5468", tile: 2 } },
    skylights: { rows: 6, width: 4.5, length: 14, color: "#d8d4ea", emissive: 0.9 },
    lamps: { spacing: 16, height: 9.5, color: "#eef0ff", shade: "#2b2e3a", size: 1.1 },
    duct: { radius: 0.9, height: 12.5, material: { materialClass: "PAINTED_METAL", color: "#6b7385", tile: 2 } },
    ceilingDucts: { count: 3, radius: 1.5, material: { materialClass: "RAW_METAL", color: "#8e96a3", tile: 3 } },
  },
  WAREHOUSE: {
    margin: 62,
    ceilingHeight: 25,
    ceiling: { materialClass: "PAINTED_METAL", color: "#8c95a3", tile: 6 },
    walls: [
      { height: 2.6, materialClass: "CONCRETE", color: "#7a7f88", texture: "mat_concrete_warehouse", tile: 3 },
      { height: 0.5, materialClass: "PAINTED_METAL", color: "#ffc02e", texture: "mat_safety_yellow", tile: 1.4 },
      { height: 12.4, materialClass: "PAINTED_METAL", color: "#9aa3b0", tile: 2.4 },
      { height: 4.5, materialClass: "SCREEN", color: "#cfe0f2", emissive: 0.4, panes: { width: 6, gap: 1, color: "#e8f2ff", emissive: 0.7 } },
      { height: 5, materialClass: "PAINTED_METAL", color: "#8b94a2", tile: 2.4 },
    ],
    columns: {
      spacing: 40,
      size: 1.3,
      material: { materialClass: "PAINTED_METAL", color: "#5a6068", texture: "mat_paintedmetal_racking", tile: 2 },
      base: { materialClass: "PAINTED_METAL", color: "#ffc02e", texture: "mat_safety_yellow", tile: 1.2 },
      baseHeight: 1.2,
    },
    trusses: { spacing: 20, depth: 2, material: { materialClass: "PAINTED_METAL", color: "#6d7583", tile: 2 } },
    skylights: { rows: 5, width: 4, length: 16, color: "#eef4ff", emissive: 1 },
    lamps: { spacing: 14, height: 9, color: "#f4f8ff", shade: "#3a3f49", size: 1 },
    duct: { radius: 0.7, height: 11.5, material: { materialClass: "PAINTED_METAL", color: "#7d8695", tile: 2 } },
    ceilingDucts: { count: 2, radius: 1.3, material: { materialClass: "RAW_METAL", color: "#9fa6ad", tile: 3 } },
  },
  FLAGSHIP: {
    margin: 46,
    ceilingHeight: 16,
    ceiling: { materialClass: "PLASTIC", color: "#ebe4d8", tile: 4 },
    walls: [
      { height: 1.1, materialClass: "WOOD", color: "#c98a52", texture: "mat_wood_store", tile: 2.2 },
      { height: 7.4, materialClass: "PLASTIC", color: "#e8dfd0", tile: 4 },
      { height: 3.2, materialClass: "SCREEN", color: "#f7f2e8", emissive: 0.25, panes: { width: 5, gap: 0.8, color: "#fff4df", emissive: 0.5 } },
      { height: 4.3, materialClass: "PLASTIC", color: "#e2d9ca", tile: 4 },
    ],
    columns: {
      spacing: 42,
      size: 1.1,
      material: { materialClass: "PLASTIC", color: "#ece6da", tile: 2 },
      base: { materialClass: "WOOD", color: "#c98a52", texture: "mat_wood_store", tile: 1.5 },
      baseHeight: 0.9,
    },
    trusses: null,
    skylights: { rows: 6, width: 3, length: 3, color: "#fff3dc", emissive: 0.85 },
    lamps: { spacing: 12, height: 7, color: "#ffe9c4", shade: "#2b2732", size: 0.7 },
    duct: null,
    ceilingDucts: null,
  },
  OFFICE: {
    margin: 44,
    ceilingHeight: 14,
    ceiling: { materialClass: "FLOOR_TILE", color: "#f0efe9", texture: "mat_floortile_office", tile: 1.2 },
    walls: [
      { height: 0.9, materialClass: "PLASTIC", color: "#dcd6cb", tile: 3 },
      { height: 7.6, materialClass: "SCREEN", color: "#cfe4f2", emissive: 0.3, panes: { width: 4, gap: 0.35, color: "#dcedfa", emissive: 0.5 } },
      { height: 5.5, materialClass: "PLASTIC", color: "#e6e1d8", tile: 3 },
    ],
    columns: {
      spacing: 26,
      size: 0.9,
      material: { materialClass: "PLASTIC", color: "#f1ede6", tile: 2 },
    },
    trusses: null,
    skylights: { rows: 8, width: 2.4, length: 2.4, color: "#f7fbff", emissive: 0.95 },
    lamps: null,
    duct: { radius: 0.35, height: 8.5, material: { materialClass: "PLASTIC", color: "#d8d3ca", tile: 2 } },
    ceilingDucts: null,
  },
  MANGA: {
    margin: 60,
    ceilingHeight: 30,
    ceiling: { materialClass: "PAINTED_METAL", color: "#1a1528", tile: 6 },
    walls: [
      { height: 2.4, materialClass: "PAINTED_METAL", color: "#2a2340", tile: 3 },
      { height: 0.3, materialClass: "NEON", color: "#ff3da6", emissive: 1 },
      { height: 13.8, materialClass: "FABRIC", color: "#241d3c", tile: 3 },
      { height: 3.5, materialClass: "SCREEN", color: "#8f5cff", emissive: 0.45, panes: { width: 9, gap: 2, color: "#65d8ff", emissive: 0.8 } },
      { height: 10, materialClass: "PAINTED_METAL", color: "#1f1930", tile: 3 },
    ],
    columns: {
      spacing: 46,
      size: 1.6,
      material: { materialClass: "PAINTED_METAL", color: "#2b2540", tile: 2 },
      base: { materialClass: "NEON", color: "#65d8ff" },
      baseHeight: 0.4,
    },
    trusses: { spacing: 18, depth: 2.4, material: { materialClass: "RAW_METAL", color: "#6e6a86", tile: 2 } },
    skylights: { rows: 3, width: 1.2, length: 18, color: "#ff3da6", emissive: 1 },
    lamps: { spacing: 12, height: 10, color: "#c9b8ff", shade: "#16121f", size: 0.9 },
    duct: { radius: 0.5, height: 12, material: { materialClass: "PAINTED_METAL", color: "#3a3350", tile: 2 } },
    ceilingDucts: null,
  },
};

export type Hall = {
  root: TransformNode;
  meshes: Mesh[];
  bounds: { minX: number; maxX: number; minZ: number; maxZ: number };
  floorY: number;
  ceilingY: number;
  /**
   * A point on the nearest wall's inner face and the direction into the hall from it, for hanging
   * things — posters, banners, signs — on the building rather than in mid-air.
   */
  wallAnchor: (x: number, z: number, height: number) => { position: Vector3; facing: Vector3 };
  dispose: () => void;
};

/** Distance from a point to the nearest centreline node, using a coarse spatial hash. */
function nearestRoad(nodes: readonly TrackNode[]): (x: number, z: number) => number {
  const cell = 40;
  const buckets = new Map<string, TrackNode[]>();
  for (const node of nodes) {
    const key = `${Math.floor(node.x / cell)}:${Math.floor(node.z / cell)}`;
    const bucket = buckets.get(key);
    if (bucket) bucket.push(node);
    else buckets.set(key, [node]);
  }
  return (x, z) => {
    const cx = Math.floor(x / cell);
    const cz = Math.floor(z / cell);
    let best = Infinity;
    for (let ox = -1; ox <= 1; ox += 1) {
      for (let oz = -1; oz <= 1; oz += 1) {
        const bucket = buckets.get(`${cx + ox}:${cz + oz}`);
        if (!bucket) continue;
        for (const node of bucket) {
          const distance = Math.hypot(node.x - x, node.z - z) - node.width * 0.5;
          if (distance < best) best = distance;
        }
      }
    }
    return best;
  };
}

export function hallSpecFor(theme: string): HallSpec {
  return HALLS[theme] ?? HALLS.PRINT_FACTORY!;
}

export function buildHall(
  scene: Scene,
  nodes: readonly TrackNode[],
  theme: string,
  quality: string,
  materials: MaterialLibrary,
  terrain: Terrain,
): Hall {
  const spec = hallSpecFor(theme);
  const root = new TransformNode(`hall-${theme}`, scene);
  const meshes: Mesh[] = [];
  const detailed = quality === "HIGH" || quality === "ULTRA";

  // ------------------------------------------------------------------ extent
  let minX = Infinity;
  let maxX = -Infinity;
  let minZ = Infinity;
  let maxZ = -Infinity;
  let minY = Infinity;
  let maxY = -Infinity;
  for (const node of nodes) {
    minX = Math.min(minX, node.x - node.width);
    maxX = Math.max(maxX, node.x + node.width);
    minZ = Math.min(minZ, node.z - node.width);
    maxZ = Math.max(maxZ, node.z + node.width);
    minY = Math.min(minY, node.y);
    maxY = Math.max(maxY, node.y);
  }
  minX -= spec.margin;
  maxX += spec.margin;
  minZ -= spec.margin;
  maxZ += spec.margin;
  const width = maxX - minX;
  const depth = maxZ - minZ;
  const centreX = (minX + maxX) / 2;
  const centreZ = (minZ + maxZ) / 2;
  // The walls go well below the floor: the terrain eases downward away from the road and a wall
  // that stops at floor level would show a slit of panorama under it.
  const floorY = minY - 0.5;
  const footY = minY - 6;
  // The ceiling clears the highest road by a real margin, whatever the spec says.
  const ceilingY = Math.max(minY + spec.ceilingHeight, maxY + 11);

  const keep = (mesh: Mesh): Mesh => {
    mesh.parent = root;
    mesh.isPickable = false;
    mesh.receiveShadows = false;
    meshes.push(mesh);
    return mesh;
  };

  // ------------------------------------------------------------------ walls
  /**
   * Four walls, each a stack of bands. A band is one long chamfered slab with its texture tiled by
   * real metres, so a nine-hundred-metre wall repeats its cladding every few metres rather than
   * stretching one tile across the building.
   */
  const sides: Array<{ length: number; cx: number; cz: number; rotation: number; inward: Vector3 }> = [
    { length: width, cx: centreX, cz: minZ, rotation: 0, inward: new Vector3(0, 0, 1) },
    { length: width, cx: centreX, cz: maxZ, rotation: Math.PI, inward: new Vector3(0, 0, -1) },
    { length: depth, cx: minX, cz: centreZ, rotation: Math.PI / 2, inward: new Vector3(1, 0, 0) },
    { length: depth, cx: maxX, cz: centreZ, rotation: -Math.PI / 2, inward: new Vector3(-1, 0, 0) },
  ];

  const paneSources = new Map<number, Mesh>();
  for (const [sideIndex, side] of sides.entries()) {
    let y = footY;
    for (const [bandIndex, band] of spec.walls.entries()) {
      const isLast = bandIndex === spec.walls.length - 1;
      const bandHeight = isLast ? Math.max(band.height, ceilingY + 1 - y) : band.height + (bandIndex === 0 ? floorY - footY : 0);
      const tile = band.tile ?? 3;
      const slab = beveledBox(scene, `hall-wall-${sideIndex}-${bandIndex}`, {
        width: side.length + 2,
        height: bandHeight,
        depth: 1.2,
        bevel: 0.06,
        cornerRadius: 0.08,
        cornerSegments: 2,
        uScale: (2 * (side.length + 3.2)) / tile,
        vScale: 1 / tile,
      });
      slab.position.set(side.cx, y + bandHeight / 2, side.cz);
      slab.rotation.y = side.rotation;
      const request: MaterialRequest = { materialClass: band.materialClass, color: band.color, tile };
      if (band.texture) request.texture = band.texture;
      if (band.emissive !== undefined) request.emissive = band.emissive;
      slab.material = materials.get(request);
      slab.freezeWorldMatrix();
      keep(slab);

      // Panes on the inner face of a lit band.
      if (band.panes) {
        let source = paneSources.get(bandIndex);
        if (!source) {
          source = beveledBox(scene, `hall-pane-${bandIndex}`, {
            width: band.panes.width,
            height: bandHeight - 0.8,
            depth: 0.18,
            bevel: 0.03,
          });
          source.material = materials.get({ materialClass: "NEON", color: band.panes.color, emissive: band.panes.emissive });
          source.isVisible = false;
          source.registerInstancedBuffer("color", 4);
          paneSources.set(bandIndex, source);
          keep(source);
        }
        const pitch = band.panes.width + band.panes.gap;
        const count = Math.floor(side.length / pitch);
        const start = -((count - 1) * pitch) / 2;
        const tint = Color3.FromHexString(band.panes.color);
        for (let index = 0; index < count; index += 1) {
          const along = start + index * pitch;
          const instance = source.createInstance(`hall-pane-${sideIndex}-${bandIndex}-${index}`);
          // Along the wall, then pushed just inside its face.
          const cos = Math.cos(side.rotation);
          const sin = Math.sin(side.rotation);
          instance.position.set(
            side.cx + cos * along + side.inward.x * 0.72,
            y + bandHeight / 2,
            side.cz - sin * along + side.inward.z * 0.72,
          );
          instance.rotation.y = side.rotation;
          // Windows are never all the same brightness: some bays are lit, some are dusk.
          const shade = 0.72 + (((index * 7 + sideIndex * 3) % 5) / 5) * 0.4;
          instance.instancedBuffers.color = new Color4(tint.r * shade, tint.g * shade, tint.b * shade, 1);
          instance.isPickable = false;
          instance.freezeWorldMatrix();
        }
      }
      y += bandHeight;
    }
  }

  // ------------------------------------------------------------------ ceiling
  const ceiling = beveledBox(scene, "hall-ceiling", {
    width: width + 2,
    height: 1.2,
    depth: depth + 2,
    bevel: 0.1,
    cornerSegments: 2,
    uScale: (2 * (width + depth + 4)) / (spec.ceiling.tile ?? 6),
    vScale: 1 / (spec.ceiling.tile ?? 6),
  });
  ceiling.position.set(centreX, ceilingY + 0.6, centreZ);
  ceiling.material = materials.get(spec.ceiling);
  ceiling.freezeWorldMatrix();
  keep(ceiling);

  // Trusses across the short axis, purlins along the long one.
  if (spec.trusses) {
    const alongX = width >= depth;
    const spanLength = alongX ? depth : width;
    const runLength = alongX ? width : depth;
    const trussSource = beveledBox(scene, "hall-truss", {
      width: spanLength,
      height: spec.trusses.depth,
      depth: 0.7,
      bevel: 0.05,
      cornerSegments: 2,
      uScale: spanLength / 2,
      vScale: 0.5,
    });
    trussSource.material = materials.get(spec.trusses.material);
    trussSource.isVisible = false;
    keep(trussSource);
    const count = Math.floor(runLength / spec.trusses.spacing);
    for (let index = 0; index <= count; index += 1) {
      const along = -runLength / 2 + index * spec.trusses.spacing;
      const instance = trussSource.createInstance(`hall-truss-${index}`);
      instance.position.set(
        alongX ? centreX + along : centreX,
        ceilingY - spec.trusses.depth / 2,
        alongX ? centreZ : centreZ + along,
      );
      instance.rotation.y = alongX ? Math.PI / 2 : 0;
      instance.isPickable = false;
      instance.freezeWorldMatrix();
    }
    if (detailed) {
      const purlinSource = beveledBox(scene, "hall-purlin", {
        width: runLength,
        height: 0.5,
        depth: 0.36,
        bevel: 0.03,
        cornerSegments: 2,
      });
      purlinSource.material = materials.get(spec.trusses.material);
      purlinSource.isVisible = false;
      keep(purlinSource);
      const purlins = Math.floor(spanLength / 12);
      for (let index = 1; index < purlins; index += 1) {
        const across = -spanLength / 2 + index * 12;
        const instance = purlinSource.createInstance(`hall-purlin-${index}`);
        instance.position.set(
          alongX ? centreX : centreX + across,
          ceilingY - spec.trusses.depth - 0.25,
          alongX ? centreZ + across : centreZ,
        );
        instance.rotation.y = alongX ? 0 : Math.PI / 2;
        instance.isPickable = false;
        instance.freezeWorldMatrix();
      }
    }
  }

  // Skylights: lit panels let into the ceiling in rows.
  if (spec.skylights) {
    const sky = spec.skylights;
    const source = beveledBox(scene, "hall-skylight", {
      width: sky.width,
      height: 0.3,
      depth: sky.length,
      bevel: 0.04,
      cornerSegments: 2,
    });
    source.material = materials.get({ materialClass: "NEON", color: sky.color, emissive: sky.emissive });
    source.isVisible = false;
    keep(source);
    const alongX = width >= depth;
    const runLength = alongX ? width : depth;
    const spanLength = alongX ? depth : width;
    const pitchAlong = sky.length * 1.9;
    const count = Math.floor((runLength - 20) / pitchAlong);
    for (let row = 0; row < sky.rows; row += 1) {
      const across = -spanLength / 2 + ((row + 0.5) / sky.rows) * spanLength;
      for (let index = 0; index < count; index += 1) {
        const along = -runLength / 2 + 10 + (index + 0.5) * pitchAlong;
        const instance = source.createInstance(`hall-skylight-${row}-${index}`);
        instance.position.set(
          alongX ? centreX + along : centreX + across,
          ceilingY - 0.05,
          alongX ? centreZ + across : centreZ + along,
        );
        instance.rotation.y = alongX ? Math.PI / 2 : 0;
        instance.isPickable = false;
        instance.freezeWorldMatrix();
      }
    }
  }

  // Big services along the ceiling.
  if (spec.ceilingDucts) {
    const alongX = width >= depth;
    const runLength = alongX ? width : depth;
    const spanLength = alongX ? depth : width;
    for (let index = 0; index < spec.ceilingDucts.count; index += 1) {
      const across = -spanLength / 2 + ((index + 0.5) / spec.ceilingDucts.count) * spanLength + (index % 2 === 0 ? 9 : -9);
      const y = ceilingY - (spec.trusses ? spec.trusses.depth : 0) - spec.ceilingDucts.radius - 0.6;
      const a = new Vector3(alongX ? centreX - runLength / 2 : centreX + across, y, alongX ? centreZ + across : centreZ - runLength / 2);
      const b = new Vector3(alongX ? centreX + runLength / 2 : centreX + across, y, alongX ? centreZ + across : centreZ + runLength / 2);
      const duct = tube(scene, `hall-ceiling-duct-${index}`, [a, b], spec.ceilingDucts.radius, detailed ? 14 : 8);
      duct.material = materials.get(spec.ceilingDucts.material);
      duct.freezeWorldMatrix();
      keep(duct);
    }
  }

  // ------------------------------------------------------------------ columns
  const columnHeight = ceilingY - footY;
  const columnSource = beveledBox(scene, "hall-column", {
    width: spec.columns.size,
    height: columnHeight,
    depth: spec.columns.size,
    bevel: Math.min(0.06, spec.columns.size * 0.08),
    cornerSegments: 3,
    uScale: (4 * spec.columns.size) / (spec.columns.material.tile ?? 2),
    vScale: 1 / (spec.columns.material.tile ?? 2),
  });
  columnSource.material = materials.get(spec.columns.material);
  columnSource.isVisible = false;
  keep(columnSource);

  let baseSource: Mesh | null = null;
  if (spec.columns.base) {
    baseSource = beveledBox(scene, "hall-column-base", {
      width: spec.columns.size + 0.24,
      height: spec.columns.baseHeight ?? 1,
      depth: spec.columns.size + 0.24,
      bevel: 0.04,
      cornerSegments: 3,
      uScale: (4 * (spec.columns.size + 0.24)) / (spec.columns.base.tile ?? 1.2),
      vScale: 1 / (spec.columns.base.tile ?? 1.2),
    });
    baseSource.material = materials.get(spec.columns.base);
    baseSource.isVisible = false;
    keep(baseSource);
  }

  const roadDistance = nearestRoad(nodes);
  let columnIndex = 0;
  const placeColumn = (x: number, z: number): void => {
    const instance = columnSource.createInstance(`hall-column-${columnIndex}`);
    instance.position.set(x, footY + columnHeight / 2, z);
    instance.isPickable = false;
    instance.freezeWorldMatrix();
    if (baseSource) {
      const base = baseSource.createInstance(`hall-column-base-${columnIndex}`);
      const groundY = terrain.heightAt(x, z);
      base.position.set(x, groundY + (spec.columns.baseHeight ?? 1) / 2, z);
      base.isPickable = false;
      base.freezeWorldMatrix();
    }
    columnIndex += 1;
  };

  // Pilasters along the walls.
  const inset = spec.columns.size / 2 + 0.7;
  for (const side of sides) {
    const count = Math.floor(side.length / spec.columns.spacing);
    for (let index = 0; index <= count; index += 1) {
      const along = -side.length / 2 + index * spec.columns.spacing;
      const cos = Math.cos(side.rotation);
      const sin = Math.sin(side.rotation);
      placeColumn(side.cx + cos * along + side.inward.x * inset, side.cz - sin * along + side.inward.z * inset);
    }
  }
  // The free-standing grid, kept clear of the road and its run-off.
  const clearance = TerrainConfig.vergeMetres + spec.columns.size + 4;
  const gridX = Math.floor(width / spec.columns.spacing);
  const gridZ = Math.floor(depth / spec.columns.spacing);
  for (let ix = 1; ix < gridX; ix += 1) {
    for (let iz = 1; iz < gridZ; iz += 1) {
      const x = minX + (ix / gridX) * width;
      const z = minZ + (iz / gridZ) * depth;
      if (roadDistance(x, z) < clearance) continue;
      placeColumn(x, z);
    }
  }

  // ------------------------------------------------------------------ lamps along the route
  /**
   * Pendant lamps at a constant height above the road, following its rises and falls. These are the
   * practicals: they say "this is a lit building", they put a rhythm of bright points into the
   * frame that reads as speed, and they lead the eye down the track before any arrow does.
   */
  if (spec.lamps) {
    const lamp = spec.lamps;
    const shade = revolve(
      scene,
      "hall-lamp-shade",
      [
        new Vector2(0.06, 0.55),
        new Vector2(0.18, 0.5),
        new Vector2(0.3, 0.32),
        new Vector2(lamp.size, 0.02),
        new Vector2(lamp.size * 0.98, 0),
      ],
      detailed ? 18 : 10,
      { capStart: false, capEnd: false },
    );
    shade.material = materials.get({ materialClass: "PAINTED_METAL", color: lamp.shade });
    const disc = revolve(
      scene,
      "hall-lamp-disc",
      [new Vector2(0.001, 0.0), new Vector2(lamp.size * 0.92, 0.0), new Vector2(lamp.size * 0.9, -0.05), new Vector2(0.001, -0.05)],
      detailed ? 18 : 10,
    );
    disc.material = materials.get({ materialClass: "NEON", color: lamp.color, emissive: 1 });
    const stem = tube(scene, "hall-lamp-stem", [new Vector3(0, 0.55, 0), new Vector3(0, 1.4, 0)], 0.04, 6);
    stem.material = materials.get({ materialClass: "RAW_METAL", color: "#6e737a" });
    const lampSource = mergeParts("hall-lamp", [shade, disc, stem], true);
    lampSource.isVisible = false;
    lampSource.isPickable = false;
    keep(lampSource);

    let next = 0;
    let lampIndex = 0;
    for (let index = 0; index < nodes.length; index += 1) {
      const node = nodes[index]!;
      if (node.distance < next) continue;
      next = node.distance + lamp.spacing;
      const frame = frameAt(nodes, index);
      // Alternating sides of the centreline, over the road edge rather than the middle, so the
      // string of lights frames the road instead of hiding the corner behind it.
      const side = lampIndex % 2 === 0 ? 1 : -1;
      const lateral = node.width * 0.32 * side;
      const instance = lampSource.createInstance(`hall-lamp-${lampIndex}`);
      instance.position.set(node.x + frame.nx * lateral, node.y + lamp.height, node.z + frame.nz * lateral);
      instance.isPickable = false;
      instance.freezeWorldMatrix();
      lampIndex += 1;
    }
  }

  // ------------------------------------------------------------------ duct following the road
  /**
   * A service run beside the route at height. This is the flow line: a continuous element that
   * turns where the track turns and climbs where it climbs, visible ahead before the corner is.
   */
  if (spec.duct) {
    const duct = spec.duct;
    const path: Vector3[] = [];
    for (let index = 0; index < nodes.length; index += 5) {
      const node = nodes[index]!;
      const frame = frameAt(nodes, index);
      const lateral = -(node.width * 0.5 + TerrainConfig.vergeMetres * 0.6);
      path.push(new Vector3(node.x + frame.nx * lateral, node.y + duct.height, node.z + frame.nz * lateral));
    }
    path.push(path[0]!.clone());
    const run = tube(scene, "hall-route-duct", path, duct.radius, detailed ? 10 : 6);
    run.material = materials.get(duct.material);
    run.freezeWorldMatrix();
    keep(run);
    // Hangers to the ceiling every few segments.
    const hanger = tube(scene, "hall-duct-hanger", [new Vector3(0, 0, 0), new Vector3(0, 1, 0)], 0.05, 5);
    hanger.material = materials.get({ materialClass: "RAW_METAL", color: "#6e737a" });
    hanger.isVisible = false;
    keep(hanger);
    for (let index = 0; index < path.length - 1; index += 6) {
      const point = path[index]!;
      const instance = hanger.createInstance(`hall-duct-hanger-${index}`);
      const length = ceilingY - point.y - duct.radius;
      instance.position.set(point.x, point.y + duct.radius, point.z);
      instance.scaling.y = Math.max(0.5, length);
      instance.isPickable = false;
      instance.freezeWorldMatrix();
    }
  }

  const wallAnchor = (x: number, z: number, height: number): { position: Vector3; facing: Vector3 } => {
    const distances = [
      { d: z - minZ, position: new Vector3(x, height, minZ + 0.7), facing: new Vector3(0, 0, 1) },
      { d: maxZ - z, position: new Vector3(x, height, maxZ - 0.7), facing: new Vector3(0, 0, -1) },
      { d: x - minX, position: new Vector3(minX + 0.7, height, z), facing: new Vector3(1, 0, 0) },
      { d: maxX - x, position: new Vector3(maxX - 0.7, height, z), facing: new Vector3(-1, 0, 0) },
    ];
    distances.sort((a, b) => a.d - b.d);
    return { position: distances[0]!.position, facing: distances[0]!.facing };
  };

  return {
    root,
    meshes,
    bounds: { minX, maxX, minZ, maxZ },
    floorY,
    ceilingY,
    wallAnchor,
    dispose: () => {
      for (const mesh of meshes) mesh.dispose();
      root.dispose();
    },
  };
}
