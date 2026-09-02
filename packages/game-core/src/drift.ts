import { VehicleConfig } from "./config.js";
import type { DriftEvent, DriftGrade, GameInput, KartState } from "./types.js";

/**
 * DRIFT SYSTEM.
 *
 * The state machine and the grading. The physics of the slide live in `vehicle.ts`, because grip and
 * yaw are part of the integration step; what lives here is everything that decides *when* the kart
 * is drifting and *how well* the player is doing it.
 *
 * The V2 brief asks for a skill ceiling: two players on the same lap should get different results
 * from the same circuit. That comes from three things, in order of how much they matter:
 *
 *  1. The drift is modulable — steering into the slide closes the line, steering out opens it.
 *  2. Three execution windows open during a long drift. Tapping the drift button inside one is a
 *     PERFECT and banks reserve; near one is a GOOD; anywhere else is a MISS and costs charge.
 *  3. Reserve carries into the next drift but bleeds away, so a chain has to be kept alive.
 *
 * The important design constraint is that none of it is compulsory. A player who simply holds drift
 * through a corner still gets a mini-turbo — they just get the smallest one.
 *
 * The input problem this solves: "press drift again" is meaningless while the button is already
 * held. So a *brief* release does not end the drift, it registers as a tap. Release for longer than
 * `driftTapGraceSeconds` and the drift ends and pays out as normal.
 */

export type { DriftEvent, DriftGrade };

const NO_EVENT: DriftEvent = {
  started: false,
  grade: "NONE",
  released: false,
  boostSeconds: 0,
  tier: 0,
  chain: 0,
  windowOpened: false,
};

export function driftLevelForCharge(charge: number): 0 | 1 | 2 | 3 {
  if (charge >= VehicleConfig.driftChargeTier3) return 3;
  if (charge >= VehicleConfig.driftChargeTier2) return 2;
  if (charge >= VehicleConfig.driftChargeTier1) return 1;
  return 0;
}

export function boostSecondsForDrift(level: 0 | 1 | 2 | 3): number {
  return [0, VehicleConfig.microBoostSeconds, VehicleConfig.boostSeconds, VehicleConfig.superBoostSeconds][level] ?? 0;
}

/**
 * Which window, if any, is open at this charge — and how far the charge is from the nearest one.
 * Returned in charge units; the caller converts using the current charge rate.
 */
function windowAt(charge: number, rate: number): { index: number; open: boolean; distance: number } {
  const halfWidth = (VehicleConfig.driftWindowSeconds * rate) / 2;
  let nearest = -1;
  let nearestDistance = Number.POSITIVE_INFINITY;
  for (let index = 0; index < VehicleConfig.driftWindowCharges.length; index += 1) {
    const centre = VehicleConfig.driftWindowCharges[index]!;
    const distance = Math.abs(charge - centre);
    if (distance < nearestDistance) {
      nearestDistance = distance;
      nearest = index;
    }
  }
  return { index: nearest, open: nearestDistance <= halfWidth, distance: nearestDistance };
}

/** Charge accrued per second at the kart's current slip and speed. Shared with the integrator. */
export function chargeRate(state: KartState): number {
  const slipFactor = Math.min(1, Math.abs(state.slipAngle) / VehicleConfig.maxSlipAngle);
  const planar = Math.hypot(state.velocity.x, state.velocity.z);
  const speedFactor = Math.min(1, planar / (VehicleConfig.maxSpeed * 0.62));
  return (0.5 + slipFactor * 0.85) * speedFactor;
}

/**
 * Advances the drift state machine. Mutates `state` and returns what happened.
 * Called from `simulateKart` before the forces are applied, because the drift decides the grip.
 */
export function stepDrift(state: KartState, input: GameInput, dt: number): DriftEvent {
  const planarSpeed = Math.hypot(state.velocity.x, state.velocity.z);
  const event: DriftEvent = { ...NO_EVENT };

  // ---------------------------------------------------------------- reserve decay
  // Outside a drift the bank bleeds away. This is what makes a chain something to maintain rather
  // than something to accumulate and cash in whenever convenient.
  if (!state.driftActive && state.boostReserve > 0) {
    state.boostReserve = Math.max(0, state.boostReserve - VehicleConfig.boostReserveDecay * dt);
    if (state.boostReserve === 0) state.driftChain = 0;
  }

  // ---------------------------------------------------------------- entry
  const wantsEntry = input.drift && state.grounded;
  const steering = Math.abs(input.steer) > VehicleConfig.driftEntrySteer;
  if (!state.driftActive && wantsEntry && steering && planarSpeed > VehicleConfig.driftMinSpeed) {
    state.driftActive = true;
    state.driftDirection = input.steer > 0 ? 1 : -1;
    state.driftCharge = 0;
    state.driftLevel = 0;
    state.driftTapWindow = 0;
    state.driftReleaseTime = 0;
    state.driftWindowsUsed = 0;
    state.lastDriftGrade = "NONE";
    // The hop is what tells the player the drift armed, before any slide is visible, and it gives
    // them a moment in the air to set the angle before it bites.
    state.hopTimer = VehicleConfig.driftHopSeconds;
    state.verticalSpeed = Math.max(state.verticalSpeed, VehicleConfig.driftHopImpulse);
    state.grounded = false;
    event.started = true;
    return event;
  }

  state.hopTimer = Math.max(0, state.hopTimer - dt);

  if (!state.driftActive) return event;

  // ---------------------------------------------------------------- charge
  const rate = chargeRate(state);
  const chargeBefore = state.driftCharge;
  state.driftCharge += rate * dt;
  state.driftLevel = driftLevelForCharge(state.driftCharge);

  // Announce a window opening so the runtime can flash a cue at exactly the right moment.
  const before = windowAt(chargeBefore, rate);
  const now = windowAt(state.driftCharge, rate);
  if (now.open && !before.open && now.index >= state.driftWindowsUsed) event.windowOpened = true;

  // ---------------------------------------------------------------- tap detection
  if (!input.drift) {
    state.driftReleaseTime += dt;
  } else if (state.driftReleaseTime > 0) {
    /**
     * The button came back inside the grace period, so this is a tap rather than a release. Grade it
     * against the nearest window and keep drifting.
     */
    const tap = windowAt(state.driftCharge, rate);
    const marginCharge = VehicleConfig.driftGoodMarginSeconds * rate;
    const alreadyUsed = tap.index < state.driftWindowsUsed;

    if (alreadyUsed) {
      event.grade = "MISS";
    } else if (tap.open) {
      event.grade = "PERFECT";
    } else if (tap.distance <= marginCharge) {
      event.grade = "GOOD";
    } else {
      event.grade = "MISS";
    }

    if (event.grade === "PERFECT") {
      state.boostReserve = Math.min(
        VehicleConfig.maxBoostReserve,
        state.boostReserve + VehicleConfig.perfectReserve,
      );
      state.driftChain = Math.min(VehicleConfig.chainMax, state.driftChain + 1);
      state.driftWindowsUsed = tap.index + 1;
    } else if (event.grade === "GOOD") {
      state.boostReserve = Math.min(
        VehicleConfig.maxBoostReserve,
        state.boostReserve + VehicleConfig.goodReserve,
      );
      state.driftWindowsUsed = tap.index + 1;
    } else {
      // A miss costs charge and breaks the chain, so mashing the button is worse than not trying.
      state.driftCharge = Math.max(0, state.driftCharge - VehicleConfig.missChargePenalty);
      state.driftLevel = driftLevelForCharge(state.driftCharge);
      state.driftChain = 0;
    }

    state.lastDriftGrade = event.grade;
    state.driftReleaseTime = 0;
  }

  // ---------------------------------------------------------------- exit
  const releasedForGood = state.driftReleaseTime > VehicleConfig.driftTapGraceSeconds;
  const tooSlow = planarSpeed < VehicleConfig.driftMinSpeed * 0.62;

  // Steering hard the other way for a moment is a deliberate bail-out, not a mistake to punish.
  const against = input.steer * state.driftDirection;
  state.counterSteerTime = against < -0.55 ? state.counterSteerTime + dt : 0;
  const bailedOut = state.counterSteerTime > VehicleConfig.driftBailSeconds;

  if (releasedForGood || tooSlow || bailedOut) {
    const level = driftLevelForCharge(state.driftCharge);
    let payout = 0;
    if (level > 0 && !tooSlow) {
      const base = boostSecondsForDrift(level);
      const reserve = state.boostReserve * VehicleConfig.reserveConversion;
      const chainBonus = 1 + state.driftChain * VehicleConfig.chainBonusPerLink;
      payout = (base + reserve) * chainBonus;
      state.boostRemaining = Math.min(VehicleConfig.maxBoostSeconds, state.boostRemaining + payout);
      state.boostTier = level;
      // The reserve is spent on release; keeping the chain is what carries value forward.
      state.boostReserve = 0;
    }

    event.released = true;
    event.boostSeconds = payout;
    event.tier = level;
    event.chain = state.driftChain;

    state.driftActive = false;
    state.driftDirection = 0;
    state.driftCharge = 0;
    state.driftLevel = 0;
    state.counterSteerTime = 0;
    state.driftReleaseTime = 0;
    state.driftWindowsUsed = 0;
    state.driftTapWindow = 0;
  } else {
    // Exposed for the HUD and the kart's own glow: how close the next window is, 0 to 1.
    const next = windowAt(state.driftCharge, rate);
    state.driftTapWindow = next.open && next.index >= state.driftWindowsUsed ? 1 : 0;
  }

  return event;
}

/** Cancels a drift without any payout. Used by wall impacts and respawns. */
export function cancelDrift(state: KartState): void {
  state.driftActive = false;
  state.driftDirection = 0;
  state.driftCharge = 0;
  state.driftLevel = 0;
  state.driftTapWindow = 0;
  state.driftReleaseTime = 0;
  state.driftWindowsUsed = 0;
  state.counterSteerTime = 0;
}

/**
 * TRICK SYSTEM.
 *
 * Tapping drift just after leaving a ramp arms a trick. Landing it cleanly pays a boost. Tapping
 * late does nothing, and a hop off a kerb is too short to qualify — the payout needs real air, or
 * the reward stops meaning anything.
 */
export function armTrick(state: KartState, input: GameInput): boolean {
  if (state.grounded || state.trickArmed) return false;
  if (!input.drift) return false;
  if (state.airTime > VehicleConfig.trickArmSeconds) return false;
  state.trickArmed = true;
  return true;
}

/** Called on landing. Returns the trick's boost, or zero if it did not qualify. */
export function resolveTrick(state: KartState): number {
  if (!state.trickArmed) return 0;
  const qualified = state.airTime >= VehicleConfig.trickMinAirSeconds;
  state.trickArmed = false;
  state.trickRotation = 0;
  return qualified ? VehicleConfig.trickBoostSeconds : 0;
}
