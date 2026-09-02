import { bakeTrack, type BakedTrack, type TrackBlueprint, type TrackFeature, type TrackSectorSpec } from "../blueprint.js";
import type { SurfaceName } from "../config.js";
import { TrackPath } from "../path.js";

/**
 * Seeded circuit generation.
 *
 * This is no longer the source of the five shipped circuits — those are hand-authored in
 * `circuits.ts`, because a generator produced five variations of one layout, which is the reskin the
 * brief rules out.
 *
 * What it is still for: the Circuit Factory. A designer picks a theme, rolls a seed and gets a new
 * playable circuit at V5 scale to iterate on, without hand-placing control points first.
 */

export type TrackTheme = "FLAGSHIP" | "WAREHOUSE" | "PRINT_FACTORY" | "OFFICE" | "MANGA";

type ThemeData = {
  name: string;
  /** One surface per sector. */
  surfaces: readonly [SurfaceName, SurfaceName, SurfaceName, SurfaceName, SurfaceName];
  sectors: readonly [string, string, string, string, string];
  landmarks: readonly string[];
  hazard: string;
  /** Metres. Bigger themes get bigger footprints. */
  scale: number;
};

const THEMES: Record<TrackTheme, ThemeData> = {
  FLAGSHIP: {
    name: "T-Shirt Megastore",
    surfaces: ["FLOOR_TILE", "FLOOR_TILE", "WOOD", "CONCRETE", "FLOOR_TILE"],
    sectors: ["Escaparate", "Planta baja", "Planta alta", "Almacén interno", "Cajas y meta"],
    landmarks: ["ESCAPARATE", "PARED DE CAMISETAS", "ESCALERA CENTRAL", "PROBADORES", "PASILLO DE PALETS", "CAJA REGISTRADORA", "ARCO DE META"],
    hazard: "CROWD_GATE",
    scale: 1,
  },
  WAREHOUSE: {
    name: "Warehouse Express",
    surfaces: ["CONCRETE", "CONCRETE", "METAL", "CARDBOARD", "CONCRETE"],
    sectors: ["Muelle", "Estanterías", "Pasarelas", "Picking y packing", "Expedición"],
    landmarks: ["MUELLE 01", "TORRE DE PALETS", "ROBOT LOGÍSTICO", "PASARELA ALTA", "CINTA TRANSPORTADORA", "TÚNEL DE CAJAS", "PORTÓN"],
    hazard: "FALLING_BOXES",
    scale: 1.08,
  },
  PRINT_FACTORY: {
    name: "Ink & Print Factory",
    surfaces: ["CONCRETE", "METAL", "INK", "METAL", "CONCRETE"],
    sectors: ["Diseño", "Pantallas", "Tinta", "Túnel de secado", "Control y packing"],
    landmarks: ["MESA DE DISEÑO", "FOTOLITOS", "CARRUSEL", "CUBAS DE TINTA", "TÚNEL UV", "SECADOR", "CONTROL"],
    hazard: "PRESS",
    scale: 1.02,
  },
  OFFICE: {
    name: "Office Chaos",
    surfaces: ["CARPET", "WOOD", "WOOD", "CARPET", "FLOOR_TILE"],
    sectors: ["Recepción", "Open office", "Escritorios", "Sala y cocina", "Pasillo final"],
    landmarks: ["RECEPCIÓN", "MONITOR GIGANTE", "TECLADO", "TAZA XL", "SALA DE REUNIONES", "CAFETERA", "PLANTA"],
    hazard: "OFFICE_CHAIRS",
    scale: 0.99,
  },
  MANGA: {
    name: "Manga Mega Con",
    surfaces: ["CARPET", "CONCRETE", "WOOD", "METAL", "CARPET"],
    sectors: ["Entrada", "Artist alley", "Cosplay y arcades", "Escenario", "Merch y meta"],
    landmarks: ["ARCO DE ENTRADA", "ARTIST ALLEY", "PANTALLA GIGANTE", "PASARELA COSPLAY", "ARCADES", "ESCENARIO", "MERCH"],
    hazard: "CROWD_GATE",
    scale: 1.12,
  },
};

/** Small deterministic PRNG so a seed always produces the same circuit. */
class Seeded {
  private state: number;
  constructor(seed: number) {
    this.state = (seed >>> 0) || 1;
  }
  next(): number {
    this.state ^= this.state << 13;
    this.state ^= this.state >>> 17;
    this.state ^= this.state << 5;
    return ((this.state >>> 0) % 1_000_000) / 1_000_000;
  }
  range(min: number, max: number): number {
    return min + this.next() * (max - min);
  }
  pick<T>(values: readonly T[]): T {
    return values[Math.floor(this.next() * values.length)]!;
  }
}

export type ThemedTrackConfig = {
  id: string;
  theme: TrackTheme;
  seed: number;
  /** Overrides the theme's display name. */
  name?: string;
  /** Base road width in metres. */
  width?: number;
};

/**
 * The layout template. A ring with four main corners plus an overpass excursion through the middle,
 * which is what produces both the length and the crossover. Seeded variation moves the leg lengths,
 * corner radii and the side the excursion loops to, so the five circuits do not read as one shape.
 */
function buildBlueprint(config: ThemedTrackConfig): TrackBlueprint {
  const theme = THEMES[config.theme];
  const random = new Seeded(config.seed);
  const scale = theme.scale;
  const width = config.width ?? 14.5;

  // Footprint corners, jittered per seed.
  const east = Math.round(random.range(365, 430) * scale);
  const north = Math.round(random.range(315, 375) * scale);
  const mirror = random.next() > 0.5 ? 1 : -1;

  const path = new TrackPath({ x: 0, y: 0, z: 0, heading: 0 }, {
    width,
    surface: theme.surfaces[0],
    sector: 1,
  });

  // -------------------------------------------------------------- S1 the approach and start line
  path.straight(Math.round(random.range(180, 235) * scale), { note: "start-finish" });

  // -------------------------------------------------------------- S2 speed
  path.sector(2, { width: width * 1.18, surface: theme.surfaces[1] });
  path.driveTo({ x: Math.round(north * 0.22), z: north, heading: 90 }, random.range(55, 72), { note: "turn 1" });
  path.straight(Math.round(random.range(245, 315) * scale), { note: "long straight" });
  path.driveTo({ x: east, z: Math.round(north * 0.82), heading: 145 }, random.range(100, 140), { note: "sweeper" });
  path.set({ width });
  path.driveTo({ x: Math.round(east * 0.9), z: Math.round(north * 0.66), heading: 335 }, random.range(24, 32), { note: "hairpin" });

  // -------------------------------------------------------------- S4 set piece: climb and overpass
  const climb = random.range(7, 11);
  path.sector(4, { width: width * 1.05, surface: theme.surfaces[3] });
  path.driveTo({ x: Math.round(east * 0.7), z: Math.round(north * 0.82), heading: 270, y: climb * 0.6 }, random.range(42, 56), { note: "ramp entry" });
  path.straight(Math.round(random.range(170, 220) * scale), { rise: climb, note: "climb" });
  path.spiral(-170 * mirror, random.range(40, 50), climb * 0.45, { banking: -0.16 * mirror, note: "upper spiral" });
  path.straight(Math.round(random.range(150, 200) * scale), { rise: -2, note: "crossover" });
  path.spiral(170 * mirror, random.range(42, 52), -climb * 0.55, { banking: 0.15 * mirror, note: "descent spiral" });
  path.driveTo({ x: Math.round(east * 0.82), z: Math.round(north * 0.3), heading: 200, y: 0 }, random.range(46, 58), { note: "back to grade" });

  // -------------------------------------------------------------- S3 technical
  const dip = -random.range(3, 6);
  path.sector(3, { width: width * 0.86, surface: theme.surfaces[2] });
  path.driveTo({ x: Math.round(east * 0.62), z: Math.round(north * 0.13), heading: 250, y: dip }, random.range(30, 38), { note: "S entry" });
  path.driveTo({ x: Math.round(east * 0.4), z: Math.round(north * 0.23), heading: 290, y: 0 }, random.range(30, 38), { note: "S exit" });
  path.driveTo({ x: Math.round(east * 0.26), z: Math.round(north * 0.11), heading: 235 }, random.range(34, 44), { note: "double apex" });
  path.driveTo({ x: Math.round(east * 0.16), z: Math.round(north * 0.2), heading: 300 }, random.range(24, 32), { note: "double apex exit" });
  path.chicane(random.range(8, 12), random.range(60, 84), 1, { note: "chicane" });

  // -------------------------------------------------------------- S5 climax
  path.sector(5, { width: width * 1.12, surface: theme.surfaces[4] });
  path.set({ banking: 0.18 });
  path.closeWithArcs(random.range(52, 68), { note: "climax" });

  const sectors: TrackSectorSpec[] = [
    { index: 1, name: theme.sectors[0], role: "INTRO" },
    { index: 2, name: theme.sectors[1], role: "SPEED" },
    { index: 3, name: theme.sectors[2], role: "TECHNICAL" },
    { index: 4, name: theme.sectors[3], role: "SET_PIECE" },
    { index: 5, name: theme.sectors[4], role: "CLIMAX" },
  ];

  const features: TrackFeature[] = [
    ...theme.landmarks.map((label, index): TrackFeature => ({
      kind: "LANDMARK",
      progress: (index + 0.5) / theme.landmarks.length,
      side: index % 2 === 0 ? 1 : -1,
      label,
    })),
    { kind: "BOOST", progress: 0.13, lane: 0 },
    { kind: "BOOST", progress: 0.34, lane: random.pick([-3, 0, 3]) },
    { kind: "BOOST", progress: 0.62, lane: 0 },
    { kind: "BOOST", progress: 0.87, lane: 0 },
    { kind: "JUMP", progress: 0.57, lane: 0, power: 1 },
    { kind: "JUMP", progress: 0.79, lane: 0, power: 0.8 },
    { kind: "ITEM_ROW", progress: 0.07, lanes: [-4, 0, 4] },
    { kind: "ITEM_ROW", progress: 0.27, lanes: [-4, 0, 4] },
    { kind: "ITEM_ROW", progress: 0.48, lanes: [-4, 4] },
    { kind: "ITEM_ROW", progress: 0.69, lanes: [-4, 0, 4] },
    { kind: "ITEM_ROW", progress: 0.92, lanes: [-4, 0, 4] },
    { kind: "HAZARD", progress: 0.31, lane: random.pick([-3, 3]), hazard: theme.hazard },
    { kind: "HAZARD", progress: 0.72, lane: random.pick([-3, 3]), hazard: theme.hazard },
    { kind: "SHORTCUT", from: 0.36, to: 0.42, risk: "MEDIUM", access: "SKILL", label: "Corte técnico" },
    { kind: "SHORTCUT", from: 0.82, to: 0.87, risk: "HIGH", access: "RISK", label: "Atajo arriesgado" },
    { kind: "SET_PIECE", progress: 0.5, label: `${theme.sectors[3]}: rampa y espiral` },
    { kind: "SET_PIECE", progress: 0.56, label: "Cruce a distinta altura" },
  ];

  return {
    schemaVersion: 5,
    id: config.id,
    name: config.name ?? theme.name,
    theme: config.theme,
    recommendedLaps: 3,
    character: {
      summary: `Circuito generado por semilla sobre la plantilla de ${theme.name}.`,
      emphasis: "TECHNICAL",
    },
    controlPoints: path.build(),
    sectors,
    features,
  };
}

export function generateThemedTrack(config: ThemedTrackConfig): BakedTrack {
  return bakeTrack(buildBlueprint(config));
}

export const ThemedTrackConfigs: readonly ThemedTrackConfig[] = [
  { id: "tshirt-megastore", theme: "FLAGSHIP", seed: 730_141 },
  { id: "warehouse-express", theme: "WAREHOUSE", seed: 818_207 },
  { id: "ink-print-factory", theme: "PRINT_FACTORY", seed: 929_353 },
  { id: "office-chaos", theme: "OFFICE", seed: 441_719 },
  { id: "manga-mega-con", theme: "MANGA", seed: 606_683 },
];

let presets: BakedTrack[] | null = null;

/** The five circuits, baked once and shared. */
export function getThemedTracks(): readonly BakedTrack[] {
  presets ??= ThemedTrackConfigs.map(generateThemedTrack);
  return presets;
}

export function getThemedTrack(id: string): BakedTrack {
  return getThemedTracks().find((track) => track.blueprint.id === id) ?? getThemedTracks()[0]!;
}

export function themeDisplayName(theme: TrackTheme): string {
  return THEMES[theme].name;
}
