import { sampleTrack } from "./track.js";
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

export function nearestSplineProgress(position: Vec3, track: TrackDefinition, cursor = -1): number {
  return sampleTrack(track, position, cursor).progress;
}

export function advanceRaceProgress(
  current: RaceProgress,
  position: Vec3,
  track: TrackDefinition,
  lapsRequired: number,
  now: number,
  cursor = -1,
): RaceProgress {
  if (current.finishedAt !== null) return current;
  const result = { ...current, progress: nearestSplineProgress(position, track, cursor) };
  const next = track.checkpoints[current.checkpoint];
  if (!next || distanceSquared(position, next) > next.radius ** 2) return result;

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

/**
 * The single continuous measure of how far through the race a kart is: completed laps plus its
 * position along the spline. Monotonic across the finish line, because the last checkpoint *is* the
 * finish line, so `lap` increments exactly as `progress` wraps to zero.
 *
 * This exists so there is one answer to "who is ahead". The runtime previously kept a second,
 * independent lap counter that incremented on any spline wrap — which both duplicated this logic and
 * disagreed with it, since the checkpoint-gated version here refuses to count a lap for a kart that
 * cut the course.
 */
export function raceProgress(progress: RaceProgress): number {
  return Math.max(0, progress.lap - 1 + progress.progress);
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

export function isWrongWay(rotation: number, position: Vec3, track: TrackDefinition, cursor = -1): boolean {
  const sample = sampleTrack(track, position, cursor);
  return Math.sin(rotation) * sample.tangent.x + Math.cos(rotation) * sample.tangent.z < 0;
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
