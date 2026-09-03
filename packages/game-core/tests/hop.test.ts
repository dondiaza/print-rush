import { describe, expect, it } from "vitest";
import {
  createKartState,
  hop,
  launch,
  resolveGround,
  sanitizeInput,
  simulateKart,
  VehicleConfig,
} from "../src/index.js";

/**
 * THE HOP.
 *
 * A small jump on demand, on the same button as the drift. Most of what is worth testing here is not
 * that it works — a vertical impulse is hard to get wrong — but that it stays *worthless on its own*.
 *
 * The hop is airborne for 0.4 s. `landingBoostMinAir` is 0.45 and `trickMinAirSeconds` is 0.42, so a
 * bare hop clears neither, and hopping repeatedly down a straight earns nothing. Those three numbers
 * are a set: raise `hopSpeed` a little and hop-spamming becomes the fastest way around every circuit,
 * with no error anywhere and no way to see it in review. So the assertions below are written against
 * the *relationship*, not the values, and they are the reason this file exists.
 *
 * What the hop is for is the combination: `launch` adds part of the rise the kart brings to a ramp,
 * so a hop timed at the lip flies higher and longer.
 */

const GROUND_Y = 0.7;
const STEP = 1 / 120;

const input = (patch: Record<string, unknown> = {}) =>
  sanitizeInput({ sequence: 1, steer: 0, throttle: 1, brake: 0, ...patch });

/**
 * Runs the simulation the way the runtime does, resolving ground contact every step.
 *
 * `hop` is applied on the **first step only**, because that is the contract: it is a one-frame pulse
 * that `InputControllerV5` raises on the key-down edge — guarded by `event.repeat` — and clears when
 * `snapshot` reads it. Holding it across every step, as an earlier version of this helper did, makes
 * the kart re-hop the instant it touches down and never land, which is a fair description of what a
 * held flag would do and not a description of anything the game can produce.
 */
function drive(steps: number, patch: Record<string, unknown>, start = createKartState(0, 0, 0, GROUND_Y)) {
  const pulse = input(patch);
  const { hop: _pulsed, ...rest } = patch;
  const held = input(rest);
  let state = start;
  let landing = resolveGround(state, GROUND_Y, STEP);
  for (let step = 0; step < steps; step += 1) {
    state = simulateKart(state, step === 0 ? pulse : held, STEP);
    const report = resolveGround(state, GROUND_Y, STEP);
    if (report.landed) landing = report;
  }
  return { state, landing };
}

/** Peak height and total airtime of a kart released with a given vertical speed. */
function flight(verticalSpeed: number, carried = 0): { air: number; peak: number } {
  const state = createKartState(0, 0, 0, GROUND_Y);
  state.verticalSpeed = carried;
  if (carried > 0) state.grounded = false;
  launch(state, verticalSpeed);
  let peak = state.position.y;
  let air = 0;
  const flat = input({ throttle: 1 });
  let current = state;
  for (let step = 0; step < 600; step += 1) {
    current = simulateKart(current, flat, STEP);
    const report = resolveGround(current, GROUND_Y, STEP);
    peak = Math.max(peak, current.position.y);
    air += STEP;
    if (report.landed) break;
  }
  return { air, peak: peak - GROUND_Y };
}

describe("the input", () => {
  it("carries the hop as a boolean pulse", () => {
    expect(sanitizeInput({ hop: true }).hop).toBe(true);
    // Anything that is not exactly `true` is not a hop. The same rule as every other flag: an input
    // packet arriving from a client is untrusted, and "truthy" is not a contract.
    expect(sanitizeInput({ hop: 1 }).hop).toBe(false);
    expect(sanitizeInput({}).hop).toBe(false);
  });
});

describe("a hop leaves the ground", () => {
  it("lifts the kart and comes back down", () => {
    const { state } = drive(3, { hop: true });
    expect(state.grounded).toBe(false);
    expect(state.position.y).toBeGreaterThan(GROUND_Y);
    // And it lands again within a fraction of a second, unaided.
    const { state: later } = drive(90, { hop: true });
    expect(later.grounded).toBe(true);
  });

  it("does nothing in the air", () => {
    // Without this a held button is a flight control: every frame would re-apply the impulse and the
    // kart would never come down.
    const airborne = createKartState(0, 0, 0, GROUND_Y + 4);
    airborne.grounded = false;
    airborne.verticalSpeed = -3;
    hop(airborne);
    expect(airborne.verticalSpeed).toBe(-3);
  });

  it("costs no speed on the frame it happens", () => {
    // A hop that stumbled would be worse than no hop. The impulse is applied after the ground forces
    // for this step precisely so the frame keeps its throttle and its grip.
    const rolling = createKartState(0, 0, 0, GROUND_Y);
    rolling.speed = 20;
    rolling.velocity.z = 20;
    const withHop = drive(1, { hop: true }, rolling).state;
    const without = drive(1, {}, { ...rolling, position: { ...rolling.position }, velocity: { ...rolling.velocity } }).state;
    expect(withHop.speed).toBeCloseTo(without.speed, 6);
  });
});

describe("a bare hop is worth nothing", () => {
  it("stays airborne for less than the landing boost needs", () => {
    /**
     * The load-bearing assertion in this file.
     *
     * If a hop's airtime ever exceeds `landingBoostMinAir`, hopping down a straight becomes a free
     * repeating boost and the fastest way around every circuit. Nothing would error; the game would
     * just quietly stop being about driving.
     */
    const air = (2 * VehicleConfig.hopSpeed) / VehicleConfig.gravity;
    expect(air).toBeLessThan(VehicleConfig.landingBoostMinAir);
    expect(air).toBeLessThan(VehicleConfig.trickMinAirSeconds);
  });

  it("earns no boost when it lands", () => {
    // The same property, measured rather than derived, through the real simulation and the real
    // ground resolution.
    const { landing } = drive(90, { hop: true });
    expect(landing.landed).toBe(true);
    expect(landing.boostSeconds).toBe(0);
    expect(landing.trickLanded).toBe(false);
  });

  it("is a hop and not a jump", () => {
    // "Levemente", as asked: high enough to clear a kerb or a floor decal, not high enough to fly
    // over anything that matters.
    const height = (VehicleConfig.hopSpeed * VehicleConfig.hopSpeed) / (2 * VehicleConfig.gravity);
    expect(height).toBeGreaterThan(0.25);
    expect(height).toBeLessThan(0.7);
  });
});

describe("a hop into a ramp is worth something", () => {
  const RAMP = 8.8;

  it("gives a ramp on its own enough air to pay out", () => {
    const { air } = flight(RAMP);
    expect(air).toBeGreaterThan(VehicleConfig.landingBoostMinAir);
  });

  it("flies higher and longer when the kart is still rising at the lip", () => {
    const plain = flight(RAMP);
    const timed = flight(RAMP, VehicleConfig.hopSpeed);
    expect(timed.peak).toBeGreaterThan(plain.peak);
    expect(timed.air).toBeGreaterThan(plain.air);
    // Worth about a third more air: a reward the player can feel, not a different game mode.
    expect(timed.air / plain.air).toBeGreaterThan(1.15);
    expect(timed.air / plain.air).toBeLessThan(1.6);
  });

  it("gains nothing from a mistimed hop", () => {
    // Arrive at the lip already falling and the ramp is just a ramp. `launch` clamps the carried
    // speed at zero, so a bad approach cannot subtract from the launch either.
    const falling = flight(RAMP, 0);
    const plain = flight(RAMP);
    expect(falling.air).toBeCloseTo(plain.air, 6);

    const descending = createKartState(0, 0, 0, GROUND_Y + 2);
    descending.grounded = false;
    descending.verticalSpeed = -7;
    launch(descending, RAMP);
    expect(descending.verticalSpeed).toBe(RAMP);
  });
});

describe("the shared button", () => {
  it("lets the drift's own hop win rather than stacking with it", () => {
    /**
     * Space is the hop and the drift, so the frame a drift starts carries both signals. `stepDrift`
     * runs first and lifts the kart by `driftHopImpulse`; `hop` then finds it airborne and no-ops.
     * Stacking them would send a kart into the air every time a player turned into a corner.
     */
    const rolling = createKartState(0, 0, 0, GROUND_Y);
    rolling.speed = 24;
    rolling.velocity.z = 24;
    const drifting = simulateKart(rolling, input({ steer: 1, drift: true, hop: true }), STEP);
    expect(drifting.driftActive).toBe(true);
    // The drift's impulse, minus one step of gravity — not the drift's plus the hop's.
    expect(drifting.verticalSpeed).toBeCloseTo(VehicleConfig.driftHopImpulse - VehicleConfig.gravity * STEP, 5);
    expect(drifting.verticalSpeed).toBeLessThan(VehicleConfig.hopSpeed);
  });

  it("hops when the tap is too slow or too straight to start a drift", () => {
    // Drift entry needs steering past `driftEntrySteer` and speed over `driftMinSpeed`. A tap that
    // meets neither is what the player means by "jump", and it has to do something.
    const slow = createKartState(0, 0, 0, GROUND_Y);
    slow.speed = 2;
    slow.velocity.z = 2;
    const hopped = simulateKart(slow, input({ steer: 1, drift: true, hop: true }), STEP);
    expect(hopped.driftActive).toBe(false);
    expect(hopped.grounded).toBe(false);
    expect(hopped.verticalSpeed).toBeGreaterThan(0);
  });
});
