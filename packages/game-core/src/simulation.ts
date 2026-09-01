import { VehicleConfig } from "./config.js";
import type { GameInput, KartState } from "./types.js";

export function createKartState(x = 0, z = 0, rotation = 0): KartState {
  return {
    position: { x, y: 0.7, z },
    rotation,
    speed: 0,
    verticalSpeed: 0,
    boostRemaining: 0,
    driftCharge: 0,
    driftLevel: 0,
  };
}

export function driftLevelForCharge(charge: number): 0 | 1 | 2 | 3 {
  if (charge >= 1.7) return 3;
  if (charge >= 1.05) return 2;
  if (charge >= 0.5) return 1;
  return 0;
}

export function boostSecondsForDrift(level: 0 | 1 | 2 | 3): number {
  return [0, 0.55, 1.05, 1.65][level] ?? 0;
}

export function applyBoost(state: KartState, seconds: number): KartState {
  return {
    ...state,
    boostRemaining: Math.min(VehicleConfig.maxBoostSeconds, state.boostRemaining + Math.max(0, seconds)),
  };
}

export function simulateKart(previous: KartState, rawInput: GameInput, dt: number): KartState {
  const input = rawInput;
  const state: KartState = {
    ...previous,
    position: { ...previous.position },
  };
  const wasDrifting = previous.driftCharge > 0;
  const canDrift = Math.abs(state.speed) > 6.2 && Math.abs(input.steer) > 0.18;

  if (input.drift && canDrift) {
    state.driftCharge = Math.min(2.25, state.driftCharge + dt * (.5 + Math.abs(input.steer) * .72));
  } else if (wasDrifting) {
    state.boostRemaining = Math.min(
      VehicleConfig.maxBoostSeconds,
      state.boostRemaining + boostSecondsForDrift(driftLevelForCharge(previous.driftCharge)),
    );
    state.driftCharge = 0;
  }
  state.driftLevel = driftLevelForCharge(state.driftCharge);

  const boosting = state.boostRemaining > 0;
  const maxForward = boosting ? VehicleConfig.boostedMaxSpeed : VehicleConfig.maxSpeed;
  const engine = input.throttle * VehicleConfig.acceleration + (boosting ? VehicleConfig.boostForce : 0);
  const braking = input.brake * VehicleConfig.brakingPower;

  if (input.brake > 0 && state.speed <= 0.4) {
    state.speed = Math.max(-VehicleConfig.reverseSpeed, state.speed - VehicleConfig.reverseAcceleration * input.brake * dt);
  } else {
    state.speed += engine * dt;
    if (input.brake > 0) state.speed = Math.max(0, state.speed - braking * dt);
  }

  const drag = input.throttle === 0 ? VehicleConfig.drag * 2.2 : VehicleConfig.drag;
  state.speed -= Math.sign(state.speed) * Math.min(Math.abs(state.speed), drag * dt);
  state.speed = Math.max(-VehicleConfig.reverseSpeed, Math.min(maxForward, state.speed));

  const speedRatio = Math.min(1, Math.abs(state.speed) / VehicleConfig.maxSpeed);
  const steeringRate = VehicleConfig.steeringLowSpeed +
    (VehicleConfig.steeringHighSpeed - VehicleConfig.steeringLowSpeed) * speedRatio;
  const driftMultiplier = input.drift && canDrift ? VehicleConfig.driftTurnMultiplier : 1;
  const steeringAuthority = .32 + speedRatio * .68;
  const direction = state.speed < 0 ? -1 : 1;
  state.rotation += input.steer * steeringRate * driftMultiplier * steeringAuthority * direction * dt;

  if (input.drift && canDrift) {
    // Drifting should rotate decisively without killing momentum. The small
    // speed bleed gives the player a reason to release into a charged boost.
    state.speed *= Math.max(.992, 1 - dt * .28);
  }

  state.position.x += Math.sin(state.rotation) * state.speed * dt;
  state.position.z += Math.cos(state.rotation) * state.speed * dt;
  state.boostRemaining = Math.max(0, state.boostRemaining - dt);
  return state;
}
