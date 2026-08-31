import { GameplayConfig } from "./config.js";
import { RacePhase, type RaceProgress, type TrackDefinition, type Vec3 } from "./types.js";

export function distanceSquared(a: Vec3, b: Vec3): number {
  const dx = a.x - b.x;
  const dy = a.y - b.y;
  const dz = a.z - b.z;
  return dx * dx + dy * dy + dz * dz;
}

export function createRaceProgress(now = 0): RaceProgress {
  return { lap: 1, checkpoint: 0, progress: 0, bestLapMs: null, currentLapStartedAt: now, finishedAt: null };
}

export function nearestSplineProgress(position: Vec3, track: TrackDefinition): number {
  let nearest = track.racingSpline[0];
  let nearestDistance = Number.POSITIVE_INFINITY;
  for (const point of track.racingSpline) {
    const distance = distanceSquared(position, point);
    if (distance < nearestDistance) {
      nearest = point;
      nearestDistance = distance;
    }
  }
  return nearest?.progress ?? 0;
}

export function advanceRaceProgress(
  current: RaceProgress,
  position: Vec3,
  track: TrackDefinition,
  lapsRequired: number,
  now: number,
): RaceProgress {
  if (current.finishedAt !== null) return current;
  const result = { ...current, progress: nearestSplineProgress(position, track) };
  const next = track.checkpoints[current.checkpoint];
  if (!next || distanceSquared(position, next) > GameplayConfig.checkpointRadius ** 2) return result;

  if (current.checkpoint === track.checkpoints.length - 1) {
    const lapTime = Math.max(0, now - current.currentLapStartedAt);
    result.bestLapMs = current.bestLapMs === null ? lapTime : Math.min(current.bestLapMs, lapTime);
    if (current.lap >= lapsRequired) {
      result.finishedAt = now;
      return result;
    }
    result.lap = current.lap + 1;
    result.checkpoint = 0;
    result.currentLapStartedAt = now;
  } else {
    result.checkpoint = current.checkpoint + 1;
  }
  return result;
}

export function rankProgress(progress: RaceProgress): number {
  return (progress.lap - 1) * 10_000 + progress.checkpoint * 1_000 + progress.progress;
}

export function rankPlayers<T extends { progress: RaceProgress }>(players: T[]): T[] {
  return [...players].sort((a, b) => {
    if (a.progress.finishedAt !== null && b.progress.finishedAt !== null) return a.progress.finishedAt - b.progress.finishedAt;
    if (a.progress.finishedAt !== null) return -1;
    if (b.progress.finishedAt !== null) return 1;
    return rankProgress(b.progress) - rankProgress(a.progress);
  });
}

export function isWrongWay(rotation: number, position: Vec3, track: TrackDefinition): boolean {
  let index = 0;
  let nearest = Number.POSITIVE_INFINITY;
  track.racingSpline.forEach((point, candidate) => {
    const distance = distanceSquared(position, point);
    if (distance < nearest) { nearest = distance; index = candidate; }
  });
  const current = track.racingSpline[index];
  const next = track.racingSpline[(index + 1) % track.racingSpline.length];
  if (!current || !next) return false;
  const forwardX = Math.sin(rotation);
  const forwardZ = Math.cos(rotation);
  const trackX = next.x - current.x;
  const trackZ = next.z - current.z;
  return forwardX * trackX + forwardZ * trackZ < 0;
}

const transitions: Record<RacePhase, readonly RacePhase[]> = {
  [RacePhase.LOBBY]: [RacePhase.LOADING, RacePhase.CLOSED],
  [RacePhase.LOADING]: [RacePhase.COUNTDOWN, RacePhase.CLOSED],
  [RacePhase.COUNTDOWN]: [RacePhase.RACING, RacePhase.CLOSED],
  [RacePhase.RACING]: [RacePhase.FINISHING, RacePhase.CLOSED],
  [RacePhase.FINISHING]: [RacePhase.RESULTS, RacePhase.CLOSED],
  [RacePhase.RESULTS]: [RacePhase.LOADING, RacePhase.CLOSED],
  [RacePhase.CLOSED]: [],
};

export function canTransition(from: RacePhase, to: RacePhase): boolean {
  return transitions[from].includes(to);
}
