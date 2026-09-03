import { NullEngine, PBRMaterial, Scene, StandardMaterial } from "@babylonjs/core";
import { getCircuits, type BakedTrack } from "@print-rush/game-core";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { buildBarrier, BARRIERS, sweepProfile } from "@/render/Barrier";
import { buildHall, HALLS } from "@/render/Hall";
import { buildSignage, findCorners, sectorStarts, SIGNAGE } from "@/render/Signage";
import type { MaterialLibrary, MaterialRequest } from "@/render/MaterialLibrary";
import { createTerrain } from "@/render/Terrain";

/**
 * The building, the barrier and the signage.
 *
 * These three modules turned a road on a plain into a circuit inside a hall, and they are built
 * from the circuit's own nodes at runtime — so a change to a layout, a margin or a profile can
 * quietly produce a wall through the road, a barrier with a hole where there was none, or a gate on
 * the start line. None of that is visible without a browser. What can be asserted without one:
 *
 *  - the hall's walls stand outside every piece of road and its ceiling clears every piece of road;
 *  - the barrier closes on both sides of every node that declares a wall, and opens where it does not;
 *  - every sector gets a gate and every real corner gets a board, on the five shipped circuits;
 *  - everything disposes.
 *
 * `MaterialLibrary` draws into a `DynamicTexture`, which has no canvas under `NullEngine`, so a stub
 * that hands out plain materials stands in for it — the geometry is what is under test.
 */

class StubMaterials {
  readonly requests: MaterialRequest[] = [];
  constructor(private readonly scene: Scene) {}
  get size(): number {
    return this.requests.length;
  }
  get(request: MaterialRequest): PBRMaterial {
    this.requests.push(request);
    return new PBRMaterial(`stub-${this.requests.length}`, this.scene);
  }
  glow(name: string): StandardMaterial {
    return new StandardMaterial(`glow-${name}`, this.scene);
  }
  dispose(): void {}
}

let engine: NullEngine;
let scene: Scene;
let circuits: readonly BakedTrack[];

beforeAll(() => {
  engine = new NullEngine();
  scene = new Scene(engine);
  circuits = getCircuits();
});

afterAll(() => {
  scene.dispose();
  engine.dispose();
});

const materials = (): MaterialLibrary => new StubMaterials(scene) as unknown as MaterialLibrary;

describe("the hall", () => {
  it("has a spec for every shipped theme", () => {
    for (const track of circuits) expect(HALLS[track.blueprint.theme], track.blueprint.theme).toBeDefined();
  });

  it.each(getCircuits().map((track) => [track.blueprint.id, track] as const))("%s: walls outside the road, ceiling above it", (_id, track) => {
    const nodes = track.definition.nodes;
    const library = materials();
    const terrain = createTerrain(scene, nodes, track.blueprint.theme, "HIGH", library);
    const hall = buildHall(scene, nodes, track.blueprint.theme, "HIGH", library, terrain);
    let maxY = -Infinity;
    for (const node of nodes) {
      expect(node.x - node.width, "west").toBeGreaterThan(hall.bounds.minX);
      expect(node.x + node.width, "east").toBeLessThan(hall.bounds.maxX);
      expect(node.z - node.width, "south").toBeGreaterThan(hall.bounds.minZ);
      expect(node.z + node.width, "north").toBeLessThan(hall.bounds.maxZ);
      maxY = Math.max(maxY, node.y);
    }
    // Eleven metres of headroom over the highest road: a gantry, a lamp and a jump all fit under it.
    expect(hall.ceilingY - maxY).toBeGreaterThan(10.9);
    // A wall anchor lands on the perimeter, facing in.
    const anchor = hall.wallAnchor(nodes[0]!.x, nodes[0]!.z, 5);
    const onPerimeter =
      Math.abs(anchor.position.x - hall.bounds.minX) < 1 ||
      Math.abs(anchor.position.x - hall.bounds.maxX) < 1 ||
      Math.abs(anchor.position.z - hall.bounds.minZ) < 1 ||
      Math.abs(anchor.position.z - hall.bounds.maxZ) < 1;
    expect(onPerimeter).toBe(true);
    expect(hall.meshes.length).toBeGreaterThan(5);
    const before = scene.meshes.length;
    hall.dispose();
    terrain.dispose();
    expect(scene.meshes.length).toBeLessThan(before);
  });

  it("keeps free-standing columns clear of the road", () => {
    const track = circuits[2]!;
    const nodes = track.definition.nodes;
    const library = materials();
    const terrain = createTerrain(scene, nodes, track.blueprint.theme, "HIGH", library);
    const hall = buildHall(scene, nodes, track.blueprint.theme, "HIGH", library, terrain);
    const columns = scene.meshes.filter((mesh) => mesh.name.startsWith("hall-column-") && !mesh.name.includes("base"));
    expect(columns.length).toBeGreaterThan(10);
    for (const column of columns) {
      let nearest = Infinity;
      for (const node of nodes) {
        nearest = Math.min(nearest, Math.hypot(node.x - column.position.x, node.z - column.position.z) - node.width * 0.5);
      }
      // Never on the road or its run-off.
      expect(nearest, column.name).toBeGreaterThan(4);
    }
    hall.dispose();
    terrain.dispose();
  });
});

describe("the barrier", () => {
  it("has a style for every shipped theme", () => {
    for (const track of circuits) expect(BARRIERS[track.blueprint.theme], track.blueprint.theme).toBeDefined();
  });

  it("sweeps a profile with one ring of vertices per node and skips open sections", () => {
    const track = circuits[2]!;
    const nodes = track.definition.nodes;
    const profile = [[0, 0], [0, 0.5], [0.5, 0.5], [0.5, 0]] as const;
    const closed = sweepProfile(scene, nodes, 1, profile, () => true, "closed");
    expect(closed).not.toBeNull();
    expect(closed!.getTotalVertices()).toBe(nodes.length * profile.length);
    // Every node stitched to the next: (nodes) x (profile segments) x 2 triangles.
    expect(closed!.getTotalIndices()).toBe(nodes.length * (profile.length - 1) * 6);

    const half = sweepProfile(scene, nodes, 1, profile, (node) => node.progress < 0.5, "half");
    expect(half).not.toBeNull();
    expect(half!.getTotalIndices()).toBeLessThan(closed!.getTotalIndices() * 0.55);

    const none = sweepProfile(scene, nodes, 1, profile, () => false, "none");
    expect(none).toBeNull();
    closed!.dispose();
    half!.dispose();
  });

  it.each(getCircuits().map((track) => [track.blueprint.id, track] as const))("%s: builds on both sides and disposes", (_id, track) => {
    const before = scene.meshes.length;
    const barrier = buildBarrier(scene, track.definition.nodes, track.blueprint.theme, "HIGH", materials());
    const plinths = barrier.meshes.filter((mesh) => mesh.name.startsWith("barrier-plinth"));
    expect(plinths.length).toBe(2);
    for (const plinth of plinths) {
      const positions = plinth.getVerticesData("position")!;
      for (let index = 1; index < positions.length; index += 3) expect(Number.isFinite(positions[index])).toBe(true);
    }
    barrier.dispose();
    expect(scene.meshes.length).toBe(before);
  });
});

describe("signage", () => {
  it("has a style for every shipped theme", () => {
    for (const track of circuits) expect(SIGNAGE[track.blueprint.theme], track.blueprint.theme).toBeDefined();
  });

  it("finds the sectors where they begin, and finds real corners", () => {
    const track = circuits[2]!;
    const starts = sectorStarts(track.definition.nodes);
    expect([...starts.keys()].sort()).toEqual([1, 2, 3, 4, 5]);
    const corners = findCorners(track.definition.nodes);
    // The factory has seventeen corners by the analyser's count; the signage needs a good share of
    // them, and none from the straights.
    expect(corners.length).toBeGreaterThanOrEqual(8);
    expect(corners.length).toBeLessThanOrEqual(30);
    for (const corner of corners) expect(Math.abs(corner.direction)).toBe(1);
  });

  it.each(getCircuits().map((track) => [track.blueprint.id, track] as const))("%s: a gate per sector after the first, boards at corners", (_id, track) => {
    const signage = buildSignage({
      scene,
      nodes: track.definition.nodes,
      sectors: track.blueprint.sectors,
      theme: track.blueprint.theme,
      quality: "HIGH",
      materials: materials(),
      heightAt: () => 0,
      avoidProgress: [0],
    });
    // Sector one starts on the finish line, whose gantry is the gate; the other four get their own.
    expect(signage.gates).toBeGreaterThanOrEqual(4);
    expect(signage.boards).toBeGreaterThanOrEqual(6);
    expect(signage.meshes.length).toBeGreaterThan(0);
    signage.dispose();
  });
});
