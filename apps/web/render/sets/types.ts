import type { Mesh, Scene, TransformNode, Vector3 } from "@babylonjs/core";
import type { BakedTrack, TrackNode } from "@print-rush/game-core";
import type { AssetCatalog } from "../AssetCatalog";
import type { Hall } from "../Hall";
import type { LightingRig, QualityLevel } from "../LightingRig";
import type { MaterialLibrary } from "../MaterialLibrary";
import type { Terrain } from "../Terrain";

/**
 * SET DRESSING.
 *
 * A *set* is everything about a circuit's environment that is authored rather than scattered: the
 * hero landmarks at the places the route was designed around, the zone-by-zone props that tell the
 * story of the space, the moving machinery, the hazards that belong to the world, and the ambient
 * effects. The track builder handles what every circuit shares — road, barrier, hall, signage, the
 * seeded scatter — and hands the rest to the theme's set.
 */

/** Tangent and left normal at a node, as `frameAt` gives them. */
export type Frame = { tx: number; tz: number; nx: number; nz: number; heading: number };

export type Placement = { node: TrackNode; index: number; frame: Frame };

/** Runs every frame. `dt` in seconds, `nowMs` wall clock, `elapsedMs` race clock (0 on the grid). */
export type Animator = (dt: number, nowMs: number, elapsedMs: number) => void;

export type DressingContext = {
  scene: Scene;
  materials: MaterialLibrary;
  lighting: LightingRig;
  terrain: Terrain;
  hall: Hall;
  baked: BakedTrack;
  nodes: readonly TrackNode[];
  quality: QualityLevel;
  detailed: boolean;
  random: () => number;
  catalog: AssetCatalog | null;
  accentA: string;
  accentB: string;
  /** Places the frame at a lap fraction. */
  at: (progress: number) => Placement;
  /** Lap fraction range of a sector, from its first node to its last. */
  sectorRange: (sector: number) => { from: number; to: number };
  /** Ground height beside the road. */
  heightAt: (x: number, z: number) => number;
  /** World position beside the road: lateral is metres left of the centreline. */
  beside: (progress: number, lateral: number, height?: number) => Vector3;
  animators: Animator[];
  addShadowCaster: (mesh: Mesh) => void;
};

export type HazardBuild = {
  /** The part that moves when the hazard fires. Positioned by the set's own animator. */
  node: TransformNode;
};

export type Dressing = {
  /** True when the set placed the landmarks itself, so the builder must not add the generic heroes. */
  landmarksHandled: boolean;
  /** Landmark positions the set placed, for the minimap and the HUD labels. */
  landmarks: Array<{ label: string; position: Vector3; progress: number }>;
  /** Builds a hazard of the given kind at the holder, or returns false to use the generic crate. */
  buildHazard?: (kind: string, holder: TransformNode, placement: Placement, lane: number) => boolean;
  dispose: () => void;
};

export type SetBuilder = (context: DressingContext) => Dressing;
