import type { SurfaceName } from "./config.js";

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
  /**
   * A tap of the hop button, edge-triggered.
   *
   * Held state would be wrong here: a hop happens once per press, and the same button is held down
   * for the whole of a drift. So this is a one-frame pulse the input layer raises on key-down, the
   * way `useItem` is, rather than a mirror of whether the key is down.
   */
  hop: boolean;
  respawn: boolean;
};

export type Vec2 = { x: number; z: number };

export type DriftGrade = "NONE" | "PERFECT" | "GOOD" | "MISS";

/** What the drift system did in one step, so the runtime can drive VFX, audio and HUD from it. */
export type DriftEvent = {
  started: boolean;
  grade: DriftGrade;
  released: boolean;
  boostSeconds: number;
  tier: 0 | 1 | 2 | 3;
  chain: number;
  windowOpened: boolean;
};

/** Per-surface multipliers applied by the track to the shared vehicle model. */
export type SurfaceGrip = { grip: number; drag: number; boost: number };

export type KartState = {
  position: Vec3;
  /** World-space planar velocity. Independent of `rotation` — this is what makes drift possible. */
  velocity: Vec2;
  /** Heading yaw in radians. Where the nose points, not necessarily where the kart travels. */
  rotation: number;
  yawRate: number;
  /** Velocity projected onto the nose axis. Signed: negative is reverse. */
  speed: number;
  /** Velocity projected across the tyres. Non-zero means the kart is sliding. */
  lateralSpeed: number;
  slipAngle: number;
  verticalSpeed: number;
  grounded: boolean;
  airTime: number;
  boostRemaining: number;
  boostTier: 0 | 1 | 2 | 3;
  driftActive: boolean;
  driftDirection: -1 | 0 | 1;
  driftCharge: number;
  driftLevel: 0 | 1 | 2 | 3;
  hopTimer: number;
  counterSteerTime: number;
  /**
   * Chaining state. A brief release of the drift button is a tap, not a release, and taps landed
   * inside the three execution windows bank `boostReserve` and extend `driftChain`. See `drift.ts`.
   */
  boostReserve: number;
  driftChain: number;
  /** How long the drift button has been released. Under the grace period this is a pending tap. */
  driftReleaseTime: number;
  /** How many of the three windows have already been consumed this drift. */
  driftWindowsUsed: number;
  /** 1 while an unused window is open. Drives the "tap now" cue. */
  driftTapWindow: number;
  lastDriftGrade: DriftGrade;
  /** Trick state: armed by tapping drift just after take-off, paid out on a clean landing. */
  trickArmed: boolean;
  trickRotation: number;
  /** Impacts are ignored while this is above zero, so one mistake is not twenty-five impacts. */
  impactCooldown: number;
  /** Visual-only: suspension compression 0..1, steering wheel angle, body roll. */
  suspension: number;
  steerVisual: number;
  lean: number;
  /** Nose-down under braking, nose-up under power. Visual only, and most of the sense of mass. */
  pitch: number;
  /**
   * What the drift system did on the most recent step. Transient: it describes this step only and
   * is not part of the persistent vehicle state, but it lives here so `simulateKart` can keep its
   * single-return signature while the runtime still gets the events it needs for feedback.
   */
  lastDriftEvent: DriftEvent;
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

/** One baked sample of the racing line. A V5 circuit is a few thousand of these. */
export type TrackNode = Vec3 & {
  progress: number;
  /** Metres travelled along the centreline from the start line. */
  distance: number;
  /** Full drivable width in metres. */
  width: number;
  /** Banking in radians. Positive rolls the road toward the left of travel. */
  banking: number;
  surface: SurfaceName;
  /** 1-based sector index. Sectors follow the space, not equal fractions of the lap. */
  sector: number;
  /** False lets the kart leave the road on that side: a shortcut mouth, a ledge or a fall. */
  wallLeft: boolean;
  wallRight: boolean;
};

export type TrackCheckpoint = Vec3 & { progress: number; radius: number };

export type TrackDefinition = {
  id: string;
  name: string;
  recommendedLaps: 1 | 2 | 3 | 5;
  spawnPoints: Array<{ position: Vec3; rotation: number }>;
  checkpoints: TrackCheckpoint[];
  /** The baked centreline. Replaces V4's `racingSpline`. */
  nodes: TrackNode[];
  recoveryPoints: Array<{ position: Vec3; rotation: number }>;
  lengthMeters: number;
  bounds: { minX: number; maxX: number; minZ: number; maxZ: number; minY: number; maxY: number };
};
