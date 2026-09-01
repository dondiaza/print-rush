export const NetworkConfig = Object.freeze({
  inputRateHz: 30,
  simulationRateHz: 30,
  physicsSubsteps: 2,
  statePatchRateHz: 20,
  maxInputsPerSecond: 40,
  reconnectSeconds: 25,
  interpolationDelayMs: 100,
  snapDistance: 8,
  smoothingFactor: 0.14,
});

export const VehicleConfig = Object.freeze({
  maxSpeed: 29,
  boostedMaxSpeed: 37,
  reverseSpeed: 8,
  acceleration: 21.5,
  reverseAcceleration: 9,
  brakingPower: 28,
  steeringLowSpeed: 2.42,
  steeringHighSpeed: 1.18,
  grip: 8.5,
  driftGrip: 2.6,
  driftTurnMultiplier: 1.34,
  drag: 0.64,
  mass: 82,
  boostForce: 17,
  maxBoostSeconds: 2.8,
  launchBoostSeconds: 0.7,
});

export const GameplayConfig = Object.freeze({
  allowedLaps: [1, 2, 3, 5] as const,
  countdownSeconds: 3,
  checkpointRadius: 10,
  recoveryDelaySeconds: 2.5,
  wrongWayGraceSeconds: 1.6,
  itemRespawnSeconds: 6,
  maxPlayers: 4,
});

export type AllowedLaps = (typeof GameplayConfig.allowedLaps)[number];

export function isAllowedLaps(value: number): value is AllowedLaps {
  return GameplayConfig.allowedLaps.includes(value as AllowedLaps);
}
