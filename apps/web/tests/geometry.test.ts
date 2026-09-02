import { NullEngine, Scene, Vector2, Vector3 } from "@babylonjs/core";
import { beforeAll, describe, expect, it } from "vitest";
import {
  beveledBox,
  ellipsoid,
  loft,
  lofted,
  mergeParts,
  revolve,
  roundedRectRing,
  tube,
} from "@/render/Geometry";

/**
 * Geometry regression tests.
 *
 * The render layer builds every kart, prop and landmark procedurally, and a mistake there produces
 * an invisible, inside-out or exploded mesh rather than an exception. That class of bug cannot be
 * caught by a typecheck and is expensive to spot by eye, so the toolkit is verified headlessly with
 * Babylon's `NullEngine`: finite positions, unit-length normals, in-range indices, and the bounding
 * box the caller asked for.
 */

let scene: Scene;

beforeAll(() => {
  const engine = new NullEngine();
  scene = new Scene(engine);
});

type Mesh = ReturnType<typeof beveledBox>;

function assertValid(mesh: Mesh): { triangles: number; size: Vector3 } {
  const positions = mesh.getVerticesData("position");
  const normals = mesh.getVerticesData("normal");
  const indices = mesh.getIndices();

  expect(positions, "mesh has positions").toBeTruthy();
  expect(normals, "mesh has normals").toBeTruthy();
  expect(indices, "mesh has indices").toBeTruthy();
  expect(positions!.length).toBeGreaterThan(0);
  expect(indices!.length).toBeGreaterThan(0);

  for (let index = 0; index < positions!.length; index += 1) {
    expect(Number.isFinite(positions![index]), `position ${index} is finite`).toBe(true);
  }

  // A degenerate normal means a collapsed triangle, which renders as a black or invisible facet.
  for (let vertex = 0; vertex < normals!.length; vertex += 3) {
    const length = Math.hypot(normals![vertex]!, normals![vertex + 1]!, normals![vertex + 2]!);
    expect(length, `normal at vertex ${vertex / 3} is unit length`).toBeGreaterThan(0.5);
  }

  const vertexCount = positions!.length / 3;
  for (const index of indices!) {
    expect(index).toBeGreaterThanOrEqual(0);
    expect(index).toBeLessThan(vertexCount);
  }

  mesh.refreshBoundingInfo();
  const box = mesh.getBoundingInfo().boundingBox;
  return { triangles: indices!.length / 3, size: box.maximum.subtract(box.minimum) };
}

describe("rings", () => {
  it("closes a rounded rectangle without duplicating the seam", () => {
    const ring = roundedRectRing(1, 0.5, 0.2, 0, 4);
    // Four corners of five points each.
    expect(ring.length).toBe(20);
    expect(ring[0]!.equals(ring[ring.length - 1]!)).toBe(false);
  });

  it("clamps the corner radius so it cannot exceed the rectangle", () => {
    const ring = roundedRectRing(0.5, 0.5, 10, 0, 3);
    for (const point of ring) {
      expect(Math.abs(point.x)).toBeLessThanOrEqual(0.51);
      expect(Math.abs(point.z)).toBeLessThanOrEqual(0.51);
    }
  });
});

describe("beveledBox", () => {
  it("matches the requested dimensions", () => {
    const { size } = assertValid(beveledBox(scene, "box", { width: 2, height: 1, depth: 3, bevel: 0.1 }));
    expect(size.x).toBeCloseTo(2, 1);
    expect(size.y).toBeCloseTo(1, 1);
    expect(size.z).toBeCloseTo(3, 1);
  });

  it("survives a bevel larger than the box", () => {
    // The art bible applies bevel by object size; a caller passing a silly value must not produce
    // inverted geometry, so the bevel is clamped rather than trusted.
    const { size } = assertValid(beveledBox(scene, "box2", { width: 0.2, height: 0.2, depth: 0.2, bevel: 5 }));
    expect(size.x).toBeCloseTo(0.2, 1);
  });
});

describe("revolve", () => {
  it("builds a wheel-shaped solid of the right diameter and width", () => {
    const { size } = assertValid(
      revolve(
        scene,
        "wheel",
        [
          new Vector2(0.24, -0.2),
          new Vector2(0.35, -0.2),
          new Vector2(0.42, -0.11),
          new Vector2(0.42, 0.11),
          new Vector2(0.35, 0.2),
          new Vector2(0.24, 0.2),
        ],
        24,
        { capStart: false, capEnd: false },
      ),
    );
    expect(size.x).toBeCloseTo(0.84, 1);
    expect(size.z).toBeCloseTo(0.84, 1);
    expect(size.y).toBeCloseTo(0.4, 1);
  });
});

describe("tube", () => {
  it("sweeps a straight path to the requested length and diameter", () => {
    const { size } = assertValid(tube(scene, "tube", [new Vector3(0, 0, 0), new Vector3(0, 2, 0)], 0.1, 8));
    expect(size.y).toBeCloseTo(2, 1);
    expect(size.x).toBeCloseTo(0.2, 1);
  });

  it("does not twist or degenerate on a curved path", () => {
    // Parallel transport of the frame is what stops a swept fender or exhaust from pinching.
    assertValid(
      tube(
        scene,
        "tube-curved",
        [new Vector3(-1, 0, 0), new Vector3(0, 1, 0.5), new Vector3(1, 0, 0)],
        0.08,
        8,
      ),
    );
  });

  it("accepts a tapering radius", () => {
    assertValid(
      tube(scene, "tube-taper", [new Vector3(0, 0, 0), new Vector3(0, 1, 0)], (t) => 0.05 + t * 0.05, 8),
    );
  });
});

describe("ellipsoid", () => {
  it("respects per-axis radii", () => {
    const { size } = assertValid(ellipsoid(scene, "ell", { x: 0.5, y: 1, z: 0.25 }, 16, 10));
    expect(size.x).toBeCloseTo(1, 1);
    expect(size.y).toBeCloseTo(2, 1);
    expect(size.z).toBeCloseTo(0.5, 1);
  });
});

describe("lofted", () => {
  it("spans the full station range", () => {
    const { size } = assertValid(
      lofted(scene, "chassis", [
        { z: -1.4, halfWidth: 0.5, halfHeight: 0.15, y: 0.44 },
        { z: 0, halfWidth: 0.8, halfHeight: 0.25, y: 0.45 },
        { z: 1.4, halfWidth: 0.24, halfHeight: 0.11, y: 0.51 },
      ]),
    );
    expect(size.z).toBeCloseTo(2.8, 1);
    expect(size.x).toBeCloseTo(1.6, 1);
  });
});

describe("mergeParts", () => {
  it("combines parts into one mesh covering both", () => {
    const left = beveledBox(scene, "left", { width: 1, height: 1, depth: 1, bevel: 0.05 });
    const right = beveledBox(scene, "right", { width: 1, height: 1, depth: 1, bevel: 0.05 });
    right.position.x = 2;
    const { size } = assertValid(mergeParts("merged", [left, right], false));
    expect(size.x).toBeCloseTo(3, 1);
  });

  it("returns the single part unchanged rather than failing", () => {
    const only = beveledBox(scene, "only", { width: 1, height: 1, depth: 1, bevel: 0.05 });
    expect(mergeParts("single", [only], false).name).toBe("single");
  });
});

describe("loft guards", () => {
  it("rejects a single ring", () => {
    expect(() => loft(scene, "bad", [roundedRectRing(1, 1, 0.2, 0, 3)])).toThrow();
  });

  it("rejects rings of differing vertex counts", () => {
    expect(() =>
      loft(scene, "bad2", [roundedRectRing(1, 1, 0.2, 0, 3), roundedRectRing(1, 1, 0.2, 1, 5)]),
    ).toThrow();
  });
});
