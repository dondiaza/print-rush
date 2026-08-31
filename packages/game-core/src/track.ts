import type { TrackDefinition, TrackPoint } from "./types.js";

export function createFlagshipStoreTrack(segments = 96): TrackDefinition {
  const spline: TrackPoint[] = Array.from({ length: segments }, (_, index) => {
    const angle = -Math.PI / 2 + (index / segments) * Math.PI * 2;
    return {
      x: Math.cos(angle) * 29,
      y: 0,
      z: Math.sin(angle) * 19,
      progress: index / segments,
    };
  });
  // The finish line is deliberately the final gate. Starting on the grid can
  // never advance race progress until the kart reaches the first quarter.
  const checkpointIndexes = [24, 48, 72, 0];
  return {
    id: "flagship-store",
    name: "Flagship Store",
    recommendedLaps: 3,
    spawnPoints: [0, 1, 2, 3].map((slot) => ({
      position: { x: -slot * 2.1, y: 0.75, z: -19 + (slot % 2) * 2.2 },
      rotation: Math.PI / 2,
    })),
    checkpoints: checkpointIndexes.map((index) => spline[index]!),
    racingSpline: spline,
    recoveryPoints: checkpointIndexes.map((index) => {
      const point = spline[index]!;
      const next = spline[(index + 1) % spline.length]!;
      return { position: { ...point, y: 0.75 }, rotation: Math.atan2(next.x - point.x, next.z - point.z) };
    }),
    bounds: { minX: -42, maxX: 42, minZ: -32, maxZ: 32 },
  };
}
