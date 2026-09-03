export const NetworkConfig = Object.freeze({
  inputRateHz: 30,
  simulationRateHz: 60,
  physicsSubsteps: 1,
  statePatchRateHz: 20,
  maxInputsPerSecond: 70,
  reconnectSeconds: 25,
  interpolationDelayMs: 100,
  snapDistance: 8,
  smoothingFactor: 0.14,
});

/**
 * V5 handling constants. Tuned against the two targets that matter: a lap of a 3 km circuit lands
 * between 90 and 180 seconds, and a corner can be taken either on grip or on a slide with a real
 * reason to choose one over the other.
 *
 * Units are metres, seconds and radians throughout. Every constant here is read by
 * `vehicle.ts` — the V4 config declared `grip`, `driftGrip` and `mass` and never used them.
 */
export const VehicleConfig = Object.freeze({
  // -------------------------------------------------------------------- speed envelope
  /** 119 km/h. Average lap pace lands near 25 m/s once corners are accounted for. */
  maxSpeed: 33,
  /** 158 km/h. */
  boostedMaxSpeed: 44,
  reverseSpeed: 9,

  // -------------------------------------------------------------------- longitudinal
  acceleration: 26,
  /** Engine force tapers to 8 % of peak at the ceiling instead of cutting out. Reads as weight. */
  accelerationFalloff: 0.92,
  reverseAcceleration: 11,
  brakingPower: 34,
  rollingResistance: 0.9,
  aeroDrag: 0.0035,
  airDrag: 0.35,

  // -------------------------------------------------------------------- steering
  /** rad/s available at a standstill. */
  steeringLowSpeed: 2.9,
  /** rad/s available at top speed. */
  steeringHighSpeed: 1.15,
  /** Time constant of the yaw filter. Short enough to feel direct, long enough not to be digital. */
  yawResponseSeconds: 0.055,
  airControl: 0.42,

  // -------------------------------------------------------------------- grip
  /**
   * Lateral velocity decays as exp(-grip * dt). Steady-state slip is roughly speed * yawRate / grip,
   * so 11 gives about 8 degrees of slip in a fast corner: planted, but alive.
   */
  lateralGrip: 11,
  /** 3.4 gives roughly 24 degrees of slip — a proper drift angle rather than a spin. */
  driftLateralGrip: 3.4,
  airLateralGrip: 0.25,
  /** Multiplier while the player counter-steers out of a slide, so saves are rewarded. */
  counterSteerGrip: 1.55,
  /** Slip is hard-clamped here so a mistake never becomes an uncontrollable spin. 40 degrees. */
  maxSlipAngle: 0.7,

  // -------------------------------------------------------------------- drift
  driftMinSpeed: 9,
  driftEntrySteer: 0.25,
  driftHopSeconds: 0.26,
  driftHopImpulse: 3.4,
  /** Base yaw the kart holds on its own inside a drift, before steering modulation. */
  driftBaseYaw: 1.28,
  /** Steering into the slide adds this, steering out subtracts it. Full modulation range. */
  driftSteerRange: 0.55,
  driftScrub: 0.32,
  driftBailSeconds: 0.3,
  driftChargeTier1: 0.75,
  driftChargeTier2: 1.6,
  driftChargeTier3: 2.6,

  // ------------------------------------------------ drift chaining (the skill ceiling)
  /**
   * Releasing the drift button for less than this does not end the drift — it registers as a tap.
   * That is what lets "press drift again" mean something while the button is already held, and it
   * is the input on which the whole chaining system rests.
   */
  driftTapGraceSeconds: 0.19,
  /** Charge values at which the three execution windows open. */
  driftWindowCharges: [0.55, 1.35, 2.25] as readonly number[],
  /** How long a window stays open. Tight enough to be a skill, wide enough to be learnable. */
  driftWindowSeconds: 0.24,
  /** A tap this far outside a window still counts as GOOD rather than MISS. */
  driftGoodMarginSeconds: 0.22,
  /** Reserve seconds granted per grade. */
  perfectReserve: 0.34,
  goodReserve: 0.13,
  /** A miss costs charge, so mashing is worse than not trying. */
  missChargePenalty: 0.18,
  /** Fraction of the reserve converted into boost when the drift is released. */
  reserveConversion: 0.85,
  maxBoostReserve: 1.6,
  /** Reserve bleeds away while not drifting, so a chain has to be kept alive. */
  boostReserveDecay: 0.42,
  /** Each consecutive perfect adds this fraction to the released boost. Caps at chainMax. */
  chainBonusPerLink: 0.12,
  chainMax: 6,

  // ------------------------------------------------ tricks
  /** Tapping drift within this long of leaving the ground arms a trick. */
  trickArmSeconds: 0.3,
  /** A trick needs at least this much air to pay out, so kerb hops earn nothing. */
  trickMinAirSeconds: 0.42,
  trickBoostSeconds: 0.62,

  // -------------------------------------------------------------------- boost
  microBoostSeconds: 0.5,
  boostSeconds: 1,
  superBoostSeconds: 1.7,
  boostForce: 21,
  maxBoostSeconds: 3,
  launchBoostSeconds: 0.85,

  // -------------------------------------------------------------------- air
  gravity: 22,
  hardLandingSpeed: 11,
  landingBoostMinAir: 0.45,
  landingBoostSeconds: 0.4,

  // -------------------------------------------------------------------- collision
  /** Kart collision radius, metres. Body is 2.9 x 1.9 so this is a slightly forgiving circle. */
  collisionRadius: 1.15,
  /** Fraction of tangential speed kept when scraping a wall. Arcade slide, not a full stop. */
  wallSlide: 0.88,
  /** Head-on impacts bleed at most this fraction of speed. */
  wallMaxSpeedLoss: 0.45,
  kartRestitution: 0.35,
  kartSeparation: 14,
  /**
   * After an impact is resolved, further impacts are ignored for this long. Without it, sliding
   * along a wall re-triggers the response every step, which is what turns one mistake into
   * twenty-five consecutive impacts and a dead stop.
   */
  impactCooldownSeconds: 0.28,
  /** Above this squareness an impact is frontal rather than a scrape. */
  frontalImpactThreshold: 0.55,
});

/**
 * Surface multipliers applied on top of the vehicle model.
 *
 * `grip` scales the lateral grip coefficient, so it directly controls how readily the surface lets
 * go. The values follow the V2 brief's table; the extra entries exist because the five circuits
 * need floors the brief names (polished shop floor, warehouse concrete) as well as the hazards.
 */
export const SurfaceConfig = Object.freeze({
  ASPHALT: { grip: 1, drag: 1, boost: 0 },
  /** Polished shop floor. */
  FLOOR_TILE: { grip: 0.9, drag: 0.97, boost: 0 },
  /** Warehouse concrete. */
  CONCRETE: { grip: 0.85, drag: 1.02, boost: 0 },
  METAL: { grip: 0.88, drag: 0.94, boost: 0 },
  WOOD: { grip: 0.92, drag: 1, boost: 0 },
  CARPET: { grip: 0.95, drag: 1.3, boost: 0 },
  CARDBOARD: { grip: 0.8, drag: 1.18, boost: 0 },
  /** Wet floor. */
  WET: { grip: 0.65, drag: 1.05, boost: 0 },
  GRASS: { grip: 0.45, drag: 2.2, boost: 0 },
  SAND: { grip: 0.4, drag: 2.6, boost: 0 },
  /** Spilled ink or oil: the hazard surface. Very easy to drift, very easy to lose. */
  INK: { grip: 0.35, drag: 1.05, boost: 0 },
  /** A moving belt: normal grip, less drag, and it pushes you along. */
  CONVEYOR: { grip: 1, drag: 0.9, boost: 6 },
  /** Off the drivable surface entirely. */
  OFFROAD: { grip: 0.45, drag: 3.1, boost: 0 },
});

export type SurfaceName = keyof typeof SurfaceConfig;

/**
 * The world beyond the road.
 *
 * Until now there was none: every node defaulted to having a wall on both sides, so a circuit was a
 * walled corridor and the surfaces below — grass, sand, off-road — were unreachable. A kart racer
 * where you cannot put a wheel on the dirt is missing most of its texture, so the road now has a
 * verge you can drive on, at a real cost in grip, and a limit past which you are put back.
 */
export const TerrainConfig = Object.freeze({
  /**
   * How far past the road edge the drivable verge extends, in metres.
   *
   * Wide enough to cut a corner or run wide and recover, narrow enough that the racing line still
   * matters. Beyond it the kart is recovered rather than allowed to wander into the backdrop.
   */
  vergeMetres: 16,
  /**
   * Where recovery triggers, past the road edge.
   *
   * Deliberately larger than the verge so the boundary is felt as a consequence rather than as a
   * wall a metre outside the tarmac: you get a moment of being genuinely lost before being helped.
   */
  recoveryMetres: 26,
  /**
   * How far the terrain mesh reaches past the widest part of the circuit.
   *
   * A *visual* number, not a physical one: it decides how much ground there is to look at, and it is
   * set from the backdrop shell rather than from taste. That shell sits 820 m from the camera, so a
   * margin of 700 leaves at most 120 m of gap between where the ground stops and where the backdrop
   * starts — which, from a camera three metres up, is a quarter of a degree of view. At the 240 this
   * started as, the gap was 580 m and the ground visibly ended before the horizon did.
   *
   * It costs nothing worth counting: the field is one plane with a dozen subdivisions, and the pixels
   * it covers are the same pixels either way. Only its extent changes, not its fill.
   */
  visualMarginMetres: 700,
});

export const GameplayConfig = Object.freeze({
  allowedLaps: [1, 2, 3, 5] as const,
  countdownSeconds: 3,
  checkpointRadius: 14,
  recoveryDelaySeconds: 1.2,
  wrongWayGraceSeconds: 1.6,
  itemRespawnSeconds: 6,
  maxPlayers: 4,
});

export type AllowedLaps = (typeof GameplayConfig.allowedLaps)[number];

export function isAllowedLaps(value: number): value is AllowedLaps {
  return GameplayConfig.allowedLaps.includes(value as AllowedLaps);
}
