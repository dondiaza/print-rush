import { getCircuits } from "@print-rush/game-core";
import { describe, expect, it } from "vitest";
import { projectTrack } from "@/components/TrackMap";

/**
 * THE MINIMAP'S PROJECTION.
 *
 * This exists because the thing it replaced was a lie, and a lie of a specific kind: the old minimap
 * drew a **fixed ellipse** on every circuit and placed each kart around it by lap progress. It looked
 * like an instrument and carried no information — a hairpin read as a gentle bend, a chicane read as
 * nothing at all, and a rival's dot sat at an angle unrelated to where that rival was.
 *
 * So the assertions below are the ones a fake cannot pass. Not "does it draw something", but: do two
 * different circuits produce two different shapes, and does a marker land where the node it points at
 * actually is. An ellipse satisfies neither.
 */

const circuits = getCircuits();

describe("the outline is the circuit's own", () => {
  it("draws a closed path through every node", () => {
    for (const circuit of circuits) {
      const { path } = projectTrack(circuit.definition.nodes);
      // One move, then a line per remaining node, then the close.
      expect(path.startsWith("M"), circuit.blueprint.name).toBe(true);
      expect(path.endsWith("Z")).toBe(true);
      expect(path.split("L").length - 1).toBe(circuit.definition.nodes.length - 1);
    }
  });

  it("gives every circuit a different shape", () => {
    /**
     * The assertion the old minimap existed in violation of.
     *
     * Compared as sampled outlines rather than as path strings: two circuits could in principle
     * differ in a decimal and be visually identical, and it is the *visual* claim that matters. Ten
     * points around the lap, and at least one of them must be far apart between any two circuits.
     */
    const outlines = circuits.map((circuit) => {
      const { at } = projectTrack(circuit.definition.nodes);
      return Array.from({ length: 10 }, (_, step) => at(step / 10));
    });

    for (let a = 0; a < outlines.length; a += 1) {
      for (let b = a + 1; b < outlines.length; b += 1) {
        const spread = Math.max(
          ...outlines[a]!.map((point, index) => Math.hypot(point.x - outlines[b]![index]!.x, point.y - outlines[b]![index]!.y)),
        );
        expect(spread, `${circuits[a]!.blueprint.name} vs ${circuits[b]!.blueprint.name}`).toBeGreaterThan(6);
      }
    }
  });

  it("fills the view box it is given", () => {
    // A circuit squeezed into a corner of the map wastes most of it. The rotation onto the longest
    // axis is what prevents that, and this is the property it exists for.
    for (const circuit of circuits) {
      const { width, height } = projectTrack(circuit.definition.nodes);
      expect(Math.max(width, height), circuit.blueprint.name).toBeGreaterThan(140);
      expect(Math.min(width, height)).toBeGreaterThan(30);
    }
  });
});

describe("markers land where the karts are", () => {
  it("places a marker on the outline, not on an ellipse around it", () => {
    for (const circuit of circuits) {
      const nodes = circuit.definition.nodes;
      const { at } = projectTrack(nodes);
      for (const fraction of [0, 0.17, 0.4, 0.63, 0.88]) {
        const marker = at(fraction);
        // The nearest sampled point of the outline must be essentially on top of the marker: the
        // marker is derived from the same projection, so anything more than a rounding error means
        // the two have drifted apart.
        let nearest = Infinity;
        for (let index = 0; index < nodes.length; index += 1) {
          const point = at(index / nodes.length);
          nearest = Math.min(nearest, Math.hypot(point.x - marker.x, point.y - marker.y));
        }
        expect(nearest, `${circuit.blueprint.name} @ ${fraction}`).toBeLessThan(0.6);
      }
    }
  });

  it("moves monotonically around the lap rather than jumping", () => {
    // A kart driving forward must not have its dot teleport. Each step of one hundredth of a lap
    // moves it a bounded distance — which also catches an off-by-one in the node interpolation.
    const { at } = projectTrack(circuits[0]!.definition.nodes);
    let previous = at(0);
    for (let step = 1; step <= 100; step += 1) {
      const point = at(step / 100);
      expect(Math.hypot(point.x - previous.x, point.y - previous.y)).toBeLessThan(24);
      previous = point;
    }
  });

  it("wraps progress past the line instead of falling off the map", () => {
    const { at, width, height } = projectTrack(circuits[0]!.definition.nodes);
    for (const progress of [-0.3, 0, 1, 1.75, 4.2]) {
      const point = at(progress);
      expect(point.x).toBeGreaterThanOrEqual(0);
      expect(point.x).toBeLessThanOrEqual(width);
      expect(point.y).toBeGreaterThanOrEqual(0);
      expect(point.y).toBeLessThanOrEqual(height);
    }
    // And a whole lap later is the same place.
    expect(at(0.42).x).toBeCloseTo(at(3.42).x, 6);
  });
});

describe("degenerate input", () => {
  it("returns a usable projection for a track with no geometry", () => {
    // A blueprint mid-edit in the track factory can hand this two nodes. A minimap that throws would
    // take the whole editor down with it.
    const projection = projectTrack([]);
    expect(projection.path).toBe("");
    expect(Number.isFinite(projection.at(0.5).x)).toBe(true);
  });
});
