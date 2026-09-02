import { Mesh, Scene, Vector2, Vector3 } from "@babylonjs/core";
import { MaterialLibrary, type MaterialClass, type MaterialRequest } from "./MaterialLibrary";
import { beveledBox, ellipsoid, lofted, mergeParts, revolve, tube } from "./Geometry";

/**
 * PROP LIBRARY V5.
 *
 * V4's entire environment was 42 `MeshBuilder.CreateBox` calls with random dimensions arranged on an
 * ellipse outside the track. Even the landmarks — the objects the brief wants visible from the point
 * where the player commits to a corner — were a 7 x 13 x 7 box with a glowing band around it.
 *
 * Every prop here is modelled: a cardboard box has flaps, tape and a label; a garment rail has
 * hangers with shirts on them; a machine has a hopper, pipes and a control panel; a spectator has a
 * head, shoulders and arms. Each is built once as a source mesh and then instanced, so the density
 * the art bible demands costs one draw call per material rather than one per object.
 *
 * The art bible's three tiers apply: SMALL props stay under 300 triangles, MID assets under 2,500,
 * and the HERO landmark per sector is allowed up to 12,000.
 */

export type PropKind =
  | "BOX"
  | "SHELF"
  | "PALLET"
  | "MACHINE"
  | "SIGN"
  | "SCREEN"
  | "RAIL"
  | "PLANT"
  | "CROWD"
  | "CRATE_STACK"
  | "TROLLEY";

export type PropSpec = {
  materialClass: MaterialClass;
  color: string;
  kind: PropKind;
  weight: number;
  /**
   * Baked material dressing this prop's principal mass — the ink drum's ink, the display's printed
   * cloth, the racking's painted steel. Optional: without one the prop takes the theme's colour over
   * the class's baked relief, which is how a hundred boxes in six colours stay six materials.
   *
   * It may only name an asset in the shared set or in this circuit's own, because another circuit's
   * assets are never downloaded. A test enforces that.
   */
  texture?: string;
};

/**
 * What the theme chose for a prop, as opposed to what the prop physically is.
 *
 * The distinction runs through every builder below and it is the whole reason `materialClass` on a
 * spec was dead configuration until now. A prop has two kinds of surface:
 *
 *  - its **principal mass**, which is what the theme is actually specifying when it writes
 *    `{ materialClass: "INK", kind: "BOX" }` — that is an ink drum, and class, colour and print all
 *    come from the spec;
 *  - its **trim**, whose material is fixed by what the part is. The shirts hanging on a clothing
 *    rail are cloth whatever the rail is made of, and a box's flaps are cardboard even when the
 *    theme calls the box paper. Trim takes the theme's colour and nothing else.
 *
 * Getting this backwards is how you end up with wooden shirts.
 */
export type PropSkin = Pick<PropSpec, "materialClass" | "color"> & { texture?: string };

/** The prop's principal mass: class, colour and baked print all come from the theme. */
function principal(skin: PropSkin, extra: { seed?: number; tile?: number } = {}): MaterialRequest {
  const request: MaterialRequest = { materialClass: skin.materialClass, color: skin.color };
  if (skin.texture !== undefined) request.texture = skin.texture;
  if (extra.seed !== undefined) request.seed = extra.seed;
  if (extra.tile !== undefined) request.tile = extra.tile;
  return request;
}

/** Trim: the part decides its own material, the theme only decides its colour. */
function trim(
  materialClass: MaterialClass,
  skin: PropSkin,
  extra: { seed?: number; tile?: number } = {},
): MaterialRequest {
  const request: MaterialRequest = { materialClass, color: skin.color };
  if (extra.seed !== undefined) request.seed = extra.seed;
  if (extra.tile !== undefined) request.tile = extra.tile;
  return request;
}

/** Stable key for a source mesh. Two specs of one kind with different prints need two sources. */
export function propSourceKey(kind: PropKind, texture?: string): string {
  return `${kind}|${texture ?? ""}`;
}

/**
 * The distinct source meshes a set of specs needs, in the order they should be built.
 *
 * Pulled out as a pure function so it can be tested without a GPU, which matters more than it
 * sounds: when the source map went from being keyed by kind to being keyed by kind-and-print, every
 * `get(spec.kind)` still compiled — `PropKind` is a string — and returned `undefined`, which would
 * have shipped a circuit with no trackside props at all and no error anywhere. The scatter and the
 * builder now derive their keys from this one function.
 */
export function propSourceSpecs(specs: readonly PropSpec[]): Array<[string, PropSpec]> {
  const seen = new Map<string, PropSpec>();
  for (const spec of specs) {
    const key = propSourceKey(spec.kind, spec.texture);
    if (!seen.has(key)) seen.set(key, spec);
  }
  return [...seen];
}

type BuildContext = {
  scene: Scene;
  materials: MaterialLibrary;
  /** Detail level: fewer segments and dropped micro-detail on weaker devices. */
  detailed: boolean;
  segments: number;
};

/**
 * A cardboard box with the four things that stop cardboard reading as a painted cube: creased
 * flaps, a tape strip down the seam, a shipping label, and a lid that does not sit perfectly flush.
 */
function buildBox(context: BuildContext, skin: PropSkin): Mesh {
  const { scene, materials, detailed } = context;
  const parts: Mesh[] = [];

  const body = beveledBox(scene, "prop-box-body", {
    width: 1.1,
    height: 0.95,
    depth: 1.05,
    bevel: 0.028,
    uScale: 1.1,
    vScale: 1,
  });
  body.material = materials.get(principal(skin));
  parts.push(body);

  if (detailed) {
    // Two flaps meeting at the top seam, each tilted a little so the lid is not machine-flat.
    for (const side of [-1, 1] as const) {
      const flap = beveledBox(scene, `prop-box-flap-${side}`, {
        width: 1.06,
        height: 0.035,
        depth: 0.5,
        bevel: 0.012,
      });
      flap.position.set(0, 0.49, side * 0.27);
      flap.rotation.x = side * 0.045;
      flap.material = materials.get(principal(skin, { seed: 1 }));
      parts.push(flap);
    }

    // Tape along the seam.
    const tape = beveledBox(scene, "prop-box-tape", {
      width: 0.16,
      height: 0.012,
      depth: 1.08,
      bevel: 0.004,
    });
    tape.position.y = 0.505;
    tape.material = materials.get({ materialClass: "PLASTIC", color: "#d8d2c4" });
    parts.push(tape);

    // Shipping label, slightly off-square because nobody applies them straight.
    const label = beveledBox(scene, "prop-box-label", {
      width: 0.4,
      height: 0.28,
      depth: 0.012,
      bevel: 0.004,
    });
    label.position.set(0.12, 0.08, 0.53);
    label.rotation.z = 0.04;
    label.material = materials.get({ materialClass: "PAPER", color: "#f7f2e8" });
    parts.push(label);
  }

  return mergeParts("prop-box", parts, true);
}

/**
 * A shelving unit: tubular uprights, cross braces, four decks, stock on the decks and a label strip
 * on the front edge. This is the object that makes a warehouse read as a warehouse.
 */
function buildShelf(context: BuildContext, skin: PropSkin): Mesh {
  const { scene, materials, detailed } = context;
  const parts: Mesh[] = [];
  const frame = materials.get(principal(skin));
  const deckMaterial = materials.get({ materialClass: "RAW_METAL", color: "#8f979f" });

  for (const side of [-1, 1] as const) {
    for (const depth of [-1, 1] as const) {
      const upright = tube(
        scene,
        `shelf-upright-${side}-${depth}`,
        [new Vector3(side * 1.15, 0, depth * 0.52), new Vector3(side * 1.15, 4.2, depth * 0.52)],
        0.055,
        context.detailed ? 8 : 5,
      );
      upright.material = frame;
      parts.push(upright);
    }
    if (detailed) {
      // Diagonal brace on each end, which is what makes racking look structural.
      const brace = tube(
        scene,
        `shelf-brace-${side}`,
        [new Vector3(side * 1.15, 0.4, -0.52), new Vector3(side * 1.15, 3.9, 0.52)],
        0.028,
        5,
      );
      brace.material = frame;
      parts.push(brace);
    }
  }

  for (let level = 0; level < 4; level += 1) {
    const y = 0.55 + level * 1.12;
    const deck = beveledBox(scene, `shelf-deck-${level}`, {
      width: 2.42,
      height: 0.06,
      depth: 1.1,
      bevel: 0.018,
    });
    deck.position.y = y;
    deck.material = deckMaterial;
    parts.push(deck);

    // Stock: three cartons per deck at varying heights, so the unit is never an empty frame.
    for (let slot = -1; slot <= 1; slot += 1) {
      const height = 0.5 + ((slot + level) % 3) * 0.13;
      const carton = beveledBox(scene, `shelf-stock-${level}-${slot}`, {
        width: 0.64,
        height,
        depth: 0.82,
        bevel: 0.022,
      });
      carton.position.set(slot * 0.76, y + height / 2 + 0.03, 0);
      carton.rotation.y = ((slot * 7 + level * 3) % 5) * 0.02;
      carton.material = materials.get({
        materialClass: "CARDBOARD",
        color: "#b98a57",
        seed: (level + slot + 2) % 3,
      });
      parts.push(carton);
    }

    if (detailed) {
      const strip = beveledBox(scene, `shelf-label-${level}`, {
        width: 2.3,
        height: 0.07,
        depth: 0.014,
        bevel: 0.004,
      });
      strip.position.set(0, y - 0.06, 0.56);
      strip.material = materials.get({ materialClass: "PAPER", color: "#f7f2e8" });
      parts.push(strip);
    }
  }

  return mergeParts("prop-shelf", parts, true);
}

/** A pallet: chamfered planks on bearers, with the gaps a real pallet has. */
function buildPallet(context: BuildContext, skin: PropSkin): Mesh {
  const { scene, materials } = context;
  const parts: Mesh[] = [];
  const material = materials.get(principal(skin));

  for (let plank = -2; plank <= 2; plank += 1) {
    const top = beveledBox(scene, `pallet-plank-${plank}`, {
      width: 1.2,
      height: 0.07,
      depth: 0.19,
      bevel: 0.012,
    });
    top.position.set(0, 0.17, plank * 0.28);
    top.material = material;
    parts.push(top);
  }
  for (const side of [-1, 0, 1]) {
    const bearer = beveledBox(scene, `pallet-bearer-${side}`, {
      width: 0.15,
      height: 0.13,
      depth: 1.2,
      bevel: 0.012,
    });
    bearer.position.set(side * 0.5, 0.07, 0);
    bearer.material = material;
    parts.push(bearer);
  }
  return mergeParts("prop-pallet", parts, true);
}

/** An industrial machine: lofted body, revolved hopper, pipework, and a lit control panel. */
function buildMachine(context: BuildContext, skin: PropSkin): Mesh {
  const { scene, materials, detailed, segments } = context;
  const parts: Mesh[] = [];
  const shell = materials.get(principal(skin));
  const steel = materials.get({ materialClass: "RAW_METAL", color: "#9fa6ad" });

  const body = lofted(
    scene,
    "machine-body",
    [
      { z: -0.9, halfWidth: 1.2, halfHeight: 1.1, y: 1.15, radius: 0.16 },
      { z: 0, halfWidth: 1.32, halfHeight: 1.22, y: 1.22, radius: 0.2 },
      { z: 0.9, halfWidth: 1.18, halfHeight: 1.05, y: 1.1, radius: 0.16 },
    ],
    { cornerSegments: 4 },
  );
  body.material = shell;
  parts.push(body);

  const hopper = revolve(
    scene,
    "machine-hopper",
    [
      new Vector2(0.78, 0),
      new Vector2(0.82, 0.14),
      new Vector2(0.5, 0.8),
      new Vector2(0.34, 1.0),
      new Vector2(0.3, 1.1),
    ],
    segments,
    { capStart: false, capEnd: false },
  );
  hopper.position.set(0.35, 2.34, 0);
  hopper.material = steel;
  parts.push(hopper);

  const pipe = tube(
    scene,
    "machine-pipe",
    [
      new Vector3(-0.9, 2.2, 0.4),
      new Vector3(-0.9, 3.1, 0.4),
      new Vector3(-0.3, 3.4, 0.4),
      new Vector3(0.3, 3.35, 0.1),
    ],
    0.14,
    detailed ? 9 : 6,
  );
  pipe.material = steel;
  parts.push(pipe);

  const panel = beveledBox(scene, "machine-panel", {
    width: 0.72,
    height: 0.86,
    depth: 0.22,
    bevel: 0.03,
  });
  panel.position.set(1.15, 1.6, 0.85);
  panel.rotation.y = -0.3;
  panel.material = shell;
  parts.push(panel);

  const readout = beveledBox(scene, "machine-readout", {
    width: 0.5,
    height: 0.34,
    depth: 0.03,
    bevel: 0.01,
  });
  readout.position.set(1.24, 1.72, 0.94);
  readout.rotation.y = -0.3;
  readout.material = materials.get({ materialClass: "SCREEN", color: "#65d8ff" });
  parts.push(readout);

  if (detailed) {
    // Feet, so the machine sits on the floor rather than floating at its own origin.
    for (const side of [-1, 1] as const) {
      for (const depth of [-1, 1] as const) {
        const foot = beveledBox(scene, `machine-foot-${side}-${depth}`, {
          width: 0.28,
          height: 0.12,
          depth: 0.28,
          bevel: 0.02,
        });
        foot.position.set(side * 0.95, 0.06, depth * 0.62);
        foot.material = steel;
        parts.push(foot);
      }
    }
  }

  return mergeParts("prop-machine", parts, true);
}

/** A hanging or post-mounted sign: panel, frame and bracket. */
function buildSign(context: BuildContext, skin: PropSkin): Mesh {
  const { scene, materials } = context;
  const parts: Mesh[] = [];

  const panel = beveledBox(scene, "sign-panel", {
    width: 2.6,
    height: 1.3,
    depth: 0.09,
    bevel: 0.02,
  });
  panel.material = materials.get(principal(skin));
  parts.push(panel);

  // A frame around the panel reads as a fabricated sign rather than a floating rectangle.
  for (const side of [-1, 1] as const) {
    const edge = beveledBox(scene, `sign-edge-${side}`, {
      width: 0.08,
      height: 1.4,
      depth: 0.13,
      bevel: 0.02,
    });
    edge.position.x = side * 1.32;
    edge.material = materials.get({ materialClass: "RAW_METAL", color: "#9fa6ad" });
    parts.push(edge);
  }

  const bracket = tube(
    scene,
    "sign-bracket",
    [new Vector3(-0.9, 0.7, 0), new Vector3(-0.9, 1.5, 0), new Vector3(0.9, 1.5, 0), new Vector3(0.9, 0.7, 0)],
    0.045,
    6,
  );
  bracket.material = materials.get({ materialClass: "RAW_METAL", color: "#9fa6ad" });
  parts.push(bracket);

  return mergeParts("prop-sign", parts, true);
}

/** A wall screen: bezel, inset emissive panel and a mount arm. */
function buildScreen(context: BuildContext, skin: PropSkin): Mesh {
  const { scene, materials } = context;
  const parts: Mesh[] = [];

  const bezel = beveledBox(scene, "screen-bezel", {
    width: 3.3,
    height: 2,
    depth: 0.2,
    bevel: 0.03,
  });
  bezel.material = materials.get({ materialClass: "PLASTIC", color: "#16151c" });
  parts.push(bezel);

  // The lit surface is inset behind the bezel, which is what gives a screen depth.
  const panel = beveledBox(scene, "screen-panel", {
    width: 3.05,
    height: 1.76,
    depth: 0.04,
    bevel: 0.01,
  });
  panel.position.z = 0.1;
  panel.material = materials.get(principal(skin));
  parts.push(panel);

  const arm = tube(
    scene,
    "screen-arm",
    [new Vector3(0, 0, -0.12), new Vector3(0, -0.1, -0.6)],
    0.07,
    6,
  );
  arm.material = materials.get({ materialClass: "RAW_METAL", color: "#6e737a" });
  parts.push(arm);

  return mergeParts("prop-screen", parts, true);
}

/**
 * A garment rail with hangers and shirts. This is the single most on-theme prop in the game and V4
 * drew it as a 0.14 x 2.3 x 0.14 box.
 */
function buildRail(context: BuildContext, skin: PropSkin): Mesh {
  const { scene, materials, detailed } = context;
  const parts: Mesh[] = [];
  const steel = materials.get({ materialClass: "RAW_METAL", color: "#b6bcc4" });

  for (const side of [-1, 1] as const) {
    const post = tube(
      scene,
      `rail-post-${side}`,
      [new Vector3(side * 0.9, 0, 0), new Vector3(side * 0.9, 1.85, 0)],
      0.045,
      detailed ? 8 : 5,
    );
    post.material = steel;
    parts.push(post);

    const foot = revolve(
      scene,
      `rail-foot-${side}`,
      [new Vector2(0.001, 0), new Vector2(0.28, 0.02), new Vector2(0.26, 0.06), new Vector2(0.001, 0.07)],
      detailed ? 12 : 8,
    );
    foot.position.set(side * 0.9, 0, 0);
    foot.material = steel;
    parts.push(foot);
  }

  const bar = tube(
    scene,
    "rail-bar",
    [new Vector3(-0.92, 1.85, 0), new Vector3(0.92, 1.85, 0)],
    0.032,
    detailed ? 8 : 5,
  );
  bar.material = steel;
  parts.push(bar);

  // Shirts on hangers. Each is a lofted torso shape, not a plane, so it has volume from any angle.
  const shirtCount = detailed ? 7 : 4;
  for (let index = 0; index < shirtCount; index += 1) {
    const x = -0.72 + (index / (shirtCount - 1)) * 1.44;

    if (detailed) {
      const hook = tube(
        scene,
        `rail-hook-${index}`,
        [new Vector3(x, 1.86, 0), new Vector3(x, 1.74, 0.01), new Vector3(x - 0.02, 1.7, 0)],
        0.011,
        5,
      );
      hook.material = steel;
      parts.push(hook);
    }

    const shirt = lofted(
      scene,
      `rail-shirt-${index}`,
      [
        { z: -0.09, halfWidth: 0.17, halfHeight: 0.03, y: 0, radius: 0.03 },
        { z: -0.03, halfWidth: 0.21, halfHeight: 0.06, y: 0, radius: 0.04 },
        { z: 0.22, halfWidth: 0.19, halfHeight: 0.055, y: 0, radius: 0.04 },
        { z: 0.42, halfWidth: 0.2, halfHeight: 0.05, y: 0, radius: 0.04 },
      ],
      { cornerSegments: 3 },
    );
    // Built along Z, hung vertically, then given a slight random turn on the rail.
    shirt.rotation.x = -Math.PI / 2;
    shirt.position.set(x, 1.24, 0);
    shirt.rotation.y = ((index * 13) % 7) * 0.04 - 0.12;
    // Cloth, whatever the rail is made of. This is the case that makes `trim` necessary: the
    // Megastore declares its rails as WOOD, and taking the class from the spec here would hang
    // wooden shirts on them.
    shirt.material = materials.get(trim("FABRIC", skin, { seed: index % 3, tile: 0.3 }));
    parts.push(shirt);
  }

  return mergeParts("prop-rail", parts, true);
}

/** A potted plant: revolved pot, soil, and leaves as flattened ellipsoids on stems. */
function buildPlant(context: BuildContext, skin: PropSkin): Mesh {
  const { scene, materials, detailed, segments } = context;
  const parts: Mesh[] = [];

  const pot = revolve(
    scene,
    "plant-pot",
    [
      new Vector2(0.001, 0),
      new Vector2(0.24, 0.02),
      new Vector2(0.3, 0.42),
      new Vector2(0.34, 0.5),
      new Vector2(0.32, 0.54),
    ],
    segments,
  );
  pot.material = materials.get({ materialClass: "CONCRETE", color: "#8a7f72" });
  parts.push(pot);

  const soil = revolve(
    scene,
    "plant-soil",
    [new Vector2(0.001, 0.5), new Vector2(0.3, 0.5), new Vector2(0.28, 0.53)],
    Math.max(8, segments - 4),
  );
  soil.material = materials.get({ materialClass: "CONCRETE", color: "#3a2f26" });
  parts.push(soil);

  const leafCount = detailed ? 9 : 5;
  for (let index = 0; index < leafCount; index += 1) {
    const angle = (index / leafCount) * Math.PI * 2;
    const lean = 0.5 + ((index * 7) % 5) * 0.12;
    const leaf = ellipsoid(
      scene,
      `plant-leaf-${index}`,
      { x: 0.11, y: 0.42, z: 0.03 },
      8,
      5,
    );
    leaf.position.set(Math.sin(angle) * 0.2 * lean, 0.92, Math.cos(angle) * 0.2 * lean);
    leaf.rotation.z = Math.sin(angle) * lean * 0.6;
    leaf.rotation.x = -Math.cos(angle) * lean * 0.6;
    leaf.material = materials.get(trim("FABRIC", skin, { seed: index % 3, tile: 0.5 }));
    parts.push(leaf);
  }

  return mergeParts("prop-plant", parts, true);
}

/**
 * A spectator. Not a full character — that would be far too expensive at crowd density — but a
 * silhouette with a head, shoulders, arms and legs, which is all that is needed at the distance a
 * crowd sits from the track. V4 used a single capsule.
 */
function buildCrowd(context: BuildContext, skin: PropSkin): Mesh {
  const { scene, materials, detailed } = context;
  const parts: Mesh[] = [];
  const shirt = materials.get(trim("FABRIC", skin, { tile: 0.3 }));
  const flesh = materials.get({ materialClass: "PLASTIC", color: "#d99b72" });

  const torso = lofted(
    scene,
    "crowd-torso",
    [
      { z: 0, halfWidth: 0.16, halfHeight: 0.1, y: 0, radius: 0.06 },
      { z: 0.3, halfWidth: 0.2, halfHeight: 0.12, y: 0, radius: 0.07 },
      { z: 0.56, halfWidth: 0.17, halfHeight: 0.1, y: 0, radius: 0.06 },
    ],
    { cornerSegments: 3 },
  );
  torso.rotation.x = -Math.PI / 2;
  torso.position.y = 0.82;
  torso.material = shirt;
  parts.push(torso);

  const head = ellipsoid(scene, "crowd-head", { x: 0.11, y: 0.13, z: 0.11 }, 10, 6);
  head.position.y = 1.52;
  head.material = flesh;
  parts.push(head);

  if (detailed) {
    for (const side of [-1, 1] as const) {
      const arm = tube(
        scene,
        `crowd-arm-${side}`,
        [
          new Vector3(side * 0.18, 1.3, 0),
          new Vector3(side * 0.24, 1.05, 0.04),
          new Vector3(side * 0.2, 0.86, 0.02),
        ],
        0.038,
        5,
      );
      arm.material = shirt;
      parts.push(arm);

      const leg = tube(
        scene,
        `crowd-leg-${side}`,
        [new Vector3(side * 0.08, 0.82, 0), new Vector3(side * 0.09, 0.4, 0), new Vector3(side * 0.08, 0, 0.02)],
        0.05,
        5,
      );
      leg.material = materials.get({ materialClass: "FABRIC", color: "#2b3550", tile: 0.4 });
      parts.push(leg);
    }
  }

  return mergeParts("prop-crowd", parts, true);
}

/** A stack of crates strapped together. Cheap way to add mass beside the track. */
function buildCrateStack(context: BuildContext, skin: PropSkin): Mesh {
  const { scene, materials } = context;
  const parts: Mesh[] = [];
  for (let level = 0; level < 3; level += 1) {
    const size = 1.05 - level * 0.08;
    const crate = beveledBox(scene, `crate-${level}`, {
      width: size,
      height: 0.78,
      depth: size,
      bevel: 0.03,
    });
    crate.position.y = 0.39 + level * 0.8;
    // A stack that is not perfectly aligned reads as stacked rather than as one tall box.
    crate.rotation.y = ((level * 11) % 7) * 0.05 - 0.15;
    crate.position.x = ((level * 5) % 3) * 0.04 - 0.04;
    crate.material = materials.get(principal(skin, { seed: level % 3 }));
    parts.push(crate);
  }
  const strap = beveledBox(scene, "crate-strap", {
    width: 1.12,
    height: 0.05,
    depth: 0.03,
    bevel: 0.008,
  });
  strap.position.y = 1.2;
  strap.material = materials.get({ materialClass: "PLASTIC", color: "#2f2f36" });
  parts.push(strap);
  return mergeParts("prop-crate-stack", parts, true);
}

/** A picking trolley: frame, wheels and a loaded shelf. */
function buildTrolley(context: BuildContext, skin: PropSkin): Mesh {
  const { scene, materials } = context;
  const parts: Mesh[] = [];
  const steel = materials.get({ materialClass: "RAW_METAL", color: "#9fa6ad" });

  for (const side of [-1, 1] as const) {
    const post = tube(
      scene,
      `trolley-post-${side}`,
      [new Vector3(side * 0.42, 0.14, -0.5), new Vector3(side * 0.42, 1.15, -0.5)],
      0.032,
      6,
    );
    post.material = steel;
    parts.push(post);
  }

  const handle = tube(
    scene,
    "trolley-handle",
    [new Vector3(-0.42, 1.15, -0.5), new Vector3(0, 1.2, -0.52), new Vector3(0.42, 1.15, -0.5)],
    0.028,
    6,
  );
  handle.material = steel;
  parts.push(handle);

  const deck = beveledBox(scene, "trolley-deck", {
    width: 0.92,
    height: 0.05,
    depth: 1.15,
    bevel: 0.014,
  });
  deck.position.y = 0.28;
  deck.material = steel;
  parts.push(deck);

  const load = beveledBox(scene, "trolley-load", {
    width: 0.72,
    height: 0.52,
    depth: 0.86,
    bevel: 0.024,
  });
  load.position.y = 0.57;
  load.material = materials.get(trim("CARDBOARD", skin));
  parts.push(load);

  for (const side of [-1, 1] as const) {
    for (const depth of [-1, 1] as const) {
      const wheel = revolve(
        scene,
        `trolley-wheel-${side}-${depth}`,
        [
          new Vector2(0.001, -0.03),
          new Vector2(0.11, -0.03),
          new Vector2(0.12, 0),
          new Vector2(0.11, 0.03),
          new Vector2(0.001, 0.03),
        ],
        10,
      );
      wheel.rotation.z = Math.PI / 2;
      wheel.position.set(side * 0.38, 0.12, depth * 0.46);
      wheel.material = materials.get({ materialClass: "RUBBER", color: "#131318" });
      parts.push(wheel);
    }
  }

  return mergeParts("prop-trolley", parts, true);
}

export type PropSource = { mesh: Mesh; kind: PropKind; footprint: number; textured: boolean };

/**
 * Builds one hidden source mesh per prop kind. Callers instance from these.
 * `footprint` is the prop's approximate radius, used to keep it clear of the racing surface.
 */
export function createPropSources(
  scene: Scene,
  materials: MaterialLibrary,
  specs: readonly PropSpec[],
  quality: "LOW" | "MEDIUM" | "HIGH" | "ULTRA",
): Map<string, PropSource> {
  const context: BuildContext = {
    scene,
    materials,
    detailed: quality === "HIGH" || quality === "ULTRA",
    segments: quality === "LOW" ? 8 : quality === "MEDIUM" ? 12 : 16,
  };

  const builders: Record<PropKind, (skin: PropSkin) => Mesh> = {
    BOX: (skin) => buildBox(context, skin),
    SHELF: (skin) => buildShelf(context, skin),
    PALLET: (skin) => buildPallet(context, skin),
    MACHINE: (skin) => buildMachine(context, skin),
    SIGN: (skin) => buildSign(context, skin),
    SCREEN: (skin) => buildScreen(context, skin),
    RAIL: (skin) => buildRail(context, skin),
    PLANT: (skin) => buildPlant(context, skin),
    CROWD: (skin) => buildCrowd(context, skin),
    CRATE_STACK: (skin) => buildCrateStack(context, skin),
    TROLLEY: (skin) => buildTrolley(context, skin),
  };

  const footprints: Record<PropKind, number> = {
    BOX: 0.8,
    SHELF: 1.6,
    PALLET: 0.9,
    MACHINE: 1.8,
    SIGN: 1.6,
    SCREEN: 2,
    RAIL: 1.2,
    PLANT: 0.6,
    CROWD: 0.4,
    CRATE_STACK: 0.9,
    TROLLEY: 0.9,
  };

  const sources = new Map<string, PropSource>();
  /**
   * One source per kind *and print*, not per kind.
   *
   * Per-instance colour lets one source serve every colour of its kind, which is what keeps the
   * material budget survivable on a densely dressed circuit. A baked print cannot be shared that
   * way: the artwork is in the texture, so two specs that differ by print are two sources. Specs
   * that differ only by colour still share one, which is the case that actually matters — the
   * Megastore's four shirt displays are one mesh.
   */
  for (const [key, spec] of propSourceSpecs(specs)) {
    const kind = spec.kind;
    const skin: PropSkin = { materialClass: spec.materialClass, color: spec.color };
    if (spec.texture !== undefined) skin.texture = spec.texture;
    const mesh = builders[kind](skin);
    mesh.name = `prop-source-${key}`;
    mesh.isVisible = false;
    mesh.isPickable = false;
    mesh.receiveShadows = true;
    // Per-instance colour lets one source serve every colour variation of its kind, which is how
    // the art bible's 40-material budget survives a densely dressed circuit.
    mesh.registerInstancedBuffer("color", 4);
    sources.set(key, { mesh, kind, footprint: footprints[kind], textured: spec.texture !== undefined });
  }
  return sources;
}
