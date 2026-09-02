import { describe, expect, it } from "vitest";
import {
  VehicleConfig,
  cancelDrift,
  createKartState,
  raceProgress,
  createRaceProgress,
  resolveGround,
  resolveKartPair,
  resolveWall,
  sanitizeInput,
  simulateKart,
  type KartState,
} from "../src/index.js";

/**
 * Drift chaining, tricks and impact response.
 *
 * These are the systems the V2 brief leans on for its skill ceiling, and every one of them is a
 * timing behaviour — which means it is exactly the kind of thing that silently stops working. A
 * window that never opens, a tap that always grades MISS, a cooldown that never expires: all of
 * those look fine in the code and are invisible in play until someone notices the mechanic does
 * nothing.
 */

const STEP = 1 / 120;
const GROUND_Y = 0.7;

/** Drives the kart for a duration, resolving ground contact as the runtime does. */
function drive(
  state: KartState,
  seconds: number,
  input: Partial<Parameters<typeof sanitizeInput>[0]> & Record<string, unknown>,
): KartState {
  let current = state;
  const sanitized = sanitizeInput(input);
  const steps = Math.round(seconds / STEP);
  for (let step = 0; step < steps; step += 1) {
    current = simulateKart(current, sanitized, STEP);
    resolveGround(current, GROUND_Y, STEP);
  }
  return current;
}

/** Brings the kart up to a speed at which it can drift. */
function rolling(): KartState {
  return drive(createKartState(), 2.5, { throttle: 1 });
}

/**
 * Taps the drift button: release for one step, then press again. That is the input the chaining
 * system reads, and a release this short must not end the drift.
 */
function tap(state: KartState, steer: number): { state: KartState; grade: string } {
  let current = simulateKart(state, sanitizeInput({ steer, throttle: 1, drift: false }), STEP);
  resolveGround(current, GROUND_Y, STEP);
  current = simulateKart(current, sanitizeInput({ steer, throttle: 1, drift: true }), STEP);
  resolveGround(current, GROUND_Y, STEP);
  return { state: current, grade: current.lastDriftEvent.grade };
}

describe("drift entry and payout", () => {
  it("enters a drift with a hop and holds an angle", () => {
    let state = rolling();
    state = drive(state, 0.05, { steer: 1, throttle: 1, drift: true });
    expect(state.driftActive).toBe(true);
    expect(state.driftDirection).toBe(1);

    state = drive(state, 0.8, { steer: 1, throttle: 1, drift: true });
    expect(Math.abs(state.slipAngle)).toBeGreaterThan(0.15);
  });

  it("pays a tier-appropriate boost on release and nothing on a short drift", () => {
    // Too brief to reach tier one.
    let brief = rolling();
    brief = drive(brief, 0.2, { steer: 1, throttle: 1, drift: true });
    brief = drive(brief, 0.4, { steer: 1, throttle: 1, drift: false });
    expect(brief.boostRemaining).toBe(0);

    // Long enough to charge, then released.
    let long = rolling();
    long = drive(long, 2.2, { steer: 1, throttle: 1, drift: true });
    const level = long.driftLevel;
    expect(level).toBeGreaterThanOrEqual(1);
    long = drive(long, 0.4, { steer: 1, throttle: 1, drift: false });
    expect(long.driftActive).toBe(false);
    expect(long.boostRemaining).toBeGreaterThan(0);
  });

  it("does not end the drift when the button is released only briefly", () => {
    let state = rolling();
    state = drive(state, 0.8, { steer: 1, throttle: 1, drift: true });
    expect(state.driftActive).toBe(true);

    // Release for well under the grace period, then press again.
    const result = tap(state, 1);
    expect(result.state.driftActive, "a tap must not end the drift").toBe(true);
  });

  it("ends the drift once the release exceeds the grace period", () => {
    let state = rolling();
    state = drive(state, 1.2, { steer: 1, throttle: 1, drift: true });
    state = drive(state, VehicleConfig.driftTapGraceSeconds + 0.05, { steer: 1, throttle: 1, drift: false });
    expect(state.driftActive).toBe(false);
  });

  /**
   * Counter-steering hard while still holding drift ends the drift and immediately re-arms it the
   * other way, which is precisely the transition a linked S-bend needs: flick the stick across
   * without letting go of the button and the kart swaps sides, banking the first drift's payout on
   * the way through. The bail-out and the re-entry are the same frame, so what to assert is that the
   * direction flipped — not that the drift stopped.
   */
  it("flips the drift direction when the player counter-steers, for linked corners", () => {
    let state = rolling();
    state = drive(state, 0.9, { steer: 1, throttle: 1, drift: true });
    expect(state.driftActive).toBe(true);
    expect(state.driftDirection).toBe(1);

    state = drive(state, VehicleConfig.driftBailSeconds + 0.15, { steer: -1, throttle: 1, drift: true });
    expect(state.driftActive).toBe(true);
    expect(state.driftDirection, "the drift swapped sides").toBe(-1);
    // The first drift still paid out on the way through.
    expect(state.boostRemaining).toBeGreaterThan(0);
  });
});

describe("drift chaining", () => {
  it("grades a tap inside a window as PERFECT and banks reserve", () => {
    let state = rolling();
    state = drive(state, 0.05, { steer: 1, throttle: 1, drift: true });

    // Walk forward until a window opens, then tap on that exact step.
    let opened = false;
    for (let step = 0; step < 600 && !opened; step += 1) {
      state = simulateKart(state, sanitizeInput({ steer: 1, throttle: 1, drift: true }), STEP);
      resolveGround(state, GROUND_Y, STEP);
      if (state.lastDriftEvent.windowOpened) opened = true;
    }
    expect(opened, "a window opens during a sustained drift").toBe(true);

    const result = tap(state, 1);
    expect(result.grade).toBe("PERFECT");
    expect(result.state.boostReserve).toBeCloseTo(VehicleConfig.perfectReserve, 5);
    expect(result.state.driftChain).toBe(1);
  });

  it("grades a tap far from any window as MISS and costs charge", () => {
    let state = rolling();
    state = drive(state, 0.05, { steer: 1, throttle: 1, drift: true });
    // Immediately after entry the charge is near zero, which is far from the first window at 0.55.
    const before = state.driftCharge;
    const result = tap(state, 1);
    expect(result.grade).toBe("MISS");
    expect(result.state.driftChain).toBe(0);
    expect(result.state.boostReserve).toBe(0);
    expect(result.state.driftCharge).toBeLessThanOrEqual(before + STEP * 2);
  });

  it("refuses to grade the same window twice, so mashing cannot farm reserve", () => {
    let state = rolling();
    state = drive(state, 0.05, { steer: 1, throttle: 1, drift: true });
    for (let step = 0; step < 600; step += 1) {
      state = simulateKart(state, sanitizeInput({ steer: 1, throttle: 1, drift: true }), STEP);
      resolveGround(state, GROUND_Y, STEP);
      if (state.lastDriftEvent.windowOpened) break;
    }

    const first = tap(state, 1);
    expect(first.grade).toBe("PERFECT");
    const reserveAfterFirst = first.state.boostReserve;

    // A second tap at the same window must not pay again.
    const second = tap(first.state, 1);
    expect(second.grade).toBe("MISS");
    expect(second.state.boostReserve).toBeLessThanOrEqual(reserveAfterFirst);
    expect(second.state.driftChain).toBe(0);
  });

  it("pays more for a chained drift than an unchained one of the same length", () => {
    const driftSeconds = 2.4;

    // Plain: hold drift, release.
    let plain = rolling();
    plain = drive(plain, driftSeconds, { steer: 1, throttle: 1, drift: true });
    plain = drive(plain, 0.4, { steer: 1, throttle: 1, drift: false });
    const plainBoost = plain.boostRemaining;

    // Chained: hold, tapping every window as it opens.
    let chained = rolling();
    chained = drive(chained, 0.05, { steer: 1, throttle: 1, drift: true });
    let elapsed = 0.05;
    while (elapsed < driftSeconds) {
      chained = simulateKart(chained, sanitizeInput({ steer: 1, throttle: 1, drift: true }), STEP);
      resolveGround(chained, GROUND_Y, STEP);
      elapsed += STEP;
      if (chained.lastDriftEvent.windowOpened) {
        const result = tap(chained, 1);
        chained = result.state;
        elapsed += STEP * 2;
      }
    }
    expect(chained.driftChain, "windows were hit").toBeGreaterThanOrEqual(1);
    chained = drive(chained, 0.4, { steer: 1, throttle: 1, drift: false });

    // This is the entire point of the mechanic: the same corner, more speed, because of execution.
    expect(chained.boostRemaining).toBeGreaterThan(plainBoost);
  });

  it("bleeds the reserve away once the drift is over", () => {
    let state = rolling();
    state = createKartState();
    state.boostReserve = 1;
    state.driftChain = 3;
    state = drive(state, 1.5, { throttle: 1 });
    expect(state.boostReserve).toBeLessThan(1);

    const emptied = drive(state, 4, { throttle: 1 });
    expect(emptied.boostReserve).toBe(0);
    expect(emptied.driftChain, "the chain dies with the reserve").toBe(0);
  });

  it("caps the reserve so a long drift cannot bank unlimited boost", () => {
    const state = createKartState();
    state.boostReserve = VehicleConfig.maxBoostReserve;
    const stepped = drive(state, 0.01, { throttle: 1 });
    expect(stepped.boostReserve).toBeLessThanOrEqual(VehicleConfig.maxBoostReserve);
  });
});

describe("tricks", () => {
  it("pays a boost for a trick armed on take-off and landed with real air", () => {
    let state = drive(createKartState(), 2.5, { throttle: 1 });
    // Launch high enough to clear the trick's minimum air time.
    state.verticalSpeed = 12;
    state.grounded = false;
    state.airTime = 0;

    // Tap drift immediately, which arms the trick.
    state = simulateKart(state, sanitizeInput({ throttle: 1, drift: true }), STEP);
    expect(state.trickArmed).toBe(true);

    // Fly, then land.
    let landed = false;
    let boost = 0;
    for (let step = 0; step < 400 && !landed; step += 1) {
      state = simulateKart(state, sanitizeInput({ throttle: 1, drift: true }), STEP);
      const report = resolveGround(state, GROUND_Y, STEP);
      if (report.landed) {
        landed = true;
        boost = report.boostSeconds;
        expect(report.trickLanded).toBe(true);
      }
    }
    expect(landed).toBe(true);
    expect(boost).toBeGreaterThanOrEqual(VehicleConfig.trickBoostSeconds);
  });

  it("pays nothing for a trick on a hop too short to qualify", () => {
    let state = drive(createKartState(), 2.5, { throttle: 1 });
    state.verticalSpeed = 2;
    state.grounded = false;
    state.airTime = 0;
    state = simulateKart(state, sanitizeInput({ throttle: 1, drift: true }), STEP);
    expect(state.trickArmed).toBe(true);

    for (let step = 0; step < 200; step += 1) {
      state = simulateKart(state, sanitizeInput({ throttle: 1, drift: true }), STEP);
      const report = resolveGround(state, GROUND_Y, STEP);
      if (report.landed) {
        expect(report.trickLanded, "a kerb hop earns nothing").toBe(false);
        return;
      }
    }
    throw new Error("the kart never landed");
  });

  it("cannot arm a trick long after take-off", () => {
    let state = drive(createKartState(), 2.5, { throttle: 1 });
    state.verticalSpeed = 12;
    state.grounded = false;
    state.airTime = 0;
    // Fly without pressing anything past the arming window.
    state = drive(state, VehicleConfig.trickArmSeconds + 0.15, { throttle: 1 });
    state = simulateKart(state, sanitizeInput({ throttle: 1, drift: true }), STEP);
    expect(state.trickArmed).toBe(false);
  });
});

describe("impact response", () => {
  const leftNormal = { x: 1, z: 0 };

  it("tells a scrape apart from a frontal hit", () => {
    const scraping = drive(createKartState(), 2.5, { throttle: 1 });
    /**
     * Mostly along the wall with a slight drift into it. A perfectly parallel kart is not
     * approaching the wall at all and correctly reports no impact, so a scrape needs some inward
     * component to exist as an event.
     */
    scraping.velocity.x = -1.5;
    const scrape = resolveWall(scraping, leftNormal, 0.1);
    expect(scrape?.kind).toBe("SCRAPE");
    expect(scrape!.glancing).toBe(true);

    const head = drive(createKartState(), 2.5, { throttle: 1 });
    // Point the kart straight into the wall.
    head.rotation = -Math.PI / 2;
    head.velocity.x = -head.speed;
    head.velocity.z = 0;
    const frontal = resolveWall(head, leftNormal, 0.1);
    expect(frontal?.kind === "FRONTAL" || frontal?.kind === "HEAVY").toBe(true);
    expect(frontal!.squareness).toBeGreaterThan(0.8);
  });

  it("ignores repeat impacts during the cooldown but still pushes out of the wall", () => {
    const state = drive(createKartState(), 2.5, { throttle: 1 });
    state.rotation = -Math.PI / 2;
    state.velocity.x = -state.speed;
    state.velocity.z = 0;

    const first = resolveWall(state, leftNormal, 0.1);
    expect(first).not.toBeNull();
    expect(state.impactCooldown).toBeGreaterThan(0);

    const positionBefore = state.position.x;
    const second = resolveWall(state, leftNormal, 0.1);
    // No second impact reported...
    expect(second).toBeNull();
    // ...but the kart is still pushed clear, which is what stops it ending up inside geometry.
    expect(state.position.x).toBeGreaterThan(positionBefore);
  });

  it("lets the cooldown expire so a later impact registers again", () => {
    let state = drive(createKartState(), 2.5, { throttle: 1 });
    state.rotation = -Math.PI / 2;
    state.velocity.x = -state.speed;
    resolveWall(state, leftNormal, 0.1);

    state = drive(state, VehicleConfig.impactCooldownSeconds + 0.05, { throttle: 1 });
    expect(state.impactCooldown).toBe(0);
  });

  it("does not stop the kart dead on a scrape", () => {
    const state = drive(createKartState(), 2.5, { throttle: 1 });
    state.velocity.x = -1.5;
    const before = Math.hypot(state.velocity.x, state.velocity.z);
    resolveWall(state, leftNormal, 0.1);
    const after = Math.hypot(state.velocity.x, state.velocity.z);
    // A brush along a barrier should cost some speed, not most of it.
    expect(after).toBeGreaterThan(before * 0.7);
  });

  it("forfeits the drift reserve when a wall is hit hard", () => {
    let state = rolling();
    state = drive(state, 1.5, { steer: 1, throttle: 1, drift: true });
    state.boostReserve = 1;
    state.driftChain = 3;
    // Square it up into the wall.
    state.rotation = -Math.PI / 2;
    state.velocity.x = -25;
    state.velocity.z = 0;
    resolveWall(state, leftNormal, 0.2);
    expect(state.driftActive).toBe(false);
    expect(state.boostReserve).toBe(0);
    expect(state.driftChain).toBe(0);
  });

  it("reports kart contact once per cooldown rather than every step", () => {
    const a = drive(createKartState(0, 0, 0), 2.5, { throttle: 1 });
    const b = drive(createKartState(1.2, 0, 0), 2.5, { throttle: 1 });
    // Drive them into each other.
    b.velocity.x = -8;
    a.velocity.x = 8;

    const first = resolveKartPair(a, b);
    expect(first).toBeGreaterThan(0);
    const second = resolveKartPair(a, b);
    expect(second, "no second report while cooling down").toBe(0);
  });

  it("cancelDrift clears the whole drift state", () => {
    let state = rolling();
    state = drive(state, 1.5, { steer: 1, throttle: 1, drift: true });
    expect(state.driftActive).toBe(true);
    cancelDrift(state);
    expect(state.driftActive).toBe(false);
    expect(state.driftCharge).toBe(0);
    expect(state.driftWindowsUsed).toBe(0);
  });
});

describe("race progress", () => {
  it("is continuous across the finish line", () => {
    const beforeLine = { ...createRaceProgress(), lap: 1, progress: 0.99 };
    const afterLine = { ...createRaceProgress(), lap: 2, progress: 0.0 };
    // The last checkpoint is the finish line, so lap increments exactly as progress wraps.
    expect(raceProgress(afterLine)).toBeCloseTo(1, 5);
    expect(raceProgress(beforeLine)).toBeCloseTo(0.99, 5);
    expect(raceProgress(afterLine)).toBeGreaterThan(raceProgress(beforeLine));
  });

  it("never goes negative on the grid", () => {
    expect(raceProgress(createRaceProgress())).toBe(0);
  });
});
