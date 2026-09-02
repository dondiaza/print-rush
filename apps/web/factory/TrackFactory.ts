import {
  bakeTrack,
  generateThemedTrack,
  getCircuits,
  getHandlingLab,
  validateTrack as validateAnalysis,
  type BakedTrack,
  type TrackAnalysis,
  type TrackTheme,
} from "@print-rush/game-core";

/**
 * Track library and persistence.
 *
 * V4 stored a `TrackConfig` of ellipse parameters (`radiusX`, `radiusZ`, `complexity`) and
 * regenerated the circuit from them on load. Those parameters no longer describe anything: V5
 * circuits are baked from blueprints, so what gets stored is the theme, the seed and the width, and
 * the baker rebuilds the same circuit deterministically.
 *
 * Storing the config rather than the baked nodes keeps localStorage small — a baked 3 km circuit is
 * roughly 1400 nodes — and means an improvement to the generator reaches saved circuits.
 */

export type { TrackTheme, TrackAnalysis };
export type TrackSurface = "ASPHALT" | "FLOOR_TILE" | "CONCRETE" | "METAL" | "WOOD" | "CARDBOARD" | "CARPET" | "INK" | "CONVEYOR";

/** A circuit as the UI sees it: the stored config plus everything the baker derived from it. */
export type StoredTrack = {
  schemaVersion: 5;
  config: TrackConfig;
  baked: BakedTrack;
};

export type TrackConfig = {
  id: string;
  name: string;
  theme: TrackTheme;
  seed: number;
  width: number;
};

const ACTIVE_TRACK = "print-rush.active-track.v5";
const TRACK_LIBRARY = "print-rush.tracks.v5";

export const TrackThemes: readonly TrackTheme[] = ["FLAGSHIP", "WAREHOUSE", "PRINT_FACTORY", "OFFICE", "MANGA"];

function toStored(config: TrackConfig): StoredTrack {
  const baked = generateThemedTrack({
    id: config.id,
    theme: config.theme,
    seed: config.seed,
    name: config.name,
    width: config.width,
  });
  return { schemaVersion: 5, config, baked };
}

export function generateTrack(config: TrackConfig): StoredTrack {
  return toStored(normalizeConfig(config));
}

/**
 * The five shipped circuits: hand-authored, not generated.
 *
 * Their `seed` is nominal — an authored circuit is not reproducible from a seed, so re-rolling one
 * of these in the editor produces a *generated* circuit on the same theme rather than a variation of
 * the authored layout. That is the honest behaviour: the authored routes are content, not output.
 */
export const TrackPresets: readonly StoredTrack[] = getCircuits().map((baked) => ({
  schemaVersion: 5 as const,
  config: {
    id: baked.blueprint.id,
    name: baked.blueprint.name,
    theme: baked.blueprint.theme as TrackTheme,
    seed: 0,
    width: baked.analysis.averageWidth,
  },
  baked,
}));

/** The grey box, kept in the library so handling can be checked from inside the normal race flow. */
export const HandlingLabTrack: StoredTrack = {
  schemaVersion: 5,
  config: { id: "handling-lab", name: "Handling Lab", theme: "FLAGSHIP", seed: 1, width: 16 },
  baked: getHandlingLab(),
};

export function validateTrack(track: StoredTrack): string[] {
  return validateAnalysis(track.baked.analysis, track.baked.blueprint);
}

export function trackMetrics(track: StoredTrack): TrackAnalysis {
  return track.baked.analysis;
}

export function loadActiveTrack(): StoredTrack {
  if (typeof window === "undefined") return TrackPresets[0]!;
  try {
    return sanitizeTrack(JSON.parse(localStorage.getItem(ACTIVE_TRACK) ?? "null"));
  } catch {
    return TrackPresets[0]!;
  }
}

export function loadTracks(): StoredTrack[] {
  if (typeof window === "undefined") return [...TrackPresets];
  try {
    const parsed = JSON.parse(localStorage.getItem(TRACK_LIBRARY) ?? "[]") as unknown;
    const custom = Array.isArray(parsed)
      ? parsed
          .map(sanitizeTrack)
          .filter((item) => !TrackPresets.some((preset) => preset.config.id === item.config.id))
      : [];
    return [...TrackPresets, ...custom].slice(0, 20);
  } catch {
    return [...TrackPresets];
  }
}

export function saveTrack(track: StoredTrack): StoredTrack[] {
  const clean = { schemaVersion: 5 as const, config: normalizeConfig(track.config), baked: track.baked };
  const tracks = loadTracks().filter((item) => item.config.id !== clean.config.id);
  tracks.unshift(clean);
  // Only the configs are persisted; the nodes are rebuilt on load.
  localStorage.setItem(TRACK_LIBRARY, JSON.stringify(tracks.slice(0, 20).map((item) => item.config)));
  localStorage.setItem(ACTIVE_TRACK, JSON.stringify(clean.config));
  return tracks;
}

function sanitizeTrack(value: unknown): StoredTrack {
  if (!value || typeof value !== "object") return TrackPresets[0]!;
  // Accept either a bare config or the older wrapped shape.
  const candidate = value as Partial<TrackConfig> & { config?: Partial<TrackConfig> };
  const config = candidate.config ?? candidate;
  if (!config.theme && !config.id) return TrackPresets[0]!;
  const preset = TrackPresets.find((item) => item.config.id === config.id);
  if (preset) return preset;
  if (config.id === HandlingLabTrack.config.id) return HandlingLabTrack;
  return toStored(normalizeConfig(config as TrackConfig));
}

function normalizeConfig(config: Partial<TrackConfig>): TrackConfig {
  const theme = TrackThemes.includes(config.theme as TrackTheme) ? (config.theme as TrackTheme) : "FLAGSHIP";
  return {
    id: String(config.id || `track-${Date.now().toString(36)}`).slice(0, 48),
    name: String(config.name || "Custom Rush").replace(/[^\p{L}\p{N} &'_-]/gu, "").trim().slice(0, 36) || "Custom Rush",
    theme,
    seed: Number.isFinite(Number(config.seed)) ? Number(config.seed) >>> 0 : 1,
    width: clamp(Number(config.width ?? 14.5), 11, 20),
  };
}

function clamp(value: number, min: number, max: number): number {
  return Number.isFinite(value) ? Math.max(min, Math.min(max, value)) : min;
}

/** Re-exported so the studio can bake an imported blueprint without reaching into the core package. */
export { bakeTrack };
export type { BakedTrack };
