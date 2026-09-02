import {
  Color3,
  Mesh,
  MeshBuilder,
  PBRMaterial,
  Scene,
  Texture,
  TransformNode,
  Vector2,
  Vector3,
} from "@babylonjs/core";
import type { CharacterDefinition, RuntimeQuality } from "@print-rush/3d-factory";
import { beveledBox, ellipsoid, lofted, mergeParts, revolve, tube } from "./Geometry";

/**
 * CHARACTER BUILDER V5.
 *
 * V4 built a rider from ten spheres, five capsules, five boxes and three tori. The head was a sphere
 * with a second sphere for a jaw, the eyes were spheres with no lids — which reads as marbles — the
 * hair was a scaled sphere, and nothing on the body moved. The `CharacterDefinition` schema was
 * excellent and the renderer threw most of it away.
 *
 * This models the character properly: a lofted torso with real shoulders, limbs as swept tubes with
 * joints, a head built from an ellipsoid with a brow, cheeks and a jaw, eyes with upper lids that
 * can blink, hair as overlapping volumes rather than a cap, and hands that reach the steering wheel.
 *
 * The five cheap animations the art bible calls out — blink, head turning into the corner, hands on
 * the wheel, lean under load, reaction to impact — are what separate a puppet from a character, so
 * the parts they need are kept as separate nodes and everything else is merged by material.
 */

export type CharacterVisual = {
  root: TransformNode;
  /** Turns to look into corners and reacts to impacts. */
  head: TransformNode;
  /** Upper eyelids, scaled down to blink. */
  eyelids: Mesh[];
  /** Shoulders pivot so the arms follow the steering wheel. */
  leftArm: TransformNode;
  rightArm: TransformNode;
  /** Torso leans under lateral load. */
  spine: TransformNode;
};

export type CharacterBuildOptions = {
  pose?: "STANDING" | "DRIVING" | "CELEBRATE";
  quality?: RuntimeQuality;
  /**
   * A styled face texture from the Character Studio, already loaded.
   *
   * Applied as a projected card in front of the skull rather than as the skull's own albedo, and
   * that is a considered choice rather than a shortcut. The skull is an ellipsoid with spherical
   * UVs; mapping a square portrait onto them would wrap the face around the head and stretch it at
   * the poles. Re-UVing the skull to a proper head layout would be the alternative, and it would
   * mean every generated head carrying a UV atlas it otherwise has no use for.
   *
   * The card works because the styling pipeline already outputs what it needs: an oval on
   * transparency, so the head's own silhouette and its hair show around the edges of the photo.
   */
  faceTexture?: Texture | null;
};

type Palette = {
  skin: PBRMaterial;
  hair: PBRMaterial;
  shirt: PBRMaterial;
  sleeve: PBRMaterial;
  pants: PBRMaterial;
  shoe: PBRMaterial;
  sole: PBRMaterial;
  eyeWhite: PBRMaterial;
  iris: PBRMaterial;
  dark: PBRMaterial;
  glass: PBRMaterial;
};

const paletteCache = new WeakMap<Scene, Map<string, Palette>>();

function palette(scene: Scene, definition: CharacterDefinition): Palette {
  let perScene = paletteCache.get(scene);
  if (!perScene) {
    perScene = new Map();
    paletteCache.set(scene, perScene);
  }
  const key = [
    definition.face.skinTone,
    definition.hair.color,
    definition.shirt.baseColor,
    definition.shirt.sleeveColor,
    definition.pants.color,
    definition.shoes.color,
    definition.shoes.soleColor,
    definition.face.eyes.irisColor,
  ].join("|");
  const cached = perScene.get(key);
  if (cached) return cached;

  const make = (name: string, hex: string, roughness: number, metallic = 0): PBRMaterial => {
    const material = new PBRMaterial(`char-${name}-${key}`, scene);
    material.albedoColor = Color3.FromHexString(hex);
    material.roughness = roughness;
    material.metallic = metallic;
    return material;
  };

  // Skin gets a touch of subsurface warmth rather than reading as painted plastic.
  const skin = make("skin", definition.face.skinTone, 0.62);
  skin.subSurface.isTranslucencyEnabled = true;
  skin.subSurface.translucencyIntensity = 0.12;
  skin.subSurface.tintColor = Color3.FromHexString("#ff9a86");

  // Clothing is FABRIC per the art bible: very rough, zero metallic. A shirt with a specular
  // highlight is the fastest way to make the whole game look cheap, given the subject matter.
  const shirt = make("shirt", definition.shirt.baseColor, 0.92);
  const sleeve = make("sleeve", definition.shirt.sleeveColor, 0.92);

  const glass = make("glass", definition.glasses.lensTint, 0.08);
  glass.alpha = 0.32;
  glass.transparencyMode = PBRMaterial.PBRMATERIAL_ALPHABLEND;

  const result: Palette = {
    skin,
    hair: make("hair", definition.hair.color, Math.max(0.5, definition.hair.roughness)),
    shirt,
    sleeve,
    pants: make("pants", definition.pants.color, 0.88),
    shoe: make("shoe", definition.shoes.color, 0.6),
    sole: make("sole", definition.shoes.soleColor, 0.9),
    eyeWhite: make("eye", "#fbf7f2", 0.28),
    iris: make("iris", definition.face.eyes.irisColor, 0.2),
    dark: make("dark", "#14121a", 0.7),
    glass,
  };
  perScene.set(key, result);
  return result;
}

/** A limb: a tube swept through a joint, tapering from shoulder to wrist. */
function limb(
  scene: Scene,
  name: string,
  from: Vector3,
  joint: Vector3,
  to: Vector3,
  thickness: number,
  segments: number,
): Mesh {
  const path: Vector3[] = [];
  // Quadratic through the joint, so the elbow or knee bends rather than kinking.
  const steps = 6;
  for (let step = 0; step <= steps; step += 1) {
    const t = step / steps;
    const inv = 1 - t;
    path.push(
      new Vector3(
        inv * inv * from.x + 2 * inv * t * joint.x + t * t * to.x,
        inv * inv * from.y + 2 * inv * t * joint.y + t * t * to.y,
        inv * inv * from.z + 2 * inv * t * joint.z + t * t * to.z,
      ),
    );
  }
  return tube(scene, name, path, (t) => thickness * (1 - t * 0.32), segments);
}

export function buildCharacter(
  scene: Scene,
  definition: CharacterDefinition,
  name: string,
  options: CharacterBuildOptions = {},
): CharacterVisual {
  const quality = options.quality ?? "HIGH";
  const pose = options.pose ?? "STANDING";
  const detailed = quality === "HIGH" || quality === "ULTRA";
  const segments = quality === "LOW" ? 7 : quality === "MEDIUM" ? 10 : 14;
  const colors = palette(scene, definition);

  const root = new TransformNode(name, scene);
  root.metadata = {
    factoryType: "CHARACTER",
    definitionId: definition.id,
    generatorVersion: definition.generatorVersion,
    animationBaseY: 0,
  };

  const body = definition.body;
  const face = definition.face;
  const exaggeration = definition.caricature === "SOFT" ? 0.94 : definition.caricature === "BOLD" ? 1.12 : 1;

  // Art bible proportion: 5.5 heads tall, not the 7.5 of realism. Cartoon but consistent.
  const totalHeight = 1.72 * body.height;
  const headHeight = (totalHeight / 5.5) * body.headScale * exaggeration;
  const legLength = totalHeight * 0.46 * body.legLength;
  const torsoHeight = totalHeight * 0.3 * body.torsoLength;
  const hipY = legLength;
  const shoulderHalf = 0.2 * body.shoulderWidth * body.volume;

  const skinParts: Mesh[] = [];
  const shirtParts: Mesh[] = [];
  const sleeveParts: Mesh[] = [];
  const pantsParts: Mesh[] = [];
  const shoeParts: Mesh[] = [];
  const soleParts: Mesh[] = [];
  const darkParts: Mesh[] = [];

  // ------------------------------------------------------------------ spine and torso
  const spine = new TransformNode(`${name}-spine`, scene);
  spine.position.y = hipY;
  spine.parent = root;

  /**
   * Real shoulders: widest at the chest, tapering to the waist and narrowing again at the neck.
   * `lofted` sweeps along Z, so the torso is built lying down — each station's Z is its height up
   * the body — and then stood upright and baked.
   */
  const torso = lofted(
    scene,
    `${name}-torso`,
    [0, 0.3, 0.72, 1].map((fraction, index) => ({
      z: fraction * torsoHeight - torsoHeight * 0.5,
      halfWidth: shoulderHalf * [0.78, 0.86, 1, 0.92][index]!,
      halfHeight: 0.1 * body.torsoWidth * [1, 1.1, 1.2, 1][index]!,
      radius: 0.055 * body.torsoWidth,
    })),
    { cornerSegments: quality === "LOW" ? 3 : 5 },
  );
  torso.rotation.x = -Math.PI / 2;
  torso.position.y = torsoHeight * 0.5;
  torso.bakeCurrentTransformIntoVertices();
  shirtParts.push(torso);

  const collar = revolve(
    scene,
    `${name}-collar`,
    [
      new Vector2(0.075 * body.torsoWidth, 0),
      new Vector2(0.095 * body.torsoWidth, 0.012),
      new Vector2(0.095 * body.torsoWidth, 0.042),
      new Vector2(0.075 * body.torsoWidth, 0.05),
    ],
    segments,
    { capStart: false, capEnd: false },
  );
  collar.position.y = torsoHeight - 0.01;
  darkParts.push(collar);

  // ------------------------------------------------------------------ neck and head
  const neck = revolve(
    scene,
    `${name}-neck`,
    [
      new Vector2(0.052, 0),
      new Vector2(0.048, 0.05),
      new Vector2(0.05, 0.09),
    ],
    Math.max(8, segments),
    { capStart: false, capEnd: false },
  );
  neck.position.y = torsoHeight - 0.015;
  skinParts.push(neck);

  const head = new TransformNode(`${name}-head`, scene);
  head.position.y = torsoHeight + 0.07 + headHeight * 0.42;
  head.parent = spine;

  const headSkin: Mesh[] = [];
  const headHair: Mesh[] = [];
  const headDark: Mesh[] = [];
  const headWhite: Mesh[] = [];
  const headIris: Mesh[] = [];
  const eyelids: Mesh[] = [];

  const skull = ellipsoid(
    scene,
    `${name}-skull`,
    {
      x: headHeight * 0.42 * face.width,
      y: headHeight * 0.5 * face.height,
      z: headHeight * 0.44,
    },
    segments,
    Math.max(6, Math.round(segments * 0.7)),
  );
  headSkin.push(skull);

  // A jaw that narrows toward the chin, rather than V4's second sphere.
  const jaw = lofted(
    scene,
    `${name}-jaw`,
    [
      { z: -headHeight * 0.3, halfWidth: headHeight * 0.3 * face.jawWidth, halfHeight: headHeight * 0.16, y: 0 },
      { z: 0, halfWidth: headHeight * 0.33 * face.jawWidth, halfHeight: headHeight * 0.17, y: 0 },
      { z: headHeight * 0.28, halfWidth: headHeight * (0.16 + face.chinSize * 0.1), halfHeight: headHeight * 0.14, y: 0 },
    ],
    { cornerSegments: 4 },
  );
  jaw.position.y = -headHeight * 0.2;
  jaw.scaling.y = 0.72 + face.jawRoundness * 0.28;
  headSkin.push(jaw);

  // Brow ridge. Without it a face has no structure above the eyes and reads as a ball.
  if (detailed) {
    const brow = lofted(
      scene,
      `${name}-brow`,
      [
        { z: -headHeight * 0.2, halfWidth: headHeight * 0.05, halfHeight: headHeight * 0.035, y: 0 },
        { z: 0, halfWidth: headHeight * 0.3, halfHeight: headHeight * 0.045, y: 0 },
        { z: headHeight * 0.2, halfWidth: headHeight * 0.05, halfHeight: headHeight * 0.035, y: 0 },
      ],
      { cornerSegments: 3 },
    );
    brow.rotation.y = Math.PI / 2;
    brow.position.set(0, headHeight * (0.1 + face.foreheadHeight * 0.06), headHeight * 0.33);
    headSkin.push(brow);

    // Cheeks, driven by the schema's cheekVolume which V4 only used to scale the whole head.
    for (const side of [-1, 1] as const) {
      const cheek = ellipsoid(
        scene,
        `${name}-cheek-${side}`,
        {
          x: headHeight * (0.09 + face.cheekVolume * 0.05),
          y: headHeight * 0.08,
          z: headHeight * 0.07,
        },
        10,
        6,
      );
      cheek.position.set(side * headHeight * 0.24, -headHeight * 0.06, headHeight * 0.27);
      headSkin.push(cheek);
    }
  }

  // Nose as a small wedge with a defined tip and bridge.
  const noseLength = headHeight * (0.12 + face.nose.length * 0.1);
  const nose = lofted(
    scene,
    `${name}-nose`,
    [
      { z: 0, halfWidth: headHeight * 0.035, halfHeight: headHeight * 0.03, y: 0 },
      { z: noseLength * 0.6, halfWidth: headHeight * (0.045 + face.nose.width * 0.03), halfHeight: headHeight * 0.045, y: -noseLength * 0.3 },
      { z: noseLength, halfWidth: headHeight * (0.05 + face.nose.width * 0.035), halfHeight: headHeight * 0.04, y: -noseLength * 0.55 },
    ],
    { cornerSegments: 3 },
  );
  nose.position.set(0, headHeight * 0.02, headHeight * 0.33);
  headSkin.push(nose);

  // ------------------------------------------------------------------ eyes with lids
  const eyeRadius = headHeight * 0.075 * face.eyes.size;
  const eyeGap = headHeight * 0.19 * face.eyes.spacing;
  const eyeY = headHeight * (0.04 + face.eyes.height * 0.03);
  const eyeZ = headHeight * 0.32;
  // Blinking is dropped at LOW: at the distance a LOW-tier driver is drawn it is invisible, and it
  // is the only reason the lids need to be a separate mesh at all.
  const blinks = quality !== "LOW";
  const lidParts: Mesh[] = [];

  for (const side of [-1, 1] as const) {
    const eyeball = ellipsoid(
      scene,
      `${name}-eye-${side}`,
      { x: eyeRadius, y: eyeRadius * (0.72 + face.eyes.roundness * 0.28), z: eyeRadius * 0.8 },
      Math.max(8, segments),
      6,
    );
    eyeball.position.set(side * eyeGap, eyeY, eyeZ);
    eyeball.rotation.z = side * face.eyes.angle;
    headWhite.push(eyeball);

    const iris = ellipsoid(
      scene,
      `${name}-iris-${side}`,
      { x: eyeRadius * 0.46, y: eyeRadius * 0.46, z: eyeRadius * 0.3 },
      10,
      6,
    );
    iris.position.set(side * eyeGap, eyeY, eyeZ + eyeRadius * 0.62);
    if (detailed || quality === "MEDIUM") headIris.push(iris);
    else headDark.push(iris);

    /**
     * The upper lid. This is the single detail that turns two marbles into a face, and it is what
     * makes a blink possible at all. Both lids are collected and merged into one mesh below: they
     * always blink together, so a second draw call buys nothing.
     */
    if (blinks) {
      const lid = ellipsoid(
        scene,
        `${name}-lid-${side}`,
        { x: eyeRadius * 1.12, y: eyeRadius * 0.62, z: eyeRadius * 0.95 },
        Math.max(8, segments),
        6,
      );
      lid.position.set(side * eyeGap, eyeY + eyeRadius * 0.52, eyeZ * 0.98);
      lid.rotation.z = side * face.eyes.angle;
      lidParts.push(lid);
    }

    // Eyebrow, following the schema's preset and angle.
    const eyebrow = beveledBox(scene, `${name}-eyebrow-${side}`, {
      width: eyeRadius * 2.1,
      height: headHeight * (0.012 + face.eyebrows.thickness * 0.016),
      depth: eyeRadius * 0.5,
      bevel: 0.004,
    });
    eyebrow.position.set(
      side * eyeGap,
      eyeY + eyeRadius * (1.25 + face.eyebrows.height * 0.3),
      eyeZ * 0.99,
    );
    eyebrow.rotation.z = side * (face.eyebrows.angle + (face.eyebrows.preset === "ARCHED" ? 0.14 : 0));
    headDark.push(eyebrow);
  }

  /**
   * A real level of detail, not just a lower segment count.
   *
   * At LOW the driver is a distant opponent on a phone, so the iris merges into the eye and the lids
   * are dropped entirely — which removes two draw calls per driver, eight across the grid. Measuring
   * this is what showed the first version cost the same 18 draw calls at every tier, which made the
   * tiers meaningless where they mattered most.
   */
  if (lidParts.length > 0) {
    const lid = mergeParts(`${name}-lids`, lidParts, false);
    lid.material = colors.skin;
    lid.parent = head;
    lid.isPickable = false;
    /**
     * Merging bakes each lid's transform into its vertices, so the mesh origin is the head origin
     * and its own `position` is zero. The blink therefore has to be a translation by a recorded
     * travel distance rather than a scale — scaling would grow the lids away from the eyes, and
     * reading a rest position off `position.y` would snap them to the head's centre.
     */
    lid.metadata = { travel: eyeRadius * 0.66 };
    eyelids.push(lid);
  }

  // Mouth, curved by the schema's `curve` so a personality reads at a glance.
  const mouth = beveledBox(scene, `${name}-mouth`, {
    width: headHeight * face.mouth.width * 0.7,
    height: headHeight * (0.014 + face.mouth.lipThickness * 0.02),
    depth: headHeight * 0.04,
    bevel: 0.004,
  });
  mouth.position.set(0, -headHeight * (0.18 + face.mouth.height * 0.06), headHeight * 0.3);
  mouth.rotation.x = -face.mouth.curve * 0.5;
  headDark.push(mouth);

  // ------------------------------------------------------------------ ears
  for (const side of [-1, 1] as const) {
    const ear = ellipsoid(
      scene,
      `${name}-ear-${side}`,
      { x: headHeight * 0.035, y: headHeight * (0.06 + face.ears.size * 0.03), z: headHeight * 0.05 },
      8,
      6,
    );
    ear.position.set(side * headHeight * 0.42 * face.width, eyeY - headHeight * 0.02, 0);
    headSkin.push(ear);
  }

  // ------------------------------------------------------------------ hair as volume
  if (definition.hair.style !== "BALD") {
    const volume = definition.hair.volume;
    const shortStyles = ["BUZZ", "MESSY_SHORT", "SHORT"];
    const isShort = shortStyles.some((style) => definition.hair.style.includes(style));

    // A skull cap sized just above the head, then overlapping locks. V4 used one scaled sphere,
    // which reads as a swimming cap regardless of the chosen style.
    const cap = ellipsoid(
      scene,
      `${name}-hair-cap`,
      {
        x: headHeight * 0.45 * face.width * definition.hair.scale,
        y: headHeight * 0.5 * face.height * definition.hair.scale,
        z: headHeight * 0.47 * definition.hair.scale,
      },
      segments,
      Math.max(6, Math.round(segments * 0.7)),
    );
    cap.position.y = headHeight * 0.06;
    // Cut away the lower half so the cap is hair, not a helmet over the face.
    cap.scaling.y = 0.92;
    headHair.push(cap);

    const lockCount = quality === "LOW" ? 3 : isShort ? 5 : 8;
    for (let index = 0; index < lockCount; index += 1) {
      const angle = (index / lockCount) * Math.PI * 2;
      const lock = ellipsoid(
        scene,
        `${name}-hair-lock-${index}`,
        {
          x: headHeight * 0.14 * volume,
          y: headHeight * (isShort ? 0.14 : 0.3) * volume,
          z: headHeight * 0.14 * volume,
        },
        8,
        6,
      );
      lock.position.set(
        Math.sin(angle) * headHeight * 0.36 * face.width,
        headHeight * (isShort ? 0.16 : -0.02),
        Math.cos(angle) * headHeight * 0.36,
      );
      headHair.push(lock);
    }
  }

  if (definition.facialHair.style !== "NONE") {
    const beard = lofted(
      scene,
      `${name}-beard`,
      [
        { z: -headHeight * 0.26, halfWidth: headHeight * 0.26, halfHeight: headHeight * 0.1, y: 0 },
        { z: 0, halfWidth: headHeight * 0.3, halfHeight: headHeight * 0.12, y: 0 },
        { z: headHeight * 0.26, halfWidth: headHeight * 0.18, halfHeight: headHeight * 0.1, y: 0 },
      ],
      { cornerSegments: 3 },
    );
    beard.position.y = -headHeight * 0.26;
    beard.scaling.y = 0.7;
    headHair.push(beard);
  }

  if (definition.glasses.style !== "NONE") {
    const lenses: Mesh[] = [];
    for (const side of [-1, 1] as const) {
      const lens = ellipsoid(
        scene,
        `${name}-lens-${side}`,
        {
          x: eyeRadius * 1.4 * definition.glasses.size,
          y: eyeRadius * 1.2 * definition.glasses.size,
          z: eyeRadius * 0.2,
        },
        10,
        6,
      );
      lens.position.set(side * eyeGap, eyeY, eyeZ + eyeRadius * 0.9);
      lens.material = colors.glass;
      lenses.push(lens);
    }
    // One transparent mesh rather than two: a second alpha-blended draw is the most expensive kind.
    const mergedLenses = mergeParts(`${name}-lenses`, lenses, false);
    mergedLenses.material = colors.glass;
    mergedLenses.parent = head;
    mergedLenses.isPickable = false;
    const bridge = tube(
      scene,
      `${name}-glasses-bridge`,
      [
        new Vector3(-eyeGap, eyeY, eyeZ + eyeRadius * 0.9),
        new Vector3(0, eyeY + eyeRadius * 0.1, eyeZ + eyeRadius * 0.95),
        new Vector3(eyeGap, eyeY, eyeZ + eyeRadius * 0.9),
      ],
      eyeRadius * 0.09,
      6,
    );
    headDark.push(bridge);
  }

  // ------------------------------------------------------------------ arms
  // In the driving pose the hands reach forward and inward to where the kart's steering wheel is.
  const armReach = pose === "DRIVING"
    ? { x: 0.16, y: 0.14, z: 0.34 }
    : pose === "CELEBRATE"
      ? { x: 0.34, y: 0.46, z: -0.05 }
      : { x: 0.24, y: -0.28, z: 0.02 };

  const arms: Record<"left" | "right", TransformNode> = {
    left: new TransformNode(`${name}-arm-left`, scene),
    right: new TransformNode(`${name}-arm-right`, scene),
  };

  for (const [key, side] of [["left", -1], ["right", 1]] as const) {
    const pivot = arms[key];
    pivot.position.set(side * shoulderHalf, torsoHeight * 0.9, 0);
    pivot.parent = spine;

    const shoulder = new Vector3(0, 0, 0);
    const elbow = new Vector3(side * armReach.x * 0.7, -0.16 * body.armLength, armReach.z * 0.45);
    const wrist = new Vector3(side * armReach.x, armReach.y - 0.2 * body.armLength, armReach.z);

    const arm = limb(scene, `${name}-arm-${key}-mesh`, shoulder, elbow, wrist, 0.045 * body.volume, Math.max(6, segments - 4));
    arm.material = colors.sleeve;
    arm.parent = pivot;
    arm.isPickable = false;
    arm.receiveShadows = true;

    // A hand that grips: a flattened palm plus a thumb, rather than a sphere. Both are skin on the
    // same rotating pivot, so they merge into one mesh — two draw calls per driver saved.
    const handParts: Mesh[] = [];
    const hand = ellipsoid(
      scene,
      `${name}-hand-${key}`,
      { x: 0.042 * body.handScale, y: 0.055 * body.handScale, z: 0.03 * body.handScale },
      8,
      6,
    );
    hand.position.copyFrom(wrist);
    hand.rotation.x = pose === "DRIVING" ? -0.6 : 0;
    handParts.push(hand);

    if (detailed) {
      const thumb = ellipsoid(
        scene,
        `${name}-thumb-${key}`,
        { x: 0.014, y: 0.026, z: 0.014 },
        6,
        4,
      );
      thumb.position.set(wrist.x - side * 0.032, wrist.y + 0.012, wrist.z + 0.012);
      handParts.push(thumb);
    }

    for (const part of handParts) part.material = colors.skin;
    const mergedHand = mergeParts(`${name}-hand-group-${key}`, handParts, false);
    mergedHand.material = colors.skin;
    mergedHand.parent = pivot;
    mergedHand.isPickable = false;
  }

  // ------------------------------------------------------------------ legs
  const legSpread = 0.075 * body.volume;
  const kneeForward = pose === "DRIVING" ? 0.3 : 0.02;
  const ankleForward = pose === "DRIVING" ? 0.42 : 0;
  const ankleY = pose === "DRIVING" ? -legLength * 0.55 : -legLength;

  for (const side of [-1, 1] as const) {
    const hip = new Vector3(side * legSpread, 0, 0);
    const knee = new Vector3(side * legSpread * 1.05, -legLength * 0.5, kneeForward);
    const ankle = new Vector3(side * legSpread, ankleY, ankleForward);
    const leg = limb(scene, `${name}-leg-${side}`, hip, knee, ankle, 0.058 * body.volume, Math.max(6, segments - 4));
    leg.position.y = 0;
    pantsParts.push(leg);

    // A shoe with a sole and a toe box, not a cube.
    const shoe = lofted(
      scene,
      `${name}-shoe-${side}`,
      [
        { z: -0.05, halfWidth: 0.045 * body.footScale, halfHeight: 0.035, y: 0 },
        { z: 0.05, halfWidth: 0.05 * body.footScale, halfHeight: 0.04, y: 0 },
        { z: 0.13, halfWidth: 0.045 * body.footScale, halfHeight: 0.032, y: -0.004 },
      ],
      { cornerSegments: 3 },
    );
    shoe.position.set(ankle.x, ankle.y - 0.03, ankle.z + 0.04);
    shoe.rotation.x = pose === "DRIVING" ? 0.35 : 0;
    shoeParts.push(shoe);

    const sole = beveledBox(scene, `${name}-sole-${side}`, {
      width: 0.1 * body.footScale,
      height: 0.018,
      depth: 0.2,
      bevel: 0.006,
    });
    sole.position.set(ankle.x, ankle.y - 0.062, ankle.z + 0.04);
    sole.rotation.x = pose === "DRIVING" ? 0.35 : 0;
    soleParts.push(sole);
  }

  // ------------------------------------------------------------------ merge by material
  const attach = (parts: Mesh[], material: PBRMaterial, parent: TransformNode, label: string): void => {
    if (parts.length === 0) return;
    for (const part of parts) part.material = material;
    const merged = mergeParts(`${name}-${label}`, parts, false);
    merged.parent = parent;
    merged.isPickable = false;
    merged.receiveShadows = true;
  };

  attach(skinParts, colors.skin, spine, "skin");
  attach(shirtParts, colors.shirt, spine, "shirt");
  attach(sleeveParts, colors.sleeve, spine, "sleeve");
  attach(pantsParts, colors.pants, spine, "pants");
  attach(shoeParts, colors.shoe, spine, "shoe");
  attach(soleParts, colors.sole, spine, "sole");
  attach(darkParts, colors.dark, spine, "dark");

  attach(headSkin, colors.skin, head, "head-skin");

  /**
   * The face card.
   *
   * Sized and placed from the skull's own dimensions rather than from constants, so it tracks a
   * character's face width, height and head scale instead of drifting off a resized head. It sits a
   * hair in front of the skull's forward extent and is slightly smaller than the skull's silhouette,
   * so the photograph reads as the face rather than as a mask laid over the whole head.
   *
   * Unverified on screen: nobody in this environment can look at it. The geometry is derived rather
   * than guessed, but the placement is the part a browser would settle in ten seconds.
   */
  if (options.faceTexture) {
    const skullX = headHeight * 0.42 * face.width;
    const skullY = headHeight * 0.5 * face.height;
    const skullZ = headHeight * 0.44;
    const card = MeshBuilder.CreatePlane(
      `${name}-face-card`,
      { width: skullX * 1.72, height: skullY * 1.62, sideOrientation: Mesh.FRONTSIDE },
      scene,
    );
    card.parent = head;
    // Forward of the skull surface, and a touch above centre because a face sits above the jaw.
    card.position.set(0, skullY * 0.08, skullZ * 0.93);
    card.isPickable = false;

    const faceMaterial = new PBRMaterial(`${name}-face-material`, scene);
    options.faceTexture.hasAlpha = true;
    faceMaterial.albedoTexture = options.faceTexture;
    faceMaterial.useAlphaFromAlbedoTexture = true;
    faceMaterial.transparencyMode = PBRMaterial.PBRMATERIAL_ALPHABLEND;
    // Skin values, so the photograph is lit like the rest of the head rather than glowing.
    faceMaterial.roughness = 0.62;
    faceMaterial.metallic = 0;
    faceMaterial.albedoColor = Color3.White();
    // Never writes depth: the card overlaps the skull, and writing depth would let it cut a hole in
    // the head from some angles.
    faceMaterial.disableDepthWrite = true;
    faceMaterial.zOffset = -3;
    faceMaterial.backFaceCulling = true;
    card.material = faceMaterial;
  }
  attach(headHair, colors.hair, head, "head-hair");
  attach(headWhite, colors.eyeWhite, head, "head-eyes");
  attach(headIris, colors.iris, head, "head-iris");
  attach(headDark, colors.dark, head, "head-dark");

  return { root, head, eyelids, leftArm: arms.left, rightArm: arms.right, spine };
}

export type CharacterAnimationInput = {
  /** Steering input, -1..1. Turns the head into the corner and rotates the arms. */
  steer: number;
  /** Body roll from lateral load, radians. */
  lean: number;
  /** Seconds since the scene started, for the blink clock. */
  time: number;
  /** 0..1, raised briefly by an impact so the driver flinches. */
  flinch?: number;
};

/**
 * The five cheap animations that make the driver a character.
 * V4's driver did none of these — it was a static mesh parented to the kart.
 */
export function animateCharacter(visual: CharacterVisual, input: CharacterAnimationInput): void {
  const flinch = input.flinch ?? 0;

  // Head turns into the corner and looks slightly down under braking load.
  visual.head.rotation.y = input.steer * 0.42;
  visual.head.rotation.z = -input.steer * 0.14 + flinch * 0.2;
  visual.head.rotation.x = flinch * 0.3;

  // Torso leans with the slide.
  visual.spine.rotation.z = input.lean * 0.45;
  visual.spine.rotation.x = flinch * 0.16;

  // Arms follow the wheel: the inside arm pulls back, the outside pushes forward.
  visual.leftArm.rotation.x = input.steer * 0.34;
  visual.rightArm.rotation.x = -input.steer * 0.34;

  /**
   * Blink. A pseudo-random cadence rather than a fixed interval, so two drivers on screen never
   * blink in unison — which is far more noticeable than not blinking at all.
   */
  const cycle = 3.1 + Math.sin(input.time * 0.37) * 1.4;
  const phase = (input.time % cycle) / cycle;
  const closed = phase > 0.965;
  for (const lid of visual.eyelids) {
    const meta = lid.metadata as { travel: number } | undefined;
    if (!meta) continue;
    // The lids slide down over the eyes and back up. See the note where `travel` is recorded.
    lid.position.y = closed ? -meta.travel : 0;
  }
}
