import { Mesh, Scene, TransformNode, Vector2, Vector3 } from "@babylonjs/core";
import { MaterialLibrary } from "./MaterialLibrary";
import { beveledBox, ellipsoid, lofted, mergeParts, revolve, tube } from "./Geometry";

/**
 * HERO ASSETS.
 *
 * The art bible gives each sector one to three hero assets, and the brief lists what they should be:
 * a giant screen-printing carousel, a wall of shirts, a stage, a logistics robot, an oversized
 * cash register. In V4 every one of these was the same object — a 7 x 13 x 7 box with a glowing
 * band — placed nine metres off the track edge.
 *
 * These are landmarks in the navigational sense: they have to be recognisable from the point where
 * the player decides which way to go, so each has a distinctive silhouette rather than distinctive
 * decoration. They are the one asset class allowed real triangle budget, because there are only a
 * handful per circuit and they carry the identity of the space.
 */

export type HeroKind =
  | "SHIRT_WALL"
  | "CASH_REGISTER"
  | "LOGISTICS_ROBOT"
  | "PALLET_TOWER"
  | "PRINT_CAROUSEL"
  | "INK_DRUMS"
  | "GIANT_MONITOR"
  | "COFFEE_MACHINE"
  | "STAGE"
  | "ARCADE_BANK";

/** Which heroes belong to which theme, in the order the sectors use them. */
export const ThemeHeroes: Record<string, readonly HeroKind[]> = {
  FLAGSHIP: ["SHIRT_WALL", "CASH_REGISTER", "SHIRT_WALL", "PALLET_TOWER", "CASH_REGISTER", "SHIRT_WALL", "STAGE"],
  WAREHOUSE: ["PALLET_TOWER", "LOGISTICS_ROBOT", "PALLET_TOWER", "PRINT_CAROUSEL", "LOGISTICS_ROBOT", "PALLET_TOWER", "INK_DRUMS"],
  PRINT_FACTORY: ["PRINT_CAROUSEL", "INK_DRUMS", "PRINT_CAROUSEL", "GIANT_MONITOR", "INK_DRUMS", "PRINT_CAROUSEL", "PALLET_TOWER"],
  OFFICE: ["GIANT_MONITOR", "COFFEE_MACHINE", "GIANT_MONITOR", "SHIRT_WALL", "COFFEE_MACHINE", "GIANT_MONITOR", "CASH_REGISTER"],
  MANGA: ["STAGE", "ARCADE_BANK", "GIANT_MONITOR", "STAGE", "ARCADE_BANK", "SHIRT_WALL", "STAGE"],
};

type Context = {
  scene: Scene;
  materials: MaterialLibrary;
  detailed: boolean;
  segments: number;
  accentA: string;
  accentB: string;
};

/** A wall of hanging and folded shirts. The most on-brand landmark in the game. */
function shirtWall(context: Context): Mesh {
  const { scene, materials, detailed } = context;
  const parts: Mesh[] = [];
  const shirtColors = ["#ff3da6", "#65d8ff", "#b9ff45", "#f7f2e8", "#ffd43b", "#8f5cff", "#2c3e70"];

  const backing = beveledBox(scene, "hero-shirt-backing", {
    width: 12,
    height: 11,
    depth: 0.6,
    bevel: 0.12,
  });
  backing.position.y = 5.5;
  backing.material = materials.get({ materialClass: "WOOD", color: "#c98a52", tile: 3 });
  parts.push(backing);

  // Three rails of hanging shirts across the wall.
  const rows = detailed ? 3 : 2;
  const perRow = detailed ? 9 : 6;
  for (let row = 0; row < rows; row += 1) {
    const y = 8.4 - row * 3.1;
    const rail = tube(
      scene,
      `hero-shirt-rail-${row}`,
      [new Vector3(-5.4, y, 0.7), new Vector3(5.4, y, 0.7)],
      0.09,
      detailed ? 8 : 5,
    );
    rail.material = materials.get({ materialClass: "RAW_METAL", color: "#b6bcc4" });
    parts.push(rail);

    for (let index = 0; index < perRow; index += 1) {
      const x = -4.8 + (index / (perRow - 1)) * 9.6;
      const shirt = lofted(
        scene,
        `hero-shirt-${row}-${index}`,
        [
          { z: -0.28, halfWidth: 0.5, halfHeight: 0.09, y: 0, radius: 0.08 },
          { z: -0.1, halfWidth: 0.62, halfHeight: 0.16, y: 0, radius: 0.1 },
          { z: 0.7, halfWidth: 0.56, halfHeight: 0.15, y: 0, radius: 0.1 },
          { z: 1.3, halfWidth: 0.58, halfHeight: 0.13, y: 0, radius: 0.1 },
        ],
        { cornerSegments: 3 },
      );
      shirt.rotation.x = -Math.PI / 2;
      shirt.position.set(x, y - 1.1, 0.7);
      shirt.rotation.y = ((index * 13 + row * 7) % 9) * 0.03 - 0.12;
      shirt.material = materials.get({
        materialClass: "FABRIC",
        color: shirtColors[(index + row * 3) % shirtColors.length]!,
        tile: 0.4,
        seed: (index + row) % 3,
      });
      parts.push(shirt);
    }
  }

  // A lit sign across the top, which is what makes it read as a display and not a fence.
  const sign = beveledBox(scene, "hero-shirt-sign", {
    width: 9,
    height: 1.5,
    depth: 0.3,
    bevel: 0.06,
  });
  sign.position.set(0, 10.6, 0.5);
  sign.material = materials.get({ materialClass: "NEON", color: context.accentA });
  parts.push(sign);

  return mergeParts("hero-shirt-wall", parts, true);
}

/** An oversized cash register: body, sloped keypad, screen and a drawer. */
function cashRegister(context: Context): Mesh {
  const { scene, materials, detailed, segments } = context;
  const parts: Mesh[] = [];
  const shell = materials.get({ materialClass: "PLASTIC", color: "#e8dfd0" });

  const body = lofted(
    scene,
    "hero-register-body",
    [
      { z: -3, halfWidth: 3.4, halfHeight: 2.6, y: 2.6, radius: 0.45 },
      { z: 0, halfWidth: 3.6, halfHeight: 2.9, y: 2.9, radius: 0.5 },
      { z: 2.6, halfWidth: 3.2, halfHeight: 2.2, y: 2.2, radius: 0.4 },
    ],
    { cornerSegments: 5 },
  );
  body.material = shell;
  parts.push(body);

  // Sloped keypad deck with keys.
  const deck = beveledBox(scene, "hero-register-deck", {
    width: 5.6,
    height: 0.4,
    depth: 3.2,
    bevel: 0.1,
  });
  deck.position.set(0, 5.2, 1.3);
  deck.rotation.x = -0.26;
  deck.material = materials.get({ materialClass: "PLASTIC", color: "#2b2732" });
  parts.push(deck);

  if (detailed) {
    for (let row = 0; row < 4; row += 1) {
      for (let column = 0; column < 5; column += 1) {
        const key = beveledBox(scene, `hero-register-key-${row}-${column}`, {
          width: 0.68,
          height: 0.22,
          depth: 0.6,
          bevel: 0.05,
        });
        key.position.set(-2 + column * 1, 5.55 - row * 0.18, 2.2 - row * 0.72);
        key.rotation.x = -0.26;
        key.material = materials.get({
          materialClass: "PLASTIC",
          color: (row + column) % 7 === 0 ? context.accentA : "#f2ede2",
        });
        parts.push(key);
      }
    }
  }

  // Raised display, angled toward the track.
  const post = revolve(
    scene,
    "hero-register-post",
    [new Vector2(0.5, 0), new Vector2(0.44, 1.4), new Vector2(0.5, 1.6)],
    segments,
  );
  post.position.set(0, 5.6, -1.6);
  post.material = shell;
  parts.push(post);

  const display = beveledBox(scene, "hero-register-display", {
    width: 4.4,
    height: 2.4,
    depth: 0.45,
    bevel: 0.09,
  });
  display.position.set(0, 8.2, -1.6);
  display.rotation.x = 0.2;
  display.material = materials.get({ materialClass: "SCREEN", color: context.accentB });
  parts.push(display);

  const drawer = beveledBox(scene, "hero-register-drawer", {
    width: 6.4,
    height: 0.9,
    depth: 0.8,
    bevel: 0.1,
  });
  drawer.position.set(0, 1.4, 3.2);
  drawer.material = materials.get({ materialClass: "RAW_METAL", color: "#9fa6ad" });
  parts.push(drawer);

  return mergeParts("hero-cash-register", parts, true);
}

/** A warehouse robot: tracked base, rotating column, articulated arm and a gripper. */
function logisticsRobot(context: Context): Mesh {
  const { scene, materials, detailed, segments } = context;
  const parts: Mesh[] = [];
  const shell = materials.get({ materialClass: "PAINTED_METAL", color: "#ffc02e" });
  const steel = materials.get({ materialClass: "RAW_METAL", color: "#8f979f" });

  const base = lofted(
    scene,
    "hero-robot-base",
    [
      { z: -2.4, halfWidth: 2, halfHeight: 0.8, y: 0.8, radius: 0.25 },
      { z: 0, halfWidth: 2.3, halfHeight: 0.95, y: 0.95, radius: 0.3 },
      { z: 2.4, halfWidth: 2, halfHeight: 0.8, y: 0.8, radius: 0.25 },
    ],
    { cornerSegments: 4 },
  );
  base.material = shell;
  parts.push(base);

  // Tracks rather than wheels: a distinctive silhouette at distance.
  for (const side of [-1, 1] as const) {
    const track = revolve(
      scene,
      `hero-robot-track-${side}`,
      [
        new Vector2(0.001, -0.45),
        new Vector2(0.7, -0.45),
        new Vector2(0.8, 0),
        new Vector2(0.7, 0.45),
        new Vector2(0.001, 0.45),
      ],
      detailed ? 16 : 10,
    );
    track.rotation.z = Math.PI / 2;
    track.scaling.z = 3.4;
    track.position.set(side * 2.1, 0.8, 0);
    track.material = materials.get({ materialClass: "RUBBER", color: "#16161c" });
    parts.push(track);
  }

  const column = revolve(
    scene,
    "hero-robot-column",
    [new Vector2(1.1, 0), new Vector2(1, 2.4), new Vector2(0.85, 3.2), new Vector2(0.9, 3.4)],
    segments,
  );
  column.position.y = 1.8;
  column.material = shell;
  parts.push(column);

  const upperArm = tube(
    scene,
    "hero-robot-upper",
    [new Vector3(0, 5.2, 0), new Vector3(1.4, 6.4, 0.6), new Vector3(3.4, 6.2, 1.2)],
    0.4,
    detailed ? 10 : 6,
  );
  upperArm.material = steel;
  parts.push(upperArm);

  const forearm = tube(
    scene,
    "hero-robot-forearm",
    [new Vector3(3.4, 6.2, 1.2), new Vector3(4.6, 5.2, 1.6), new Vector3(5, 3.8, 1.8)],
    0.3,
    detailed ? 10 : 6,
  );
  forearm.material = steel;
  parts.push(forearm);

  // Gripper holding a carton, which explains what the machine is for.
  for (const side of [-1, 1] as const) {
    const claw = beveledBox(scene, `hero-robot-claw-${side}`, {
      width: 0.22,
      height: 1.1,
      depth: 0.5,
      bevel: 0.05,
    });
    claw.position.set(5 + side * 0.55, 3.1, 1.8);
    claw.rotation.z = side * 0.12;
    claw.material = shell;
    parts.push(claw);
  }

  const carton = beveledBox(scene, "hero-robot-carton", {
    width: 1.1,
    height: 1,
    depth: 1.05,
    bevel: 0.04,
  });
  carton.position.set(5, 2.4, 1.8);
  carton.material = materials.get({ materialClass: "CARDBOARD", color: "#b98a57" });
  parts.push(carton);

  const beacon = ellipsoid(scene, "hero-robot-beacon", { x: 0.4, y: 0.35, z: 0.4 }, 10, 6);
  beacon.position.y = 5.6;
  beacon.material = materials.get({ materialClass: "NEON", color: context.accentA });
  parts.push(beacon);

  return mergeParts("hero-logistics-robot", parts, true);
}

/** A leaning tower of palletised cartons, wrapped and strapped. */
function palletTower(context: Context): Mesh {
  const { scene, materials, detailed } = context;
  const parts: Mesh[] = [];
  const levels = detailed ? 7 : 5;

  for (let level = 0; level < levels; level += 1) {
    const y = level * 1.75;
    // Each level is a pallet plus four cartons, rotated slightly so the stack leans and twists.
    for (let plank = -2; plank <= 2; plank += 1) {
      const board = beveledBox(scene, `hero-tower-plank-${level}-${plank}`, {
        width: 3.2,
        height: 0.14,
        depth: 0.5,
        bevel: 0.03,
      });
      board.position.set(level * 0.09, y + 0.2, plank * 0.72);
      board.rotation.y = level * 0.03;
      board.material = materials.get({ materialClass: "WOOD", color: "#a2764b", seed: level % 3 });
      parts.push(board);
    }
    for (const dx of [-0.78, 0.78]) {
      for (const dz of [-0.78, 0.78]) {
        const carton = beveledBox(scene, `hero-tower-carton-${level}-${dx}-${dz}`, {
          width: 1.4,
          height: 1.3,
          depth: 1.4,
          bevel: 0.045,
        });
        carton.position.set(level * 0.09 + dx, y + 1, dz);
        carton.rotation.y = level * 0.03 + ((level + dx) % 3) * 0.02;
        carton.material = materials.get({
          materialClass: "CARDBOARD",
          color: "#b98a57",
          seed: (level + (dx > 0 ? 1 : 0)) % 3,
        });
        parts.push(carton);
      }
    }
    if (detailed) {
      const strap = beveledBox(scene, `hero-tower-strap-${level}`, {
        width: 3.3,
        height: 0.09,
        depth: 0.06,
        bevel: 0.02,
      });
      strap.position.set(level * 0.09, y + 1.5, 0);
      strap.material = materials.get({ materialClass: "PLASTIC", color: context.accentB });
      parts.push(strap);
    }
  }
  return mergeParts("hero-pallet-tower", parts, true);
}

/** The screen-print carousel: a hub with radial arms, print heads and platens. */
function printCarousel(context: Context): Mesh {
  const { scene, materials, detailed, segments } = context;
  const parts: Mesh[] = [];
  const shell = materials.get({ materialClass: "PAINTED_METAL", color: "#3a3f49" });
  const steel = materials.get({ materialClass: "RAW_METAL", color: "#9fa6ad" });
  const inks = ["#ff3da6", "#ffd43b", "#65d8ff", "#12101a", "#8f5cff", "#b9ff45"];

  const pillar = revolve(
    scene,
    "hero-carousel-pillar",
    [new Vector2(1.5, 0), new Vector2(1.3, 4.4), new Vector2(1.1, 5), new Vector2(1.2, 5.2)],
    segments,
  );
  pillar.material = shell;
  parts.push(pillar);

  const hub = revolve(
    scene,
    "hero-carousel-hub",
    [new Vector2(0.001, 5.2), new Vector2(2.2, 5.3), new Vector2(2.3, 5.9), new Vector2(0.001, 6)],
    segments,
  );
  hub.material = steel;
  parts.push(hub);

  const arms = detailed ? 6 : 4;
  for (let index = 0; index < arms; index += 1) {
    const angle = (index / arms) * Math.PI * 2;
    const dx = Math.sin(angle);
    const dz = Math.cos(angle);

    const arm = tube(
      scene,
      `hero-carousel-arm-${index}`,
      [new Vector3(dx * 2, 5.6, dz * 2), new Vector3(dx * 6.2, 5.5, dz * 6.2)],
      0.24,
      detailed ? 9 : 6,
    );
    arm.material = steel;
    parts.push(arm);

    // The platen the shirt sits on.
    const platen = beveledBox(scene, `hero-carousel-platen-${index}`, {
      width: 2.2,
      height: 0.2,
      depth: 3,
      bevel: 0.05,
    });
    platen.position.set(dx * 6, 4.7, dz * 6);
    platen.rotation.y = angle;
    platen.material = steel;
    parts.push(platen);

    // A shirt on the platen, in the ink colour this station prints.
    const shirt = beveledBox(scene, `hero-carousel-shirt-${index}`, {
      width: 1.9,
      height: 0.1,
      depth: 2.6,
      bevel: 0.05,
    });
    shirt.position.set(dx * 6, 4.86, dz * 6);
    shirt.rotation.y = angle;
    shirt.material = materials.get({
      materialClass: "FABRIC",
      color: index % 2 === 0 ? "#f7f2e8" : "#2b2732",
      tile: 0.5,
    });
    parts.push(shirt);

    // Print head above, one per ink.
    const head = beveledBox(scene, `hero-carousel-head-${index}`, {
      width: 2.4,
      height: 0.9,
      depth: 3.2,
      bevel: 0.08,
    });
    head.position.set(dx * 6, 7.4, dz * 6);
    head.rotation.y = angle;
    head.material = shell;
    parts.push(head);

    const inkPot = revolve(
      scene,
      `hero-carousel-ink-${index}`,
      [new Vector2(0.001, 0), new Vector2(0.5, 0.05), new Vector2(0.45, 0.8), new Vector2(0.001, 0.85)],
      detailed ? 12 : 8,
    );
    inkPot.position.set(dx * 6, 8, dz * 6);
    inkPot.material = materials.get({ materialClass: "INK", color: inks[index % inks.length]! });
    parts.push(inkPot);
  }

  return mergeParts("hero-print-carousel", parts, true);
}

/** A bank of ink drums on a bund, with a gantry over them. */
function inkDrums(context: Context): Mesh {
  const { scene, materials, detailed, segments } = context;
  const parts: Mesh[] = [];
  const inks = ["#ff3da6", "#ffd43b", "#65d8ff", "#12101a", "#8f5cff"];

  const bund = beveledBox(scene, "hero-drums-bund", {
    width: 11,
    height: 0.6,
    depth: 5,
    bevel: 0.1,
  });
  bund.position.y = 0.3;
  bund.material = materials.get({ materialClass: "CONCRETE", color: "#4a4550", tile: 3 });
  parts.push(bund);

  const count = detailed ? 5 : 3;
  for (let index = 0; index < count; index += 1) {
    const x = -4 + (index / Math.max(1, count - 1)) * 8;
    const drum = revolve(
      scene,
      `hero-drums-drum-${index}`,
      [
        new Vector2(0.001, 0),
        new Vector2(1.05, 0.05),
        new Vector2(1.1, 0.4),
        new Vector2(1.05, 0.6),
        new Vector2(1.1, 0.8),
        new Vector2(1.05, 2.4),
        new Vector2(1.1, 2.6),
        new Vector2(1.05, 2.95),
        new Vector2(0.001, 3),
      ],
      detailed ? segments : 10,
    );
    drum.position.set(x, 0.6, index % 2 === 0 ? -0.6 : 0.9);
    drum.material = materials.get({ materialClass: "INK", color: inks[index % inks.length]! });
    parts.push(drum);

    const lid = revolve(
      scene,
      `hero-drums-lid-${index}`,
      [new Vector2(0.001, 3), new Vector2(0.4, 3.02), new Vector2(0.36, 3.2), new Vector2(0.001, 3.22)],
      8,
    );
    lid.position.set(x, 0.6, index % 2 === 0 ? -0.6 : 0.9);
    lid.material = materials.get({ materialClass: "RAW_METAL", color: "#b6bcc4" });
    parts.push(lid);
  }

  const gantry = tube(
    scene,
    "hero-drums-gantry",
    [new Vector3(-5.2, 0.6, 2.2), new Vector3(-5.2, 5.4, 2.2), new Vector3(5.2, 5.4, 2.2), new Vector3(5.2, 0.6, 2.2)],
    0.18,
    detailed ? 9 : 6,
  );
  gantry.material = materials.get({ materialClass: "PAINTED_METAL", color: context.accentB });
  parts.push(gantry);

  return mergeParts("hero-ink-drums", parts, true);
}

/** An oversized monitor on a stand: bezel, lit panel, stand and a keyboard at its foot. */
function giantMonitor(context: Context): Mesh {
  const { scene, materials, detailed } = context;
  const parts: Mesh[] = [];
  const shell = materials.get({ materialClass: "PLASTIC", color: "#2b2732" });

  const bezel = beveledBox(scene, "hero-monitor-bezel", {
    width: 13,
    height: 8,
    depth: 0.8,
    bevel: 0.14,
  });
  bezel.position.y = 7.5;
  bezel.material = shell;
  parts.push(bezel);

  const panel = beveledBox(scene, "hero-monitor-panel", {
    width: 12.2,
    height: 7.2,
    depth: 0.16,
    bevel: 0.05,
  });
  panel.position.set(0, 7.5, 0.42);
  panel.material = materials.get({ materialClass: "SCREEN", color: context.accentB });
  parts.push(panel);

  const neck = beveledBox(scene, "hero-monitor-neck", {
    width: 1.6,
    height: 3.4,
    depth: 0.9,
    bevel: 0.1,
  });
  neck.position.y = 2.1;
  neck.material = shell;
  parts.push(neck);

  const foot = lofted(
    scene,
    "hero-monitor-foot",
    [
      { z: -2.4, halfWidth: 3.6, halfHeight: 0.25, y: 0.25, radius: 0.2 },
      { z: 0, halfWidth: 4.2, halfHeight: 0.35, y: 0.35, radius: 0.25 },
      { z: 2.4, halfWidth: 3.6, halfHeight: 0.25, y: 0.25, radius: 0.2 },
    ],
    { cornerSegments: 4 },
  );
  foot.material = shell;
  parts.push(foot);

  if (detailed) {
    // A keyboard at the base, which sets the scale: the karts drive past it.
    const keyboard = beveledBox(scene, "hero-monitor-keyboard", {
      width: 10,
      height: 0.5,
      depth: 3.6,
      bevel: 0.09,
    });
    keyboard.position.set(0, 0.3, 5.4);
    keyboard.rotation.x = -0.04;
    keyboard.material = materials.get({ materialClass: "PLASTIC", color: "#e6e1d8" });
    parts.push(keyboard);

    for (let row = 0; row < 4; row += 1) {
      for (let column = 0; column < 12; column += 1) {
        const key = beveledBox(scene, `hero-monitor-key-${row}-${column}`, {
          width: 0.62,
          height: 0.16,
          depth: 0.62,
          bevel: 0.05,
        });
        key.position.set(-4.2 + column * 0.76, 0.6, 4.3 + row * 0.78);
        key.material = materials.get({ materialClass: "PLASTIC", color: "#f4f1ea" });
        parts.push(key);
      }
    }
  }

  return mergeParts("hero-giant-monitor", parts, true);
}

/** A giant coffee machine with a cup under the spout. */
function coffeeMachine(context: Context): Mesh {
  const { scene, materials, segments } = context;
  const parts: Mesh[] = [];
  const shell = materials.get({ materialClass: "PAINTED_METAL", color: "#2b2732" });

  const body = lofted(
    scene,
    "hero-coffee-body",
    [
      { z: -2.2, halfWidth: 2.6, halfHeight: 3.4, y: 3.4, radius: 0.4 },
      { z: 0.4, halfWidth: 2.8, halfHeight: 3.8, y: 3.8, radius: 0.45 },
      { z: 1.8, halfWidth: 2.4, halfHeight: 2.4, y: 2.4, radius: 0.35 },
    ],
    { cornerSegments: 5 },
  );
  body.material = shell;
  parts.push(body);

  const hopper = revolve(
    scene,
    "hero-coffee-hopper",
    [new Vector2(1.6, 0), new Vector2(1.5, 1.6), new Vector2(1.1, 2.1), new Vector2(1.2, 2.3)],
    segments,
  );
  hopper.position.y = 7.2;
  hopper.material = materials.get({ materialClass: "GLASS", color: "#c8b6a0" });
  parts.push(hopper);

  const spout = tube(
    scene,
    "hero-coffee-spout",
    [new Vector3(0, 4.4, 1.6), new Vector3(0, 3.9, 2.4)],
    0.22,
    8,
  );
  spout.material = materials.get({ materialClass: "RAW_METAL", color: "#b6bcc4" });
  parts.push(spout);

  const cup = revolve(
    scene,
    "hero-coffee-cup",
    [
      new Vector2(0.001, 0),
      new Vector2(0.9, 0.05),
      new Vector2(1.15, 2.1),
      new Vector2(1.2, 2.25),
      new Vector2(1.05, 2.25),
      new Vector2(0.8, 0.2),
      new Vector2(0.001, 0.18),
    ],
    segments,
  );
  cup.position.set(0, 0.6, 3.4);
  cup.material = materials.get({ materialClass: "PAPER", color: "#f7f2e8" });
  parts.push(cup);

  const panel = beveledBox(scene, "hero-coffee-panel", {
    width: 2.2,
    height: 1.4,
    depth: 0.2,
    bevel: 0.06,
  });
  panel.position.set(0, 5.6, 1.9);
  panel.material = materials.get({ materialClass: "SCREEN", color: context.accentB });
  parts.push(panel);

  return mergeParts("hero-coffee-machine", parts, true);
}

/** A convention stage: deck, truss, backdrop screen and speaker stacks. */
function stage(context: Context): Mesh {
  const { scene, materials, detailed } = context;
  const parts: Mesh[] = [];

  const deck = beveledBox(scene, "hero-stage-deck", {
    width: 16,
    height: 1.6,
    depth: 9,
    bevel: 0.12,
  });
  deck.position.y = 0.8;
  deck.material = materials.get({ materialClass: "WOOD", color: "#3a2f28", tile: 4 });
  parts.push(deck);

  const backdrop = beveledBox(scene, "hero-stage-backdrop", {
    width: 15,
    height: 8.4,
    depth: 0.4,
    bevel: 0.08,
  });
  backdrop.position.set(0, 5.8, -4.2);
  backdrop.material = materials.get({ materialClass: "SCREEN", color: context.accentA });
  parts.push(backdrop);

  // Truss over the stage, built from tubes so it reads as scaffolding.
  for (const side of [-1, 1] as const) {
    const upright = tube(
      scene,
      `hero-stage-upright-${side}`,
      [new Vector3(side * 7.6, 1.6, -4), new Vector3(side * 7.6, 11.5, -4)],
      0.22,
      detailed ? 8 : 5,
    );
    upright.material = materials.get({ materialClass: "RAW_METAL", color: "#8f979f" });
    parts.push(upright);
  }
  const beam = tube(
    scene,
    "hero-stage-beam",
    [new Vector3(-7.6, 11.4, -4), new Vector3(7.6, 11.4, -4)],
    0.22,
    detailed ? 8 : 5,
  );
  beam.material = materials.get({ materialClass: "RAW_METAL", color: "#8f979f" });
  parts.push(beam);

  const lightCount = detailed ? 7 : 4;
  for (let index = 0; index < lightCount; index += 1) {
    const x = -6.4 + (index / Math.max(1, lightCount - 1)) * 12.8;
    const can = revolve(
      scene,
      `hero-stage-light-${index}`,
      [new Vector2(0.001, 0), new Vector2(0.42, 0.05), new Vector2(0.5, 0.8), new Vector2(0.001, 0.85)],
      10,
    );
    can.position.set(x, 10.4, -4);
    can.rotation.x = Math.PI;
    can.material = materials.get({
      materialClass: "NEON",
      color: index % 2 === 0 ? context.accentA : context.accentB,
    });
    parts.push(can);
  }

  for (const side of [-1, 1] as const) {
    for (let level = 0; level < 2; level += 1) {
      const speaker = beveledBox(scene, `hero-stage-speaker-${side}-${level}`, {
        width: 2.2,
        height: 2.6,
        depth: 1.8,
        bevel: 0.08,
      });
      speaker.position.set(side * 7, 1.6 + 1.3 + level * 2.7, 1.5);
      speaker.material = materials.get({ materialClass: "PLASTIC", color: "#16151c" });
      parts.push(speaker);

      const cone = revolve(
        scene,
        `hero-stage-cone-${side}-${level}`,
        [new Vector2(0.001, 0), new Vector2(0.72, 0.02), new Vector2(0.62, 0.2), new Vector2(0.001, 0.26)],
        12,
      );
      cone.rotation.x = -Math.PI / 2;
      cone.position.set(side * 7, 1.6 + 1.3 + level * 2.7, 2.5);
      cone.material = materials.get({ materialClass: "RUBBER", color: "#0e0e12" });
      parts.push(cone);
    }
  }

  return mergeParts("hero-stage", parts, true);
}

/** A bank of arcade cabinets. */
function arcadeBank(context: Context): Mesh {
  const { scene, materials, detailed } = context;
  const parts: Mesh[] = [];
  const count = detailed ? 5 : 3;

  for (let index = 0; index < count; index += 1) {
    const x = -4 + (index / Math.max(1, count - 1)) * 8;
    const cabinet = lofted(
      scene,
      `hero-arcade-body-${index}`,
      [
        { z: -0.9, halfWidth: 0.95, halfHeight: 2.4, y: 2.4, radius: 0.14 },
        { z: 0.3, halfWidth: 0.95, halfHeight: 2.8, y: 2.8, radius: 0.16 },
        { z: 0.95, halfWidth: 0.9, halfHeight: 1.9, y: 1.9, radius: 0.14 },
      ],
      { cornerSegments: 3 },
    );
    cabinet.position.x = x;
    cabinet.material = materials.get({ materialClass: "PLASTIC", color: "#1b1630" });
    parts.push(cabinet);

    const screen = beveledBox(scene, `hero-arcade-screen-${index}`, {
      width: 1.5,
      height: 1.3,
      depth: 0.14,
      bevel: 0.04,
    });
    screen.position.set(x, 3.6, 0.82);
    screen.rotation.x = 0.3;
    screen.material = materials.get({
      materialClass: "SCREEN",
      color: index % 2 === 0 ? context.accentA : context.accentB,
    });
    parts.push(screen);

    const marquee = beveledBox(scene, `hero-arcade-marquee-${index}`, {
      width: 1.8,
      height: 0.8,
      depth: 0.2,
      bevel: 0.05,
    });
    marquee.position.set(x, 5.4, 0.5);
    marquee.material = materials.get({ materialClass: "NEON", color: context.accentA });
    parts.push(marquee);

    if (detailed) {
      const stick = tube(
        scene,
        `hero-arcade-stick-${index}`,
        [new Vector3(x - 0.35, 2.5, 1.1), new Vector3(x - 0.35, 2.85, 1.15)],
        0.06,
        6,
      );
      stick.material = materials.get({ materialClass: "RAW_METAL", color: "#b6bcc4" });
      parts.push(stick);

      const ball = ellipsoid(scene, `hero-arcade-ball-${index}`, { x: 0.13, y: 0.13, z: 0.13 }, 8, 5);
      ball.position.set(x - 0.35, 2.92, 1.15);
      ball.material = materials.get({ materialClass: "PLASTIC", color: context.accentA });
      parts.push(ball);

      for (let button = 0; button < 3; button += 1) {
        const pad = revolve(
          scene,
          `hero-arcade-button-${index}-${button}`,
          [new Vector2(0.001, 0), new Vector2(0.11, 0.01), new Vector2(0.1, 0.05), new Vector2(0.001, 0.06)],
          8,
        );
        pad.position.set(x + 0.1 + button * 0.22, 2.52, 1.08);
        pad.material = materials.get({
          materialClass: "PLASTIC",
          color: ["#ff3da6", "#ffd43b", "#65d8ff"][button]!,
        });
        parts.push(pad);
      }
    }
  }

  return mergeParts("hero-arcade-bank", parts, true);
}

const BUILDERS: Record<HeroKind, (context: Context) => Mesh> = {
  SHIRT_WALL: shirtWall,
  CASH_REGISTER: cashRegister,
  LOGISTICS_ROBOT: logisticsRobot,
  PALLET_TOWER: palletTower,
  PRINT_CAROUSEL: printCarousel,
  INK_DRUMS: inkDrums,
  GIANT_MONITOR: giantMonitor,
  COFFEE_MACHINE: coffeeMachine,
  STAGE: stage,
  ARCADE_BANK: arcadeBank,
};

export type HeroOptions = {
  quality: "LOW" | "MEDIUM" | "HIGH" | "ULTRA";
  accentA: string;
  accentB: string;
};

/**
 * Builds one hero landmark. Heroes are not instanced — the art bible forbids repeating a hero
 * within a circuit — so each is a unique mesh and is worth its triangle budget.
 */
export function buildHero(
  scene: Scene,
  materials: MaterialLibrary,
  kind: HeroKind,
  name: string,
  options: HeroOptions,
): TransformNode {
  const context: Context = {
    scene,
    materials,
    detailed: options.quality === "HIGH" || options.quality === "ULTRA",
    segments: options.quality === "LOW" ? 10 : options.quality === "MEDIUM" ? 14 : 20,
    accentA: options.accentA,
    accentB: options.accentB,
  };
  const mesh = BUILDERS[kind](context);
  mesh.name = name;
  mesh.isPickable = false;
  mesh.receiveShadows = true;
  return mesh;
}

export function heroesForTheme(theme: string): readonly HeroKind[] {
  return ThemeHeroes[theme] ?? ThemeHeroes.FLAGSHIP!;
}
