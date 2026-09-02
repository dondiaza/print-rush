import type { SurfaceName } from "./config.js";
import { headingDeltas, measureLength } from "./track.js";
import type { TrackCheckpoint, TrackDefinition, TrackNode, Vec3 } from "./types.js";

/**
 * Track authoring.
 *
 * A blueprint is a hand-placed list of control points in world space. Baking runs a closed
 * Catmull-Rom through them and resamples at a fixed arc length, so the designer controls the shape
 * and the runtime always gets evenly spaced nodes.
 *
 * The important consequence versus V4: control points are free 3D positions rather than a radius
 * function of angle, so a circuit can double back, cross over itself at a different height, climb
 * to a second floor and come back down. That topology is what the V5 brief asks for and what the
 * parametric ellipse made impossible.
 */

/** Metres between baked nodes. 2.5 m keeps a 3 km circuit near 1200 nodes. */
export const NODE_SPACING = 2.5;

export type TrackControlPoint = {
  x: number;
  y: number;
  z: number;
  /** Drivable width in metres. Carried forward from the previous point when omitted. */
  width?: number;
  /** Banking in radians. Positive rolls the road toward the left of travel. */
  banking?: number;
  surface?: SurfaceName;
  /** 1-based sector. Sectors follow the space, so they are declared, not divided evenly. */
  sector?: number;
  wallLeft?: boolean;
  wallRight?: boolean;
  /** Optional label used by the editor and the visual review gallery. */
  note?: string;
};

export type TrackFeature =
  | { kind: "BOOST"; progress: number; lane: number }
  | { kind: "JUMP"; progress: number; lane: number; power: number }
  | { kind: "ITEM_ROW"; progress: number; lanes: number[] }
  | { kind: "HAZARD"; progress: number; lane: number; hazard: string }
  | { kind: "LANDMARK"; progress: number; side: -1 | 1; label: string }
  | {
      kind: "SHORTCUT";
      from: number;
      to: number;
      risk: "LOW" | "MEDIUM" | "HIGH";
      /**
       * How the shortcut is gated, per the brief's three categories. ITEM needs a boost to clear it,
       * SKILL needs a precise drift or jump, RISK is simply faster and far more dangerous. A circuit
       * with only one kind of shortcut offers only one kind of decision.
       */
      access: "ITEM" | "SKILL" | "RISK";
      label: string;
    }
  | { kind: "SET_PIECE"; progress: number; label: string };

export type TrackSectorSpec = {
  index: number;
  name: string;
  /** Narrative beat this sector carries. Enforced by the quality gate. */
  role: "INTRO" | "SPEED" | "TECHNICAL" | "SET_PIECE" | "CLIMAX";
};

/**
 * What makes this circuit different to drive, not just different to look at. The brief is explicit
 * that the five tracks must not be reskins, so the intended character is declared here and asserted
 * by the quality gate rather than left as an aspiration in a design document.
 */
export type TrackCharacter = {
  /** One line on how it should feel to drive. */
  summary: string;
  /** The dominant demand it places on the player. */
  emphasis: "SLALOM" | "SPEED" | "ENVIRONMENT" | "TECHNICAL" | "SPECTACLE";
};

export type TrackBlueprint = {
  schemaVersion: 5;
  id: string;
  name: string;
  theme: string;
  recommendedLaps: 1 | 2 | 3 | 5;
  character: TrackCharacter;
  controlPoints: TrackControlPoint[];
  sectors: TrackSectorSpec[];
  features: TrackFeature[];
};

export type TrackAnalysis = {
  lengthMeters: number;
  nodeCount: number;
  estimatedLapSeconds: number;
  corners: number;
  hairpins: number;
  straights: number;
  elevationRange: number;
  elevationChanges: number;
  averageWidth: number;
  crossovers: number;
  sectors: number;
  landmarks: number;
  shortcuts: number;
  setPieces: number;
  /** Narrowest and widest drivable width, in metres. A slalom track and a speed track differ here. */
  minWidth: number;
  maxWidth: number;
  /** Distinct surfaces used. An environmental circuit leans on this. */
  surfaces: string[];
  jumps: number;
  hazards: number;
  /** Shortcut categories present, so a circuit is not all one kind of decision. */
  shortcutKinds: string[];
};

export type BakedTrack = {
  blueprint: TrackBlueprint;
  definition: TrackDefinition;
  analysis: TrackAnalysis;
  issues: string[];
};

function catmullRom(p0: Vec3, p1: Vec3, p2: Vec3, p3: Vec3, t: number): Vec3 {
  const t2 = t * t;
  const t3 = t2 * t;
  const blend = (a: number, b: number, c: number, d: number): number =>
    0.5 * ((2 * b) + (-a + c) * t + (2 * a - 5 * b + 4 * c - d) * t2 + (-a + 3 * b - 3 * c + d) * t3);
  return {
    x: blend(p0.x, p1.x, p2.x, p3.x),
    y: blend(p0.y, p1.y, p2.y, p3.y),
    z: blend(p0.z, p1.z, p2.z, p3.z),
  };
}

type DenseSample = { point: Vec3; segment: number; local: number };

/** Walks the closed spline at high density so the arc-length resample has something to march along. */
function densify(points: readonly TrackControlPoint[], subdivisions: number): DenseSample[] {
  const count = points.length;
  const dense: DenseSample[] = [];
  for (let segment = 0; segment < count; segment += 1) {
    const p0 = points[(segment - 1 + count) % count]!;
    const p1 = points[segment]!;
    const p2 = points[(segment + 1) % count]!;
    const p3 = points[(segment + 2) % count]!;
    for (let step = 0; step < subdivisions; step += 1) {
      const local = step / subdivisions;
      dense.push({ point: catmullRom(p0, p1, p2, p3, local), segment, local });
    }
  }
  return dense;
}

function lerp(a: number, b: number, t: number): number {
  return a + (b - a) * t;
}

export function bakeTrack(blueprint: TrackBlueprint): BakedTrack {
  const control = blueprint.controlPoints;
  if (control.length < 8) {
    throw new Error(`Track ${blueprint.id} needs at least 8 control points, got ${control.length}.`);
  }

  // Carry unspecified attributes forward so a designer only annotates where something changes.
  const resolved = control.map((point, index) => {
    let width = point.width;
    let banking = point.banking;
    let surface = point.surface;
    let sector = point.sector;
    let wallLeft = point.wallLeft;
    let wallRight = point.wallRight;
    for (let back = index; back >= 0 && (width === undefined || surface === undefined || sector === undefined); back -= 1) {
      const previous = control[back]!;
      width ??= previous.width;
      surface ??= previous.surface;
      sector ??= previous.sector;
      banking ??= previous.banking;
      wallLeft ??= previous.wallLeft;
      wallRight ??= previous.wallRight;
    }
    return {
      ...point,
      width: width ?? 14,
      banking: banking ?? 0,
      surface: surface ?? ("ASPHALT" as SurfaceName),
      sector: sector ?? 1,
      wallLeft: wallLeft ?? true,
      wallRight: wallRight ?? true,
    };
  });

  /**
   * Drop control points that sit on top of their neighbour before densifying. Authoring routes that
   * end a leg exactly on a target pose, or emit a few points across a very short arc, can leave
   * near-coincident points; Catmull-Rom through those produces a heading spike, which showed up in
   * the grey box as a 1 m-radius kink across the finish line. Deduplicating here fixes it for every
   * authoring route at once rather than in each one.
   */
  const MIN_CONTROL_SPACING = 4;
  const spaced = resolved.filter((point, index) => {
    if (index === 0) return true;
    const previous = resolved[index - 1]!;
    const gap = Math.hypot(point.x - previous.x, point.y - previous.y, point.z - previous.z);
    // Never drop a point that opens a new sector or changes surface: that information is the
    // reason it exists, and losing it would silently move a sector boundary.
    const carriesChange = point.sector !== previous.sector || point.surface !== previous.surface;
    return gap >= MIN_CONTROL_SPACING || carriesChange;
  });
  // The wrap-around pair matters too, since the spline is closed.
  const first = spaced[0]!;
  while (spaced.length > 8) {
    const last = spaced[spaced.length - 1]!;
    if (Math.hypot(last.x - first.x, last.y - first.y, last.z - first.z) >= MIN_CONTROL_SPACING) break;
    spaced.pop();
  }

  const dense = densify(spaced, 24);

  // Arc-length resample at a fixed spacing.
  const nodes: TrackNode[] = [];
  let carried = 0;
  let distance = 0;
  for (let index = 0; index < dense.length; index += 1) {
    const current = dense[index]!;
    const next = dense[(index + 1) % dense.length]!;
    const step = Math.hypot(
      next.point.x - current.point.x,
      next.point.y - current.point.y,
      next.point.z - current.point.z,
    );
    let travelled = carried;
    while (travelled < step) {
      const t = step > 0 ? travelled / step : 0;
      const position = {
        x: lerp(current.point.x, next.point.x, t),
        y: lerp(current.point.y, next.point.y, t),
        z: lerp(current.point.z, next.point.z, t),
      };
      // Attributes come from the two control points bracketing this sample.
      const a = spaced[current.segment]!;
      const b = spaced[(current.segment + 1) % spaced.length]!;
      const blend = current.local;
      nodes.push({
        ...position,
        progress: 0,
        distance,
        width: lerp(a.width, b.width, blend),
        banking: lerp(a.banking, b.banking, blend),
        // Discrete attributes snap rather than blend: half a surface is not a surface.
        surface: blend < 0.5 ? a.surface : b.surface,
        sector: blend < 0.5 ? a.sector : b.sector,
        wallLeft: blend < 0.5 ? a.wallLeft : b.wallLeft,
        wallRight: blend < 0.5 ? a.wallRight : b.wallRight,
      });
      distance += NODE_SPACING;
      travelled += NODE_SPACING;
    }
    carried = travelled - step;
  }

  const lengthMeters = measureLength(nodes);
  nodes.forEach((node, index) => {
    node.progress = index / nodes.length;
  });

  const definition = buildDefinition(blueprint, nodes, lengthMeters);
  const analysis = analyseTrack(blueprint, nodes, lengthMeters);
  return { blueprint, definition, analysis, issues: validateTrack(analysis, blueprint) };
}

function buildDefinition(blueprint: TrackBlueprint, nodes: TrackNode[], lengthMeters: number): TrackDefinition {
  const count = nodes.length;
  const headingAt = (index: number): number => {
    const node = nodes[index % count]!;
    const next = nodes[(index + 4) % count]!;
    return Math.atan2(next.x - node.x, next.z - node.z);
  };

  // One checkpoint per sector boundary plus the finish line, so cutting the course cannot score.
  const sectorCount = Math.max(3, blueprint.sectors.length);
  const checkpointIndexes = Array.from({ length: sectorCount }, (_, slot) =>
    Math.floor((count * (slot + 1)) / sectorCount) % count);

  const checkpoints: TrackCheckpoint[] = checkpointIndexes.map((index) => {
    const node = nodes[index]!;
    return { x: node.x, y: node.y, z: node.z, progress: node.progress, radius: Math.max(16, node.width * 0.85) };
  });

  const recoveryPoints = checkpointIndexes.map((index) => {
    const node = nodes[index]!;
    return { position: { x: node.x, y: node.y + 0.75, z: node.z }, rotation: headingAt(index) };
  });

  const start = nodes[0]!;
  const startRotation = headingAt(0);
  const forward = { x: Math.sin(startRotation), z: Math.cos(startRotation) };
  const normal = { x: -forward.z, z: forward.x };
  const spawnPoints = [0, 1, 2, 3].map((slot) => {
    const row = Math.floor(slot / 2);
    const lane = (slot % 2 === 0 ? -1 : 1) * start.width * 0.18;
    const behind = 4 + row * 5;
    return {
      position: {
        x: start.x - forward.x * behind + normal.x * lane,
        y: start.y + 0.75,
        z: start.z - forward.z * behind + normal.z * lane,
      },
      rotation: startRotation,
    };
  });

  const xs = nodes.map((node) => node.x);
  const ys = nodes.map((node) => node.y);
  const zs = nodes.map((node) => node.z);
  const margin = 60;

  return {
    id: blueprint.id,
    name: blueprint.name,
    recommendedLaps: blueprint.recommendedLaps,
    spawnPoints,
    checkpoints,
    nodes,
    recoveryPoints,
    lengthMeters: Math.round(lengthMeters),
    bounds: {
      minX: Math.min(...xs) - margin,
      maxX: Math.max(...xs) + margin,
      minZ: Math.min(...zs) - margin,
      maxZ: Math.max(...zs) + margin,
      minY: Math.min(...ys) - 40,
      maxY: Math.max(...ys) + 60,
    },
  };
}

/** Average pace used for lap estimates: below top speed because corners exist. */
const PACE_METRES_PER_SECOND = 24;

export function analyseTrack(
  blueprint: TrackBlueprint,
  nodes: readonly TrackNode[],
  lengthMeters: number,
): TrackAnalysis {
  const deltas = headingDeltas(nodes);

  // A significant corner is a run of same-signed heading change totalling more than 25 degrees.
  let corners = 0;
  let hairpins = 0;
  let run = 0;
  let sign = 0;
  const closeRun = (): void => {
    const magnitude = Math.abs(run);
    if (magnitude > (25 * Math.PI) / 180) corners += 1;
    if (magnitude > (140 * Math.PI) / 180) hairpins += 1;
  };
  for (const delta of deltas) {
    const deltaSign = Math.sign(delta);
    if (deltaSign === sign) {
      run += delta;
    } else {
      closeRun();
      run = delta;
      sign = deltaSign;
    }
  }
  closeRun();

  // A straight is at least 60 m of near-zero curvature.
  const straightNodes = Math.ceil(60 / NODE_SPACING);
  let straights = 0;
  let straightRun = 0;
  for (const delta of deltas) {
    if (Math.abs(delta) < (0.6 * Math.PI) / 180) {
      straightRun += 1;
    } else {
      if (straightRun >= straightNodes) straights += 1;
      straightRun = 0;
    }
  }
  if (straightRun >= straightNodes) straights += 1;

  const ys = nodes.map((node) => node.y);
  const elevationRange = Math.max(...ys) - Math.min(...ys);

  // Count meaningful climbs and descents, ignoring sub-metre noise.
  let elevationChanges = 0;
  let climbSign = 0;
  let accumulated = 0;
  for (let index = 0; index < nodes.length; index += 1) {
    const delta = nodes[(index + 1) % nodes.length]!.y - nodes[index]!.y;
    const deltaSign = Math.sign(delta);
    if (deltaSign !== 0 && deltaSign !== climbSign) {
      if (Math.abs(accumulated) > 1.5) elevationChanges += 1;
      climbSign = deltaSign;
      accumulated = 0;
    }
    accumulated += delta;
  }
  if (Math.abs(accumulated) > 1.5) elevationChanges += 1;

  return {
    lengthMeters: Math.round(lengthMeters),
    nodeCount: nodes.length,
    estimatedLapSeconds: Math.round(lengthMeters / PACE_METRES_PER_SECOND),
    corners,
    hairpins,
    straights,
    elevationRange: Number(elevationRange.toFixed(1)),
    elevationChanges,
    averageWidth: Number((nodes.reduce((sum, node) => sum + node.width, 0) / nodes.length).toFixed(1)),
    crossovers: countCrossovers(nodes),
    sectors: blueprint.sectors.length,
    landmarks: blueprint.features.filter((feature) => feature.kind === "LANDMARK").length,
    shortcuts: blueprint.features.filter((feature) => feature.kind === "SHORTCUT").length,
    setPieces: blueprint.features.filter((feature) => feature.kind === "SET_PIECE").length,
    minWidth: Number(Math.min(...nodes.map((node) => node.width)).toFixed(1)),
    maxWidth: Number(Math.max(...nodes.map((node) => node.width)).toFixed(1)),
    surfaces: [...new Set(nodes.map((node) => node.surface))].sort(),
    jumps: blueprint.features.filter((feature) => feature.kind === "JUMP").length,
    hazards: blueprint.features.filter((feature) => feature.kind === "HAZARD").length,
    shortcutKinds: [
      ...new Set(
        blueprint.features
          .filter((feature): feature is Extract<TrackFeature, { kind: "SHORTCUT" }> => feature.kind === "SHORTCUT")
          .map((feature) => feature.access),
      ),
    ].sort(),
  };
}

/**
 * Counts places where the circuit passes over itself: node pairs close in XZ, far apart in Y, and
 * far apart along the lap. This is the metric the V4 generator could never move off zero.
 */
function countCrossovers(nodes: readonly TrackNode[]): number {
  const count = nodes.length;
  const minimumSeparation = Math.floor(count * 0.06);
  const seen = new Set<number>();
  let crossovers = 0;
  for (let a = 0; a < count; a += 2) {
    for (let b = a + minimumSeparation; b < count; b += 2) {
      if (count - (b - a) < minimumSeparation) continue;
      const nodeA = nodes[a]!;
      const nodeB = nodes[b]!;
      const planar = Math.hypot(nodeA.x - nodeB.x, nodeA.z - nodeB.z);
      const vertical = Math.abs(nodeA.y - nodeB.y);
      if (planar < (nodeA.width + nodeB.width) * 0.5 && vertical > 3.5) {
        // Collapse the whole overlapping region into one crossover.
        const bucket = Math.floor(a / minimumSeparation) * 1000 + Math.floor(b / minimumSeparation);
        if (!seen.has(bucket)) {
          seen.add(bucket);
          crossovers += 1;
        }
      }
    }
  }
  return crossovers;
}

/** The V5 quality bar from the brief, expressed as checks rather than prose. */
export function validateTrack(analysis: TrackAnalysis, blueprint: TrackBlueprint): string[] {
  const issues: string[] = [];
  if (analysis.lengthMeters < 2_500) {
    issues.push(`Longitud ${analysis.lengthMeters} m: por debajo del mínimo V5 de 2.500 m.`);
  }
  if (analysis.lengthMeters > 5_200) {
    issues.push(`Longitud ${analysis.lengthMeters} m: por encima del máximo orientativo de 5.000 m.`);
  }
  if (analysis.estimatedLapSeconds < 90 || analysis.estimatedLapSeconds > 180) {
    issues.push(`Vuelta estimada ${analysis.estimatedLapSeconds} s: fuera de la ventana 90-180 s.`);
  }
  if (analysis.corners < 10) issues.push(`Solo ${analysis.corners} curvas significativas; el mínimo es 10.`);
  if (analysis.corners > 22) issues.push(`${analysis.corners} curvas: el circuito puede volverse ilegible.`);
  if (analysis.straights < 2) issues.push("Faltan rectas donde respirar, adelantar y usar rebufo.");
  if (analysis.elevationChanges < 3) issues.push(`Solo ${analysis.elevationChanges} cambios de elevación; el mínimo es 3.`);
  if (analysis.sectors < 3) issues.push("Un circuito V5 necesita entre 3 y 6 sectores diferenciados.");
  if (analysis.landmarks < 5) issues.push(`Solo ${analysis.landmarks} landmarks; el mínimo es 5.`);
  if (analysis.shortcuts < 1) issues.push("Falta al menos un atajo.");
  if (analysis.setPieces < 2) issues.push("Cada circuito necesita al menos 2 momentos espectaculares.");
  if (analysis.averageWidth < 9) issues.push(`Anchura media ${analysis.averageWidth} m: demasiado estrecho para 4 karts.`);
  const roles = new Set(blueprint.sectors.map((sector) => sector.role));
  if (!roles.has("SET_PIECE")) issues.push("Ningún sector está marcado como SET_PIECE.");
  if (analysis.jumps < 1) issues.push("Falta al menos un salto o rampa.");
  if (analysis.hazards < 1) issues.push("Falta al menos un elemento interactivo o hazard.");
  // The brief asks a circuit to produce decisions, which needs more than one kind of shortcut.
  if (analysis.shortcutKinds.length < 2) {
    issues.push("Los atajos son todos de la misma categoría; hacen falta al menos dos tipos.");
  }
  return issues;
}
