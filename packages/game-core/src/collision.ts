import { VehicleConfig } from "./config.js";
import { cancelDrift } from "./drift.js";
import type { KartState, Vec2 } from "./types.js";

/**
 * Arcade collision response.
 *
 * V4 loaded the full Rapier WASM runtime to create one flat floor collider and a kinematic body
 * that only copied the kart's position — it resolved nothing. Collision here is analytic against
 * the track's own geometry: a circle against the wall planes derived from the road spline, and
 * circle-against-circle between karts. It is faster, deterministic, and produces the same result on
 * the client and the authoritative server, which a physics engine stepping on two machines does not.
 */

/**
 * The V2 brief asks for impacts to be told apart rather than all producing one response. The kind is
 * derived from how square the hit is and which way the kart was travelling, so the runtime can pick
 * the right sound, particle and camera impulse without re-deriving any of it.
 */
export type ImpactKind = "SCRAPE" | "FRONTAL" | "REAR" | "HEAVY";

export type WallHit = {
  kind: ImpactKind;
  /** Impact strength 0..1, where 1 is a square head-on hit at top speed. */
  severity: number;
  /** True when the kart is mostly sliding along the wall rather than hitting it. */
  glancing: boolean;
  /** How square the hit was, 0 parallel to 1 head-on. Drives the speed loss. */
  squareness: number;
};

/**
 * Pushes the kart out of a wall and converts the impact into a slide.
 * `normal` points away from the wall, into open track, and must be unit length.
 */
export function resolveWall(state: KartState, normal: Vec2, penetration: number): WallHit | null {
  const approach = state.velocity.x * normal.x + state.velocity.z * normal.z;
  if (penetration <= 0) return null;

  // Push-out always happens, even during the cooldown: the kart must never be left inside geometry.
  state.position.x += normal.x * penetration;
  state.position.z += normal.z * penetration;

  if (approach >= 0) return null;

  /**
   * The cooldown is why one mistake stays one mistake. Grinding along a barrier satisfies the
   * penetration test on every step, and without this gate the kart would take the full impact
   * response dozens of times a second and stop dead against a wall it was merely brushing.
   */
  if (state.impactCooldown > 0) {
    // Still bleed the component going into the wall, or the kart would grind while accelerating.
    const grindTangentX = state.velocity.x - normal.x * approach;
    const grindTangentZ = state.velocity.z - normal.z * approach;
    state.velocity.x = grindTangentX;
    state.velocity.z = grindTangentZ;
    syncLongitudinal(state);
    return null;
  }

  const speed = Math.hypot(state.velocity.x, state.velocity.z);
  // How square the hit is: 1 is straight into the wall, 0 is perfectly parallel.
  const squareness = speed > 0.01 ? Math.min(1, -approach / speed) : 0;
  const severity = squareness * Math.min(1, speed / VehicleConfig.maxSpeed);
  const glancing = squareness < 0.4;

  // Reversing into something is a rear impact and should not pitch the kart forward or spin it.
  const reversing = state.speed < -0.5;
  const kind: ImpactKind = glancing
    ? "SCRAPE"
    : reversing
      ? "REAR"
      : squareness >= VehicleConfig.frontalImpactThreshold && severity > 0.55
        ? "HEAVY"
        : "FRONTAL";

  state.impactCooldown = VehicleConfig.impactCooldownSeconds;

  // Remove the component going into the wall, keep most of the component going along it.
  const tangentX = state.velocity.x - normal.x * approach;
  const tangentZ = state.velocity.z - normal.z * approach;
  const keep = VehicleConfig.wallSlide * (1 - VehicleConfig.wallMaxSpeedLoss * squareness ** 2);
  state.velocity.x = tangentX * keep;
  state.velocity.z = tangentZ * keep;

  // A square hit also straightens the kart out a little, which stops players grinding along walls
  // at full angle. A glancing hit leaves the heading alone so scraping a barrier stays recoverable.
  if (!glancing) {
    const wallYaw = Math.atan2(tangentX, tangentZ);
    let delta = wallYaw - state.rotation;
    while (delta > Math.PI) delta -= Math.PI * 2;
    while (delta < -Math.PI) delta += Math.PI * 2;
    state.rotation += delta * Math.min(0.6, squareness * 0.7);
    state.yawRate *= 0.45;
  }

  /**
   * A heavy hit bounces the kart back off the wall instead of just scrubbing it. Without some
   * rebound a square impact leaves the kart pinned against the surface with no speed and no way out,
   * which reads as the game freezing rather than as a crash.
   */
  if (kind === "HEAVY") {
    const rebound = speed * 0.18;
    state.velocity.x += normal.x * rebound;
    state.velocity.z += normal.z * rebound;
  }

  // Hitting a wall cancels a drift and forfeits the reserve: there is nothing to charge while
  // stopped against concrete, and keeping the bank would make walls a free place to park a chain.
  if (severity > 0.3 && state.driftActive) {
    cancelDrift(state);
    state.boostReserve = 0;
    state.driftChain = 0;
  }

  syncLongitudinal(state);
  return { kind, severity, glancing, squareness };
}

/**
 * Equal-mass circle collision between two karts. Deliberately soft: karts should shoulder each
 * other around without the pack turning into a pinball table.
 */
export function resolveKartPair(a: KartState, b: KartState): number {
  const dx = b.position.x - a.position.x;
  const dz = b.position.z - a.position.z;
  const minimum = VehicleConfig.collisionRadius * 2;
  const distanceSquared = dx * dx + dz * dz;
  if (distanceSquared >= minimum * minimum || distanceSquared < 1e-6) return 0;

  const distance = Math.sqrt(distanceSquared);
  const nx = dx / distance;
  const nz = dz / distance;
  const overlap = minimum - distance;

  a.position.x -= nx * overlap * 0.5;
  a.position.z -= nz * overlap * 0.5;
  b.position.x += nx * overlap * 0.5;
  b.position.z += nz * overlap * 0.5;

  const relative = (b.velocity.x - a.velocity.x) * nx + (b.velocity.z - a.velocity.z) * nz;
  if (relative > 0) return 0;

  const impulse = -(1 + VehicleConfig.kartRestitution) * relative * 0.5;
  a.velocity.x -= nx * impulse;
  a.velocity.z -= nz * impulse;
  b.velocity.x += nx * impulse;
  b.velocity.z += nz * impulse;

  // A constant nudge on top of the impulse keeps two karts from welding together at equal speed.
  const separation = VehicleConfig.kartSeparation * overlap;
  a.velocity.x -= nx * separation * 0.016;
  a.velocity.z -= nz * separation * 0.016;
  b.velocity.x += nx * separation * 0.016;
  b.velocity.z += nz * separation * 0.016;

  syncLongitudinal(a);
  syncLongitudinal(b);

  const severity = Math.abs(relative) / VehicleConfig.maxSpeed;
  // Reported only once per cooldown, so rubbing wheels does not fire a stream of impact sounds and
  // camera shakes. The separation impulse above still runs every step, which is what keeps them apart.
  if (severity > 0.12) {
    if (a.impactCooldown > 0 || b.impactCooldown > 0) return 0;
    a.impactCooldown = VehicleConfig.impactCooldownSeconds;
    b.impactCooldown = VehicleConfig.impactCooldownSeconds;
  }
  return severity;
}

/** Re-derives the longitudinal and lateral channels after velocity was modified directly. */
export function syncLongitudinal(state: KartState): void {
  const forwardX = Math.sin(state.rotation);
  const forwardZ = Math.cos(state.rotation);
  state.speed = state.velocity.x * forwardX + state.velocity.z * forwardZ;
  state.lateralSpeed = state.velocity.x * forwardZ - state.velocity.z * forwardX;
  state.slipAngle = Math.atan2(state.lateralSpeed, Math.max(0.001, Math.abs(state.speed)));
}

/** Sets velocity directly from a speed along the current heading. Used by respawn and boost pads. */
export function setVelocityAlongHeading(state: KartState, speed: number): void {
  state.velocity.x = Math.sin(state.rotation) * speed;
  state.velocity.z = Math.cos(state.rotation) * speed;
  state.speed = speed;
  state.lateralSpeed = 0;
  state.slipAngle = 0;
}
