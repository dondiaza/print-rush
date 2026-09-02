import {
  VehicleConfig,
  sanitizeInput,
  type GameInput,
  type KartState,
  type TrackDefinition,
  type TrackSample,
} from "@print-rush/game-core";

/**
 * BOT DRIVER.
 *
 * V4's opponents were not karts. Each was a `TransformNode` plus a scalar `totalProgress` advanced
 * along the spline, with a catch-up term proportional to the player's distance and a sine wave for
 * variation. They could not collide, could not drift, could not be blocked and could not make a
 * mistake — and because they were on rails, no amount of art would make a race against them feel
 * like a race.
 *
 * A bot here is a full `KartState` running the same `simulateKart` as the player. This driver only
 * produces a `GameInput`, so everything the player is subject to — grip, slip, walls, kart contact,
 * items — applies to bots identically and for free.
 */

/**
 * The five personalities the brief asks for. Each varies more than raw pace: how much speed it
 * carries, how accurately it holds a line, how willingly it drifts, whether it takes shortcuts, and
 * how much noise it adds to its own steering. Two bots with the same `level` still drive differently.
 */
export type BotPersonality = "CAUTIOUS" | "BALANCED" | "AGGRESSIVE" | "TECHNICAL" | "CHAOTIC";

export type BotSkill = {
  personality: BotPersonality;
  /** 0..1. Scales cornering speed and line accuracy. */
  level: number;
  /** Metres the bot aims off the centreline. Gives the field different lines. */
  laneOffset: number;
  /** Extra reaction lag in seconds. Weaker bots see corners later. */
  reaction: number;
  /** 0..1. How readily it drifts a corner rather than braking for it. */
  driftAppetite: number;
  /** 0..1. How much it will lean on a rival it is alongside. */
  aggression: number;
  /** 0..1. Chance it commits to a shortcut when one is available. */
  shortcutAppetite: number;
  /** Random steering noise in radians. A chaotic bot is genuinely untidy, not merely slow. */
  jitter: number;
};

export const BotPersonalities: Record<BotPersonality, Omit<BotSkill, "laneOffset">> = {
  // Brakes early, holds a wide safe line, almost never drifts. Slow but never in the wall.
  CAUTIOUS: { personality: "CAUTIOUS", level: 0.74, reaction: 0.13, driftAppetite: 0.15, aggression: 0.15, shortcutAppetite: 0.1, jitter: 0.01 },
  // The reference driver.
  BALANCED: { personality: "BALANCED", level: 0.86, reaction: 0.08, driftAppetite: 0.55, aggression: 0.45, shortcutAppetite: 0.4, jitter: 0.02 },
  // Carries too much speed, drifts everything, will put a wheel in. Fast and error-prone.
  AGGRESSIVE: { personality: "AGGRESSIVE", level: 0.92, reaction: 0.06, driftAppetite: 0.9, aggression: 0.95, shortcutAppetite: 0.75, jitter: 0.035 },
  // The quickest in a corner because it is the tidiest. Takes the skill shortcuts.
  TECHNICAL: { personality: "TECHNICAL", level: 0.96, reaction: 0.04, driftAppetite: 0.7, aggression: 0.35, shortcutAppetite: 0.85, jitter: 0.008 },
  // Wildly inconsistent: occasionally brilliant, frequently sideways.
  CHAOTIC: { personality: "CHAOTIC", level: 0.83, reaction: 0.1, driftAppetite: 0.8, aggression: 0.7, shortcutAppetite: 0.6, jitter: 0.075 },
};

/** The three opponents on the grid. Deliberately different personalities, not three difficulties. */
export const BotSkills: readonly BotSkill[] = [
  { ...BotPersonalities.TECHNICAL, laneOffset: -1.4 },
  { ...BotPersonalities.AGGRESSIVE, laneOffset: 1.8 },
  { ...BotPersonalities.CHAOTIC, laneOffset: -2.6 },
];

/** Metres of track looked at when judging how fast the next corner can be taken. */
const SCAN_METRES = 90;

export class BotDriver {
  private steerFilter = 0;
  private driftHold = 0;
  private recoverTimer = 0;
  private reactionClock = 0;
  private cachedCornerSpeed: number = VehicleConfig.maxSpeed;

  // ---------------------------------------------------------------- stuck detection
  /** Seconds with no meaningful forward progress. */
  private stalledFor = 0;
  /** Lap distance at the start of the current observation window, in metres. */
  private windowStartDistance = -1;
  private windowElapsed = 0;
  /** Seconds spent trying to reverse out before giving up and asking for a respawn. */
  private reversingFor = 0;
  /**
   * Seconds this driver has been running. The stuck detector is disabled for the first moment of
   * its life: every bot is stationary on the grid, and without this grace it classifies the start
   * of the race as being stuck and reverses off the line.
   */
  private aliveFor = 0;
  /** Throttle asked for last step. A bot braking for a corner is slow on purpose, not stuck. */
  private lastThrottle = 1;
  /** Deterministic noise source, seeded per bot so a race replays identically. */
  private noise: number;

  constructor(private readonly skill: BotSkill, seed = 1) {
    this.noise = (seed * 2_654_435_761) >>> 0;
  }

  /** xorshift, so jitter is reproducible rather than `Math.random()` in the simulation. */
  private nextNoise(): number {
    this.noise ^= this.noise << 13;
    this.noise ^= this.noise >>> 17;
    this.noise ^= this.noise << 5;
    return ((this.noise >>> 0) % 2_000) / 1_000 - 1;
  }

  get personality(): BotPersonality {
    return this.skill.personality;
  }

  /**
   * True when the bot has given up on recovering by itself and needs a respawn.
   * The runtime owns respawning, because it owns the track and the recovery points.
   */
  get needsRespawn(): boolean {
    return this.reversingFor > 2.2;
  }

  /** Called by the runtime after it respawns this bot. */
  clearStuck(): void {
    this.stalledFor = 0;
    this.reversingFor = 0;
    this.recoverTimer = 0;
    // Respawning places the kart stationary on the racing line, so the grace period applies again.
    this.aliveFor = 0;
    this.lastThrottle = 1;
    this.windowStartDistance = -1;
    this.windowElapsed = 0;
  }

  /**
   * Chooses inputs for one bot. Deliberately built from the same information a player has — where
   * the track goes, how fast the kart is going, whether it is on the road — rather than from
   * privileged state.
   */
  update(
    kart: KartState,
    sample: TrackSample,
    track: TrackDefinition,
    dt: number,
    rubberBand: number,
  ): GameInput {
    const nodes = track.nodes;
    const count = nodes.length;
    const nodeSpacing = 2.5;

    this.reactionClock += dt;
    const speed = Math.hypot(kart.velocity.x, kart.velocity.z);

    /**
     * STUCK RECOVERY.
     *
     * A bot is stuck when it is barely moving, or when it has stopped making progress along the
     * lap — which also catches the case of driving hard into a wall at an angle, where speed is
     * non-zero but the lap position never changes. Recovery is attempted physically first: reverse
     * away and steer back toward the racing line. Only if that fails for a couple of seconds does
     * the runtime respawn it, which is the last resort rather than the first.
     */
    this.aliveFor += dt;

    /**
     * Progress is measured as metres advanced along the lap over a one-second window, not as a
     * per-step delta.
     *
     * The first version compared `sample.progress` between consecutive steps against a 1e-4
     * threshold. On a 2.5 km circuit one step at racing speed advances about 7e-5 of a lap — below
     * that threshold — so every bot was flagged as stuck while travelling at 27 m/s and reversed
     * itself back down the track. A window is the only reliable way to ask this question.
     */
    this.windowElapsed += dt;
    if (this.windowStartDistance < 0) this.windowStartDistance = sample.node.distance;
    let advancedEnough = true;
    if (this.windowElapsed >= 1) {
      let advanced = sample.node.distance - this.windowStartDistance;
      // Handle the wrap at the finish line.
      if (advanced < -track.lengthMeters * 0.5) advanced += track.lengthMeters;
      advancedEnough = advanced > 6;
      this.windowStartDistance = sample.node.distance;
      this.windowElapsed = 0;
      if (advancedEnough) {
        this.stalledFor = 0;
        this.reversingFor = 0;
      }
    }

    // Only count as stalled if the bot actually asked to move. Braking for a hairpin is slow by
    // choice, and the grid is stationary by definition.
    const tryingToMove = this.lastThrottle > 0.3;
    const barelyMoving = speed < 2.5;
    if (this.aliveFor > 1.5 && tryingToMove && (barelyMoving || !advancedEnough)) {
      this.stalledFor += dt;
    } else if (!barelyMoving) {
      this.stalledFor = Math.max(0, this.stalledFor - dt * 2);
    }

    if (this.stalledFor > 1.2) {
      this.reversingFor += dt;
      // Reverse out, steering the nose back toward the road. Sanitised like any other input, so a
      // recovering bot is subject to exactly the same physics as everyone else.
      const backOff = Math.sign(sample.lateral) || 1;
      return sanitizeInput({
        sequence: 0,
        steer: backOff * 0.7,
        throttle: 0,
        brake: 1,
        drift: false,
        useItem: false,
        respawn: false,
      });
    }

    // ---------------------------------------------------------------- read the road ahead
    // Refresh the corner-speed estimate on the bot's reaction interval, not every step: it makes
    // weaker bots visibly late to brake instead of merely slower.
    if (this.reactionClock >= this.skill.reaction) {
      this.reactionClock = 0;
      this.cachedCornerSpeed = this.estimateCornerSpeed(nodes, sample.index, count, nodeSpacing);
    }

    /**
     * Aim point moves further ahead with speed — but pulls back in when the corner ahead is tight.
     *
     * A fixed 36 m lookahead on a 10 m-wide slalom aims past the chicanes entirely, so the bot drove
     * straight through them: it never applied much steering, which meant it never met the drift
     * condition and spent half its time off the road. The lookahead has to shorten with the corner.
     */
    const cornerRatio = Math.min(1, this.cachedCornerSpeed / VehicleConfig.maxSpeed);
    const aimMetres = (10 + (speed / VehicleConfig.maxSpeed) * 26) * (0.42 + 0.58 * cornerRatio);
    const aimIndex = (sample.index + Math.round(aimMetres / nodeSpacing)) % count;
    const aimNode = nodes[aimIndex]!;
    const nextNode = nodes[(aimIndex + 1) % count]!;
    const tangentX = nextNode.x - aimNode.x;
    const tangentZ = nextNode.z - aimNode.z;
    const tangentLength = Math.hypot(tangentX, tangentZ) || 1;
    const normalX = -tangentZ / tangentLength;
    const normalZ = tangentX / tangentLength;
    const lane = this.skill.laneOffset * Math.min(1, aimNode.width / 14);
    const targetX = aimNode.x + normalX * lane;
    const targetZ = aimNode.z + normalZ * lane;

    // ---------------------------------------------------------------- steering
    const desiredHeading = Math.atan2(targetX - kart.position.x, targetZ - kart.position.z);
    let headingError = desiredHeading - kart.rotation;
    while (headingError > Math.PI) headingError -= Math.PI * 2;
    while (headingError < -Math.PI) headingError += Math.PI * 2;

    /**
     * Counter-steer only when *not* drifting. Applying slide correction during a drift means the bot
     * steers out of the drift it just started, which opens the line instead of closing it and is a
     * large part of why the drifting profiles ended up off the road four fifths of the time.
     */
    const slideCorrection = kart.driftActive ? 0 : (-kart.lateralSpeed / VehicleConfig.maxSpeed) * 0.9;
    // Jitter is what makes a CHAOTIC bot untidy rather than simply slower, and it is what keeps
    // TECHNICAL looking clean. Deterministic, so a race is reproducible.
    const jitter = this.nextNoise() * this.skill.jitter;
    let steerTarget = headingError * 2.1 + slideCorrection + jitter;

    // Being off the road overrides the racing line: get back on it first.
    if (sample.offRoad) {
      this.recoverTimer = 0.6;
      steerTarget = -Math.sign(sample.lateral) * 0.8 + headingError * 1.4;
    }
    this.recoverTimer = Math.max(0, this.recoverTimer - dt);

    steerTarget = Math.max(-1, Math.min(1, steerTarget));
    // Bots get the same short steering filter the player's input has, so their yaw behaves the same.
    this.steerFilter += (steerTarget - this.steerFilter) * Math.min(1, dt / 0.07);

    // ---------------------------------------------------------------- throttle and brake
    // Rubber banding adjusts the target speed, never the physics, so a bot in front can still be
    // out-driven and a bot behind still has to actually drive.
    /**
     * The pace ceiling is a real spread, not a rounding difference. At 0.82 + level * 0.2 the five
     * personalities all landed within 5 % of the kart's top speed, which the vehicle's own limit
     * then flattened completely — CAUTIOUS and TECHNICAL covered the same distance to seven
     * significant figures. A wider band keeps every profile below the ceiling so the dial binds.
     */
    const targetSpeed = Math.min(
      VehicleConfig.maxSpeed * (0.62 + this.skill.level * 0.36) * (1 + rubberBand * 0.12),
      this.cachedCornerSpeed,
    );

    let throttle = 1;
    let brake = 0;
    if (speed > targetSpeed * 1.08) {
      throttle = 0;
      brake = Math.min(1, (speed - targetSpeed) / 8);
    } else if (speed > targetSpeed) {
      throttle = 0.35;
    }
    if (this.recoverTimer > 0) throttle = Math.min(throttle, 0.55);

    // ---------------------------------------------------------------- drift
    // How much the corner ahead demands. Zero on a straight, approaching one in a hairpin.
    const cornerTightness = 1 - cornerRatio;

    /**
     * The drift decision is keyed on how much steering the bot is already applying, scaled by its
     * appetite — not on corner tightness. Keying it on tightness made it depend on the corner-speed
     * estimate, so when that estimate loosened, every bot silently stopped drifting altogether.
     *
     * A cautious bot brakes for the corner it would otherwise drift, and below an appetite of 0.2 it
     * does not drift at all. That is what the personality means, rather than being merely slower.
     */
    const steerNeeded = 0.66 - this.skill.driftAppetite * 0.42;
    // Room left on the road. A bot already running wide must not start a drift that takes it wider.
    const halfWidth = sample.node.width * 0.5;
    const nearTheLine = Math.abs(sample.lateral) < halfWidth * 0.68;
    const wantsDrift =
      this.skill.driftAppetite > 0.2 &&
      Math.abs(this.steerFilter) > steerNeeded &&
      speed > VehicleConfig.driftMinSpeed * 1.15 &&
      // Worth the scrub: a gentle bend is quicker on grip.
      cornerTightness > 0.09 &&
      nearTheLine &&
      !sample.offRoad;

    /**
     * The hold is short and continuously refreshed rather than committed for over a second. A long
     * commitment meant the bot kept drifting after the corner had ended, which slid it straight off
     * the track; a short refresh lets the drift last exactly as long as the corner does, and it
     * ends at the moment the boost is worth banking.
     */
    if (wantsDrift) this.driftHold = 0.3;
    this.driftHold = Math.max(0, this.driftHold - dt);

    this.lastThrottle = throttle;
    return sanitizeInput({
      sequence: 0,
      steer: this.steerFilter,
      throttle,
      brake,
      drift: this.driftHold > 0,
      useItem: false,
      respawn: false,
    });
  }

  /**
   * Highest speed the bot can be doing *right now* and still make every corner in the scan window.
   *
   * The first version took the tightest curvature anywhere in the next 90 m and clamped the bot to
   * that corner's speed for the whole window. On a slalom circuit that pinned every bot to the
   * 11 m/s floor from the moment it left the grid — which also put them below the drift entry speed,
   * so no bot ever drifted and all five personalities drove identically. The dials were being read;
   * there was simply no speed for them to act on.
   *
   * The fix is a braking-distance model. For each point ahead: the corner there has a maximum speed
   * of sqrt(a_lat / k), and the maximum speed *here* that can still decelerate to it over distance d
   * is sqrt(v_corner^2 + 2 * a_brake * d). The limit is the minimum of those, so a distant hairpin
   * no longer slows the bot on the straight leading to it.
   */
  private estimateCornerSpeed(
    nodes: TrackDefinition["nodes"],
    index: number,
    count: number,
    spacing: number,
  ): number {
    const steps = Math.round(SCAN_METRES / spacing);
    // Usable lateral acceleration. A bot willing to drift can carry more of it, which is why the
    // aggressive and technical profiles are quick in different ways.
    const usableLateral = 14 + this.skill.level * 11 + this.skill.driftAppetite * 4;
    // Deliberately below the vehicle's real braking power: a bot that brakes at the theoretical
    // limit has no margin and clips the apex of everything.
    const usableBraking = VehicleConfig.brakingPower * (0.5 + this.skill.level * 0.3);

    let limit: number = VehicleConfig.maxSpeed;
    // Starts at zero distance on purpose: the corner the bot is *in* must bind with no braking
    // allowance. Beginning the scan 7.5 m ahead gave even the current corner an allowance, so the
    // computed limit never dropped below top speed and `cornerTightness` was always zero — which
    // silently disabled the drift decision that reads it.
    for (let step = 0; step < steps; step += 2) {
      // `+ count` before the modulo: at step 0 the first sample looks two nodes *behind* the kart,
      // and a bare modulo on a negative index returns a negative one.
      const a = nodes[(index + step - 2 + count) % count]!;
      const b = nodes[(index + step + count) % count]!;
      const c = nodes[(index + step + 2 + count) % count]!;
      const inHeading = Math.atan2(b.x - a.x, b.z - a.z);
      const outHeading = Math.atan2(c.x - b.x, c.z - b.z);
      let delta = outHeading - inHeading;
      while (delta > Math.PI) delta -= Math.PI * 2;
      while (delta < -Math.PI) delta += Math.PI * 2;

      /**
       * Curvature in radians per metre.
       *
       * The two sampled segments (a to b, b to c) each span two nodes, so their midpoints are two
       * nodes — one `spacing * 2` — apart. Dividing by `spacing * 4` halved every curvature and so
       * doubled every corner-speed estimate, which is why bots never registered a corner as tight
       * enough to be worth drifting.
       */
      const curvature = Math.abs(delta) / (spacing * 2);
      if (curvature < 1e-4) continue;

      const cornerSpeed = Math.sqrt(usableLateral / curvature);
      const distance = step * spacing;
      const allowedHere = Math.sqrt(cornerSpeed * cornerSpeed + 2 * usableBraking * distance);
      limit = Math.min(limit, allowedHere);
    }

    // A floor, so a bot never talks itself into a standstill on a hairpin.
    return Math.max(12, Math.min(VehicleConfig.maxSpeed, limit));
  }
}
