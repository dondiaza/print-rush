import {
  Color3,
  Mesh,
  PBRMaterial,
  Scene,
  TransformNode,
  Vector2,
  Vector3,
} from "@babylonjs/core";
import type { KartDefinition, RuntimeQuality } from "@print-rush/3d-factory";
import {
  beveledBox,
  ellipsoid,
  lofted,
  mergeParts,
  revolve,
  tube,
  type Station,
} from "./Geometry";

/**
 * KART BUILDER V5.
 *
 * V4's kart was seven boxes and four twelve-sided cylinders — a chassis box, a nose box, a bumper
 * box, a seat box, a spoiler box, a number plane, and wheels that were untextured cylinders with a
 * flat disc for a rim. At the camera distance the game actually uses, that is the most visible
 * object on screen and the clearest signal that the project was a prototype.
 *
 * This builds the parts the art bible lists: a tapering lofted monocoque, side pods, four fenders,
 * front and rear bumpers, a roll bar, a seat with a backrest, a steering wheel that turns, an engine
 * with a visible head, exhaust pipes, a spoiler with endplates, headlights, and wheels made of a
 * revolved tyre with a separate spoked rim.
 *
 * Parts are merged by material, so all of that detail costs six draw calls: one for the static body
 * (multi-material), four wheels and the steering wheel. The wheels and steering wheel stay separate
 * because they move.
 */

export type KartVisual = {
  root: TransformNode;
  /** Front-left, front-right, rear-left, rear-right. Rotated and steered by the runtime. */
  wheels: Mesh[];
  steeringWheel: Mesh | null;
  /** Suspension travel is applied to these, so a landing visibly compresses. */
  restHeights: number[];
};

type KartMaterials = {
  paint: PBRMaterial;
  accent: PBRMaterial;
  rubber: PBRMaterial;
  chrome: PBRMaterial;
  plastic: PBRMaterial;
  glass: PBRMaterial;
  seat: PBRMaterial;
};

/**
 * Materials are cached per scene and keyed by the colours that define them, so four karts sharing a
 * finish share their materials. The art bible caps the race scene at 40 unique materials and a
 * detailed kart could blow that budget on its own.
 */
const materialCache = new WeakMap<Scene, Map<string, KartMaterials>>();

function kartMaterials(scene: Scene, definition: KartDefinition): KartMaterials {
  let perScene = materialCache.get(scene);
  if (!perScene) {
    perScene = new Map();
    materialCache.set(scene, perScene);
  }
  const key = `${definition.primaryColor}|${definition.secondaryColor}|${definition.rimColor}|${definition.finish}`;
  const cached = perScene.get(key);
  if (cached) return cached;

  const paint = new PBRMaterial(`kart-paint-${key}`, scene);
  paint.albedoColor = Color3.FromHexString(definition.primaryColor);
  paint.metallic = definition.finish === "METALLIC" ? 0.7 : definition.finish === "PEARL" ? 0.35 : 0.05;
  paint.roughness = definition.finish === "MATTE" ? 0.82 : definition.finish === "GLOSS" ? 0.24 : 0.34;
  // Clearcoat is what makes painted bodywork read as painted rather than as coloured plastic. The
  // art bible keeps it controlled — this is a stylised kart, not a car-configurator render.
  if (definition.finish !== "MATTE") {
    paint.clearCoat.isEnabled = true;
    paint.clearCoat.intensity = 0.45;
    paint.clearCoat.roughness = 0.18;
  }

  const accent = new PBRMaterial(`kart-accent-${key}`, scene);
  accent.albedoColor = Color3.FromHexString(definition.secondaryColor);
  accent.metallic = paint.metallic;
  accent.roughness = paint.roughness;
  accent.clearCoat.isEnabled = paint.clearCoat.isEnabled;
  accent.clearCoat.intensity = 0.4;
  accent.clearCoat.roughness = 0.2;

  const rubber = new PBRMaterial(`kart-rubber-${key}`, scene);
  rubber.albedoColor = new Color3(0.045, 0.045, 0.052);
  rubber.metallic = 0;
  rubber.roughness = 0.95;

  const chrome = new PBRMaterial(`kart-chrome-${key}`, scene);
  chrome.albedoColor = Color3.FromHexString(definition.rimColor);
  chrome.metallic = 0.95;
  chrome.roughness = 0.26;

  const plastic = new PBRMaterial(`kart-plastic-${key}`, scene);
  plastic.albedoColor = new Color3(0.1, 0.1, 0.12);
  plastic.metallic = 0.05;
  plastic.roughness = 0.42;

  const glass = new PBRMaterial(`kart-glass-${key}`, scene);
  glass.albedoColor = new Color3(1, 0.94, 0.78);
  glass.emissiveColor = new Color3(0.55, 0.5, 0.38);
  glass.metallic = 0;
  glass.roughness = 0.1;

  const seat = new PBRMaterial(`kart-seat-${key}`, scene);
  seat.albedoColor = new Color3(0.07, 0.065, 0.085);
  seat.metallic = 0;
  seat.roughness = 0.68;

  const materials: KartMaterials = { paint, accent, rubber, chrome, plastic, glass, seat };
  perScene.set(key, materials);
  return materials;
}

/** Body silhouettes per chassis type, as loft stations from tail to nose. */
function chassisStations(body: KartDefinition["body"]): Station[] {
  const widen = body === "INK_TANK" ? 1.1 : body === "PACKAGE" ? 1.06 : body === "SPRINT" ? 0.92 : 1;
  const stretch = body === "SPRINT" ? 1.08 : body === "ROLLER" ? 0.95 : 1;
  const tall = body === "PACKAGE" || body === "INK_TANK" ? 1.18 : 1;

  const raw: Station[] = [
    { z: -1.42, halfWidth: 0.5, halfHeight: 0.15, y: 0.44 },
    { z: -1.15, halfWidth: 0.72, halfHeight: 0.21, y: 0.44 },
    { z: -0.7, halfWidth: 0.81, halfHeight: 0.26, y: 0.45 },
    { z: -0.15, halfWidth: 0.8, halfHeight: 0.25, y: 0.45 },
    { z: 0.4, halfWidth: 0.7, halfHeight: 0.22, y: 0.46 },
    { z: 0.85, halfWidth: 0.55, halfHeight: 0.19, y: 0.47 },
    { z: 1.2, halfWidth: 0.4, halfHeight: 0.15, y: 0.49 },
    { z: 1.42, halfWidth: 0.24, halfHeight: 0.11, y: 0.51 },
  ];
  return raw.map((station) => ({
    ...station,
    z: station.z * stretch,
    halfWidth: station.halfWidth * widen,
    halfHeight: station.halfHeight * tall,
    radius: station.halfHeight * 0.7,
  }));
}

/** A torus, built by revolving a circular profile offset from the axis. */
function torusProfile(majorRadius: number, minorRadius: number, steps: number): Vector2[] {
  const profile: Vector2[] = [];
  for (let step = 0; step <= steps; step += 1) {
    const angle = (step / steps) * Math.PI * 2;
    profile.push(new Vector2(majorRadius + Math.cos(angle) * minorRadius, Math.sin(angle) * minorRadius));
  }
  return profile;
}

/**
 * A wheel: a revolved tyre with rounded shoulders and a flat tread, plus a separate rim with
 * spokes. V4's wheel was a 12-sided cylinder with a disc stuck to it.
 */
function buildWheel(
  scene: Scene,
  name: string,
  definition: KartDefinition,
  materials: KartMaterials,
  front: boolean,
  segments: number,
): Mesh {
  const diameter =
    definition.wheel === "CHUNKY" || definition.wheel === "OFFROAD"
      ? front ? 0.76 : 0.9
      : definition.wheel === "ROLLER"
        ? front ? 0.6 : 0.68
        : front ? 0.72 : 0.84;
  const radius = diameter / 2;
  const width = definition.wheel === "SLICK" ? (front ? 0.34 : 0.5) : front ? 0.4 : 0.54;
  const rimRadius = radius * 0.58;
  const half = width / 2;

  // Tyre cross-section, from the inner bead out over the tread and back. The rounded shoulders are
  // the whole point: a cylinder has none, so it never catches a highlight along its edge.
  const tyre = revolve(
    scene,
    `${name}-tyre`,
    [
      new Vector2(rimRadius, -half),
      new Vector2(radius * 0.82, -half),
      new Vector2(radius * 0.97, -half * 0.82),
      new Vector2(radius, -half * 0.55),
      new Vector2(radius, half * 0.55),
      new Vector2(radius * 0.97, half * 0.82),
      new Vector2(radius * 0.82, half),
      new Vector2(rimRadius, half),
    ],
    segments,
    { capStart: false, capEnd: false },
  );
  tyre.material = materials.rubber;

  // Rim: a dished disc with a raised outer lip.
  const rim = revolve(
    scene,
    `${name}-rim`,
    [
      new Vector2(0.001, -half * 0.5),
      new Vector2(rimRadius * 0.45, -half * 0.52),
      new Vector2(rimRadius * 0.9, -half * 0.66),
      new Vector2(rimRadius, -half * 0.9),
      new Vector2(rimRadius, half * 0.9),
      new Vector2(rimRadius * 0.9, half * 0.66),
      new Vector2(rimRadius * 0.45, half * 0.52),
      new Vector2(0.001, half * 0.5),
    ],
    segments,
    { capStart: false, capEnd: false },
  );
  rim.material = materials.chrome;

  const parts: Mesh[] = [tyre, rim];

  // Spokes, laid out by rim style. Even at low quality the silhouette reads as a wheel with spokes
  // rather than a flat plate.
  const spokeCount = definition.rim === "DISC" ? 0 : definition.rim === "FIVE_SPOKE" ? 5 : definition.rim === "STAR" ? 6 : 8;
  for (let index = 0; index < spokeCount; index += 1) {
    const angle = (index / spokeCount) * Math.PI * 2;
    const spokeLength = rimRadius * 0.82;
    const spoke = beveledBox(scene, `${name}-spoke-${index}`, {
      width: rimRadius * 0.24,
      height: width * 0.34,
      depth: spokeLength,
      bevel: 0.012,
    });
    /**
     * The wheel is modelled around Y, so its disc lies in XZ and a spoke radiates in that plane.
     * `rotation.y` points the box's local +Z along the spoke direction, and it is then pushed out by
     * half its length — a spoke centred on the hub would reach through it and read as five bars
     * rather than five spokes.
     */
    spoke.rotation.y = angle;
    spoke.position.set(Math.sin(angle) * spokeLength * 0.52, 0, Math.cos(angle) * spokeLength * 0.52);
    spoke.material = materials.chrome;
    parts.push(spoke);
  }

  // Hub nut, so the centre of the wheel is not an empty hole.
  const hub = revolve(
    scene,
    `${name}-hub`,
    [
      new Vector2(0.001, -half * 0.62),
      new Vector2(rimRadius * 0.3, -half * 0.62),
      new Vector2(rimRadius * 0.3, half * 0.62),
      new Vector2(0.001, half * 0.62),
    ],
    Math.max(6, Math.round(segments / 3)),
  );
  // Chrome rather than a third material: the hub is 3 cm across at racing distance, and giving it
  // its own material cost a whole extra draw call on every wheel of every kart.
  hub.material = materials.chrome;
  parts.push(hub);

  const wheel = mergeParts(name, parts, true);
  // The wheel is modelled around Y and then laid onto the axle.
  wheel.rotation.z = Math.PI / 2;
  wheel.bakeCurrentTransformIntoVertices();
  return wheel;
}

export function buildKart(
  scene: Scene,
  definition: KartDefinition,
  name: string,
  quality: RuntimeQuality = "HIGH",
): KartVisual {
  const materials = kartMaterials(scene, definition);
  const detailed = quality === "HIGH" || quality === "ULTRA";
  const wheelSegments = quality === "LOW" ? 12 : quality === "MEDIUM" ? 18 : 28;
  const root = new TransformNode(name, scene);
  root.metadata = {
    factoryType: "KART",
    definitionId: definition.id,
    generatorVersion: definition.generatorVersion,
  };

  const painted: Mesh[] = [];
  const accented: Mesh[] = [];
  const metal: Mesh[] = [];
  const dark: Mesh[] = [];
  const lights: Mesh[] = [];

  // ------------------------------------------------------------------ monocoque
  const chassis = lofted(scene, `${name}-chassis`, chassisStations(definition.body), { cornerSegments: 4 });
  painted.push(chassis);

  // Floor pan, slightly wider than the body so the kart looks planted rather than balanced on air.
  const pan = beveledBox(scene, `${name}-pan`, {
    width: 1.68,
    height: 0.07,
    depth: 2.5,
    bevel: 0.025,
  });
  pan.position.y = 0.24;
  dark.push(pan);

  // ------------------------------------------------------------------ side pods
  for (const side of [-1, 1] as const) {
    const pod = lofted(
      scene,
      `${name}-pod-${side}`,
      [
        { z: -0.85, halfWidth: 0.1, halfHeight: 0.1, y: 0.42 },
        { z: -0.4, halfWidth: 0.19, halfHeight: 0.19, y: 0.42 },
        { z: 0.25, halfWidth: 0.2, halfHeight: 0.19, y: 0.42 },
        { z: 0.6, halfWidth: 0.09, halfHeight: 0.11, y: 0.44 },
      ],
      { cornerSegments: 3 },
    );
    pod.position.x = side * 0.82;
    accented.push(pod);
  }

  // ------------------------------------------------------------------ nose and bumpers
  const noseLength = definition.nose === "WEDGE" ? 0.5 : definition.nose === "TWIN" ? 0.34 : 0.4;
  const nose = lofted(
    scene,
    `${name}-nose`,
    [
      { z: 1.34, halfWidth: 0.28, halfHeight: 0.13, y: 0.5 },
      { z: 1.34 + noseLength * 0.5, halfWidth: 0.34, halfHeight: 0.11, y: 0.48 },
      { z: 1.34 + noseLength, halfWidth: 0.2, halfHeight: 0.07, y: 0.46 },
    ],
    { cornerSegments: 3 },
  );
  accented.push(nose);

  // Bumpers are swept tubes, which is what a real kart has and what makes the silhouette read.
  const frontBumper = tube(
    scene,
    `${name}-front-bumper`,
    [
      new Vector3(-0.86, 0.38, 1.42),
      new Vector3(-0.5, 0.36, 1.66),
      new Vector3(0.5, 0.36, 1.66),
      new Vector3(0.86, 0.38, 1.42),
    ],
    0.05,
    quality === "LOW" ? 6 : 8,
  );
  metal.push(frontBumper);

  const rearBumper = tube(
    scene,
    `${name}-rear-bumper`,
    [
      new Vector3(-0.8, 0.42, -1.4),
      new Vector3(-0.45, 0.42, -1.62),
      new Vector3(0.45, 0.42, -1.62),
      new Vector3(0.8, 0.42, -1.4),
    ],
    0.05,
    quality === "LOW" ? 6 : 8,
  );
  metal.push(rearBumper);

  // ------------------------------------------------------------------ fenders
  // A curved guard swept over each wheel. Without these the wheels look bolted onto a slab.
  const wheelbase = 1.05;
  const trackWidth = 0.98;
  for (const side of [-1, 1] as const) {
    for (const front of [1, -1] as const) {
      const radius = front > 0 ? 0.5 : 0.58;
      const path: Vector3[] = [];
      const steps = quality === "LOW" ? 4 : 7;
      for (let step = 0; step <= steps; step += 1) {
        const angle = Math.PI * (0.12 + (step / steps) * 0.76);
        path.push(
          new Vector3(
            side * trackWidth,
            0.4 + Math.sin(angle) * radius,
            front * wheelbase - Math.cos(angle) * radius,
          ),
        );
      }
      const fender = tube(scene, `${name}-fender-${side}-${front}`, path, 0.055, quality === "LOW" ? 5 : 7);
      accented.push(fender);
    }
  }

  // ------------------------------------------------------------------ suspension arms
  if (detailed) {
    for (const side of [-1, 1] as const) {
      for (const front of [1, -1] as const) {
        const arm = tube(
          scene,
          `${name}-arm-${side}-${front}`,
          [new Vector3(side * 0.3, 0.32, front * wheelbase * 0.86), new Vector3(side * trackWidth, 0.38, front * wheelbase)],
          0.035,
          6,
        );
        metal.push(arm);
      }
    }
  }

  // ------------------------------------------------------------------ seat
  const seatBase = lofted(
    scene,
    `${name}-seat-base`,
    [
      { z: -0.95, halfWidth: 0.34, halfHeight: 0.07, y: 0.66 },
      { z: -0.7, halfWidth: 0.38, halfHeight: 0.08, y: 0.64 },
      { z: -0.42, halfWidth: 0.36, halfHeight: 0.07, y: 0.64 },
    ],
    { cornerSegments: 3 },
  );
  dark.push(seatBase);

  const backrest = lofted(
    scene,
    `${name}-backrest`,
    [
      { z: -0.98, halfWidth: 0.36, halfHeight: 0.06, y: 0.74 },
      { z: -1.04, halfWidth: 0.38, halfHeight: 0.06, y: 1.02 },
      { z: -1.06, halfWidth: 0.33, halfHeight: 0.05, y: 1.26 },
    ],
    { cornerSegments: 3 },
  );
  dark.push(backrest);

  // ------------------------------------------------------------------ roll bar
  const rollBar = tube(
    scene,
    `${name}-roll-bar`,
    [
      new Vector3(-0.52, 0.72, -1.02),
      new Vector3(-0.44, 1.24, -1.1),
      new Vector3(0, 1.4, -1.12),
      new Vector3(0.44, 1.24, -1.1),
      new Vector3(0.52, 0.72, -1.02),
    ],
    0.045,
    quality === "LOW" ? 6 : 9,
  );
  metal.push(rollBar);

  // ------------------------------------------------------------------ engine and exhaust
  const engine = beveledBox(scene, `${name}-engine`, {
    width: 0.56,
    height: 0.44,
    depth: 0.5,
    bevel: 0.035,
  });
  engine.position.set(0.2, 0.68, -1.18);
  dark.push(engine);

  const head = revolve(
    scene,
    `${name}-engine-head`,
    [
      new Vector2(0.001, 0),
      new Vector2(0.14, 0.02),
      new Vector2(0.15, 0.16),
      new Vector2(0.1, 0.2),
      new Vector2(0.001, 0.21),
    ],
    quality === "LOW" ? 8 : 12,
  );
  head.position.set(0.2, 0.88, -1.18);
  metal.push(head);

  const exhaust = tube(
    scene,
    `${name}-exhaust`,
    [
      new Vector3(0.2, 0.76, -1.36),
      new Vector3(0.34, 0.84, -1.5),
      new Vector3(0.42, 0.96, -1.58),
    ],
    (t) => 0.05 + t * 0.03,
    quality === "LOW" ? 6 : 9,
  );
  metal.push(exhaust);

  // ------------------------------------------------------------------ spoiler
  if (definition.spoiler !== "NONE") {
    const wingWidth = definition.spoiler === "DOUBLE" ? 1.66 : definition.spoiler === "LOW" ? 1.2 : 1.48;
    const wingY = definition.spoiler === "LOW" ? 0.78 : 1.06;
    const wing = lofted(
      scene,
      `${name}-wing`,
      [
        { z: -1.34, halfWidth: wingWidth / 2, halfHeight: 0.035, y: wingY },
        { z: -1.46, halfWidth: wingWidth / 2, halfHeight: 0.045, y: wingY + 0.02 },
        { z: -1.58, halfWidth: wingWidth / 2, halfHeight: 0.025, y: wingY },
      ],
      { cornerSegments: 2 },
    );
    accented.push(wing);

    for (const side of [-1, 1] as const) {
      const endplate = beveledBox(scene, `${name}-endplate-${side}`, {
        width: 0.035,
        height: 0.2,
        depth: 0.34,
        bevel: 0.014,
      });
      endplate.position.set((side * wingWidth) / 2, wingY + 0.06, -1.46);
      accented.push(endplate);
    }

    if (definition.spoiler === "DOUBLE") {
      const upper = wing.clone(`${name}-wing-upper`);
      upper.position.y += 0.22;
      accented.push(upper);
    }

    for (const side of [-1, 1] as const) {
      const stay = tube(
        scene,
        `${name}-wing-stay-${side}`,
        [new Vector3(side * 0.4, 0.5, -1.3), new Vector3(side * 0.42, wingY, -1.44)],
        0.028,
        6,
      );
      metal.push(stay);
    }
  }

  // ------------------------------------------------------------------ headlights
  for (const side of [-1, 1] as const) {
    const lens = ellipsoid(
      scene,
      `${name}-headlight-${side}`,
      { x: 0.11, y: 0.08, z: 0.06 },
      quality === "LOW" ? 8 : 12,
      6,
    );
    lens.position.set(side * 0.3, 0.55, 1.48);
    lights.push(lens);
  }

  // ------------------------------------------------------------------ steering
  const column = tube(
    scene,
    `${name}-column`,
    [new Vector3(0, 0.6, -0.2), new Vector3(0, 0.88, 0.1)],
    0.032,
    6,
  );
  metal.push(column);

  const steeringWheel = revolve(
    scene,
    `${name}-steering-wheel`,
    torusProfile(0.17, 0.026, quality === "LOW" ? 5 : 8),
    quality === "LOW" ? 10 : 16,
    { capStart: false, capEnd: false },
  );
  steeringWheel.material = materials.plastic;
  // Modelled flat, then tilted back to the driver's hands.
  steeringWheel.rotation.x = Math.PI / 2 - 0.42;
  steeringWheel.position.set(0, 0.9, 0.12);
  steeringWheel.parent = root;
  steeringWheel.isPickable = false;

  // ------------------------------------------------------------------ number plate
  const plate = beveledBox(scene, `${name}-plate`, {
    width: 0.34,
    height: 0.26,
    depth: 0.03,
    bevel: 0.012,
  });
  plate.position.set(0, 0.62, 1.3);
  plate.rotation.x = -0.2;
  lights.push(plate);

  // ------------------------------------------------------------------ antenna
  if (definition.antenna !== "NONE") {
    const pole = tube(
      scene,
      `${name}-antenna`,
      [new Vector3(0.5, 0.7, -1.02), new Vector3(0.54, 1.5, -1.06)],
      0.014,
      5,
    );
    metal.push(pole);
    const topper = ellipsoid(
      scene,
      `${name}-antenna-top`,
      definition.antenna === "SHIRT"
        ? { x: 0.13, y: 0.1, z: 0.03 }
        : definition.antenna === "FLAG"
          ? { x: 0.12, y: 0.07, z: 0.02 }
          : { x: 0.07, y: 0.07, z: 0.07 },
      10,
      6,
    );
    topper.position.set(0.54, 1.56, -1.06);
    accented.push(topper);
  }

  // ------------------------------------------------------------------ merge by material
  const assign = (parts: Mesh[], material: PBRMaterial): Mesh | null => {
    if (parts.length === 0) return null;
    for (const part of parts) part.material = material;
    return mergeParts(`${name}-${material.name}`, parts, false);
  };

  const groups = [
    assign(painted, materials.paint),
    assign(accented, materials.accent),
    assign(metal, materials.chrome),
    assign(dark, materials.seat),
    assign(lights, materials.glass),
  ].filter((mesh): mesh is Mesh => mesh !== null);

  for (const group of groups) {
    group.parent = root;
    group.isPickable = false;
    group.receiveShadows = true;
  }

  // ------------------------------------------------------------------ wheels
  const wheels: Mesh[] = [];
  const restHeights: number[] = [];
  for (const front of [true, false]) {
    for (const side of [-1, 1] as const) {
      const wheel = buildWheel(
        scene,
        `${name}-wheel-${front ? "f" : "r"}-${side > 0 ? "r" : "l"}`,
        definition,
        materials,
        front,
        wheelSegments,
      );
      const restY = front ? 0.36 : 0.42;
      wheel.position.set(side * trackWidth, restY, front ? wheelbase : -wheelbase);
      wheel.parent = root;
      wheel.isPickable = false;
      wheel.receiveShadows = true;
      // The runtime reads this to spin, steer and compress the right wheels.
      wheel.metadata = { wheel: true, front, side, restY };
      wheels.push(wheel);
      restHeights.push(restY);
    }
  }

  return { root, wheels, steeringWheel, restHeights };
}

/**
 * Spins and steers the wheels, turns the steering wheel, and applies suspension travel.
 * V4 animated a wheel by adding to `rotation.x` on any child mesh tagged `wheel` and set a fixed
 * `rotation.y` on the front pair; nothing compressed, so a landing had no weight.
 */
export function animateKart(
  visual: KartVisual,
  spin: number,
  steer: number,
  suspension: number,
): void {
  for (const wheel of visual.wheels) {
    const meta = wheel.metadata as { front: boolean; restY: number } | undefined;
    if (!meta) continue;
    wheel.rotation.x = spin;
    // Only the front wheels steer, and less than the visual steering input so the geometry does not
    // look broken at full lock.
    wheel.rotation.y = meta.front ? steer * 0.46 : 0;
    // Rear suspension takes more of the load, which is what a rear-engined kart does.
    const travel = suspension * (meta.front ? 0.09 : 0.13);
    wheel.position.y = meta.restY - travel;
  }
  if (visual.steeringWheel) {
    // The rim turns further than the wheels: it is the clearest read on what the player is doing.
    visual.steeringWheel.rotation.y = -steer * 1.5;
  }
}
