export type Vec3 = { x: number; y: number; z: number };

export enum RacePhase {
  LOBBY = "LOBBY",
  LOADING = "LOADING",
  COUNTDOWN = "COUNTDOWN",
  RACING = "RACING",
  FINISHING = "FINISHING",
  RESULTS = "RESULTS",
  CLOSED = "CLOSED",
}

export type GameInput = {
  sequence: number;
  steer: number;
  throttle: number;
  brake: number;
  drift: boolean;
  useItem: boolean;
  respawn: boolean;
};

export type KartState = {
  position: Vec3;
  rotation: number;
  speed: number;
  verticalSpeed: number;
  boostRemaining: number;
  driftCharge: number;
  driftLevel: 0 | 1 | 2 | 3;
};

export type RaceProgress = {
  lap: number;
  checkpoint: number;
  progress: number;
  bestLapMs: number | null;
  currentLapStartedAt: number;
  finishedAt: number | null;
};

export type PlayerSnapshot = {
  id: string;
  nickname: string;
  connected: boolean;
  ready: boolean;
  state: KartState;
  progress: RaceProgress;
  racePosition: number;
  lastProcessedInput: number;
};

export type TrackPoint = Vec3 & { progress: number };

export type TrackDefinition = {
  id: string;
  name: string;
  recommendedLaps: 1 | 2 | 3 | 5;
  spawnPoints: Array<{ position: Vec3; rotation: number }>;
  checkpoints: TrackPoint[];
  racingSpline: TrackPoint[];
  recoveryPoints: Array<{ position: Vec3; rotation: number }>;
  bounds: { minX: number; maxX: number; minZ: number; maxZ: number };
};
