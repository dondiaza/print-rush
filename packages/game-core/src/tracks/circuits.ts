import { bakeTrack, type BakedTrack, type TrackBlueprint, type TrackFeature } from "../blueprint.js";
import { TrackPath } from "../path.js";

/**
 * THE FIVE CIRCUITS, AUTHORED.
 *
 * These replace the procedurally generated versions. The generator gave five circuits of the right
 * *size* — 2.5 to 3.3 km with the right corner counts — but they were one layout template with
 * different seeds and palettes, which is exactly the reskin the brief rules out.
 *
 * Each circuit here follows the route the brief specifies and, more importantly, has a distinct
 * mechanical character that the quality gate asserts rather than merely claiming:
 *
 *  - TIENDA      narrow, relentless slalom. Lowest widths, most linked corners, two floors.
 *  - ALMACÉN     speed. Widest road, two long straights, conveyor sections that push you along.
 *  - SERIGRAFÍA  environment. Spilled ink at 0.35 grip is the whole track; presses and steam.
 *  - OFICINAS    technical and chaotic. Tightest sections, carpet drag, most elevation changes.
 *  - MANGA       spectacle. The biggest jumps and the most route choices.
 *
 * Layouts are driven with the turtle from `path.ts`. Legs end at explicit global poses so the loop
 * closes exactly, and the closing join is itself a real corner rather than a smoothing artefact.
 */

// ---------------------------------------------------------------------------------- helpers

/** Landmarks spread evenly, since every circuit needs at least five for navigation. */
function landmarks(labels: readonly string[]): TrackFeature[] {
  return labels.map((label, index) => ({
    kind: "LANDMARK" as const,
    progress: (index + 0.5) / labels.length,
    side: index % 2 === 0 ? 1 : (-1 as -1 | 1),
    label,
  }));
}

function itemRows(progresses: readonly number[], lanes: number[] = [-4, 0, 4]): TrackFeature[] {
  return progresses.map((progress) => ({ kind: "ITEM_ROW" as const, progress, lanes }));
}

function boosts(progresses: readonly number[]): TrackFeature[] {
  return progresses.map((progress) => ({ kind: "BOOST" as const, progress, lane: 0 }));
}

// ---------------------------------------------------------------------------------- 1. TIENDA

/**
 * T-SHIRT MEGASTORE — narrow, relentless slalom.
 *
 * Route: shop window, entrance, display slalom, central stair up, upper floor, changing rooms,
 * stockroom, checkout, then a jump over the shop floor back to the line.
 *
 * The identity is width. Nothing on this circuit is wider than 14 m and the display aisles drop to
 * 10 m, so the drift has to be modulated rather than committed to — which is what makes it the
 * gentlest of the five to learn and the hardest to be tidy on.
 */
function tiendaPath(): TrackPath {
  // Footprint scale. Tuned so the lap lands inside the 2.5-5 km window without altering the layout.
  const S = 1.48;
  const path = new TrackPath({ x: 0, y: 0, z: 0, heading: 0 }, {
    width: 13,
    surface: "FLOOR_TILE",
    sector: 1,
  });

  // S1 — shop window and entrance. Wide enough to form up on the grid, then it pinches.
  path.straight(150 * S, { width: 14, note: "escaparate y meta" });
  path.driveTo({ x: 60 * S, z: 250 * S, heading: 70 }, 52, { width: 12.5, note: "entrada" });

  // S2 — the display slalom. Six linked corners at minimum width: the signature of the track.
  // It also dips through the aisles, which is the first of the lap's elevation changes.
  path.sector(2, { width: 10.5 });
  path.chicane(13, 74 * S, 1, { note: "expositores 1" });
  path.driveTo({ x: 200 * S, z: 320 * S, heading: 96, y: -3.5 }, 34, { note: "bajada al pasillo" });
  path.chicane(13, 74 * S, -1, { note: "expositores 2" });
  path.driveTo({ x: 300 * S, z: 300 * S, heading: 118, y: 0 }, 34, { note: "pasillo de camisetas" });
  path.chicane(11, 66 * S, 1, { note: "expositores 3" });

  // S3 — central stair to the upper floor, then the upper-floor loop.
  path.sector(3, { width: 12, surface: "WOOD" });
  path.driveTo({ x: 400 * S, z: 220 * S, heading: 175, y: 5 }, 42, { note: "escalera central" });
  path.straight(120 * S, { rise: 7.5, note: "subida" });
  path.spiral(150, 40, 3, { banking: 0.14, note: "planta superior" });
  path.driveTo({ x: 300 * S, z: 60 * S, heading: 250, y: 15 }, 44, { note: "balcón" });

  // S4 — changing rooms: the tightest passage on any of the five circuits.
  path.sector(4, { width: 10, surface: "CARPET" });
  path.driveTo({ x: 190 * S, z: 30 * S, heading: 268 }, 26, { note: "probadores" });
  path.chicane(9, 56 * S, -1, { note: "cabinas" });

  // S5 — stockroom, checkout, and the jump back down to the shop floor.
  path.sector(5, { width: 12.5, surface: "CONCRETE" });
  path.driveTo({ x: 60 * S, z: 90 * S, heading: 320, y: 15 }, 38, { note: "almacén interno" });
  path.straight(90 * S, { rise: -6, note: "rampa de cajas" });
  path.set({ surface: "FLOOR_TILE", width: 13.5 });
  path.straight(70 * S, { rise: -9, note: "salto sobre la tienda" });

  return path;
}

export const TiendaBlueprint: TrackBlueprint = (() => {
  const path = tiendaPath();
  path.closeWithArcs(46, { width: 14, note: "zona de cajas" });
  return {
    schemaVersion: 5,
    id: "tshirt-megastore",
    name: "T-Shirt Megastore",
    theme: "FLAGSHIP",
    recommendedLaps: 3,
    character: {
      summary: "Slalom estrecho entre expositores, en dos plantas. Premia la precisión, no el valor.",
      emphasis: "SLALOM",
    },
    controlPoints: path.build(),
    sectors: [
      { index: 1, name: "Escaparate", role: "INTRO" },
      { index: 2, name: "Expositores", role: "TECHNICAL" },
      { index: 3, name: "Planta alta", role: "SET_PIECE" },
      { index: 4, name: "Probadores", role: "TECHNICAL" },
      { index: 5, name: "Cajas", role: "CLIMAX" },
    ],
    features: [
      ...landmarks([
        "ESCAPARATE",
        "PARED DE CAMISETAS",
        "ESCALERA CENTRAL",
        "PROBADORES",
        "ALMACÉN",
        "CAJA REGISTRADORA",
      ]),
      ...boosts([0.16, 0.44, 0.72, 0.93]),
      { kind: "JUMP", progress: 0.9, lane: 0, power: 1 },
      { kind: "JUMP", progress: 0.55, lane: 0, power: 0.7 },
      ...itemRows([0.08, 0.3, 0.5, 0.68, 0.86]),
      { kind: "HAZARD", progress: 0.26, lane: 3, hazard: "CROWD_GATE" },
      { kind: "HAZARD", progress: 0.63, lane: -3, hazard: "FALLING_BOXES" },
      // Cutting the display aisle needs a drift held through a gap: skill, not equipment.
      { kind: "SHORTCUT", from: 0.24, to: 0.3, risk: "MEDIUM", access: "SKILL", label: "Entre expositores" },
      // The stockroom ramp only clears with a boost in hand.
      { kind: "SHORTCUT", from: 0.79, to: 0.85, risk: "HIGH", access: "ITEM", label: "Rampa de palets" },
      { kind: "SET_PIECE", progress: 0.42, label: "Escalera central a la planta alta" },
      { kind: "SET_PIECE", progress: 0.9, label: "Salto sobre la tienda" },
    ],
  };
})();

// ---------------------------------------------------------------------------------- 2. ALMACÉN

/**
 * WAREHOUSE EXPRESS — speed.
 *
 * Route: loading dock, pallet rows, racking aisles, upper ramp, walkways, picking, packing,
 * conveyor belts, box tunnel, back to the dock.
 *
 * The identity is top speed. The road is the widest of the five at up to 19 m, there are two
 * straights over 250 m, and the conveyor sections add 6 m/s of their own — so this is the circuit
 * where the boost chain matters most, because there is room to use it.
 */
function almacenPath(): TrackPath {
  const S = 1.15;
  const path = new TrackPath({ x: 0, y: 0, z: 0, heading: 0 }, {
    width: 18,
    surface: "CONCRETE",
    sector: 1,
  });

  // S1 — the dock. Wide, open, fast, and it drops into the building.
  path.straight(230 * S, { width: 19, note: "muelle de carga" });
  path.driveTo({ x: 110 * S, z: 380 * S, heading: 80, y: -4 }, 78, { note: "salida del muelle" });

  // S2 — the long racking straight. The fastest stretch in the game.
  path.sector(2, { width: 17 });
  path.straight(300 * S, { rise: 4, note: "pasillo de estanterías" });
  path.driveTo({ x: 470 * S, z: 330 * S, heading: 150, y: 0 }, 96, { note: "curva rápida de palets" });

  // S3 — up to the walkways, on metal.
  path.sector(3, { width: 15, surface: "METAL" });
  path.driveTo({ x: 470 * S, z: 200 * S, heading: 182, y: 9 }, 60, { note: "rampa superior" });
  path.straight(150 * S, { rise: 5, note: "pasarela" });
  path.spiral(-160, 46, -4, { banking: -0.15, note: "bajada de pasarela" });

  // S4 — picking and packing, then the conveyors that push you along.
  path.sector(4, { width: 14, surface: "CARDBOARD" });
  path.driveTo({ x: 330 * S, z: 90 * S, heading: 250, y: 0 }, 40, { note: "picking" });
  path.chicane(12, 82 * S, 1, { note: "packing" });
  path.set({ surface: "CONVEYOR", width: 13 });
  path.straight(130 * S, { note: "cintas transportadoras" });

  // S5 — box tunnel back to the dock.
  path.sector(5, { width: 16, surface: "CONCRETE" });
  path.driveTo({ x: 100 * S, z: 60 * S, heading: 320 }, 54, { note: "túnel de cajas" });

  return path;
}

export const AlmacenBlueprint: TrackBlueprint = (() => {
  const path = almacenPath();
  path.closeWithArcs(70, { width: 18, note: "retorno al muelle" });
  return {
    schemaVersion: 5,
    id: "warehouse-express",
    name: "Warehouse Express",
    theme: "WAREHOUSE",
    recommendedLaps: 3,
    character: {
      summary: "El circuito rápido. Rectas largas, pista ancha y cintas que empujan.",
      emphasis: "SPEED",
    },
    controlPoints: path.build(),
    sectors: [
      { index: 1, name: "Muelle", role: "INTRO" },
      { index: 2, name: "Estanterías", role: "SPEED" },
      { index: 3, name: "Pasarelas", role: "SET_PIECE" },
      { index: 4, name: "Picking", role: "TECHNICAL" },
      { index: 5, name: "Expedición", role: "CLIMAX" },
    ],
    features: [
      ...landmarks([
        "MUELLE 01",
        "TORRE DE PALETS",
        "ROBOT LOGÍSTICO",
        "PASARELA ALTA",
        "CINTA TURBO",
        "TÚNEL DE CAJAS",
        "PORTÓN",
      ]),
      ...boosts([0.12, 0.28, 0.46, 0.66, 0.88]),
      { kind: "JUMP", progress: 0.52, lane: 0, power: 1 },
      { kind: "JUMP", progress: 0.78, lane: 0, power: 0.8 },
      ...itemRows([0.06, 0.24, 0.42, 0.6, 0.82], [-6, 0, 6]),
      // A speed circuit needs moving obstacles, or the straights are free.
      { kind: "HAZARD", progress: 0.2, lane: -5, hazard: "FALLING_BOXES" },
      { kind: "HAZARD", progress: 0.35, lane: 5, hazard: "FORKLIFT" },
      { kind: "HAZARD", progress: 0.71, lane: 0, hazard: "FALLING_BOXES" },
      // Straight through the racking: no gate, just very fast and very narrow.
      { kind: "SHORTCUT", from: 0.3, to: 0.38, risk: "HIGH", access: "RISK", label: "Entre estanterías" },
      // Over the packing table, which needs a boost to reach.
      { kind: "SHORTCUT", from: 0.72, to: 0.78, risk: "MEDIUM", access: "ITEM", label: "Sobre la mesa de packing" },
      { kind: "SET_PIECE", progress: 0.5, label: "Pasarela elevada sobre el almacén" },
      { kind: "SET_PIECE", progress: 0.8, label: "Cintas transportadoras" },
    ],
  };
})();

// ---------------------------------------------------------------------------------- 3. SERIGRAFÍA

/**
 * INK & PRINT FACTORY — environment.
 *
 * Route: design desk, film positives, screens, the carousel press, ink store, drying tunnel,
 * quality control, packing.
 *
 * The identity is the floor. Spilled ink runs at 0.35 grip — the lowest surface in the game, less
 * than half of asphalt — so the track fights you where the others merely turn. Learning where the
 * ink is *is* learning this circuit, and the drift is almost free on it, which makes the chain
 * windows unusually reachable and unusually easy to throw away.
 */
function serigrafiaPath(): TrackPath {
  const S = 1.5;
  const path = new TrackPath({ x: 0, y: 0, z: 0, heading: 0 }, {
    width: 14,
    surface: "CONCRETE",
    sector: 1,
  });

  // S1 — design and film. Clean concrete, so the contrast with the ink lands later.
  path.straight(170 * S, { note: "mesa de diseño" });
  path.driveTo({ x: 90 * S, z: 290 * S, heading: 74 }, 50, { note: "fotolitos" });

  // S2 — the screen racks. Metal, tight, technical, and it drops into the press hall.
  path.sector(2, { width: 12.5, surface: "METAL" });
  path.straight(140 * S, { rise: -4, note: "pantallas" });
  path.chicane(11, 70 * S, 1, { note: "bastidores" });
  path.driveTo({ x: 380 * S, z: 290 * S, heading: 132, y: 0 }, 36, { note: "entrada al carrusel" });

  // S3 — around the carousel press, and into the ink. This is the track's whole point.
  path.sector(3, { width: 15, surface: "INK" });
  path.spiral(200, 44, 0, { banking: 0.12, note: "vuelta al carrusel" });
  path.driveTo({ x: 390 * S, z: 110 * S, heading: 205 }, 40, { note: "cubas de tinta" });
  path.chicane(13, 78 * S, -1, { note: "charcos de tinta" });

  // S4 — the drying tunnel: a climb on hot metal, back to grip.
  path.sector(4, { width: 13, surface: "METAL" });
  path.driveTo({ x: 250 * S, z: 60 * S, heading: 262, y: 7 }, 34, { note: "túnel de secado" });
  path.straight(130 * S, { rise: 5, note: "horno" });
  path.spiral(-150, 40, -6, { banking: -0.13, note: "salida del secador" });

  // S5 — control and packing, back down to grade.
  path.sector(5, { width: 14, surface: "CONCRETE" });
  path.driveTo({ x: 80 * S, z: 70 * S, heading: 322, y: 0 }, 44, { note: "control de calidad" });

  return path;
}

export const SerigrafiaBlueprint: TrackBlueprint = (() => {
  const path = serigrafiaPath();
  path.closeWithArcs(48, { note: "packing" });
  return {
    schemaVersion: 5,
    id: "ink-print-factory",
    name: "Ink & Print Factory",
    theme: "PRINT_FACTORY",
    recommendedLaps: 3,
    character: {
      summary: "Mecánicas ambientales. La tinta derramada agarra a 0,35 y decide la carrera.",
      emphasis: "ENVIRONMENT",
    },
    controlPoints: path.build(),
    sectors: [
      { index: 1, name: "Diseño", role: "INTRO" },
      { index: 2, name: "Pantallas", role: "TECHNICAL" },
      { index: 3, name: "Tinta", role: "SET_PIECE" },
      { index: 4, name: "Secado", role: "SPEED" },
      { index: 5, name: "Control", role: "CLIMAX" },
    ],
    features: [
      ...landmarks([
        "MESA DE DISEÑO",
        "FOTOLITOS",
        "CARRUSEL",
        "CUBAS DE TINTA",
        "TÚNEL UV",
        "SECADOR",
        "CONTROL",
      ]),
      ...boosts([0.14, 0.4, 0.63, 0.86]),
      { kind: "JUMP", progress: 0.58, lane: 0, power: 0.9 },
      { kind: "JUMP", progress: 0.82, lane: 0, power: 0.7 },
      ...itemRows([0.07, 0.26, 0.45, 0.66, 0.88]),
      // The presses are the interactive element the brief asks for.
      { kind: "HAZARD", progress: 0.22, lane: 0, hazard: "PRESS" },
      { kind: "HAZARD", progress: 0.44, lane: -4, hazard: "PRESS" },
      { kind: "HAZARD", progress: 0.5, lane: 4, hazard: "STEAM" },
      { kind: "HAZARD", progress: 0.75, lane: 0, hazard: "STEAM" },
      // Straight across the ink pool: shorter, and almost no grip.
      { kind: "SHORTCUT", from: 0.46, to: 0.53, risk: "HIGH", access: "RISK", label: "Cruzar el charco" },
      // Through the carousel itself, which needs a precise line at speed.
      { kind: "SHORTCUT", from: 0.34, to: 0.4, risk: "MEDIUM", access: "SKILL", label: "Bajo el carrusel" },
      { kind: "SET_PIECE", progress: 0.36, label: "Vuelta completa al carrusel de serigrafía" },
      { kind: "SET_PIECE", progress: 0.7, label: "Túnel de secado" },
    ],
  };
})();

// ---------------------------------------------------------------------------------- 4. OFICINAS

/**
 * OFFICE CHAOS — technical and chaotic.
 *
 * Route: reception, open office, across the desks, over a keyboard, past the monitors, meeting
 * room, kitchen, corridor, a jump between desks, back to reception.
 *
 * The identity is that the karts are small and the furniture is not. This has the most corners and
 * the most elevation changes of the five, because the route keeps climbing onto desks and dropping
 * back to the carpet — and carpet has the highest drag in the game, so momentum lost here is
 * expensive to rebuild.
 */
function oficinasPath(): TrackPath {
  // The largest scale of the five: the office footprint is small because the karts are tiny
  // relative to the furniture, so it needs the most stretching to reach a full lap distance.
  const S = 2.05;
  const path = new TrackPath({ x: 0, y: 0, z: 0, heading: 0 }, {
    width: 12,
    surface: "FLOOR_TILE",
    sector: 1,
  });

  // S1 — reception.
  path.straight(140 * S, { width: 13, note: "recepción" });
  path.driveTo({ x: 70 * S, z: 230 * S, heading: 76 }, 44, { width: 11.5, note: "acceso open office" });

  // S2 — open office on carpet, weaving between the desk islands.
  path.sector(2, { width: 11, surface: "CARPET" });
  path.chicane(10, 62 * S, 1, { note: "islas de escritorios" });
  path.driveTo({ x: 260 * S, z: 250 * S, heading: 120 }, 30, { note: "pasillo central" });
  path.chicane(9, 58 * S, -1, { note: "más escritorios" });

  // S3 — up onto the desks. Wood, and the biggest height change on the circuit.
  path.sector(3, { width: 10.5, surface: "WOOD" });
  path.driveTo({ x: 380 * S, z: 230 * S, heading: 168, y: 6 }, 32, { note: "subida al escritorio" });
  path.straight(100 * S, { rise: 4, note: "sobre el teclado" });
  path.driveTo({ x: 360 * S, z: 90 * S, heading: 214, y: 10 }, 30, { note: "entre monitores" });

  // S4 — over reception at desk height, then down to the meeting room and the kitchen.
  path.sector(4, { width: 12, surface: "WOOD" });
  // This leg passes directly over the start straight ten metres up: the circuit's crossover.
  path.driveTo({ x: 10 * S, z: 175 * S, heading: 250, y: 10 }, 44, { note: "pasarela sobre recepción" });
  path.set({ surface: "CARPET" });
  path.driveTo({ x: 230 * S, z: 40 * S, heading: 258, y: 2 }, 40, { note: "sala de reuniones" });
  path.chicane(9, 54 * S, 1, { note: "sillas" });
  path.driveTo({ x: 120 * S, z: 40 * S, heading: 282, y: 0 }, 28, { note: "cocina" });

  // S5 — corridor and the jump between desks.
  path.sector(5, { width: 11.5, surface: "FLOOR_TILE" });
  path.straight(80 * S, { rise: 3, note: "pasillo" });
  path.straight(60 * S, { rise: -3, note: "salto entre mesas" });

  return path;
}

export const OficinasBlueprint: TrackBlueprint = (() => {
  const path = oficinasPath();
  path.closeWithArcs(38, { width: 13, note: "vuelta a recepción" });
  return {
    schemaVersion: 5,
    id: "office-chaos",
    name: "Office Chaos",
    theme: "OFFICE",
    recommendedLaps: 3,
    character: {
      summary: "Técnico y caótico. El más estrecho, el de más curvas y más cambios de altura.",
      emphasis: "TECHNICAL",
    },
    controlPoints: path.build(),
    sectors: [
      { index: 1, name: "Recepción", role: "INTRO" },
      { index: 2, name: "Open office", role: "TECHNICAL" },
      { index: 3, name: "Escritorios", role: "SET_PIECE" },
      { index: 4, name: "Sala y cocina", role: "TECHNICAL" },
      { index: 5, name: "Pasillo", role: "CLIMAX" },
    ],
    features: [
      ...landmarks([
        "RECEPCIÓN",
        "MONITOR GIGANTE",
        "TECLADO",
        "TAZA XL",
        "SALA DE REUNIONES",
        "CAFETERA",
      ]),
      ...boosts([0.18, 0.42, 0.6, 0.84, 0.95]),
      { kind: "JUMP", progress: 0.92, lane: 0, power: 1 },
      { kind: "JUMP", progress: 0.48, lane: 0, power: 0.6 },
      ...itemRows([0.1, 0.3, 0.52, 0.72, 0.9], [-3, 0, 3]),
      { kind: "HAZARD", progress: 0.24, lane: 3, hazard: "OFFICE_CHAIRS" },
      { kind: "HAZARD", progress: 0.66, lane: -3, hazard: "OFFICE_CHAIRS" },
      { kind: "HAZARD", progress: 0.78, lane: 0, hazard: "PRINTER" },
      // Straight over the desk instead of round it: needs a clean jump.
      { kind: "SHORTCUT", from: 0.5, to: 0.56, risk: "MEDIUM", access: "SKILL", label: "Sobre el escritorio" },
      // Under the meeting table, which is tight enough to be genuinely dangerous.
      { kind: "SHORTCUT", from: 0.68, to: 0.73, risk: "HIGH", access: "RISK", label: "Bajo la mesa de reuniones" },
      { kind: "SET_PIECE", progress: 0.55, label: "Ruta sobre los escritorios y el teclado" },
      { kind: "SET_PIECE", progress: 0.92, label: "Salto entre mesas" },
    ],
  };
})();

// ---------------------------------------------------------------------------------- 5. MANGA

/**
 * MANGA MEGA CON — spectacle.
 *
 * Route: entrance arch, artist alley, stands, cosplay walkway, arcades, food court, main stage,
 * upper gantry, merch, finish.
 *
 * The identity is scale and choice. It has the biggest jumps, the most alternate routes, and the
 * only three-way decision on any of the five circuits — over the stage, round the stands or under
 * the gantry — which is what makes it the one worth racing last.
 */
function mangaPath(): TrackPath {
  const S = 1.38;
  const path = new TrackPath({ x: 0, y: 0, z: 0, heading: 0 }, {
    width: 16,
    surface: "CARPET",
    sector: 1,
  });

  // S1 — entrance and artist alley.
  path.straight(190 * S, { width: 17, note: "arco de entrada" });
  path.driveTo({ x: 100 * S, z: 340 * S, heading: 78 }, 62, { width: 15, note: "artist alley" });

  // S2 — the stand aisles, then a fast run past the arcades. Dips through the food court.
  path.sector(2, { width: 14, surface: "CONCRETE" });
  path.straight(220 * S, { note: "pasillo de stands" });
  path.chicane(12, 80 * S, 1, { note: "cosplay plaza" });
  path.driveTo({ x: 470 * S, z: 330 * S, heading: 146, y: -5 }, 88, { note: "arcades" });

  // S3 — up the gantry over the hall. The big set-piece.
  path.sector(3, { width: 15, surface: "METAL" });
  path.driveTo({ x: 490 * S, z: 190 * S, heading: 186, y: 11 }, 54, { note: "subida a pasarela" });
  path.straight(170 * S, { rise: 7, note: "pasarela superior" });
  path.spiral(-165, 48, -5, { banking: -0.16, note: "bajada al escenario" });

  // S4 — the stage. Widest point on any circuit, and the jump off the front.
  path.sector(4, { width: 20, surface: "WOOD" });
  path.driveTo({ x: 330 * S, z: 70 * S, heading: 248, y: 4 }, 46, { note: "escenario" });
  path.straight(110 * S, { rise: -8, note: "salto del escenario" });

  // S5 — food court and merch back to the line.
  path.sector(5, { width: 16, surface: "CARPET" });
  path.driveTo({ x: 110 * S, z: 60 * S, heading: 318, y: 0 }, 56, { note: "merch" });

  return path;
}

export const MangaBlueprint: TrackBlueprint = (() => {
  const path = mangaPath();
  path.closeWithArcs(58, { width: 17, note: "recta de meta" });
  return {
    schemaVersion: 5,
    id: "manga-mega-con",
    name: "Manga Mega Con",
    theme: "MANGA",
    recommendedLaps: 3,
    character: {
      summary: "Espectáculo. Los saltos más grandes y la única decisión de tres rutas.",
      emphasis: "SPECTACLE",
    },
    controlPoints: path.build(),
    sectors: [
      { index: 1, name: "Entrada", role: "INTRO" },
      { index: 2, name: "Artist alley", role: "SPEED" },
      { index: 3, name: "Pasarela", role: "SET_PIECE" },
      { index: 4, name: "Escenario", role: "SET_PIECE" },
      { index: 5, name: "Merch", role: "CLIMAX" },
    ],
    features: [
      ...landmarks([
        "ARCO DE ENTRADA",
        "ARTIST ALLEY",
        "PANTALLA GIGANTE",
        "PASARELA COSPLAY",
        "ARCADES",
        "ESCENARIO",
        "MERCH",
      ]),
      ...boosts([0.1, 0.3, 0.5, 0.7, 0.9]),
      { kind: "JUMP", progress: 0.76, lane: 0, power: 1.3 },
      { kind: "JUMP", progress: 0.55, lane: 0, power: 1 },
      { kind: "JUMP", progress: 0.34, lane: 0, power: 0.7 },
      ...itemRows([0.06, 0.22, 0.4, 0.58, 0.76, 0.92], [-6, -2, 2, 6]),
      { kind: "HAZARD", progress: 0.28, lane: 4, hazard: "CROWD_GATE" },
      { kind: "HAZARD", progress: 0.62, lane: -4, hazard: "CROWD_GATE" },
      // The three-way decision the circuit is built around.
      { kind: "SHORTCUT", from: 0.44, to: 0.5, risk: "MEDIUM", access: "SKILL", label: "Sobre el escenario" },
      { kind: "SHORTCUT", from: 0.24, to: 0.29, risk: "LOW", access: "ITEM", label: "Entre stands" },
      { kind: "SHORTCUT", from: 0.66, to: 0.72, risk: "HIGH", access: "RISK", label: "Bajo la pasarela" },
      { kind: "SET_PIECE", progress: 0.6, label: "Pasarela superior sobre el pabellón" },
      { kind: "SET_PIECE", progress: 0.78, label: "Salto desde el escenario" },
    ],
  };
})();

// ---------------------------------------------------------------------------------- registry

export const CircuitBlueprints: readonly TrackBlueprint[] = [
  TiendaBlueprint,
  AlmacenBlueprint,
  SerigrafiaBlueprint,
  OficinasBlueprint,
  MangaBlueprint,
];

let baked: BakedTrack[] | null = null;

/** The five shipped circuits, baked once and shared. */
export function getCircuits(): readonly BakedTrack[] {
  baked ??= CircuitBlueprints.map(bakeTrack);
  return baked;
}

export function getCircuit(id: string): BakedTrack {
  return getCircuits().find((track) => track.blueprint.id === id) ?? getCircuits()[0]!;
}
