import type { TrackDefinition, TrackPoint } from "@print-rush/game-core";

export type TrackTheme = "FLAGSHIP" | "WAREHOUSE" | "NEON_FACTORY";
export type TrackConfig = { id: string; name: string; seed: number; radiusX: number; radiusZ: number; width: number; complexity: number; theme: TrackTheme };
export type StoredTrack = { schemaVersion: 2; generatorVersion: "2.0.0"; config: TrackConfig; definition: TrackDefinition };

const ACTIVE_TRACK = "print-rush.active-track.v2";
const TRACK_LIBRARY = "print-rush.tracks.v2";

export function generateTrack(config: TrackConfig, segments = 96): StoredTrack {
  const phase = ((config.seed % 997) / 997) * Math.PI * 2;
  const spline: TrackPoint[] = Array.from({ length: segments }, (_, index) => {
    const angle = -Math.PI / 2 + (index / segments) * Math.PI * 2;
    const wave = 1 + Math.sin(angle * 3 + phase) * config.complexity * .09 + Math.sin(angle * 5 - phase) * config.complexity * .035;
    return { x: Math.cos(angle) * config.radiusX * wave, y: Math.sin(angle * 2 + phase) * config.complexity * .25, z: Math.sin(angle) * config.radiusZ * wave, progress: index / segments };
  });
  const checkpoints = [24, 48, 72, 0].map((index) => spline[index]!);
  const recoveryPoints = [24, 48, 72, 0].map((index) => {
    const point = spline[index]!; const next = spline[(index + 1) % spline.length]!;
    return { position: { ...point, y: point.y + .75 }, rotation: Math.atan2(next.x - point.x, next.z - point.z) };
  });
  const start = spline[0]!;
  const startNext = spline[1]!;
  const startRotation = Math.atan2(startNext.x - start.x, startNext.z - start.z);
  const forward = { x: Math.sin(startRotation), z: Math.cos(startRotation) };
  const normal = { x: -forward.z, z: forward.x };
  const definition: TrackDefinition = {
    id: config.id, name: config.name, recommendedLaps: 3, racingSpline: spline, checkpoints, recoveryPoints,
    spawnPoints: [0, 1, 2, 3].map((slot) => { const row = Math.floor(slot / 2); const lane = slot % 2 === 0 ? -.62 : .62; const behind = 1.3 + row * 2.35; return { position: { x: start.x - forward.x * behind + normal.x * lane, y: start.y + .75, z: start.z - forward.z * behind + normal.z * lane }, rotation: startRotation }; }),
    bounds: { minX: -config.radiusX - 14, maxX: config.radiusX + 14, minZ: -config.radiusZ - 14, maxZ: config.radiusZ + 14 },
  };
  return { schemaVersion: 2, generatorVersion: "2.0.0", config, definition };
}

export const TrackPresets: readonly StoredTrack[] = [
  generateTrack({ id: "flagship-store", name: "Flagship Store", seed: 7301, radiusX: 29, radiusZ: 19, width: 10.5, complexity: 0, theme: "FLAGSHIP" }),
  generateTrack({ id: "warehouse-loop", name: "Warehouse Loop", seed: 8182, radiusX: 32, radiusZ: 17, width: 9.4, complexity: .72, theme: "WAREHOUSE" }),
  generateTrack({ id: "neon-press", name: "Neon Press", seed: 9293, radiusX: 25, radiusZ: 22, width: 11.2, complexity: 1, theme: "NEON_FACTORY" }),
] as const;

export function loadActiveTrack(): StoredTrack {
  if (typeof window === "undefined") return TrackPresets[0]!;
  try { return sanitizeTrack(JSON.parse(localStorage.getItem(ACTIVE_TRACK) ?? "null")); } catch { return TrackPresets[0]!; }
}
export function loadTracks(): StoredTrack[] {
  if (typeof window === "undefined") return [...TrackPresets];
  try { const value = JSON.parse(localStorage.getItem(TRACK_LIBRARY) ?? "[]") as unknown; return Array.isArray(value) && value.length ? value.map(sanitizeTrack) : [...TrackPresets]; } catch { return [...TrackPresets]; }
}
export function saveTrack(track: StoredTrack): StoredTrack[] {
  const clean = sanitizeTrack(track); const tracks = loadTracks().filter((item) => item.config.id !== clean.config.id); tracks.unshift(clean);
  localStorage.setItem(TRACK_LIBRARY, JSON.stringify(tracks.slice(0, 20))); localStorage.setItem(ACTIVE_TRACK, JSON.stringify(clean)); return tracks;
}
function sanitizeTrack(value: unknown): StoredTrack {
  if (!value || typeof value !== "object") return TrackPresets[0]!;
  const candidate = value as Partial<StoredTrack>;
  if (candidate.schemaVersion !== 2 || !candidate.config) return TrackPresets[0]!;
  const config = candidate.config;
  return generateTrack({ id: String(config.id || `track-${Date.now()}`), name: String(config.name || "Custom Track").slice(0, 28), seed: Number(config.seed) >>> 0, radiusX: clamp(Number(config.radiusX), 20, 36), radiusZ: clamp(Number(config.radiusZ), 14, 27), width: clamp(Number(config.width), 8, 13), complexity: clamp(Number(config.complexity), 0, 1), theme: ["FLAGSHIP", "WAREHOUSE", "NEON_FACTORY"].includes(config.theme) ? config.theme : "FLAGSHIP" });
}
function clamp(value: number, min: number, max: number): number { return Number.isFinite(value) ? Math.max(min, Math.min(max, value)) : min; }
