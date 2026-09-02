import { VehicleConfig } from "./config.js";
import { armTrick, boostSecondsForDrift, driftLevelForCharge, resolveTrick, stepDrift, type DriftEvent } from "./drift.js";
import type { GameInput, KartState, SurfaceGrip } from "./types.js";

/**
 * PRINT RUSH V5 — arcade kart model.
 *
 * The V4 model moved the kart along its heading (`position += forward * speed`), so heading and
 * travel could never disagree. Without that disagreement there is no slip angle, no inertia and no
 * drift — only a turn-rate multiplier pretending to be one.
 *
 * V5 carries a world-space velocity vector that is independent of the heading. Every frame the
 * velocity is decomposed into a longitudinal component (along the nose) and a lateral one (across
 * the tyres). The engine and brakes act on the longitudinal part; grip bleeds the lateral part away
 * at a rate that drops sharply while drifting. Rotating the heading faster than grip can realign
 * the velocity is what produces a slide, so the drift is a consequence of the model rather than a
 * special case bolted onto it.
 */

const TAU = Math.PI * 2;

export function createKartState(x = 0, z = 0, rotation = 0, y = 0.7): KartState {
  return {
    position: { x, y, z },
    velocity: { x: 0, z: 0 },
    rotation,
    yawRate: 0,
    speed: 0,
    lateralSpeed: 0,
    slipAngle: 0,
    verticalSpeed: 0,
    grounded: true,
    airTime: 0,
    boostRemaining: 0,
    boostTier: 0,
    driftActive: false,
    driftDirection: 0,
    driftCharge: 0,
    driftLevel: 0,
    hopTimer: 0,
    counterSteerTime: 0,
    boostReserve: 0,
    driftChain: 0,
    driftReleaseTime: 0,
    driftWindowsUsed: 0,
    driftTapWindow: 0,
    lastDriftGrade: "NONE",
    trickArmed: false,
    trickRotation: 0,
    impactCooldown: 0,
    suspension: 0,
    steerVisual: 0,
    lean: 0,
    pitch: 0,
    lastDriftEvent: {
      started: false,
      grade: "NONE",
      released: false,
      boostSeconds: 0,
      tier: 0,
      chain: 0,
      windowOpened: false,
    },
  };
}

export function cloneKartState(state: KartState): KartState {
  return { ...state, position: { ...state.position }, velocity: { ...state.velocity } };
}

// The drift state machine and its grading live in `drift.ts`; these are re-exported so callers do
// not have to know which module owns them.
export { boostSecondsForDrift, driftLevelForCharge };

export function applyBoost(state: KartState, seconds: number, tier: 0 | 1 | 2 | 3 = 0): KartState {
  const next = cloneKartState(state);
  next.boostRemaining = Math.min(VehicleConfig.maxBoostSeconds, next.boostRemaining + Math.max(0, seconds));
  next.boostTier = Math.max(next.boostTier, tier) as 0 | 1 | 2 | 3;
  return next;
}

/** Planar speed regardless of which way the nose points. Used for camera, audio and HUD. */
export function travelSpeed(state: KartState): number {
  return Math.hypot(state.velocity.x, state.velocity.z);
}

/**
 * Steering authority falls off with speed so the kart is nimble in hairpins and stable on straights.
 * The falloff is deliberately steep at first and then flat — a linear ramp makes mid-speed corners
 * feel numb.
 */
export function steerRateForSpeed(speedRatio: number): number {
  const t = Math.min(1, Math.max(0, speedRatio));
  const shaped = (1 - t) ** 1.4;
  return VehicleConfig.steeringHighSpeed + (VehicleConfig.steeringLowSpeed - VehicleConfig.steeringHighSpeed) * shaped;
}

/** Engine force tapers toward the speed ceiling instead of cutting out, which is what reads as weight. */
function engineAcceleration(longitudinal: number, ceiling: number): number {
  const ratio = Math.min(1, Math.max(0, longitudinal / ceiling));
  return VehicleConfig.acceleration * (1 - VehicleConfig.accelerationFalloff * ratio ** 1.6);
}

function wrapAngle(angle: number): number {
  let value = angle;
  while (value > Math.PI) value -= TAU;
  while (value < -Math.PI) value += TAU;
  return value;
}

const DEFAULT_SURFACE: SurfaceGrip = { grip: 1, drag: 1, boost: 0 };

export function simulateKart(
  previous: KartState,
  input: GameInput,
  dt: number,
  surface: SurfaceGrip = DEFAULT_SURFACE,
): KartState {
  const state = cloneKartState(previous);

  const forwardX = Math.sin(state.rotation);
  const forwardZ = Math.cos(state.rotation);
  const rightX = forwardZ;
  const rightZ = -forwardX;

  let longitudinal = state.velocity.x * forwardX + state.velocity.z * forwardZ;
  let lateral = state.velocity.x * rightX + state.velocity.z * rightZ;

  // ---------------------------------------------------------------- drift and tricks
  const planarSpeed = Math.hypot(longitudinal, lateral);
  // The whole drift state machine, including window grading and the reserve, lives in `drift.ts`.
  // It runs before the forces because the drift decides how much lateral grip the tyres have.
  const drift = stepDrift(state, input, dt);
  // A tap just after take-off arms a trick; `resolveGround` pays it out on landing.
  armTrick(state, input);
  state.impactCooldown = Math.max(0, state.impactCooldown - dt);

  // ---------------------------------------------------------------- steering and yaw
  const boosting = state.boostRemaining > 0;
  const ceiling = boosting ? VehicleConfig.boostedMaxSpeed : VehicleConfig.maxSpeed;
  const speedRatio = Math.min(1, planarSpeed / VehicleConfig.maxSpeed);

  let targetYawRate: number;
  if (state.driftActive) {
    // Inside the drift the kart holds an angle on its own; steering modulates how tight it is.
    // Steering into the slide closes the line, steering out of it opens the line back up.
    const into = Math.min(1, Math.max(-1, input.steer * state.driftDirection));
    const magnitude = VehicleConfig.driftBaseYaw + into * VehicleConfig.driftSteerRange;
    targetYawRate = state.driftDirection * magnitude * (0.55 + 0.45 * speedRatio);
  } else {
    const authority = state.grounded ? 1 : VehicleConfig.airControl;
    const direction = longitudinal < -0.4 ? -1 : 1;
    targetYawRate = input.steer * steerRateForSpeed(speedRatio) * authority * direction;
    // A stationary kart should not pirouette on the spot.
    targetYawRate *= Math.min(1, planarSpeed / 3.2);
  }

  // Short interpolation: enough to stop the yaw snapping digitally, short enough to feel immediate.
  const yawBlend = 1 - Math.exp(-dt / VehicleConfig.yawResponseSeconds);
  state.yawRate += (targetYawRate - state.yawRate) * yawBlend;
  state.rotation = wrapAngle(state.rotation + state.yawRate * dt);

  // Rotating the chassis moves velocity from the longitudinal axis onto the lateral one. This single
  // rotation is the whole reason a slide exists.
  const yawStep = state.yawRate * dt;
  const cos = Math.cos(yawStep);
  const sin = Math.sin(yawStep);
  const rotatedLongitudinal = longitudinal * cos + lateral * sin;
  const rotatedLateral = lateral * cos - longitudinal * sin;
  longitudinal = rotatedLongitudinal;
  lateral = rotatedLateral;

  // ---------------------------------------------------------------- longitudinal forces
  if (state.grounded) {
    const reversing = input.brake > 0 && longitudinal <= 0.5;
    if (reversing) {
      longitudinal = Math.max(
        -VehicleConfig.reverseSpeed,
        longitudinal - VehicleConfig.reverseAcceleration * input.brake * dt,
      );
    } else {
      const boostForce = boosting ? VehicleConfig.boostForce : 0;
      longitudinal += (engineAcceleration(longitudinal, ceiling) * input.throttle + boostForce) * dt;
      if (input.brake > 0) {
        longitudinal = Math.max(0, longitudinal - VehicleConfig.brakingPower * input.brake * dt);
      }
    }

    const coasting = input.throttle < 0.05 && input.brake < 0.05;
    const rolling = VehicleConfig.rollingResistance * (coasting ? 2.4 : 1) * surface.drag;
    const aero = VehicleConfig.aeroDrag * longitudinal * Math.abs(longitudinal);
    longitudinal -= Math.sign(longitudinal) * Math.min(Math.abs(longitudinal), (rolling + Math.abs(aero)) * dt);

    // Drifting scrubs a little speed. That cost is what makes the charged boost a real trade.
    if (state.driftActive) longitudinal *= Math.max(0.99, 1 - dt * VehicleConfig.driftScrub);
  } else {
    longitudinal -= Math.sign(longitudinal) * Math.min(Math.abs(longitudinal), VehicleConfig.airDrag * dt);
  }

  longitudinal = Math.max(-VehicleConfig.reverseSpeed, Math.min(ceiling, longitudinal));

  // ---------------------------------------------------------------- lateral grip
  if (state.grounded) {
    const baseGrip = state.driftActive ? VehicleConfig.driftLateralGrip : VehicleConfig.lateralGrip;
    // Counter-steering while sliding without the drift button is how a player saves a slide.
    const catching = !state.driftActive && Math.sign(input.steer) === -Math.sign(lateral) && Math.abs(input.steer) > 0.2;
    const grip = baseGrip * surface.grip * (catching ? VehicleConfig.counterSteerGrip : 1);
    lateral *= Math.exp(-grip * dt);
  } else {
    lateral *= Math.exp(-VehicleConfig.airLateralGrip * dt);
  }

  // Hard cap on slip so a mistake never becomes an uncontrollable spin.
  const slip = Math.atan2(lateral, Math.max(0.001, Math.abs(longitudinal)));
  if (Math.abs(slip) > VehicleConfig.maxSlipAngle) {
    lateral = Math.sign(lateral) * Math.abs(longitudinal) * Math.tan(VehicleConfig.maxSlipAngle);
  }

  state.slipAngle = Math.atan2(lateral, Math.max(0.001, Math.abs(longitudinal)));
  state.speed = longitudinal;
  state.lateralSpeed = lateral;
  state.velocity.x = forwardX * longitudinal + rightX * lateral;
  state.velocity.z = forwardZ * longitudinal + rightZ * lateral;

  // ---------------------------------------------------------------- integrate
  state.position.x += state.velocity.x * dt;
  state.position.z += state.velocity.z * dt;

  if (!state.grounded) {
    state.verticalSpeed -= VehicleConfig.gravity * dt;
    state.airTime += dt;
  }
  state.position.y += state.verticalSpeed * dt;

  state.boostRemaining = Math.max(0, state.boostRemaining - dt);
  if (state.boostRemaining === 0) state.boostTier = 0;

  // ---------------------------------------------------------------- visual-only channels
  const steerTarget = state.driftActive
    ? state.driftDirection * 0.85 + input.steer * 0.3
    : input.steer;
  state.steerVisual += (Math.max(-1, Math.min(1, steerTarget)) - state.steerVisual) * (1 - Math.exp(-dt * 14));
  const leanTarget = -state.lateralSpeed / VehicleConfig.maxSpeed * 1.9 - state.yawRate * 0.11;
  state.lean += (Math.max(-0.42, Math.min(0.42, leanTarget)) - state.lean) * (1 - Math.exp(-dt * 9));

  /**
   * Pitch: the nose dips under braking and lifts under power. This is a visual-only channel, but it
   * is most of what makes an arcade kart read as having mass — without it the chassis is a rigid
   * block sliding around, however good the underlying model is.
   */
  const longitudinalAccel = (longitudinal - previous.speed) / Math.max(dt, 1e-4);
  const pitchTarget = Math.max(-0.09, Math.min(0.07, -longitudinalAccel / 260));
  state.pitch += (pitchTarget - state.pitch) * (1 - Math.exp(-dt * 7));

  state.suspension = Math.max(0, state.suspension - dt * 3.4);
  // A held trick spins the chassis while airborne. Purely cosmetic; the physics is untouched.
  state.trickRotation = state.trickArmed && !state.grounded
    ? state.trickRotation + dt * 7.5
    : state.trickRotation * Math.max(0, 1 - dt * 6);

  state.lastDriftEvent = drift;
  return state;
}

/**
 * Ground contact is resolved by the caller, which is the only thing that knows the track surface.
 * Returns the landing report so the runtime can drive camera, VFX and the landing boost.
 */
export type LandingReport = {
  landed: boolean;
  impact: number;
  boostSeconds: number;
  /** True when a trick was armed on take-off and the landing qualified for its bonus. */
  trickLanded: boolean;
};

export function resolveGround(state: KartState, groundY: number, dt: number): LandingReport {
  const report: LandingReport = { landed: false, impact: 0, boostSeconds: 0, trickLanded: false };

  if (state.position.y > groundY + 0.06) {
    if (state.grounded) {
      state.grounded = false;
      state.airTime = 0;
    }
    return report;
  }

  if (!state.grounded) {
    const impact = Math.max(0, -state.verticalSpeed);
    report.landed = true;
    report.impact = impact;
    state.suspension = Math.min(1, impact / VehicleConfig.hardLandingSpeed);
    // A clean, committed jump pays out; a scrappy one just costs a little speed.
    if (state.airTime > VehicleConfig.landingBoostMinAir && impact < VehicleConfig.hardLandingSpeed) {
      report.boostSeconds = VehicleConfig.landingBoostSeconds;
    }
    // A trick landed on top of that stacks, which is what makes committing to one worth the risk of
    // being sideways in the air.
    const trickBoost = resolveTrick(state);
    if (trickBoost > 0) {
      report.boostSeconds += trickBoost;
      report.trickLanded = true;
    }
    if (impact > VehicleConfig.hardLandingSpeed) {
      const loss = Math.min(0.24, (impact - VehicleConfig.hardLandingSpeed) * 0.02);
      state.speed *= 1 - loss;
      state.velocity.x *= 1 - loss;
      state.velocity.z *= 1 - loss;
    }
    state.grounded = true;
    state.airTime = 0;
  }

  state.position.y = groundY;
  state.verticalSpeed = 0;
  // Settle onto slopes rather than snapping, so crests and dips read as terrain.
  void dt;
  return report;
}

export function launch(state: KartState, verticalSpeed: number): void {
  state.verticalSpeed = Math.max(state.verticalSpeed, verticalSpeed);
  state.grounded = false;
  state.airTime = 0;
}
