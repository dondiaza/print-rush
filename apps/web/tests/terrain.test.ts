import { NullEngine, PBRMaterial, Scene, VertexBuffer } from "@babylonjs/core";
import { getCircuits, TerrainConfig } from "@print-rush/game-core";
import { beforeAll, describe, expect, it } from "vitest";
import { MaterialLibrary } from "@/render/MaterialLibrary";
import { createTerrain } from "@/render/Terrain";

/**
 * THE GROUND.
 *
 * Until this module existed, a circuit was a ribbon of road with a wall on each side and a painted
 * backdrop, and past the walls there was nothing — no geometry at all. That single absence produced
 * two of the defects reported against the game ("the backgrounds are still not complete", "I should
 * be able to leave the road"), and the fix is only real if the mesh is actually there and actually
 * covers the distance the camera can see.
 *
 * So these assertions are about extent and about texel density, because those are the two ways a
 * ground plane fails without erroring: it can be built and be too small, and it can be built at the
 * right size with its texture stretched across the whole of it.
 */

let scene: Scene;
const circuit = getCircuits()[0]!;

beforeAll(() => {
  scene = new Scene(new NullEngine());
});

/**
 * A material library that hands out one flat material.
 *
 * Not a shortcut: `MaterialLibrary` draws its procedural patterns into a `DynamicTexture`, and a
 * `NullEngine` has no canvas to draw into, so the real one cannot run here at all. What that class
 * does with a request is covered by `catalog.test.ts` against the real manifest; what this file is
 * about is the geometry, and the geometry does not care which material it gets.
 */
class FlatMaterials extends MaterialLibrary {
  private readonly flat: PBRMaterial;

  constructor(target: Scene) {
    super(target, "HIGH");
    this.flat = new PBRMaterial("flat", target);
  }

  override get(): PBRMaterial {
    return this.flat;
  }
}

const build = (quality: string) =>
  createTerrain(scene, circuit.definition.nodes, circuit.blueprint.theme, quality, new FlatMaterials(scene));

describe("extent", () => {
  it("reaches past the circuit far enough to meet the backdrop", () => {
    const terrain = build("HIGH");
    // The backdrop shell sits 820 m from the camera. Anything less than that here leaves a band of
    // nothing between where the ground stops and where the picture starts, which is the "incomplete
    // background" report in its most literal form.
    expect(terrain.radius).toBeGreaterThanOrEqual(TerrainConfig.visualMarginMetres);
    expect(terrain.radius).toBeGreaterThan(700);
    terrain.dispose();
  });

  it("covers the whole circuit, not just the middle of it", () => {
    const terrain = build("HIGH");
    const field = terrain.meshes.find((mesh) => mesh.name === "terrain-field")!;
    field.computeWorldMatrix(true);
    field.refreshBoundingInfo({});
    const box = field.getBoundingInfo().boundingBox;
    for (const node of circuit.definition.nodes) {
      expect(node.x).toBeGreaterThan(box.minimumWorld.x);
      expect(node.x).toBeLessThan(box.maximumWorld.x);
      expect(node.z).toBeGreaterThan(box.minimumWorld.z);
      expect(node.z).toBeLessThan(box.maximumWorld.z);
    }
    terrain.dispose();
  });
});

describe("texel density", () => {
  it("gives the field UVs measured in metres, not 0..1 across the plane", () => {
    /**
     * The bug this catches was invisible and everywhere.
     *
     * `MeshBuilder.CreateGround` lays UVs 0..1 across the whole plane, while `MaterialLibrary` scales
     * its textures by `1 / tile` on the assumption that UVs are in metres — which the road surface
     * satisfies and a ground plane does not. On a plane this size that asked for one texture repeat
     * every several kilometres: a flat, blurry, untextured floor at every quality tier. Asserting
     * that the UV range is comparable to the plane's size in metres is what pins it down.
     */
    const terrain = build("HIGH");
    const field = terrain.meshes.find((mesh) => mesh.name === "terrain-field")!;
    const uvs = field.getVerticesData(VertexBuffer.UVKind)!;
    let maxU = 0;
    for (let index = 0; index < uvs.length; index += 2) maxU = Math.max(maxU, uvs[index]!);
    // One UV unit per metre, so the largest U is the plane's span.
    expect(maxU).toBeCloseTo(terrain.radius * 2, 0);
    terrain.dispose();
  });

  it("squares up the verge's texture across the track", () => {
    // The verge is roughly three times the width of the road it borders, and `buildRoadSurface`
    // writes `u` as 0..1 across whatever width it is given. Left alone, that stretches the texture
    // three to one exactly where a driver looks when running wide.
    const terrain = build("HIGH");
    const verge = terrain.meshes.find((mesh) => mesh.name === "terrain-verge")!;
    const uvs = verge.getVerticesData(VertexBuffer.UVKind)!;
    let maxU = 0;
    for (let index = 0; index < uvs.length; index += 2) maxU = Math.max(maxU, uvs[index]!);
    expect(maxU).toBeGreaterThan(1.5);
  });
});

describe("cost", () => {
  it("is a handful of meshes at every tier, including the lowest", () => {
    // The ground is the one piece of dressing that cannot be cut on a small device: without it the
    // world has no floor. So it must be cheap enough that it never needs to be.
    const low = build("LOW");
    expect(low.meshes.length).toBeLessThanOrEqual(3);
    expect(low.meshes.length).toBeGreaterThanOrEqual(2);
    low.dispose();

    const high = build("HIGH");
    expect(high.meshes.length).toBeLessThanOrEqual(4);
    // The rumble strip is the difference: one instanced source, a full lap of both edges.
    expect(high.meshes.some((mesh) => mesh.name === "terrain-rumble")).toBe(true);
    high.dispose();
  });

  it("disposes everything it made", () => {
    const before = scene.meshes.length;
    const terrain = build("HIGH");
    expect(scene.meshes.length).toBeGreaterThan(before);
    terrain.dispose();
    // Instances go with their source, so the count must come all the way back.
    expect(scene.meshes.length).toBe(before);
  });
});
