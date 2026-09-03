import { describe, expect, it } from "vitest";
import {
  getCircuits,
  needsRecovery,
  queryWall,
  sampleTrack,
  surfaceAt,
  surfaceGrip,
  TerrainConfig,
  type TrackDefinition,
  type TrackNode,
} from "../src/index.js";

/**
 * LEAVING THE ROAD.
 *
 * These exist because the game shipped for months without any of this working, and the reason it did
 * not work was invisible: every node defaulted to `wallLeft`/`wallRight` true, so `queryWall` stopped
 * a kart at the edge of the tarmac and the `GRASS`, `SAND` and `OFFROAD` entries in `SurfaceConfig`
 * were dead code — configured, tuned, documented, and unreachable.
 *
 * The assertions are about *reachability* rather than about numbers. Each one fails if the corridor
 * comes back, in the specific way it could come back.
 *
 * The geometry is asserted against a straight synthetic track rather than a real circuit, and that is
 * not for convenience: on a curved centreline a point forty metres off the road is often nearest to a
 * *different* node than the one it was offset from, so a test written against a real corner would be
 * measuring the nearest-node search rather than the thing it claims to measure.
 */

/** A straight run of road along +Z, so a lateral offset in metres is exactly `lateral`. */
function straight(options: { width?: number; banking?: number } = {}): TrackDefinition {
  const width = options.width ?? 14;
  const nodes: TrackNode[] = [];
  for (let index = 0; index < 40; index += 1) {
    nodes.push({
      x: 0,
      y: 0,
      z: index * 10,
      progress: index / 40,
      distance: index * 10,
      width,
      banking: options.banking ?? 0,
      surface: "ASPHALT",
      sector: 1,
      wallLeft: true,
      wallRight: true,
    });
  }
  return {
    id: "straight",
    name: "Straight",
    recommendedLaps: 1,
    spawnPoints: [],
    checkpoints: [],
    nodes,
    recoveryPoints: [],
    lengthMeters: 400,
    bounds: { minX: 0, maxX: 0, minZ: 0, maxZ: 390, minY: 0, maxY: 0 },
  };
}

const track = straight();
const half = 7;
/** A sample at a given lateral offset, mid-run so the nearest node is unambiguous. */
const at = (lateral: number, definition = track) =>
  sampleTrack(definition, { x: -lateral, y: 0, z: 200 });

describe("the verge is reachable", () => {
  it("reports off-road past the tarmac edge", () => {
    expect(at(half - 1).offRoad).toBe(false);
    expect(at(half + 1).offRoad).toBe(true);
  });

  it("measures how far off the road a position is", () => {
    expect(at(half + 10).offRoadDistance).toBeCloseTo(10, 6);
    expect(at(0).offRoadDistance).toBe(0);
    // Symmetric: the far side of the road is off-road at the same distance.
    expect(at(-(half + 10)).offRoadDistance).toBeCloseTo(10, 6);
  });

  it("leaves the barrier a verge's width from the tarmac", () => {
    // Just off the road: no wall, even though both wall flags are set.
    expect(queryWall(at(half + 2), 1)).toBeNull();
    expect(queryWall(at(-(half + 2)), 1)).toBeNull();
    // Past the verge: the barrier.
    expect(queryWall(at(half + TerrainConfig.vergeMetres + 3), 1)).not.toBeNull();
    expect(queryWall(at(-(half + TerrainConfig.vergeMetres + 3)), 1)).not.toBeNull();
  });

  it("still lets a circuit open a side deliberately", () => {
    // The point of the change was to stop walls being the shape of the world, not to remove them.
    // A node that asks for no wall must still get none, which is what a shortcut mouth relies on.
    const open = straight();
    for (const node of open.nodes) node.wallLeft = false;
    const far = half + TerrainConfig.vergeMetres + 5;
    expect(queryWall(at(far, open), 1)).toBeNull();
    expect(queryWall(at(-far, open), 1)).not.toBeNull();
  });
});

describe("running wide costs grip, then costs a reset", () => {
  it("grades the surface by how far off the road you are", () => {
    expect(surfaceAt(at(0))).toBe("ASPHALT");
    expect(surfaceAt(at(half + 4))).toBe("OFFROAD");
    expect(surfaceAt(at(half + TerrainConfig.vergeMetres + 4))).toBe("SAND");
  });

  it("makes each step off the road slower than the last", () => {
    const road = surfaceGrip(surfaceAt(at(0)));
    const verge = surfaceGrip(surfaceAt(at(half + 4)));
    const beyond = surfaceGrip(surfaceAt(at(half + TerrainConfig.vergeMetres + 4)));
    expect(verge.grip).toBeLessThan(road.grip);
    expect(beyond.grip).toBeLessThan(verge.grip);
  });

  it("only recovers a kart that is genuinely lost", () => {
    // The whole verge and a margin past it must be drivable: a recovery a metre off the tarmac is an
    // invisible wall with extra steps, which is worse than the visible one it replaced.
    expect(needsRecovery(at(half + TerrainConfig.vergeMetres))).toBe(false);
    expect(needsRecovery(at(half + TerrainConfig.recoveryMetres + 1))).toBe(true);
  });

  it("keeps recovery outside the drivable verge", () => {
    expect(TerrainConfig.recoveryMetres).toBeGreaterThan(TerrainConfig.vergeMetres);
  });
});

describe("the ground off the road is flat", () => {
  const banked = straight({ banking: 0.18 });

  it("still banks across the road itself", () => {
    const centre = at(0, banked).groundY;
    const edge = at(half, banked).groundY;
    expect(edge - centre).toBeCloseTo(Math.tan(0.18) * half, 6);
  });

  it("stops extrapolating banking past the tarmac edge", () => {
    // `tan(banking) * lateral` used to run without limit. That was harmless while the walls made
    // off-road unreachable, and became a ramp into the sky the moment they opened: forty metres off
    // a banked corner put the ground seven metres in the air.
    const edge = at(half, banked).groundY;
    expect(at(half + 40, banked).groundY).toBeCloseTo(edge, 6);
    expect(at(-(half + 40), banked).groundY).toBeCloseTo(at(-half, banked).groundY, 6);
  });
});

describe("every shipped circuit can be left", () => {
  it.each(getCircuits().map((track) => [track.blueprint.name, track.definition] as const))(
    "%s has driveable ground beside the road",
    (_name, definition) => {
      // A regression here means a circuit has gone back to being a corridor. Sampling the real
      // centreline rather than a synthetic one, but only two metres out, where the nearest node
      // cannot have changed.
      const node = definition.nodes[Math.floor(definition.nodes.length / 2)]!;
      const sample = sampleTrack(definition, node);
      const out = node.width / 2 + 2;
      const beside = sampleTrack(definition, {
        x: node.x + sample.normal.x * out,
        y: node.y,
        z: node.z + sample.normal.z * out,
      });
      expect(beside.offRoad).toBe(true);
      expect(queryWall(beside, 1)).toBeNull();
      expect(needsRecovery(beside)).toBe(false);
    },
  );
});
