import {
  Color3,
  Mesh,
  MeshBuilder,
  VertexBuffer,
  type Scene,
} from "@babylonjs/core";
import type { TrackNode } from "@print-rush/game-core";
import { TerrainConfig } from "@print-rush/game-core";
import type { MaterialLibrary, MaterialRequest } from "./MaterialLibrary";
import { buildRoadSurface, frameAt } from "./RoadMesh";

/**
 * THE GROUND.
 *
 * There was none. A circuit was a ribbon of road with a wall on each side and a backdrop behind it,
 * and beyond the walls there was literally nothing — which is why the world looked unfinished and
 * why you could not leave the road. Both complaints have the same cause.
 *
 * This builds what a kart racer needs outside the tarmac:
 *
 *  - a **verge**: a band of driveable off-road hugging the road, textured differently and slightly
 *    below it so the edge reads as an edge rather than as a change of paint;
 *  - a **field**: a large plane covering the whole circuit and well past it, so the horizon is
 *    ground meeting sky instead of geometry stopping;
 *  - a **rumble strip** at the road edge, which is what actually tells a driver at speed where the
 *    grip ends. A colour change alone does not; a vibration you can see does.
 *
 * The field is one plane and the verge is one lofted surface, so the whole thing costs three draw
 * calls. That matters because it exists on every circuit at every quality tier — including the
 * lowest, where the rest of the dressing is cut.
 */

export type Terrain = {
  meshes: Mesh[];
  /** The field's extent, so the backdrop can be placed beyond it rather than guessed at. */
  radius: number;
  /**
   * Ground height at a world position.
   *
   * Anything placed outside the barrier — spectators, plants, props, landmarks — has to stand on the
   * ground rather than at the height of the nearest piece of road, or it floats above a dip and sinks
   * into a rise. This is the same function the field's vertices were built from, so the two agree by
   * construction rather than by coincidence.
   */
  heightAt: (x: number, z: number) => number;
  dispose: () => void;
};

/** Which material dresses the ground outside the road, per theme. */
type GroundLook = {
  verge: MaterialRequest;
  field: MaterialRequest;
  rumbleLight: string;
  rumbleDark: string;
};

/**
 * The ground each circuit sits on.
 *
 * Chosen so the verge reads as *the same place* as the track rather than as a different level: a
 * shop's aisle runs out onto its own tiling, a warehouse's onto sealed concrete. Only the
 * screen-printing floor gets a genuinely different material, because a workshop really does have
 * bare concrete beyond the marked route.
 */
const GROUND: Record<string, GroundLook> = {
  FLAGSHIP: {
    verge: { materialClass: "FLOOR_TILE", color: "#8e857b", texture: "mat_floortile_store", tile: 3 },
    // The shop floor beyond the aisle is the same polished tile, at a coarser repeat.
    field: { materialClass: "FLOOR_TILE", color: "#9a9088", texture: "mat_floortile_store", tile: 7 },
    rumbleLight: "#f7f2e8",
    rumbleDark: "#ff3da6",
  },
  WAREHOUSE: {
    verge: { materialClass: "CONCRETE", color: "#818893", texture: "mat_concrete_warehouse", tile: 4 },
    field: { materialClass: "CONCRETE", color: "#8c939c", texture: "mat_concrete_warehouse", tile: 9 },
    rumbleLight: "#ffc02e",
    rumbleDark: "#2b2732",
  },
  PRINT_FACTORY: {
    verge: { materialClass: "CONCRETE", color: "#605a6b", texture: "mat_concrete_factory", tile: 4 },
    // Sealed epoxy: the hall floor beyond the marked route, with its bay lines, not open ground.
    field: { materialClass: "FLOOR_TILE", color: "#5a5566", texture: "mat_epoxy_factory", tile: 12 },
    rumbleLight: "#ffd43b",
    rumbleDark: "#8f5cff",
  },
  OFFICE: {
    verge: { materialClass: "FLOOR_TILE", color: "#8f867b", texture: "mat_carpet_office", tile: 3 },
    field: { materialClass: "FLOOR_TILE", color: "#a49a8e", texture: "mat_floortile_office", tile: 6 },
    rumbleLight: "#f7f2e8",
    rumbleDark: "#65d8ff",
  },
  MANGA: {
    verge: { materialClass: "FLOOR_TILE", color: "#423a63", texture: "mat_carpet_manga", tile: 3 },
    field: { materialClass: "FLOOR_TILE", color: "#433969", texture: "mat_carpet_manga", tile: 8 },
    rumbleLight: "#ff3da6",
    rumbleDark: "#8f5cff",
  },
  GREYBOX: {
    verge: { materialClass: "ASPHALT", color: "#6a6f75", tile: 4 },
    field: { materialClass: "CONCRETE", color: "#7a7f85", tile: 10 },
    rumbleLight: "#e8e4dc",
    rumbleDark: "#4a4f57",
  },
};

/**
 * Builds the ground for a circuit.
 *
 * `nodes` is the baked centreline, which is where the extent comes from: a field sized from the
 * circuit's own bounding box plus a margin is always big enough and never wastefully huge, which a
 * fixed size would be for one circuit and too small for another.
 */
export function createTerrain(
  scene: Scene,
  nodes: readonly TrackNode[],
  theme: string,
  quality: string,
  materials: MaterialLibrary,
): Terrain {
  const look = GROUND[theme] ?? GROUND.GREYBOX!;
  const meshes: Mesh[] = [];

  // ---------------------------------------------------------------- extent
  let minX = Infinity;
  let maxX = -Infinity;
  let minZ = Infinity;
  let maxZ = -Infinity;
  let minY = Infinity;
  for (const node of nodes) {
    minX = Math.min(minX, node.x);
    maxX = Math.max(maxX, node.x);
    minZ = Math.min(minZ, node.z);
    maxZ = Math.max(maxZ, node.z);
    minY = Math.min(minY, node.y);
  }
  const centreX = (minX + maxX) / 2;
  const centreZ = (minZ + maxZ) / 2;
  const span = Math.max(maxX - minX, maxZ - minZ) + TerrainConfig.visualMarginMetres * 2;
  /**
   * Grid resolution, and the height radius derived from it.
   *
   * These two are one decision, not two, and the derivation is what makes the ground safe. A vertex
   * takes the lowest road height within `heightRadius`; the mesh between vertices is a bilinear
   * patch, which is bounded by its four corners. So as long as every point in a cell is inside the
   * radius of all four of that cell's corners — which needs the radius to exceed the cell's diagonal
   * — the rendered surface is at or below every piece of road near it, everywhere, not just at the
   * vertices. Writing the radius as a constant beside a separately chosen cell count is how that
   * guarantee gets quietly broken by a later edit to the margin.
   *
   * The radius also wants to be as *small* as the bound allows. It is a minimum over a disc, so a
   * larger disc means the ground sags further below the road on a gradient: at 45 m the Manga hall's
   * climb put an eight-metre trench beside the track. At one and a half cells it is around two.
   */
  const cells = Math.max(24, Math.min(128, Math.round(span / 14)));
  const heightRadius = (span / cells) * 1.5;
  const heightAt = groundHeight(nodes, minY, heightRadius);

  // ------------------------------------------------------------------ field
  /**
   * The ground follows the circuit's elevation. It has to, and the first version of this did not.
   *
   * That version was a flat plane at the circuit's *mean* height, on the reasoning that the verge
   * handled the local height and the field only had to be plausible beyond it. The reasoning was
   * wrong by an order of magnitude: these circuits climb and fall through more than twenty metres —
   * the Megastore runs from -3.6 m at its lowest to 15.5 m on the upper floor — so a plane at the
   * mean sat four and a half metres *above the start line* with 61% of the road buried underneath it.
   * With the race camera three and a half metres up, the player's eye was inside an opaque
   * kilometre-wide sheet, looking at a flat expanse with the track hidden below. It read as an open
   * field seen in first person, which is precisely what it was.
   *
   * So the field is a heightfield: a grid whose every vertex takes its height from the road nearby,
   * and specifically from the *lowest* road nearby (see {@link groundHeight}), so it can never bury
   * anything. It comes to some eight thousand vertices in one static mesh — cheap enough to keep
   * identical at every quality tier, which matters, because the ground is the one thing that can
   * never be cut.
   */
  const field = MeshBuilder.CreateGround(
    "terrain-field",
    { width: span, height: span, subdivisions: cells },
    scene,
  );
  field.position.set(centreX, 0, centreZ);
  const positions = field.getVerticesData(VertexBuffer.PositionKind);
  if (positions) {
    for (let index = 0; index < positions.length; index += 3) {
      positions[index + 1] = heightAt((positions[index] ?? 0) + centreX, (positions[index + 2] ?? 0) + centreZ);
    }
    field.setVerticesData(VertexBuffer.PositionKind, positions);
    // The normals came from a flat plane, so every one of them points straight up. Without this the
    // heightfield lights as though it were level and its slopes read as shading painted on a floor.
    field.createNormals(false);
  }
  /**
   * UVs rewritten in metres.
   *
   * `CreateGround` lays its UVs 0..1 across the whole plane, and `MaterialLibrary` scales textures by
   * `1 / tile` on the assumption that UVs are measured in metres — which the road surface satisfies
   * and this did not. On a plane close to a kilometre across, `tile: 10` was therefore asking for one
   * texture repeat every ten *kilometres*: the ground was a single stretched pixel of flat colour
   * with no detail at any distance. This is the other half of "the texturing looks bad", and it was
   * wrong on desktop too — it was just less obvious there, with more dressing to look at instead.
   */
  const fieldUvs = field.getVerticesData(VertexBuffer.UVKind);
  if (fieldUvs) {
    for (let index = 0; index < fieldUvs.length; index += 1) fieldUvs[index] = (fieldUvs[index] ?? 0) * span;
    field.setVerticesData(VertexBuffer.UVKind, fieldUvs);
  }
  field.receiveShadows = quality !== "LOW";
  field.isPickable = false;
  field.material = materials.get(look.field);
  // Nothing moves it, and it is the largest mesh in the scene.
  field.freezeWorldMatrix();
  meshes.push(field);

  // ------------------------------------------------------------------ verge
  /**
   * A driveable band following the road.
   *
   * Built with the same lofted surface as the road itself, at a wider half-width, so it inherits the
   * centreline's banking and elevation exactly. A separate flat strip would gap on every crest.
   *
   * Two centimetres below the road, which is the whole trick: a verge at the same height reads as a
   * paint change, and one much lower reads as a kerb the kart falls off.
   */
  const verge = buildRoadSurface(scene, widen(nodes, TerrainConfig.vergeMetres * 2), "terrain-verge", {
    tileLength: VERGE_TILE_LENGTH,
    shoulder: 0,
  });
  verge.position.y -= 0.02;
  /**
   * The verge's cross-track UV, also in metres.
   *
   * `buildRoadSurface` writes `u` as 0..1 across the surface's width and `v` as distance over the
   * tile length. That happens to come out square on the road, whose width is close to its tile
   * length, but the verge is three times wider — so its texture was stretched three to one across
   * the track, which reads as smearing exactly where a driver looks when running wide.
   */
  const vergeWidth = meanWidth(nodes) + TerrainConfig.vergeMetres * 2;
  const vergeUvs = verge.getVerticesData(VertexBuffer.UVKind);
  if (vergeUvs) {
    const across = vergeWidth / VERGE_TILE_LENGTH;
    for (let index = 0; index < vergeUvs.length; index += 2) vergeUvs[index] = (vergeUvs[index] ?? 0) * across;
    verge.setVerticesData(VertexBuffer.UVKind, vergeUvs);
  }
  verge.material = materials.get(look.verge);
  verge.receiveShadows = quality !== "LOW";
  verge.isPickable = false;
  meshes.push(verge);

  // ----------------------------------------------------------- rumble strip
  if (quality !== "LOW") {
    const rumble = buildRumble(scene, nodes, look, materials);
    if (rumble) meshes.push(rumble);
  }

  return {
    meshes,
    radius: span / 2,
    heightAt,
    dispose: () => {
      for (const mesh of meshes) mesh.dispose();
    },
  };
}

/** Metres of verge covered by one repeat of its texture along the track. */
const VERGE_TILE_LENGTH = 14;

/**
 * A ground-height function derived from the centreline.
 *
 * Two properties matter, and the second is the one that is easy to miss.
 *
 * It has to **follow the road**, because a circuit that climbs twenty metres cannot have a flat
 * ground plane. That was the bug this replaced.
 *
 * And it has to take the height of the *lowest* road nearby, not the nearest one. These circuits
 * cross over themselves — the Megastore jumps over its own shop floor, the warehouse runs gantries
 * above its aisles. Take the nearest node's height and the ground under a bridge gets built at the
 * height of the bridge deck, burying the road that passes beneath: the same failure as before, local
 * instead of global. The minimum guarantees the ground is at or below every piece of road near it,
 * which is the invariant that actually matters.
 *
 * Past `radius` from any road the height eases toward the circuit's own floor, so the far ground is
 * a plain that the circuit sits on rather than a cliff a fixed distance from the track.
 *
 * `radius` is the caller's, and it is derived from the mesh's cell size rather than chosen here —
 * see the note at the call site for why the two cannot be picked independently.
 *
 * The lookup is a uniform grid rather than a scan: eight thousand vertices against a thousand nodes
 * is eight million distance tests done the naive way, and a few dozen done this way.
 */
function groundHeight(
  nodes: readonly TrackNode[],
  minY: number,
  radius: number,
): (x: number, z: number) => number {
  const buckets = new Map<string, TrackNode[]>();
  const cellKey = (cx: number, cz: number) => cx + ":" + cz;
  for (const node of nodes) {
    const key = cellKey(Math.floor(node.x / radius), Math.floor(node.z / radius));
    const bucket = buckets.get(key);
    if (bucket) bucket.push(node);
    else buckets.set(key, [node]);
  }

  const floor = minY - 2;
  return (x: number, z: number): number => {
    const cx = Math.floor(x / radius);
    const cz = Math.floor(z / radius);
    let lowest = Infinity;
    let nearest = Infinity;
    let nearestY = floor;
    // The cell size is the search radius, so the 3x3 block around a point covers everything within
    // it. Searching wider would only turn up nodes that are already too far away to count.
    for (let ox = -1; ox <= 1; ox += 1) {
      for (let oz = -1; oz <= 1; oz += 1) {
        const bucket = buckets.get(cellKey(cx + ox, cz + oz));
        if (!bucket) continue;
        for (const node of bucket) {
          const distance = Math.hypot(node.x - x, node.z - z);
          if (distance < nearest) {
            nearest = distance;
            nearestY = node.y;
          }
          if (distance <= radius) lowest = Math.min(lowest, node.y);
        }
      }
    }

    // Half a metre below the road, so the verge's outer edge steps down onto the field instead of
    // fighting it for the same pixels. The barrier stands in front of that step.
    if (lowest < Infinity) return lowest - 0.5;
    /**
     * Out of range of the road: ease from the nearest road's height down to the circuit's floor.
     *
     * A hard cut to the floor would put a cliff a fixed distance from the track the whole way round
     * the lap. Easing over a couple of hundred metres makes it a slope instead, and by the time it
     * reaches the floor the barrier and the dressing are long out of the way.
     */
    if (nearest === Infinity) return floor;
    const t = Math.min(1, (nearest - radius) / 220);
    const eased = t * t * (3 - 2 * t);
    return (nearestY - 0.5) * (1 - eased) + floor * eased;
  };
}

/** The mean road width, used to square up the verge's texture across the track. */
function meanWidth(nodes: readonly TrackNode[]): number {
  if (nodes.length === 0) return 12;
  let total = 0;
  for (const node of nodes) total += node.width;
  return total / nodes.length;
}

/**
 * The centreline, with every node's width increased.
 *
 * Reusing `buildRoadSurface` needs nodes whose `width` describes the verge rather than the road, and
 * copying them is cheaper and far less error-prone than a second surface builder that would have to
 * re-derive banking, elevation and UV distance identically.
 */
function widen(nodes: readonly TrackNode[], extra: number): TrackNode[] {
  return nodes.map((node) => ({ ...node, width: node.width + extra }));
}

/**
 * The rumble strip: alternating blocks along both road edges.
 *
 * Instanced from one source with per-instance colour, so a full lap of both edges is one draw call.
 * This is the element that actually communicates the limit at speed — the eye reads the flicker
 * frequency as a rate of travel, which a flat colour change cannot do.
 */
function buildRumble(
  scene: Scene,
  nodes: readonly TrackNode[],
  look: GroundLook,
  materials: MaterialLibrary,
): Mesh | null {
  const source = MeshBuilder.CreateBox("terrain-rumble", { width: 0.9, height: 0.06, depth: 2 }, scene);
  source.material = materials.get({ materialClass: "CONCRETE", color: "#ffffff", tile: 1 });
  source.isVisible = false;
  source.isPickable = false;
  source.registerInstancedBuffer("color", 4);

  const light = Color3.FromHexString(look.rumbleLight);
  const dark = Color3.FromHexString(look.rumbleDark);
  let placed = 0;

  // Every third node, both sides. Denser than that and the blocks merge into a line at speed;
  // sparser and the flicker stops reading as a rate.
  for (let index = 0; index < nodes.length; index += 3) {
    const node = nodes[index]!;
    const frame = frameAt(nodes, index);
    const half = node.width / 2;
    for (const side of [1, -1] as const) {
      const instance = source.createInstance(`rumble-${index}-${side}`);
      instance.position.set(
        node.x + frame.nx * side * (half + 0.45),
        node.y + 0.03,
        node.z + frame.nz * side * (half + 0.45),
      );
      instance.rotation.y = frame.heading;
      const stripe = Math.floor(node.distance / 2) % 2 === 0 ? light : dark;
      instance.instancedBuffers.color = stripe.toColor4(1);
      instance.isPickable = false;
      instance.freezeWorldMatrix();
      placed += 1;
    }
  }

  if (placed === 0) {
    source.dispose();
    return null;
  }
  return source;
}
