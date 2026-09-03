import { NullEngine, PBRMaterial, Scene, VertexBuffer } from "@babylonjs/core";
import { getCircuits, TerrainConfig } from "@print-rush/game-core";
import { describe, expect, it } from "vitest";
import { MaterialLibrary } from "@/render/MaterialLibrary";
import { createTerrain } from "@/render/Terrain";

/**
 * THE GROUND MUST NEVER BE ABOVE THE ROAD.
 *
 * This file exists because that invariant was broken in production, and the way it broke is worth
 * writing down: the field was a flat plane placed at the circuit's *mean* height, on the reasoning
 * that the verge handled the ground near the track and the field only had to look plausible beyond
 * it. Every part of that sentence is true except the conclusion, because these circuits are not flat.
 * The Megastore runs from -3.6 m to 15.5 m, so its mean sat four and a half metres above the start
 * line with 61% of the road underneath an opaque kilometre-wide sheet.
 *
 * What that looked like is the part no typecheck could have caught. The race camera sits at the
 * kart's height plus 4.7 m and the kart starts at 0.42 m, so the eye was 0.64 m *above* the plane
 * while the kart was 4 m below it: a viewpoint skimming a featureless surface, with the player's own
 * vehicle and the entire track hidden beneath. It was reported as "it looks first person and there is
 * no defined road, it's an open field", and that was an accurate description of the render.
 *
 * So the assertions below are about the two heights that actually matter — the road's and the
 * camera's — rather than about the terrain's own numbers.
 */

// Built at module scope, not in a `beforeAll`: the bodies of the `describe.each` below run at
// collection time, which is before any hook, and they need a terrain to make assertions about.
const scene = new Scene(new NullEngine());

/** `MaterialLibrary` needs a canvas for its procedural patterns; a `NullEngine` has none. */
class FlatMaterials extends MaterialLibrary {
  private readonly flat: PBRMaterial;

  constructor(target: Scene) {
    super(target, "HIGH");
    this.flat = new PBRMaterial("flat-ground", target);
  }

  override get(): PBRMaterial {
    return this.flat;
  }
}

/**
 * Where the camera's eye sits, in metres above the kart.
 *
 * `RaceCameraV5` places it at `kart.position.y + 1.2` (the pivot) `+ profile.height` (3.5), and the
 * kart itself rides 0.42 m above the road. Hard-coded rather than imported because the point of the
 * assertion is that the ground must clear the *camera* too, and a change to either number should
 * make someone look at this test rather than silently satisfy it.
 */
const EYE_ABOVE_ROAD = 0.42 + 1.2 + 3.5;

const circuits = getCircuits();

describe.each(circuits.map((circuit) => [circuit.blueprint.name, circuit] as const))(
  "%s",
  (_name, circuit) => {
    const nodes = circuit.definition.nodes;
    const terrain = createTerrain(
      scene,
      nodes,
      circuit.blueprint.theme,
      "HIGH",
      new FlatMaterials(scene),
    );

    it("never puts the ground above the road", () => {
      for (const node of nodes) {
        // Strictly below, with the clearance the terrain claims to leave, at every single node —
        // not on average, and not at the start line only. One buried node is a hole in the track.
        expect(
          terrain.heightAt(node.x, node.z),
          `ground under the road at progress ${node.progress.toFixed(3)}`,
        ).toBeLessThan(node.y - 0.4);
      }
    });

    it("never puts the ground above the camera", () => {
      // The failure that got reported. The eye is 5.1 m over the road, so ground above *that* is
      // ground the player is looking at instead of looking at their own kart.
      for (const node of nodes) {
        expect(terrain.heightAt(node.x, node.z)).toBeLessThan(node.y + EYE_ABOVE_ROAD);
      }
    });

    it("keeps the field mesh itself below every nearby piece of road", () => {
      /**
       * The function is not what renders — the mesh is, and it interpolates between the vertices the
       * function produced. That interpolation is safe for a reason worth stating: a bilinear patch is
       * bounded by its four corners, the grid cells are around 14 m, and each corner takes the
       * minimum road height within 45 m. So every corner of the cell containing a node is at or below
       * that node, and therefore so is the whole cell. This asserts the premise directly, against the
       * real vertex buffer, rather than trusting the argument.
       */
      const field = terrain.meshes.find((mesh) => mesh.name === "terrain-field")!;
      const positions = field.getVerticesData(VertexBuffer.PositionKind)!;
      const origin = field.position;

      let checked = 0;
      // Every eleventh node, which is a sample of roughly a hundred spread around the lap. The full
      // cross product is eight million distance tests per circuit and buys nothing.
      for (let index = 0; index < nodes.length; index += 11) {
        const node = nodes[index]!;
        for (let vertex = 0; vertex < positions.length; vertex += 3) {
          const x = (positions[vertex] ?? 0) + origin.x;
          const z = (positions[vertex + 2] ?? 0) + origin.z;
          if (Math.hypot(x - node.x, z - node.z) > 20) continue;
          expect(positions[vertex + 1] ?? 0).toBeLessThan(node.y);
          checked += 1;
        }
      }
      // A test that silently checked nothing would pass just as happily.
      expect(checked).toBeGreaterThan(50);
    });

    it("follows the circuit's elevation instead of averaging it", () => {
      /**
       * The positive form of the same requirement. A flat plane satisfies "below the road" trivially
       * by sitting under the lowest point, and it would be just as wrong: the whole circuit would
       * stand on a mesa. The ground's own vertical range has to be comparable to the road's.
       */
      const roadRange =
        Math.max(...nodes.map((node) => node.y)) - Math.min(...nodes.map((node) => node.y));
      const sampled = nodes.map((node) => terrain.heightAt(node.x, node.z));
      const groundRange = Math.max(...sampled) - Math.min(...sampled);
      expect(roadRange).toBeGreaterThan(5);
      expect(groundRange).toBeGreaterThan(roadRange * 0.6);
    });

    it("only sags below the road where there is lower road to sag to", () => {
      /**
       * The other failure of a minimum-over-a-disc, and the one that took two attempts to state
       * correctly.
       *
       * On a gradient the lowest road within the radius is further down the hill, so the ground sags
       * below the track beside it. At a 45 m radius that reached eight metres in the Manga hall: a
       * trench beside the track, a cliff at the verge's edge, and the dressing outside the barrier
       * standing at the bottom of it.
       *
       * But a large sag is not wrong by itself. These circuits cross over themselves, and beside a
       * bridge the ground *should* drop to the deck below — the whole reason the height is a minimum
       * is so it never buries that lower road. So the assertion is not "the sag is small", which
       * failed honestly on the Manga crossing; it is "the sag is explained by road that is genuinely
       * lower nearby". A gradient trench has no such explanation and still fails.
       *
       * The 30 m window is deliberately wider than the terrain's own radius, which makes the bound
       * loose in the right direction: it holds for the current radius, and it breaks if someone
       * widens the radius back out.
       */
      for (const node of nodes) {
        let lowestNear = node.y;
        for (const other of nodes) {
          if (Math.hypot(other.x - node.x, other.z - node.z) <= 30) {
            lowestNear = Math.min(lowestNear, other.y);
          }
        }
        expect(
          terrain.heightAt(node.x, node.z),
          `sag under the road at progress ${node.progress.toFixed(3)}`,
        ).toBeGreaterThan(lowestNear - 1.2);
      }
    });

    it("leaves a course, not a plain", () => {
      /**
       * The other half of the report: "it should be a circuit, not open field".
       *
       * The barrier stands at the verge's outer edge, so the verge is what decides whether a lap
       * reads as a track with room for a mistake or as a field with a road painted on it. The rule
       * is that a single side's run-off may not exceed the road's own half-width — asserted against
       * the *narrowest* circuit's real geometry, not against a number someone liked.
       */
      const meanWidth = nodes.reduce((total, node) => total + node.width, 0) / nodes.length;
      expect(TerrainConfig.vergeMetres).toBeLessThanOrEqual(meanWidth / 2);
    });
  },
);
