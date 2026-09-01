import type { TrackDefinition, TrackPoint } from "@print-rush/game-core";

export type TrackTheme = "FLAGSHIP" | "WAREHOUSE" | "PRINT_FACTORY" | "OFFICE" | "MANGA";
export type TrackSurface = "ASPHALT" | "CARDBOARD" | "METAL" | "WOOD" | "INK";
export type TrackHazard = "NONE" | "FALLING_BOXES" | "PRESS" | "OFFICE_CHAIRS" | "CROWD_GATE";

export type TrackConfig = {
  id: string;
  name: string;
  seed: number;
  radiusX: number;
  radiusZ: number;
  width: number;
  complexity: number;
  theme: TrackTheme;
  elevation: number;
  banking: number;
};

export type TrackSegment = {
  index: number;
  progress: number;
  sector: 1 | 2 | 3 | 4 | 5;
  width: number;
  banking: number;
  elevation: number;
  surface: TrackSurface;
  speedProfile: "TECHNICAL" | "FLOW" | "FAST";
  hazard: TrackHazard;
  decorationTheme: TrackTheme;
};

export type TrackLandmark = {
  id: string;
  label: string;
  progress: number;
  color: string;
  side: -1 | 1;
};

export type TrackShortcut = {
  id: string;
  startProgress: number;
  endProgress: number;
  risk: "LOW" | "MEDIUM" | "HIGH";
};

export type TrackMetrics = {
  lengthMeters: number;
  averageWidth: number;
  maxElevation: number;
  technicality: number;
  estimatedLapSeconds: number;
};

export type StoredTrack = {
  schemaVersion: 4;
  generatorVersion: "4.0.0";
  config: TrackConfig;
  definition: TrackDefinition;
  segments: TrackSegment[];
  landmarks: TrackLandmark[];
  shortcuts: TrackShortcut[];
  metrics: TrackMetrics;
};

const ACTIVE_TRACK = "print-rush.active-track.v4";
const TRACK_LIBRARY = "print-rush.tracks.v4";

const THEME_DATA: Record<TrackTheme, {
  surfaces: readonly TrackSurface[];
  hazard: TrackHazard;
  landmarks: readonly [string, string, -1 | 1][];
}> = {
  FLAGSHIP: {
    surfaces: ["ASPHALT", "WOOD", "ASPHALT", "INK", "ASPHALT"],
    hazard: "CROWD_GATE",
    landmarks: [["CAMISETA GIGANTE", "#ff3da6", 1], ["CAJA CENTRAL", "#b9ff45", -1], ["PROBADORES", "#65d8ff", 1], ["ESCAPARATE", "#ffd43b", -1], ["META NEÓN", "#ff3da6", 1]],
  },
  WAREHOUSE: {
    surfaces: ["ASPHALT", "CARDBOARD", "METAL", "ASPHALT", "CARDBOARD"],
    hazard: "FALLING_BOXES",
    landmarks: [["MUELLE 01", "#ffb547", -1], ["TORRE DE CAJAS", "#ff623d", 1], ["CINTA TURBO", "#b9ff45", -1], ["PASILLO FRÍO", "#65d8ff", 1], ["DESPACHO", "#ffb547", -1]],
  },
  PRINT_FACTORY: {
    surfaces: ["METAL", "INK", "ASPHALT", "METAL", "INK"],
    hazard: "PRESS",
    landmarks: [["PULPO DE TINTA", "#8f5cff", 1], ["PRENSA V4", "#ff3da6", -1], ["TÚNEL UV", "#65d8ff", 1], ["SECADOR", "#ff7b2f", -1], ["MESA XL", "#b9ff45", 1]],
  },
  OFFICE: {
    surfaces: ["WOOD", "ASPHALT", "CARDBOARD", "WOOD", "ASPHALT"],
    hazard: "OFFICE_CHAIRS",
    landmarks: [["RECEPCIÓN", "#65d8ff", -1], ["SALA CREATIVA", "#ff3da6", 1], ["CAFÉ TURBO", "#ffb547", -1], ["SERVIDORES", "#8f5cff", 1], ["DESPACHO FINAL", "#b9ff45", -1]],
  },
  MANGA: {
    surfaces: ["ASPHALT", "WOOD", "INK", "ASPHALT", "METAL"],
    hazard: "CROWD_GATE",
    landmarks: [["ARCO MANGA", "#ff3da6", 1], ["ARCADE ALLEY", "#65d8ff", -1], ["ESCENARIO", "#8f5cff", 1], ["COSPLAY PLAZA", "#ffd43b", -1], ["BOSS GATE", "#ff623d", 1]],
  },
};

export function generateTrack(config: TrackConfig, segments = 240): StoredTrack {
  const count = Math.max(160, Math.round(segments / 5) * 5);
  const phase = ((config.seed % 997) / 997) * Math.PI * 2;
  const theme = THEME_DATA[config.theme];
  const spline: TrackPoint[] = Array.from({ length: count }, (_, index) => {
    const progress = index / count;
    const angle = -Math.PI / 2 + progress * Math.PI * 2;
    const primary = Math.sin(angle * 3 + phase) * config.complexity * .11;
    const secondary = Math.sin(angle * 7 - phase * .6) * config.complexity * .045;
    const wave = 1 + primary + secondary;
    const elevation = Math.sin(angle * 2 + phase) * config.elevation * .62 + Math.sin(angle * 5 - phase) * config.elevation * .19;
    return { x: Math.cos(angle) * config.radiusX * wave, y: elevation, z: Math.sin(angle) * config.radiusZ * wave, progress };
  });
  const checkpointIndexes = [1, 2, 3, 4, 0].map((sector) => Math.floor(count * sector / 5) % count);
  const checkpoints = checkpointIndexes.map((index) => spline[index]!);
  const recoveryPoints = checkpointIndexes.map((index) => {
    const point = spline[index]!;
    const next = spline[(index + 1) % spline.length]!;
    return { position: { ...point, y: point.y + .75 }, rotation: Math.atan2(next.x - point.x, next.z - point.z) };
  });
  const start = spline[0]!;
  const startNext = spline[1]!;
  const startRotation = Math.atan2(startNext.x - start.x, startNext.z - start.z);
  const forward = { x: Math.sin(startRotation), z: Math.cos(startRotation) };
  const normal = { x: -forward.z, z: forward.x };
  const definition: TrackDefinition = {
    id: config.id,
    name: config.name,
    recommendedLaps: 3,
    racingSpline: spline,
    checkpoints,
    recoveryPoints,
    spawnPoints: [0, 1, 2, 3].map((slot) => {
      const row = Math.floor(slot / 2);
      const lane = slot % 2 === 0 ? -.8 : .8;
      const behind = 2.2 + row * 3;
      return { position: { x: start.x - forward.x * behind + normal.x * lane, y: start.y + .75, z: start.z - forward.z * behind + normal.z * lane }, rotation: startRotation };
    }),
    bounds: { minX: -config.radiusX - 24, maxX: config.radiusX + 24, minZ: -config.radiusZ - 24, maxZ: config.radiusZ + 24 },
  };
  const segmentData: TrackSegment[] = spline.map((point, index) => {
    const sector = (Math.floor(point.progress * 5) + 1) as TrackSegment["sector"];
    const sectorPhase = (point.progress * 5) % 1;
    const widthPulse = Math.sin(sectorPhase * Math.PI * 2 + phase) * .45 * config.complexity;
    return {
      index,
      progress: point.progress,
      sector,
      width: Math.max(8, config.width + widthPulse - (sector === 2 ? .45 : 0)),
      banking: Math.sin(point.progress * Math.PI * 8 + phase) * config.banking,
      elevation: point.y,
      surface: theme.surfaces[sector - 1]!,
      speedProfile: sector === 2 || sector === 4 ? "TECHNICAL" : sector === 3 ? "FAST" : "FLOW",
      hazard: index === Math.floor(((sector - 1) + .62) * count / 5) ? theme.hazard : "NONE",
      decorationTheme: config.theme,
    };
  });
  const landmarks = theme.landmarks.map(([label, color, side], index) => ({ id: `${config.id}-landmark-${index + 1}`, label, color, side, progress: (index + .48) / 5 }));
  const shortcuts: TrackShortcut[] = [
    { id: `${config.id}-shortcut-a`, startProgress: .285, endProgress: .35, risk: "MEDIUM" },
    { id: `${config.id}-shortcut-b`, startProgress: .675, endProgress: .735, risk: config.complexity > .7 ? "HIGH" : "LOW" },
  ];
  return { schemaVersion: 4, generatorVersion: "4.0.0", config, definition, segments: segmentData, landmarks, shortcuts, metrics: measureTrack(definition, segmentData) };
}

export function measureTrack(definition: TrackDefinition, segments: TrackSegment[]): TrackMetrics {
  let lengthMeters = 0;
  definition.racingSpline.forEach((point, index) => {
    const next = definition.racingSpline[(index + 1) % definition.racingSpline.length]!;
    lengthMeters += Math.hypot(next.x - point.x, next.y - point.y, next.z - point.z);
  });
  const averageWidth = segments.reduce((sum, segment) => sum + segment.width, 0) / Math.max(1, segments.length);
  const maxElevation = Math.max(...definition.racingSpline.map((point) => Math.abs(point.y)));
  const technicality = Math.round((segments.filter((segment) => segment.speedProfile === "TECHNICAL").length / Math.max(1, segments.length)) * 100);
  return { lengthMeters: Math.round(lengthMeters), averageWidth: Number(averageWidth.toFixed(1)), maxElevation: Number(maxElevation.toFixed(1)), technicality, estimatedLapSeconds: Math.round(lengthMeters / 21) };
}

export function validateTrack(track: StoredTrack): string[] {
  const issues: string[] = [];
  if (track.definition.racingSpline.length < 160) issues.push("El circuito necesita al menos 160 muestras.");
  if (track.metrics.lengthMeters < 220) issues.push("El circuito es demasiado corto para V4.");
  if (track.metrics.averageWidth < 8) issues.push("Hay tramos demasiado estrechos.");
  if (track.definition.checkpoints.length !== 5) issues.push("Deben existir cinco sectores comprobables.");
  if (track.landmarks.length !== 5) issues.push("Cada sector necesita un landmark.");
  return issues;
}

const PRESET_CONFIGS: readonly TrackConfig[] = [
  { id: "tshirt-store-gp", name: "T-Shirt Store Grand Prix", seed: 7301, radiusX: 58, radiusZ: 39, width: 11.2, complexity: .42, theme: "FLAGSHIP", elevation: 2.1, banking: .08 },
  { id: "warehouse-mayhem", name: "Warehouse Mayhem", seed: 8182, radiusX: 63, radiusZ: 36, width: 10.4, complexity: .73, theme: "WAREHOUSE", elevation: 3.4, banking: .12 },
  { id: "print-factory-panic", name: "Print Factory Panic", seed: 9293, radiusX: 54, radiusZ: 43, width: 10.8, complexity: .88, theme: "PRINT_FACTORY", elevation: 4.4, banking: .16 },
  { id: "office-overdrive", name: "Office Overdrive", seed: 4417, radiusX: 60, radiusZ: 34, width: 10.2, complexity: .68, theme: "OFFICE", elevation: 2.8, banking: .1 },
  { id: "manga-convention", name: "Manga Convention Madness", seed: 6066, radiusX: 57, radiusZ: 42, width: 11.5, complexity: 1, theme: "MANGA", elevation: 4.8, banking: .18 },
] as const;

export const TrackPresets: readonly StoredTrack[] = PRESET_CONFIGS.map((config) => generateTrack(config));

export function loadActiveTrack(): StoredTrack {
  if (typeof window === "undefined") return TrackPresets[0]!;
  try { return sanitizeTrack(JSON.parse(localStorage.getItem(ACTIVE_TRACK) ?? "null")); } catch { return TrackPresets[0]!; }
}

export function loadTracks(): StoredTrack[] {
  if (typeof window === "undefined") return [...TrackPresets];
  try {
    const value = JSON.parse(localStorage.getItem(TRACK_LIBRARY) ?? "[]") as unknown;
    const custom = Array.isArray(value) ? value.map(sanitizeTrack).filter((item) => !TrackPresets.some((preset) => preset.config.id === item.config.id)) : [];
    return [...TrackPresets, ...custom].slice(0, 20);
  } catch { return [...TrackPresets]; }
}

export function saveTrack(track: StoredTrack): StoredTrack[] {
  const clean = sanitizeTrack(track);
  const tracks = loadTracks().filter((item) => item.config.id !== clean.config.id);
  tracks.unshift(clean);
  localStorage.setItem(TRACK_LIBRARY, JSON.stringify(tracks.slice(0, 20)));
  localStorage.setItem(ACTIVE_TRACK, JSON.stringify(clean));
  return tracks;
}

function sanitizeTrack(value: unknown): StoredTrack {
  if (!value || typeof value !== "object") return TrackPresets[0]!;
  const candidate = value as { config?: Partial<TrackConfig> };
  if (!candidate.config) return TrackPresets[0]!;
  const config = candidate.config;
  const theme = (["FLAGSHIP", "WAREHOUSE", "PRINT_FACTORY", "OFFICE", "MANGA"] as const).includes(config.theme as TrackTheme) ? config.theme as TrackTheme : "FLAGSHIP";
  return generateTrack({
    id: String(config.id || `track-${Date.now()}`),
    name: String(config.name || "Custom Track").slice(0, 36),
    seed: Number(config.seed) >>> 0,
    radiusX: clamp(Number(config.radiusX), 42, 72),
    radiusZ: clamp(Number(config.radiusZ), 28, 52),
    width: clamp(Number(config.width), 8, 14),
    complexity: clamp(Number(config.complexity), 0, 1),
    theme,
    elevation: clamp(Number(config.elevation ?? 2.5), 0, 6),
    banking: clamp(Number(config.banking ?? .1), 0, .24),
  });
}

function clamp(value: number, min: number, max: number): number {
  return Number.isFinite(value) ? Math.max(min, Math.min(max, value)) : min;
}
