import {
  Color3,
  Color4,
  DirectionalLight,
  HemisphericLight,
  Mesh,
  MeshBuilder,
  Scene,
  ShadowGenerator,
  StandardMaterial,
  Vector3,
  VertexData,
} from "@babylonjs/core";
import type { TrackDefinition, TrackNode } from "@print-rush/game-core";

/**
 * GREY BOX.
 *
 * Deliberately unlit, untextured, uncoloured geometry. Its only job is to let the vehicle model be
 * judged on feel, which is the gate the V5 brief puts in front of every art task.
 *
 * The one thing it does take seriously is spatial reference: distance posts every 25 m, kerbs at
 * every corner and lane markings down the centre. Speed perception is a real, measurable property
 * of the handling model, and it cannot be assessed on an empty plane — the V4 circuit had nothing
 * beside the road, which is a large part of why 104 km/h felt slow.
 */

export type BuiltGreyBox = {
  road: Mesh;
  walls: Mesh[];
  markers: Mesh[];
  dispose: () => void;
};

/** Builds the road surface as a single banked ribbon from the baked node list. */
function buildRoad(scene: Scene, nodes: readonly TrackNode[], name: string): Mesh {
  const count = nodes.length;
  const positions: number[] = [];
  const indices: number[] = [];
  const normals: number[] = [];
  const uvs: number[] = [];

  for (let index = 0; index < count; index += 1) {
    const node = nodes[index]!;
    const previous = nodes[(index - 1 + count) % count]!;
    const next = nodes[(index + 1) % count]!;
    const tx = next.x - previous.x;
    const tz = next.z - previous.z;
    const length = Math.hypot(tx, tz) || 1;
    const nx = -tz / length;
    const nz = tx / length;
    const half = node.width * 0.5;
    // Banking rotates the cross-section about the tangent, so the edges sit at different heights.
    const lift = Math.tan(node.banking) * half;

    positions.push(node.x + nx * half, node.y + lift, node.z + nz * half);
    positions.push(node.x - nx * half, node.y - lift, node.z - nz * half);
    // V runs with distance so any tiling material repeats at a constant rate along the lap.
    uvs.push(0, node.distance / 8, 1, node.distance / 8);
  }

  for (let index = 0; index < count; index += 1) {
    const a = index * 2;
    const b = a + 1;
    const c = ((index + 1) % count) * 2;
    const d = c + 1;
    indices.push(a, b, c, b, d, c);
  }

  const mesh = new Mesh(name, scene);
  const data = new VertexData();
  data.positions = positions;
  data.indices = indices;
  data.uvs = uvs;
  VertexData.ComputeNormals(positions, indices, normals);
  data.normals = normals;
  data.applyToMesh(mesh);
  return mesh;
}

/** Vertical wall along one side of the road, built the same way as the surface. */
function buildWall(
  scene: Scene,
  nodes: readonly TrackNode[],
  side: 1 | -1,
  height: number,
  name: string,
): Mesh | null {
  const count = nodes.length;
  const positions: number[] = [];
  const indices: number[] = [];
  const normals: number[] = [];
  const uvs: number[] = [];
  const present: boolean[] = [];

  for (let index = 0; index < count; index += 1) {
    const node = nodes[index]!;
    const previous = nodes[(index - 1 + count) % count]!;
    const next = nodes[(index + 1) % count]!;
    const tx = next.x - previous.x;
    const tz = next.z - previous.z;
    const length = Math.hypot(tx, tz) || 1;
    const nx = (-tz / length) * side;
    const nz = (tx / length) * side;
    const half = node.width * 0.5;
    const lift = Math.tan(node.banking) * half * side;
    const baseY = node.y + lift;

    positions.push(node.x + nx * half, baseY, node.z + nz * half);
    positions.push(node.x + nx * half, baseY + height, node.z + nz * half);
    uvs.push(node.distance / 4, 0, node.distance / 4, 1);
    present.push(side === 1 ? node.wallLeft : node.wallRight);
  }

  let quads = 0;
  for (let index = 0; index < count; index += 1) {
    // A gap in the wall is a shortcut mouth or a ledge, so the quad is simply skipped.
    if (!present[index] || !present[(index + 1) % count]) continue;
    const a = index * 2;
    const b = a + 1;
    const c = ((index + 1) % count) * 2;
    const d = c + 1;
    if (side === 1) indices.push(a, b, c, b, d, c);
    else indices.push(c, b, a, c, d, b);
    quads += 1;
  }
  if (quads === 0) return null;

  const mesh = new Mesh(name, scene);
  const data = new VertexData();
  data.positions = positions;
  data.indices = indices;
  data.uvs = uvs;
  VertexData.ComputeNormals(positions, indices, normals);
  data.normals = normals;
  data.applyToMesh(mesh);
  return mesh;
}

function greyMaterial(scene: Scene, name: string, value: number, emissive = 0): StandardMaterial {
  const material = new StandardMaterial(name, scene);
  material.diffuseColor = new Color3(value, value, value * 1.02);
  material.emissiveColor = new Color3(emissive, emissive, emissive);
  material.specularColor = new Color3(0.04, 0.04, 0.05);
  return material;
}

export function buildGreyBox(scene: Scene, track: TrackDefinition): BuiltGreyBox {
  scene.clearColor = new Color4(0.42, 0.45, 0.5, 1);
  scene.ambientColor = new Color3(0.3, 0.3, 0.34);

  const ambient = new HemisphericLight("greybox-ambient", new Vector3(0, 1, 0), scene);
  ambient.intensity = 0.55;
  ambient.diffuse = Color3.FromHexString("#cdd6e0");
  ambient.groundColor = Color3.FromHexString("#4a4f57");

  const key = new DirectionalLight("greybox-key", new Vector3(-0.4, -1, 0.35), scene);
  key.intensity = 1.9;
  key.position.set(120, 180, -140);
  const shadows = new ShadowGenerator(2048, key);
  shadows.usePercentageCloserFiltering = true;

  const nodes = track.nodes;
  const road = buildRoad(scene, nodes, "greybox-road");
  road.material = greyMaterial(scene, "greybox-road-mat", 0.3);
  road.receiveShadows = true;

  const walls: Mesh[] = [];
  const wallMaterial = greyMaterial(scene, "greybox-wall-mat", 0.55);
  for (const side of [1, -1] as const) {
    const wall = buildWall(scene, nodes, side, 0.9, `greybox-wall-${side > 0 ? "left" : "right"}`);
    if (!wall) continue;
    wall.material = wallMaterial;
    wall.receiveShadows = true;
    walls.push(wall);
  }

  // ------------------------------------------------------------------ kerbs
  // Kerbs only appear where the road actually curves, so they read as corner markers rather than
  // decoration. Instanced from one source mesh.
  const kerbSource = MeshBuilder.CreateBox("greybox-kerb", { width: 1.1, height: 0.12, depth: 2.4 }, scene);
  kerbSource.material = greyMaterial(scene, "greybox-kerb-mat", 0.78, 0.06);
  kerbSource.isVisible = false;
  kerbSource.registerInstancedBuffer("color", 4);

  const markers: Mesh[] = [];
  const postSource = MeshBuilder.CreateBox("greybox-post", { width: 0.34, height: 2.6, depth: 0.34 }, scene);
  postSource.material = greyMaterial(scene, "greybox-post-mat", 0.68);
  postSource.isVisible = false;
  postSource.registerInstancedBuffer("color", 4);

  const laneSource = MeshBuilder.CreateBox("greybox-lane", { width: 0.28, height: 0.02, depth: 3 }, scene);
  laneSource.material = greyMaterial(scene, "greybox-lane-mat", 0.82, 0.1);
  laneSource.isVisible = false;

  let nextPostDistance = 0;
  let nextLaneDistance = 0;
  for (let index = 0; index < nodes.length; index += 1) {
    const node = nodes[index]!;
    const next = nodes[(index + 1) % nodes.length]!;
    const previous = nodes[(index - 1 + nodes.length) % nodes.length]!;
    const tx = next.x - previous.x;
    const tz = next.z - previous.z;
    const length = Math.hypot(tx, tz) || 1;
    const heading = Math.atan2(tx / length, tz / length);
    const nx = -tz / length;
    const nz = tx / length;
    const half = node.width * 0.5;

    // Curvature at this node, used to decide where kerbs belong.
    const previousHeading = Math.atan2(node.x - previous.x, node.z - previous.z);
    let curvature = heading - previousHeading;
    while (curvature > Math.PI) curvature -= Math.PI * 2;
    while (curvature < -Math.PI) curvature += Math.PI * 2;

    if (Math.abs(curvature) > 0.012 && index % 2 === 0) {
      // Inside of the corner gets the kerb.
      const side = curvature > 0 ? -1 : 1;
      const kerb = kerbSource.createInstance(`kerb-${index}`);
      kerb.position.set(node.x + nx * half * side, node.y + 0.07, node.z + nz * half * side);
      kerb.rotation.y = heading;
      const alternate = Math.floor(node.distance / 2.4) % 2 === 0;
      kerb.instancedBuffers.color = alternate
        ? new Color4(0.86, 0.86, 0.88, 1)
        : new Color4(0.42, 0.42, 0.46, 1);
      markers.push(kerbSource);
    }

    // Distance posts every 25 m on both sides. These are the reference that makes speed legible.
    if (node.distance >= nextPostDistance) {
      nextPostDistance = node.distance + 25;
      for (const side of [1, -1] as const) {
        const post = postSource.createInstance(`post-${index}-${side}`);
        post.position.set(node.x + nx * (half + 1.6) * side, node.y + 1.3, node.z + nz * (half + 1.6) * side);
        post.rotation.y = heading;
        // Every fourth post is bright, giving a 100 m rhythm to read against.
        const hundred = Math.round(node.distance / 25) % 4 === 0;
        post.instancedBuffers.color = hundred
          ? new Color4(0.95, 0.95, 0.98, 1)
          : new Color4(0.6, 0.6, 0.66, 1);
      }
    }

    if (node.distance >= nextLaneDistance) {
      nextLaneDistance = node.distance + 8;
      const lane = laneSource.createInstance(`lane-${index}`);
      lane.position.set(node.x, node.y + 0.03, node.z);
      lane.rotation.y = heading;
    }
  }

  // ------------------------------------------------------------------ start line
  const start = nodes[0]!;
  const startNext = nodes[4]!;
  const startHeading = Math.atan2(startNext.x - start.x, startNext.z - start.z);
  const line = MeshBuilder.CreateBox("greybox-startline", { width: start.width, height: 0.04, depth: 1.6 }, scene);
  line.position.set(start.x, start.y + 0.05, start.z);
  line.rotation.y = startHeading;
  line.material = greyMaterial(scene, "greybox-startline-mat", 0.95, 0.2);

  // ------------------------------------------------------------------ void floor
  // A large plane well below the circuit, so falling off reads as falling rather than as nothing.
  const span = Math.max(track.bounds.maxX - track.bounds.minX, track.bounds.maxZ - track.bounds.minZ) * 1.6;
  const floor = MeshBuilder.CreateGround("greybox-floor", { width: span, height: span, subdivisions: 1 }, scene);
  floor.position.set(
    (track.bounds.minX + track.bounds.maxX) / 2,
    track.bounds.minY - 6,
    (track.bounds.minZ + track.bounds.maxZ) / 2,
  );
  floor.material = greyMaterial(scene, "greybox-floor-mat", 0.16);

  return {
    road,
    walls,
    markers,
    dispose: () => {
      road.dispose();
      walls.forEach((wall) => wall.dispose());
      kerbSource.dispose();
      postSource.dispose();
      laneSource.dispose();
      line.dispose();
      floor.dispose();
    },
  };
}

/** A grey stand-in kart: correct dimensions, visible wheels and suspension, no styling. */
export function buildGreyKart(scene: Scene, name: string, tint: Color3): {
  root: Mesh;
  wheels: Mesh[];
  body: Mesh;
} {
  const root = new Mesh(name, scene);

  const bodyMaterial = new StandardMaterial(`${name}-body-mat`, scene);
  bodyMaterial.diffuseColor = tint;
  bodyMaterial.specularColor = new Color3(0.1, 0.1, 0.12);

  // Chassis with a chamfered top so the light has an edge to break on even in the grey box.
  const body = MeshBuilder.CreateBox(`${name}-body`, { width: 1.9, height: 0.55, depth: 2.9 }, scene);
  body.position.y = 0.62;
  body.material = bodyMaterial;
  body.parent = root;

  const nose = MeshBuilder.CreateCylinder(
    `${name}-nose`,
    { height: 1.7, diameterTop: 1.2, diameterBottom: 1.85, tessellation: 6 },
    scene,
  );
  nose.rotation.x = Math.PI / 2;
  nose.position.set(0, 0.72, 1.5);
  nose.material = bodyMaterial;
  nose.parent = root;

  const seat = MeshBuilder.CreateBox(`${name}-seat`, { width: 1, height: 0.9, depth: 0.3 }, scene);
  seat.position.set(0, 1.25, -0.75);
  seat.rotation.x = -0.16;
  seat.material = bodyMaterial;
  seat.parent = root;

  // A tall marker so the kart's heading is unmistakable while judging slip angle.
  const fin = MeshBuilder.CreateBox(`${name}-fin`, { width: 0.12, height: 1.5, depth: 0.9 }, scene);
  fin.position.set(0, 1.7, -1.2);
  const finMaterial = new StandardMaterial(`${name}-fin-mat`, scene);
  finMaterial.diffuseColor = tint.scale(0.4);
  finMaterial.emissiveColor = tint.scale(0.5);
  fin.material = finMaterial;
  fin.parent = root;

  const wheelMaterial = new StandardMaterial(`${name}-wheel-mat`, scene);
  wheelMaterial.diffuseColor = new Color3(0.09, 0.09, 0.1);
  wheelMaterial.specularColor = new Color3(0.05, 0.05, 0.05);

  const wheels: Mesh[] = [];
  for (const side of [-1, 1] as const) {
    for (const front of [-1, 1] as const) {
      const wheel = MeshBuilder.CreateCylinder(
        `${name}-wheel-${side}-${front}`,
        { diameter: front > 0 ? 0.74 : 0.86, height: front > 0 ? 0.4 : 0.52, tessellation: 24 },
        scene,
      );
      wheel.rotation.z = Math.PI / 2;
      wheel.position.set(side * 1.02, front > 0 ? 0.37 : 0.43, front * 1.05);
      wheel.material = wheelMaterial;
      wheel.parent = root;
      wheel.metadata = { wheel: true, front: front > 0, side };
      wheels.push(wheel);
    }
  }

  return { root, wheels, body };
}
