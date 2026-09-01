import { describe, expect, it } from "vitest";
import {
  InputRateLimiter,
  ItemDefinitions,
  RacePhase,
  SeededRandom,
  advanceRaceProgress,
  applyBoost,
  canTransition,
  createFlagshipStoreTrack,
  createKartState,
  createRaceProgress,
  driftLevelForCharge,
  isAllowedLaps,
  isWrongWay,
  pickWeightedItem,
  rankPlayers,
  sanitizeInput,
  simulateKart,
} from "../src/index.js";

describe("authoritative input", () => {
  it("sanitizes ranges and ignores non-boolean flags", () => {
    expect(sanitizeInput({ sequence: 2.9, steer: 99, throttle: -2, brake: 0.5, drift: "yes" })).toEqual({
      sequence: 2,
      steer: 1,
      throttle: 0,
      brake: 0.5,
      drift: false,
      useItem: false,
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
    expect(driftLevelForCharge(1.1)).toBe(2);
    const boosted = applyBoost(applyBoost(createKartState(), 2), 2);
    expect(boosted.boostRemaining).toBe(2.8);
  });

  it("accelerates a kart without accepting client position", () => {
    const state = simulateKart(createKartState(), sanitizeInput({ sequence: 1, throttle: 1 }), 1 / 30);
    expect(state.speed).toBeGreaterThan(0);
    expect(state.position.z).toBeGreaterThan(0);
  });

  it("enforces race phase transitions", () => {
    expect(canTransition(RacePhase.LOBBY, RacePhase.LOADING)).toBe(true);
    expect(canTransition(RacePhase.LOBBY, RacePhase.RACING)).toBe(false);
  });
});

describe("track rules", () => {
  const track = createFlagshipStoreTrack();

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
    const start = track.racingSpline[0]!;
    expect(isWrongWay(-Math.PI / 2, start, track)).toBe(true);
    expect(isWrongWay(Math.PI / 2, start, track)).toBe(false);
  });
});

describe("seeded item RNG", () => {
  it("ships the thirteen V4 weighted items", () => {
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
