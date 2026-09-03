import {
  RaceConfig,
  createKartState,
  getCircuit,
  resolveGround,
  sampleTrack,
  simulateKart,
  surfaceGrip,
  type KartState,
} from "@print-rush/game-core";
import { describe, expect, it } from "vitest";
import { BotDriver, BotPersonalities, BotSkills, botSkillsForGrid, type BotPersonality } from "@/game/BotDriver";

/**
 * Bot driving.
 *
 * The point of these tests is that the personalities differ *in play*, not merely in their
 * configuration. It is easy to write five profiles and have them all drive identically because the
 * dial that actually matters is never read — which is precisely what had happened before, when
 * `level` scaled everything and drift usage was gated on `level > 0.6` for all of them.
 *
 * So each assertion runs a bot around a real circuit and measures the result.
 */

const STEP = 1 / 120;

/** Runs a bot around a circuit for a number of seconds, reporting what it managed. */
function race(personality: BotPersonality, seconds: number, seed = 1) {
  const track = getCircuit("tshirt-megastore").definition;
  const spawn = track.spawnPoints[0]!;
  const driver = new BotDriver({ ...BotPersonalities[personality], laneOffset: 0 }, seed);

  let kart: KartState = createKartState(spawn.position.x, spawn.position.z, spawn.rotation, spawn.position.y);
  let cursor = -1;
  let sample = sampleTrack(track, kart.position, cursor);
  cursor = sample.index;

  let driftSteps = 0;
  let offRoadSteps = 0;
  let topSpeed = 0;
  let distance = 0;
  let respawns = 0;

  const steps = Math.round(seconds / STEP);
  for (let step = 0; step < steps; step += 1) {
    const input = driver.update(kart, sample, track, STEP, 0);
    if (driver.needsRespawn) {
      // Mirror the runtime: put it back on the line and clear the driver's stuck state.
      const node = track.nodes[cursor]!;
      const ahead = track.nodes[(cursor + 6) % track.nodes.length]!;
      kart = createKartState(node.x, node.z, Math.atan2(ahead.x - node.x, ahead.z - node.z), node.y + 0.42);
      driver.clearStuck();
      respawns += 1;
      continue;
    }

    const grip = surfaceGrip(sample.offRoad ? "OFFROAD" : sample.surface);
    const before = { x: kart.position.x, z: kart.position.z };
    kart = simulateKart(kart, input, STEP, grip);
    sample = sampleTrack(track, kart.position, cursor);
    cursor = sample.index;
    resolveGround(kart, sample.groundY + 0.42, STEP);

    distance += Math.hypot(kart.position.x - before.x, kart.position.z - before.z);
    if (kart.driftActive) driftSteps += 1;
    if (sample.offRoad) offRoadSteps += 1;
    topSpeed = Math.max(topSpeed, Math.hypot(kart.velocity.x, kart.velocity.z));
  }

  return {
    distance,
    driftFraction: driftSteps / steps,
    offRoadFraction: offRoadSteps / steps,
    topSpeed,
    respawns,
  };
}

describe("bot personalities", () => {
  it("races all five archetypes and never two identical drivers", () => {
    /**
     * This assertion changed shape when the grid grew, and the new form is the stronger one.
     *
     * It used to require every bot on the grid to have a *different* personality, which was
     * satisfiable only because there were exactly three bots and three archetypes in use — and it
     * quietly permitted the other two personalities to be written, tuned, tested and never raced.
     *
     * With a field of eight, personalities necessarily repeat. What must not repeat is a *driver*: two
     * bots with the same archetype have to differ in the dials that decide how they race, or they
     * drive glued together for the whole lap. So the test now demands both that all five archetypes
     * appear and that no two entries on the grid are the same combination.
     */
    expect(Object.keys(BotPersonalities)).toHaveLength(5);
    const onGrid = BotSkills.map((skill) => skill.personality);
    expect(new Set(onGrid).size).toBe(5);

    const signatures = BotSkills.map((skill) => `${skill.personality}|${skill.level}|${skill.jitter}|${skill.laneOffset}`);
    expect(new Set(signatures).size).toBe(BotSkills.length);
  });

  it("spreads the field across the road rather than down one groove", () => {
    // `laneOffset` is what makes a pack fan out through a corner. Both sides of the racing line have
    // to be used, and no bot's line may start off the tarmac — the narrowest circuit's road is 10 m,
    // so half of it is 5 m.
    const offsets = BotSkills.map((skill) => skill.laneOffset);
    expect(offsets.some((offset) => offset < 0)).toBe(true);
    expect(offsets.some((offset) => offset > 0)).toBe(true);
    expect(Math.max(...offsets.map(Math.abs))).toBeLessThan(4);
  });

  it("builds the field from the configured grid size", () => {
    // The number four used to be hard-coded in five places. This is the one that matters: the
    // opponent list must be exactly one short of the grid, or the player has no slot or a spare one.
    expect(BotSkills).toHaveLength(RaceConfig.gridSize - 1);
    expect(botSkillsForGrid(12)).toHaveLength(11);
    expect(botSkillsForGrid(1)).toHaveLength(0);
  });

  it("gives every personality a different combination of dials", () => {
    const signatures = Object.values(BotPersonalities).map(
      (skill) => `${skill.level}|${skill.driftAppetite}|${skill.aggression}|${skill.jitter}`,
    );
    expect(new Set(signatures).size).toBe(5);
  });

  it("makes the cautious bot drift far less than the aggressive one", () => {
    const cautious = race("CAUTIOUS", 14);
    const aggressive = race("AGGRESSIVE", 14);
    // This is the assertion that would have failed before: drift was gated on `level`, so a cautious
    // bot with a lower level drifted less only incidentally, not by design.
    expect(cautious.driftFraction).toBeLessThan(aggressive.driftFraction);
  });

  it("makes the chaotic bot the untidiest and the technical bot the cleanest", () => {
    const chaotic = race("CHAOTIC", 16);
    const technical = race("TECHNICAL", 16);
    // Steering jitter should show up as time spent off the racing surface.
    expect(chaotic.offRoadFraction).toBeGreaterThanOrEqual(technical.offRoadFraction);
  });

  it("makes the technical bot cover more ground than the cautious one", () => {
    const technical = race("TECHNICAL", 18);
    const cautious = race("CAUTIOUS", 18);
    expect(technical.distance).toBeGreaterThan(cautious.distance);
  });

  it("is deterministic for a given seed, and different across seeds", () => {
    const first = race("CHAOTIC", 8, 7);
    const repeat = race("CHAOTIC", 8, 7);
    expect(repeat.distance).toBeCloseTo(first.distance, 6);

    const other = race("CHAOTIC", 8, 99);
    // Jitter is seeded, so two bots of the same personality do not drive in lockstep.
    expect(other.distance).not.toBeCloseTo(first.distance, 3);
  });

  it("keeps every personality on the track well enough to complete a stint", () => {
    for (const personality of Object.keys(BotPersonalities) as BotPersonality[]) {
      const result = race(personality, 20);
      // Any bot that cannot cover 150 m in twenty seconds is stuck, not slow.
      expect(result.distance, `${personality} makes progress`).toBeGreaterThan(150);
      expect(result.respawns, `${personality} rarely needs rescuing`).toBeLessThanOrEqual(2);
    }
  });
});

describe("stuck recovery", () => {
  it("asks for a respawn only after failing to recover by itself", () => {
    const track = getCircuit("office-chaos").definition;
    const driver = new BotDriver({ ...BotPersonalities.BALANCED, laneOffset: 0 }, 3);

    // Wedge the kart: stationary, far off the road, facing nowhere useful.
    const node = track.nodes[40]!;
    const kart = createKartState(node.x + 60, node.z + 60, Math.PI, node.y);
    const sample = sampleTrack(track, kart.position, -1);

    expect(driver.needsRespawn).toBe(false);

    // It should first try to reverse out. That takes the 1.5 s grace plus the stall threshold, so
    // the window has to be long enough to include both.
    let sawReverseAttempt = false;
    for (let step = 0; step < 420; step += 1) {
      const input = driver.update(kart, sample, track, STEP, 0);
      if (input.brake > 0.5 && input.throttle === 0) sawReverseAttempt = true;
      if (driver.needsRespawn) break;
    }
    expect(sawReverseAttempt, "physical recovery is attempted first").toBe(true);
    expect(driver.needsRespawn).toBe(false);

    // Only after a couple of seconds of getting nowhere does it give up.
    for (let step = 0; step < 400; step += 1) {
      driver.update(kart, sample, track, STEP, 0);
      if (driver.needsRespawn) break;
    }
    expect(driver.needsRespawn, "respawn is the last resort").toBe(true);

    driver.clearStuck();
    expect(driver.needsRespawn).toBe(false);
  });

  it("does not ask for a respawn while making normal progress", () => {
    const result = race("BALANCED", 20);
    expect(result.respawns).toBe(0);
  });
});
