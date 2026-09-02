import { Mesh, Scene, Vector2, Vector3, VertexData } from "@babylonjs/core";

/**
 * GEOMETRY TOOLKIT.
 *
 * The audit found that 100 % of the game's geometry was `MeshBuilder` primitives — boxes, spheres,
 * cylinders — with mathematically perfect edges. The art bible makes bevel mandatory for a reason:
 * a sharp edge gives the light nothing to break on, so a lit cube reads as a cube, while the same
 * cube with 2 cm of chamfer reads as an object.
 *
 * Everything here is built on one operation: `loft`, which stitches a sequence of closed rings into
 * a surface. That single primitive covers every shape the game needs —
 *
 *  - a chamfered box is four rounded-rectangle rings,
 *  - a kart body is a dozen rings of varying width along its length,
 *  - a wheel is a profile revolved into rings,
 *  - a roll bar is a circle swept along a path,
 *
 * — which means one well-tested piece of code replaces a pile of primitive calls, and the resulting
 * meshes have proper normals, continuous UVs and smooth shading where they should.
 */

export type Ring = Vector3[];

export type LoftOptions = {
  /** Close the surface between the last and first ring, for a torus or a tyre. */
  closed?: boolean;
  /** Triangulate a cap over the first ring. */
  capStart?: boolean;
  capEnd?: boolean;
  /** Metres of texture per unit along the ring. Keeps tiling materials at a constant scale. */
  uScale?: number;
  vScale?: number;
};

/** Stitches closed rings of equal vertex count into a surface. */
export function loft(scene: Scene, name: string, rings: readonly Ring[], options: LoftOptions = {}): Mesh {
  if (rings.length < 2) throw new Error(`loft(${name}) needs at least two rings.`);
  const perRing = rings[0]!.length;
  for (const ring of rings) {
    if (ring.length !== perRing) {
      throw new Error(`loft(${name}) needs rings of equal length; got ${ring.length} and ${perRing}.`);
    }
  }

  const positions: number[] = [];
  const uvs: number[] = [];
  const indices: number[] = [];
  const uScale = options.uScale ?? 1;
  const vScale = options.vScale ?? 1;

  // Cumulative distance along the sweep, so V does not bunch up where rings are close together.
  const vs: number[] = [0];
  for (let index = 1; index < rings.length; index += 1) {
    const previous = centroid(rings[index - 1]!);
    const current = centroid(rings[index]!);
    vs.push(vs[index - 1]! + Vector3.Distance(previous, current));
  }

  for (let ringIndex = 0; ringIndex < rings.length; ringIndex += 1) {
    const ring = rings[ringIndex]!;
    // The seam vertex is duplicated so U can run 0..1 without wrapping the texture backwards.
    for (let vertex = 0; vertex <= perRing; vertex += 1) {
      const point = ring[vertex % perRing]!;
      positions.push(point.x, point.y, point.z);
      uvs.push((vertex / perRing) * uScale, vs[ringIndex]! * vScale);
    }
  }

  const stride = perRing + 1;
  const ringCount = options.closed ? rings.length : rings.length - 1;
  for (let ringIndex = 0; ringIndex < ringCount; ringIndex += 1) {
    const next = (ringIndex + 1) % rings.length;
    for (let vertex = 0; vertex < perRing; vertex += 1) {
      const a = ringIndex * stride + vertex;
      const b = ringIndex * stride + vertex + 1;
      const c = next * stride + vertex;
      const d = next * stride + vertex + 1;
      indices.push(a, c, b, b, c, d);
    }
  }

  if (options.capStart) appendCap(positions, uvs, indices, rings[0]!, false);
  if (options.capEnd) appendCap(positions, uvs, indices, rings[rings.length - 1]!, true);

  const mesh = new Mesh(name, scene);
  const data = new VertexData();
  data.positions = positions;
  data.indices = indices;
  data.uvs = uvs;
  const normals: number[] = [];
  VertexData.ComputeNormals(positions, indices, normals);
  data.normals = normals;
  data.applyToMesh(mesh);
  /**
   * No welding pass is needed or wanted. Adjacent rings already share their vertices, so
   * `ComputeNormals` averages across the surface and the chamfer shades smoothly on its own. Calling
   * `forceSharedVertices` here would weld the duplicated seam vertex and merge the cap ring into the
   * body, which both smears the UV seam and rounds off the edge the chamfer exists to create.
   */
  return mesh;
}

function appendCap(
  positions: number[],
  uvs: number[],
  indices: number[],
  ring: Ring,
  flip: boolean,
): void {
  const centre = centroid(ring);
  const base = positions.length / 3;
  positions.push(centre.x, centre.y, centre.z);
  uvs.push(0.5, 0.5);
  for (const point of ring) {
    positions.push(point.x, point.y, point.z);
    uvs.push(0.5, 0.5);
  }
  for (let index = 0; index < ring.length; index += 1) {
    const a = base;
    const b = base + 1 + index;
    const c = base + 1 + ((index + 1) % ring.length);
    if (flip) indices.push(a, b, c);
    else indices.push(a, c, b);
  }
}

function centroid(ring: Ring): Vector3 {
  const sum = new Vector3();
  for (const point of ring) sum.addInPlace(point);
  return sum.scaleInPlace(1 / ring.length);
}

// ---------------------------------------------------------------------------------------- rings

/**
 * A rounded rectangle in the XZ plane at height `y`. The corner radius is what turns a box into an
 * object, so it is a required parameter rather than an option.
 */
export function roundedRectRing(
  halfWidth: number,
  halfDepth: number,
  radius: number,
  y: number,
  cornerSegments = 4,
): Ring {
  const r = Math.max(0.001, Math.min(radius, Math.min(halfWidth, halfDepth) * 0.98));
  const innerX = halfWidth - r;
  const innerZ = halfDepth - r;
  const ring: Ring = [];
  // Four corner arcs, walked in order so the ring stays convex and consistently wound.
  const corners: Array<[number, number, number]> = [
    [innerX, innerZ, 0],
    [-innerX, innerZ, Math.PI / 2],
    [-innerX, -innerZ, Math.PI],
    [innerX, -innerZ, (Math.PI * 3) / 2],
  ];
  for (const [cx, cz, startAngle] of corners) {
    for (let step = 0; step <= cornerSegments; step += 1) {
      const angle = startAngle + (step / cornerSegments) * (Math.PI / 2);
      ring.push(new Vector3(cx + Math.cos(angle) * r, y, cz + Math.sin(angle) * r));
    }
  }
  return ring;
}

/** A circle in the XZ plane. Used for tubes and revolved shapes. */
export function circleRing(radius: number, y: number, segments = 16): Ring {
  const ring: Ring = [];
  for (let step = 0; step < segments; step += 1) {
    const angle = (step / segments) * Math.PI * 2;
    ring.push(new Vector3(Math.cos(angle) * radius, y, Math.sin(angle) * radius));
  }
  return ring;
}

/** Scales and offsets a ring. Lets one profile be reused down a tapering body. */
export function transformRing(
  ring: Ring,
  scale: { x: number; z: number },
  offset: { x?: number; y?: number; z?: number } = {},
): Ring {
  return ring.map(
    (point) =>
      new Vector3(
        point.x * scale.x + (offset.x ?? 0),
        point.y + (offset.y ?? 0),
        point.z * scale.z + (offset.z ?? 0),
      ),
  );
}

// ---------------------------------------------------------------------------------------- shapes

export type BeveledBoxOptions = {
  width: number;
  height: number;
  depth: number;
  /** Chamfer size. The art bible sets 8 mm for small props, 20 mm mid, 40-60 mm hero. */
  bevel: number;
  /** Radius of the vertical edges. Defaults to the bevel. */
  cornerRadius?: number;
  cornerSegments?: number;
  uScale?: number;
  vScale?: number;
};

/**
 * A chamfered box: rounded vertical edges and a bevel along the top and bottom faces.
 * This is the single most-used shape in the game and the reason nothing has to look like a cube.
 */
export function beveledBox(scene: Scene, name: string, options: BeveledBoxOptions): Mesh {
  const { width, height, depth, bevel } = options;
  const halfWidth = width / 2;
  const halfDepth = depth / 2;
  const halfHeight = height / 2;
  const b = Math.max(0.001, Math.min(bevel, Math.min(halfWidth, halfDepth, halfHeight) * 0.6));
  const radius = options.cornerRadius ?? b * 1.6;
  const segments = options.cornerSegments ?? 3;

  const profile = (inset: number, y: number): Ring =>
    roundedRectRing(halfWidth - inset, halfDepth - inset, Math.max(0.001, radius - inset * 0.5), y, segments);

  const rings: Ring[] = [
    profile(b, -halfHeight),
    profile(0, -halfHeight + b),
    profile(0, halfHeight - b),
    profile(b, halfHeight),
  ];

  return loft(scene, name, rings, {
    capStart: true,
    capEnd: true,
    uScale: options.uScale ?? 1,
    vScale: options.vScale ?? 1,
  });
}

/**
 * Revolves a 2D profile around the Y axis. `profile` points are (radius, height) pairs.
 * Wheels, tyres, cups, ink drums, bottles and bollards are all this shape.
 */
export function revolve(
  scene: Scene,
  name: string,
  profile: readonly Vector2[],
  segments = 24,
  options: { capStart?: boolean; capEnd?: boolean; uScale?: number; vScale?: number } = {},
): Mesh {
  const rings = profile.map((point) => circleRing(Math.max(0.0001, point.x), point.y, segments));
  return loft(scene, name, rings, {
    capStart: options.capStart ?? true,
    capEnd: options.capEnd ?? true,
    uScale: options.uScale ?? 1,
    vScale: options.vScale ?? 1,
  });
}

/**
 * Sweeps a circle along a path. Used for roll bars, exhausts, pipes, handrails and cables — all
 * things V4 drew as thin boxes.
 */
export function tube(
  scene: Scene,
  name: string,
  path: readonly Vector3[],
  radius: number | ((t: number) => number),
  segments = 10,
): Mesh {
  if (path.length < 2) throw new Error(`tube(${name}) needs at least two path points.`);
  const rings: Ring[] = [];
  // Parallel transport of the reference frame, so the tube does not twist on a curved path.
  let up = new Vector3(0, 1, 0);
  for (let index = 0; index < path.length; index += 1) {
    const point = path[index]!;
    const ahead = path[Math.min(path.length - 1, index + 1)]!;
    const behind = path[Math.max(0, index - 1)]!;
    const tangent = ahead.subtract(behind).normalize();
    if (Math.abs(Vector3.Dot(tangent, up)) > 0.95) up = new Vector3(1, 0, 0);
    const right = Vector3.Cross(up, tangent).normalize();
    const trueUp = Vector3.Cross(tangent, right).normalize();
    up = trueUp;

    const t = index / (path.length - 1);
    const r = typeof radius === "number" ? radius : radius(t);
    const ring: Ring = [];
    for (let step = 0; step < segments; step += 1) {
      const angle = (step / segments) * Math.PI * 2;
      ring.push(
        point
          .add(right.scale(Math.cos(angle) * r))
          .add(trueUp.scale(Math.sin(angle) * r)),
      );
    }
    rings.push(ring);
  }
  return loft(scene, name, rings, { capStart: true, capEnd: true });
}

/**
 * A body lofted from a set of cross-sections given as (z, halfWidth, halfHeight, centreY).
 * This is how the kart chassis, the nose cone and a character's torso are shaped: a silhouette
 * described at a few stations and smoothly connected.
 */
export type Station = { z: number; halfWidth: number; halfHeight: number; y?: number; radius?: number };

export function lofted(
  scene: Scene,
  name: string,
  stations: readonly Station[],
  options: { cornerSegments?: number; capStart?: boolean; capEnd?: boolean } = {},
): Mesh {
  const segments = options.cornerSegments ?? 4;
  const rings = stations.map((station) => {
    // Built in the XY plane at a given Z, then the ring is oriented by swapping axes: the loft
    // sweeps along the station list rather than along Y.
    const ring = roundedRectRing(
      station.halfWidth,
      station.halfHeight,
      station.radius ?? Math.min(station.halfWidth, station.halfHeight) * 0.45,
      0,
      segments,
    );
    return ring.map((point) => new Vector3(point.x, point.z + (station.y ?? 0), station.z));
  });
  return loft(scene, name, rings, {
    capStart: options.capStart ?? true,
    capEnd: options.capEnd ?? true,
  });
}

/**
 * An ellipsoid built from rings rather than `CreateSphere`, so it can be squashed per axis and
 * given a flat spot. Heads, shoulders and hips are this shape.
 */
export function ellipsoid(
  scene: Scene,
  name: string,
  radii: { x: number; y: number; z: number },
  segments = 16,
  rings = 10,
): Mesh {
  const list: Ring[] = [];
  for (let step = 0; step <= rings; step += 1) {
    const v = (step / rings) * Math.PI;
    const y = -Math.cos(v) * radii.y;
    const scale = Math.sin(v);
    // The poles collapse to a point, so they get a tiny non-zero radius to keep the ring valid.
    const ring = circleRing(Math.max(0.0005, scale), y, segments).map(
      (point) => new Vector3(point.x * radii.x, point.y, point.z * radii.z),
    );
    list.push(ring);
  }
  return loft(scene, name, list, { capStart: false, capEnd: false });
}

/**
 * Merges parts into one mesh while keeping their materials as sub-meshes. Multi-material merging is
 * what lets a detailed object — a kart with paint, rubber, chrome and glass — still be a single
 * draw call per material instead of one per part.
 */
export function mergeParts(name: string, parts: Mesh[], useMultiMaterial = true): Mesh {
  const valid = parts.filter((part) => part.getTotalVertices() > 0);
  if (valid.length === 0) throw new Error(`mergeParts(${name}) received no geometry.`);
  if (valid.length === 1) {
    valid[0]!.name = name;
    return valid[0]!;
  }
  const merged = Mesh.MergeMeshes(valid, true, true, undefined, false, useMultiMaterial);
  if (!merged) throw new Error(`mergeParts(${name}) failed to merge ${valid.length} parts.`);
  merged.name = name;
  return merged;
}

/** Convenience: a 2D profile point for `revolve`. */
export function profilePoint(radius: number, height: number): Vector2 {
  return new Vector2(radius, height);
}
