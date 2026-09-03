import {
  Color3,
  DynamicTexture,
  Mesh,
  MeshBuilder,
  PBRMaterial,
  TransformNode,
  Vector3,
  type Scene,
} from "@babylonjs/core";
import type { TrackNode, TrackSectorSpec } from "@print-rush/game-core";
import { TerrainConfig } from "@print-rush/game-core";
import type { MaterialLibrary } from "./MaterialLibrary";
import { beveledBox, mergeParts, tube } from "./Geometry";
import { curvatureAt, frameAt } from "./RoadMesh";

/**
 * SIGNAGE.
 *
 * What the brief asks a HUD-less frame to answer — where am I, where does the road go, what comes
 * next — is answered in the world by three things, none of which existed:
 *
 *  - **zone gates**: a gantry across the road at the start of each sector carrying the sector's
 *    name, so the player reads "SECADO" on a sign before the lighting turns orange;
 *  - **corner boards**: chevrons on the outside of every real corner, placed before the apex, so a
 *    blind turn announces its direction;
 *  - **edge lines**: painted lines along both road edges, which separate ROAD from SHOULDER from
 *    OFFTRACK as paint does on a factory floor.
 *
 * Text is drawn into a `DynamicTexture` with a real font, once per distinct string, so a sign is
 * crisp at any distance and costs one texture. Under `NullEngine` there is no canvas to draw into;
 * the sign then keeps its plate and colour and loses its lettering, which is the right degradation.
 */

export type SignageStyle = {
  /** Sign face and lettering. */
  plate: string;
  ink: string;
  accent: string;
  /** Post and gantry steel. */
  steel: string;
  /** Painted edge line. */
  edgeLine: string;
  /** Whether zone names go on gantries (industrial) or on wall-mounted boards (retail, office). */
  gantry: boolean;
  /** A short word placed under the sector name. */
  caption: string;
};

export const SIGNAGE: Record<string, SignageStyle> = {
  PRINT_FACTORY: { plate: "#1c1b24", ink: "#f7f2e8", accent: "#ffd43b", steel: "#3a3f49", edgeLine: "#ffd43b", gantry: true, caption: "ZONA" },
  WAREHOUSE: { plate: "#1c2230", ink: "#f7f2e8", accent: "#ffc02e", steel: "#5a6068", edgeLine: "#ffc02e", gantry: true, caption: "PASILLO" },
  FLAGSHIP: { plate: "#f7f2e8", ink: "#12101a", accent: "#ff3da6", steel: "#9fa6ad", edgeLine: "#f7f2e8", gantry: false, caption: "PLANTA" },
  OFFICE: { plate: "#f4f2ee", ink: "#12101a", accent: "#65d8ff", steel: "#c9ced4", edgeLine: "#f7f2e8", gantry: false, caption: "SALA" },
  MANGA: { plate: "#12101a", ink: "#f7f2e8", accent: "#ff3da6", steel: "#2b2540", edgeLine: "#ff3da6", gantry: true, caption: "HALL" },
};

export function signageStyleFor(theme: string): SignageStyle {
  return SIGNAGE[theme] ?? SIGNAGE.PRINT_FACTORY!;
}

/** The next power of two at or above `value`, capped at 2048. */
function potCeil(value: number): number {
  let size = 64;
  while (size < value && size < 2048) size *= 2;
  return size;
}

/** True when a 2D canvas exists to draw text into. False under `NullEngine`. */
function canDrawText(): boolean {
  return typeof document !== "undefined" || typeof OffscreenCanvas !== "undefined";
}

export type TextOptions = {
  width: number;
  height: number;
  plate: string;
  ink: string;
  accent?: string;
  caption?: string;
  /** Emissive strength: a lit sign box versus painted board. */
  glow?: number;
  chevrons?: -1 | 1;
  /** A chequered flag instead of text. */
  checker?: boolean;
};

/**
 * A sign board: a chamfered plate in the plate colour with the painted face on a plane in front.
 *
 * The face is a plane, not the box itself, on purpose. A chamfered box is lofted, so its U runs
 * around the whole perimeter and a text texture applied to it is smeared across all four sides —
 * the letters come out sliced and mirrored. A plane carries the texture once, the right way round.
 * The face looks along the local -Z axis: toward the traffic that approaches a gantry.
 */
export function createBoard(
  scene: Scene,
  name: string,
  size: { width: number; height: number; depth?: number },
  face: PBRMaterial,
  plate: PBRMaterial,
  options: { doubleSided?: boolean } = {},
): Mesh {
  const depth = size.depth ?? 0.18;
  const back = beveledBox(scene, `${name}-plate`, { width: size.width, height: size.height, depth, bevel: Math.min(0.05, depth * 0.3), cornerSegments: 2 });
  back.material = plate;
  const front = MeshBuilder.CreatePlane(`${name}-face`, { width: size.width - 0.08, height: size.height - 0.08, sideOrientation: Mesh.FRONTSIDE }, scene);
  /**
   * A Babylon plane's front face looks along -Z — it is the face the default camera at negative Z
   * sees — so the front sits at -Z with no rotation and the rear is the one turned round. The first
   * version had this backwards and every board in the game rendered as a blank plate: the lettered
   * face was there, facing into the sign.
   */
  front.position.z = -depth / 2 - 0.006;
  front.material = face;
  const parts = [back, front];
  if (options.doubleSided) {
    const rear = MeshBuilder.CreatePlane(`${name}-rear`, { width: size.width - 0.08, height: size.height - 0.08, sideOrientation: Mesh.FRONTSIDE }, scene);
    rear.rotation.y = Math.PI;
    rear.position.z = depth / 2 + 0.006;
    rear.material = face;
    parts.push(rear);
  }
  const board = mergeParts(name, parts, true);
  board.isPickable = false;
  return board;
}

/**
 * A sign face: plate colour, an accent rule, big lettering and an optional caption. Cached per
 * distinct text so a hundred identical arrow boards are one texture.
 */
export class SignPainter {
  private readonly cache = new Map<string, PBRMaterial>();
  private readonly owned: Array<PBRMaterial | DynamicTexture> = [];

  constructor(private readonly scene: Scene) {}

  material(text: string, options: TextOptions): PBRMaterial {
    const key = `${text}|${options.width}x${options.height}|${options.plate}|${options.ink}|${options.accent ?? ""}|${options.caption ?? ""}|${options.glow ?? 0}|${options.chevrons ?? 0}|${options.checker ? 1 : 0}`;
    const cached = this.cache.get(key);
    if (cached) return cached;

    const material = new PBRMaterial(`sign-${text}`, this.scene);
    material.roughness = 0.55;
    material.metallic = 0;
    material.albedoColor = Color3.FromHexString(options.plate);
    material.backFaceCulling = true;

    if (canDrawText()) {
      // Power-of-two sizes, always: a mipmapped texture at 1024 x 160 is legal in WebGL 2 and not in
      // WebGL 1, and a sign that silently fails to upload is a blank plate with no error anywhere.
      const width = potCeil(options.width);
      const height = potCeil(options.height);
      const texture = new DynamicTexture(`sign-tex-${text}`, { width, height }, this.scene, true);
      const context = texture.getContext() as unknown as CanvasRenderingContext2D;
      context.fillStyle = options.plate;
      context.fillRect(0, 0, width, height);
      if (options.accent) {
        context.fillStyle = options.accent;
        context.fillRect(0, 0, width, Math.round(height * 0.09));
        context.fillRect(0, height - Math.round(height * 0.05), width, Math.round(height * 0.05));
      }
      if (options.checker) {
        const cells = 8;
        const cell = width / cells;
        for (let row = 0; row < Math.ceil(height / cell); row += 1) {
          for (let column = 0; column < cells; column += 1) {
            context.fillStyle = (row + column) % 2 === 0 ? options.ink : options.plate;
            context.fillRect(column * cell, row * cell, cell, cell);
          }
        }
      } else if (options.chevrons) {
        // Three chevrons pointing the way the road goes.
        context.strokeStyle = options.ink;
        context.lineWidth = height * 0.11;
        context.lineJoin = "round";
        context.lineCap = "round";
        const direction = options.chevrons;
        for (let index = 0; index < 3; index += 1) {
          const cx = width * (0.28 + index * 0.22);
          const tip = cx + direction * width * 0.09;
          const tail = cx - direction * width * 0.05;
          context.beginPath();
          context.moveTo(tail, height * 0.22);
          context.lineTo(tip, height * 0.5);
          context.lineTo(tail, height * 0.78);
          context.stroke();
        }
      } else {
        context.fillStyle = options.ink;
        context.textAlign = "center";
        context.textBaseline = "middle";
        const captionSize = Math.round(height * 0.14);
        const mainSize = Math.round(Math.min(height * 0.46, (width * 1.5) / Math.max(4, text.length)));
        if (options.caption) {
          context.font = `700 ${captionSize}px "Arial Black", "Segoe UI", Arial, sans-serif`;
          context.fillStyle = options.accent ?? options.ink;
          context.fillText(options.caption, width / 2, height * 0.26);
        }
        context.font = `900 ${mainSize}px "Arial Black", "Segoe UI", Arial, sans-serif`;
        context.fillStyle = options.ink;
        context.fillText(text, width / 2, options.caption ? height * 0.6 : height * 0.52);
      }
      texture.update();
      texture.hasAlpha = false;
      material.albedoTexture = texture;
      material.albedoColor = Color3.White();
      if (options.glow) {
        material.emissiveTexture = texture;
        material.emissiveColor = Color3.White().scale(options.glow);
      }
      this.owned.push(texture);
    }

    this.cache.set(key, material);
    this.owned.push(material);
    return material;
  }

  dispose(): void {
    for (const item of this.owned) item.dispose();
    this.owned.length = 0;
    this.cache.clear();
  }
}

export type Signage = {
  meshes: Mesh[];
  gates: number;
  boards: number;
  dispose: () => void;
};

export type SignageContext = {
  scene: Scene;
  nodes: readonly TrackNode[];
  sectors: readonly TrackSectorSpec[];
  theme: string;
  quality: string;
  materials: MaterialLibrary;
  /** Ground height beside the road, for posts. */
  heightAt: (x: number, z: number) => number;
  /** Lap fraction where the finish gantry stands, so no zone gate collides with it. */
  avoidProgress?: number[];
};

/** Where each sector begins, as a node index. */
export function sectorStarts(nodes: readonly TrackNode[]): Map<number, number> {
  const starts = new Map<number, number>();
  for (let index = 0; index < nodes.length; index += 1) {
    const sector = nodes[index]!.sector;
    if (!starts.has(sector)) starts.set(sector, index);
  }
  return starts;
}

/**
 * Corners worth signing: runs of sustained curvature, reported as the apex index and the turn's
 * direction. A slalom of chicanes yields several; a long straight yields none.
 */
export function findCorners(nodes: readonly TrackNode[], threshold = 0.02, minRun = 6): Array<{ apex: number; direction: -1 | 1; strength: number }> {
  const corners: Array<{ apex: number; direction: -1 | 1; strength: number }> = [];
  let runStart = -1;
  let runSign = 0;
  let runSum = 0;
  for (let index = 0; index <= nodes.length; index += 1) {
    const curvature = index < nodes.length ? curvatureAt(nodes, index) : 0;
    const sign = Math.abs(curvature) > threshold ? Math.sign(curvature) : 0;
    if (sign !== 0 && sign === runSign) {
      runSum += Math.abs(curvature);
      continue;
    }
    if (runSign !== 0 && index - runStart >= minRun) {
      corners.push({ apex: Math.floor((runStart + index) / 2), direction: runSign > 0 ? -1 : 1, strength: runSum });
    }
    runStart = index;
    runSign = sign;
    runSum = Math.abs(curvature);
  }
  return corners;
}

export function buildSignage(context: SignageContext): Signage {
  const { scene, nodes, theme, materials } = context;
  const style = signageStyleFor(theme);
  const painter = new SignPainter(scene);
  const root = new TransformNode(`signage-${theme}`, scene);
  const meshes: Mesh[] = [];
  const steel = materials.get({ materialClass: "PAINTED_METAL", color: style.steel });
  const plateMaterial = materials.get({ materialClass: "PLASTIC", color: style.plate });
  const detailed = context.quality !== "LOW";
  /**
   * Registers a mesh for disposal. A mesh that already hangs under a gate's holder keeps that parent:
   * the first version reparented everything to the root, which silently dropped every gantry and
   * board onto the world origin — all five zone gates stood stacked on the finish line, and the frame
   * showed whichever was drawn last.
   */
  const keep = (mesh: Mesh): void => {
    if (!mesh.parent) mesh.parent = root;
    mesh.isPickable = false;
    meshes.push(mesh);
  };

  // ------------------------------------------------------------------ zone gates
  let gates = 0;
  const starts = sectorStarts(nodes);
  const avoid = context.avoidProgress ?? [0];
  for (const sector of context.sectors) {
    const start = starts.get(sector.index);
    if (start === undefined) continue;
    // Twelve metres into the sector, and never on top of the start line.
    const index = (start + 5) % nodes.length;
    const node = nodes[index]!;
    if (avoid.some((progress) => Math.abs(((node.progress - progress + 1.5) % 1) - 0.5) < 0.012)) continue;
    const frame = frameAt(nodes, index);
    const half = node.width * 0.5 + TerrainConfig.vergeMetres + 0.4;
    const clearance = 6.4;
    const label = sector.name.toUpperCase();

    const holder = new TransformNode(`zone-gate-${sector.index}`, scene);
    holder.parent = root;
    holder.position.set(node.x, node.y, node.z);
    holder.rotation.y = frame.heading;

    if (style.gantry) {
      const parts: Mesh[] = [];
      for (const side of [-1, 1] as const) {
        const post = beveledBox(scene, `zone-post-${sector.index}-${side}`, { width: 0.5, height: clearance + 2.2, depth: 0.5, bevel: 0.04, cornerSegments: 2 });
        post.position.set(side * half, (clearance + 2.2) / 2, 0);
        post.material = steel;
        parts.push(post);
      }
      const beam = beveledBox(scene, `zone-beam-${sector.index}`, { width: half * 2 + 0.5, height: 0.6, depth: 0.5, bevel: 0.04, cornerSegments: 2 });
      beam.position.set(0, clearance + 2.0, 0);
      beam.material = steel;
      parts.push(beam);
      const frameMesh = mergeParts(`zone-gantry-${sector.index}`, parts, true);
      frameMesh.parent = holder;
      keep(frameMesh);

      const board = createBoard(
        scene,
        `zone-board-${sector.index}`,
        { width: Math.min(half * 1.6, 14), height: 2.2, depth: 0.22 },
        painter.material(label, { width: 1024, height: 192, plate: style.plate, ink: style.ink, accent: style.accent, caption: `${style.caption} ${sector.index}`, glow: 0.35 }),
        plateMaterial,
        { doubleSided: true },
      );
      board.position.set(0, clearance + 0.7, 0);
      board.parent = holder;
      keep(board);
    } else {
      // A board on a post at the outside of the road, angled to the driver.
      for (const side of [1, -1] as const) {
        if (side === -1 && !detailed) continue;
        const post = tube(scene, `zone-postr-${sector.index}-${side}`, [new Vector3(side * half, 0, 0), new Vector3(side * half, 4.6, 0)], 0.07, 6);
        post.material = steel;
        post.parent = holder;
        keep(post);
        const board = createBoard(
          scene,
          `zone-boardr-${sector.index}-${side}`,
          { width: 5.2, height: 1.5, depth: 0.14 },
          painter.material(label, { width: 768, height: 224, plate: style.plate, ink: style.ink, accent: style.accent, caption: `${style.caption} ${sector.index}` }),
          plateMaterial,
        );
        board.position.set(side * (half - 0.3), 4.2, 0);
        board.rotation.y = side * 0.35;
        board.parent = holder;
        keep(board);
      }
    }
    gates += 1;
  }

  // ------------------------------------------------------------------ corner boards
  let boards = 0;
  const corners = findCorners(nodes);
  const boardSources = new Map<number, Mesh>();
  for (const corner of corners) {
    // Announced before the apex: eighteen metres back, on the outside of the turn.
    const index = (corner.apex - 7 + nodes.length) % nodes.length;
    const node = nodes[index]!;
    const frame = frameAt(nodes, index);
    const outside = -corner.direction;
    const half = node.width * 0.5 + TerrainConfig.vergeMetres + 0.6;
    let source = boardSources.get(corner.direction);
    if (!source) {
      const face = createBoard(
        scene,
        `corner-board-${corner.direction}`,
        { width: 3.4, height: 1.1, depth: 0.12 },
        painter.material(corner.direction > 0 ? "LEFT" : "RIGHT", { width: 512, height: 166, plate: style.plate, ink: style.accent, chevrons: corner.direction, glow: 0.45 }),
        plateMaterial,
      );
      const post = tube(scene, `corner-post-${corner.direction}`, [new Vector3(0, -2.2, 0), new Vector3(0, -0.5, 0)], 0.05, 6);
      post.material = steel;
      source = mergeParts(`corner-sign-${corner.direction}`, [face, post], true);
      source.isVisible = false;
      keep(source);
      boardSources.set(corner.direction, source);
    }
    const x = node.x + frame.nx * outside * half;
    const z = node.z + frame.nz * outside * half;
    const instance = source.createInstance(`corner-sign-${index}`);
    instance.position.set(x, context.heightAt(x, z) + 2.4, z);
    // The board's face looks along local -Z, so the holder's +Z runs with the road: the face meets
    // the approaching driver.
    instance.rotation.y = frame.heading;
    instance.isPickable = false;
    instance.freezeWorldMatrix();
    boards += 1;
  }

  return {
    meshes,
    gates,
    boards,
    dispose: () => {
      for (const mesh of meshes) mesh.dispose();
      painter.dispose();
      root.dispose();
    },
  };
}
