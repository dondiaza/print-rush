import { describe, expect, it } from "vitest";
import {
  InputRateLimiter,
  ItemDefinitions,
  RacePhase,
  SeededRandom,
  VehicleConfig,
  advanceRaceProgress,
  applyBoost,
  canTransition,
  createKartState,
  createRaceProgress,
  driftLevelForCharge,
  getThemedTracks,
  isAllowedLaps,
  isWrongWay,
  pickWeightedItem,
  rankPlayers,
  resolveGround,
  sanitizeInput,
  simulateKart,
  travelSpeed,
} from "../src/index.js";

const GROUND_Y = 0.7;

/**
 * Runs the simulation at the real fixed step, resolving ground contact each step exactly as the
 * runtime does. Ground resolution is not optional for a meaningful test: the drift hop deliberately
 * lifts the kart, and an airborne kart gets no engine force, so a loop that never lands one would
 * measure a kart coasting to a stop rather than a kart drifting.
 */
function drive(steps: number, input: Parameters<typeof sanitizeInput>[0], start = createKartState()) {
  let state = start;
  const sanitized = sanitizeInput(input);
  for (let step = 0; step < steps; step += 1) {
    state = simulateKart(state, sanitized, 1 / 120);
    resolveGround(state, GROUND_Y, 1 / 120);
  }
  return state;
}

describe("authoritative input", () => {
  it("sanitizes ranges and ignores non-boolean flags", () => {
    expect(sanitizeInput({ sequence: 2.9, steer: 99, throttle: -2, brake: 0.5, drift: "yes" })).toEqual({
      sequence: 2,
      steer: 1,
      throttle: 0,
      brake: 0.5,
      drift: false,
      useItem: false,
      hop: false,
      respawn: false,
    });
  });

  it("rate limits bursts", () => {
    const limiter = new InputRateLimiter(2);
    expect(limiter.accept(0)).toBe(true);
    expect(limiter.accept(10)).toBe(true);
    expect(limiter.accept(20)).toBe(false);
    expect(limiter.accept(1_001)).toBe(true);
  });
});

describe("gameplay rules", () => {
  it("only accepts supported lap counts", () => {
    expect([1, 2, 3, 5].every(isAllowedLaps)).toBe(true);
    expect(isAllowedLaps(4)).toBe(false);
  });

  it("builds drift levels and caps boost", () => {
    expect(driftLevelForCharge(0.4)).toBe(0);
    expect(driftLevelForCharge(1.7)).toBe(2);
    expect(driftLevelForCharge(2.7)).toBe(3);
    const boosted = applyBoost(applyBoost(createKartState(), 2), 2);
    expect(boosted.boostRemaining).toBe(VehicleConfig.maxBoostSeconds);
  });

  it("enforces race phase transitions", () => {
    expect(canTransition(RacePhase.LOBBY, RacePhase.LOADING)).toBe(true);
    expect(canTransition(RacePhase.LOBBY, RacePhase.RACING)).toBe(false);
  });
});

describe("vehicle model", () => {
  it("accelerates forward without accepting a client position", () => {
    const state = drive(60, { sequence: 1, throttle: 1 });
    expect(state.speed).toBeGreaterThan(0);
    expect(state.position.z).toBeGreaterThan(0);
    expect(state.position.x).toBeCloseTo(0, 5);
  });

  it("approaches but never exceeds the speed ceiling", () => {
    const state = drive(1_200, { sequence: 1, throttle: 1 });
    expect(state.speed).toBeLessThanOrEqual(VehicleConfig.maxSpeed + 1e-6);
    expect(state.speed).toBeGreaterThan(VehicleConfig.maxSpeed * 0.9);
  });

  it("takes time to reach top speed, so the throttle has weight", () => {
    // A quarter second of throttle must not deliver most of the speed range.
    const brief = drive(30, { sequence: 1, throttle: 1 });
    expect(brief.speed).toBeLessThan(VehicleConfig.maxSpeed * 0.4);
  });

  /**
   * The defining property of the V5 model. V4 moved the kart along its heading, so heading and
   * travel could never disagree and no slide was possible. Turning under power must now produce a
   * non-zero lateral velocity component.
   */
  it("develops lateral velocity when cornering", () => {
    let state = drive(120, { sequence: 1, throttle: 1 });
    state = drive(60, { sequence: 2, throttle: 1, steer: 1 }, state);
    expect(Math.abs(state.lateralSpeed)).toBeGreaterThan(0.5);
    expect(Math.abs(state.slipAngle)).toBeGreaterThan(0.01);
  });

  it("slides much further when drifting than when gripping", () => {
    const rolling = drive(180, { sequence: 1, throttle: 1 });

    const gripping = drive(90, { sequence: 2, throttle: 1, steer: 1 }, rolling);
    // Entering a drift needs the button and steering held from the same state.
    const drifting = drive(90, { sequence: 3, throttle: 1, steer: 1, drift: true }, rolling);

    expect(drifting.driftActive).toBe(true);
    expect(Math.abs(drifting.slipAngle)).toBeGreaterThan(Math.abs(gripping.slipAngle) * 2);
  });

  it("clamps slip so a mistake cannot become a spin", () => {
    let state = drive(240, { sequence: 1, throttle: 1 });
    for (let step = 0; step < 600; step += 1) {
      state = simulateKart(state, sanitizeInput({ sequence: step, throttle: 1, steer: 1, drift: true }), 1 / 120);
      resolveGround(state, GROUND_Y, 1 / 120);
      expect(Math.abs(state.slipAngle)).toBeLessThanOrEqual(VehicleConfig.maxSlipAngle + 0.02);
    }
  });

  it("pays out a boost tier when a charged drift is released", () => {
    let state = drive(180, { sequence: 1, throttle: 1 });
    // Hold the drift long enough to earn at least tier one.
    for (let step = 0; step < 150; step += 1) {
      state = simulateKart(state, sanitizeInput({ sequence: step, throttle: 1, steer: 1, drift: true }), 1 / 120);
      resolveGround(state, GROUND_Y, 1 / 120);
    }
    expect(state.driftLevel).toBeGreaterThanOrEqual(1);

    /**
     * The release has to exceed `driftTapGraceSeconds` now. A single step of the button being up is
     * a *tap* for the chaining system, not a release, so one step no longer ends the drift — see
     * `drift.test.ts` for the chaining behaviour this enables.
     */
    let released = state;
    const releaseSteps = Math.ceil((VehicleConfig.driftTapGraceSeconds + 0.02) * 120);
    for (let step = 0; step < releaseSteps; step += 1) {
      released = simulateKart(released, sanitizeInput({ sequence: 999, throttle: 1, steer: 1 }), 1 / 120);
      resolveGround(released, GROUND_Y, 1 / 120);
    }
    expect(released.driftActive).toBe(false);
    expect(released.boostRemaining).toBeGreaterThan(0);
  });

  it("does not pirouette from a standstill", () => {
    const state = drive(60, { sequence: 1, steer: 1 });
    expect(Math.abs(state.rotation)).toBeLessThan(0.1);
  });

  it("reports travel speed independently of heading", () => {
    const state = drive(120, { sequence: 1, throttle: 1 });
    expect(travelSpeed(state)).toBeCloseTo(Math.abs(state.speed), 3);
  });
});

describe("track rules", () => {
  const track = getThemedTracks()[0]!.definition;

  it("requires checkpoints in server order", () => {
    const progress = createRaceProgress(0);
    const finalGate = track.checkpoints.at(-1)!;
    expect(advanceRaceProgress(progress, finalGate, track, 1, 100).checkpoint).toBe(0);
    const firstGate = track.checkpoints[0]!;
    expect(advanceRaceProgress(progress, firstGate, track, 1, 100).checkpoint).toBe(1);
  });

  it("ranks by lap, checkpoint and spline progress", () => {
    const base = createRaceProgress();
    const ranked = rankPlayers([
      { id: "behind", progress: { ...base, checkpoint: 1, progress: 0.4 } },
      { id: "ahead", progress: { ...base, checkpoint: 2, progress: 0.1 } },
    ]);
    expect(ranked[0]!.id).toBe("ahead");
  });

  it("detects reverse travel", () => {
    const start = track.nodes[0]!;
    const ahead = track.nodes[8]!;
    const forward = Math.atan2(ahead.x - start.x, ahead.z - start.z);
    expect(isWrongWay(forward, start, track)).toBe(false);
    expect(isWrongWay(forward + Math.PI, start, track)).toBe(true);
  });
});

/**
 * The circuit quality gate from the brief, asserted rather than described. V4's circuits were
 * 308 to 330 m with laps of about 11 seconds; these thresholds are what "another game" means in
 * measurable terms, and they fail the build if a generator change regresses them.
 */
describe("V5 circuit quality gate", () => {
  const tracks = getThemedTracks();

  it("ships five circuits", () => {
    expect(tracks).toHaveLength(5);
  });

  it.each(tracks.map((track) => [track.blueprint.name, track] as const))(
    "%s passes every V5 requirement",
    (_name, track) => {
      expect(track.issues).toEqual([]);
    },
  );

  it.each(tracks.map((track) => [track.blueprint.name, track.analysis] as const))(
    "%s is long enough to be an adventure",
    (_name, analysis) => {
      expect(analysis.lengthMeters).toBeGreaterThanOrEqual(2_500);
      expect(analysis.estimatedLapSeconds).toBeGreaterThanOrEqual(90);
      expect(analysis.estimatedLapSeconds).toBeLessThanOrEqual(180);
      expect(analysis.corners).toBeGreaterThanOrEqual(10);
      expect(analysis.straights).toBeGreaterThanOrEqual(2);
      expect(analysis.elevationChanges).toBeGreaterThanOrEqual(3);
      // The parametric ellipse could never cross itself. Every V5 circuit must.
      expect(analysis.crossovers).toBeGreaterThanOrEqual(1);
    },
  );

  it("gives each circuit its own shape rather than a recoloured template", () => {
    const lengths = tracks.map((track) => track.analysis.lengthMeters);
    expect(new Set(lengths).size).toBe(lengths.length);
  });

  it("bakes deterministically", () => {
    const again = getThemedTracks();
    expect(again[0]!.definition.nodes.length).toBe(tracks[0]!.definition.nodes.length);
    expect(again[0]!.analysis).toEqual(tracks[0]!.analysis);
  });
});

describe("seeded item RNG", () => {
  it("ships the thirteen weighted items", () => {
    expect(Object.values(ItemDefinitions)).toHaveLength(13);
    expect(Object.values(ItemDefinitions).every((item) => item.weightByPosition.length === 4)).toBe(true);
  });

  it("is reproducible", () => {
    const first = new SeededRandom(42);
    const second = new SeededRandom(42);
    expect(Array.from({ length: 8 }, () => pickWeightedItem(4, first).id)).toEqual(
      Array.from({ length: 8 }, () => pickWeightedItem(4, second).id),
    );
  });
});
