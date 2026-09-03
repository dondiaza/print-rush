import { NullEngine, Scene } from "@babylonjs/core";
import { CharacterPresets, KartPresets } from "@print-rush/3d-factory";
import { RaceConfig } from "@print-rush/game-core";
import { describe, expect, it } from "vitest";
import { buildKart } from "@/render/KartBuilder";
import { buildCharacter } from "@/render/CharacterBuilder";

/**
 * Triangle and draw-call budgets.
 *
 * The art bible sets these numbers, and without a test they drift: it is very easy to add "just one
 * more detail" to a kart until four of them cost more than the whole environment. These assertions
 * are the ceiling, and they print the real figures so a change's cost is visible in the test output.
 *
 * Budgets from `docs/ART_BIBLE_V5.md` section 5.3 — a kart and a driver are hero-tier assets, so
 * 12,000 triangles each is the cap, and the lower tiers must actually be cheaper rather than merely
 * being labelled so.
 */

function measure(scene: Scene, root: { getChildMeshes: (d?: boolean) => Array<{ getTotalIndices: () => number; subMeshes?: unknown[] }> }) {
  const meshes = root.getChildMeshes(false);
  let triangles = 0;
  let drawCalls = 0;
  for (const mesh of meshes) {
    triangles += mesh.getTotalIndices() / 3;
    // Each sub-mesh is a separate draw, which is what multi-material merging trades against.
    drawCalls += Math.max(1, mesh.subMeshes?.length ?? 1);
  }
  void scene;
  return { triangles: Math.round(triangles), drawCalls, meshCount: meshes.length };
}

describe("kart budget", () => {
  it("stays inside the hero triangle cap and scales down by quality", () => {
    const scene = new Scene(new NullEngine());
    const rows: Array<[string, number, number, number]> = [];

    for (const quality of ["LOW", "MEDIUM", "HIGH", "ULTRA"] as const) {
      const visual = buildKart(scene, KartPresets[0]!, `budget-kart-${quality}`, quality);
      const { triangles, drawCalls, meshCount } = measure(scene, visual.root);
      rows.push([quality, triangles, drawCalls, meshCount]);
    }

    console.table(
      rows.map(([quality, triangles, drawCalls, meshCount]) => ({
        quality,
        triangles,
        drawCalls,
        meshes: meshCount,
      })),
    );

    const byQuality = new Map(rows.map(([quality, triangles]) => [quality, triangles]));
    expect(byQuality.get("HIGH")!).toBeLessThan(12_000);
    expect(byQuality.get("LOW")!).toBeLessThan(byQuality.get("HIGH")!);
    // A kart still has to be a kart at the lowest tier, not a box.
    expect(byQuality.get("LOW")!).toBeGreaterThan(600);

    // Four karts on track, so the per-kart draw calls have to stay modest.
    const highDrawCalls = rows.find(([quality]) => quality === "HIGH")![2];
    expect(highDrawCalls).toBeLessThanOrEqual(24);
  });
});

describe("character budget", () => {
  it("stays inside the hero triangle cap and scales down by quality", () => {
    const scene = new Scene(new NullEngine());
    const rows: Array<[string, number, number, number]> = [];

    for (const quality of ["LOW", "MEDIUM", "HIGH", "ULTRA"] as const) {
      const visual = buildCharacter(scene, CharacterPresets[0]!, `budget-char-${quality}`, {
        pose: "DRIVING",
        quality,
      });
      const { triangles, drawCalls, meshCount } = measure(scene, visual.root);
      rows.push([quality, triangles, drawCalls, meshCount]);
    }

    console.table(
      rows.map(([quality, triangles, drawCalls, meshCount]) => ({
        quality,
        triangles,
        drawCalls,
        meshes: meshCount,
      })),
    );

    const byQuality = new Map(rows.map(([quality, triangles]) => [quality, triangles]));
    expect(byQuality.get("HIGH")!).toBeLessThan(12_000);
    expect(byQuality.get("LOW")!).toBeLessThan(byQuality.get("HIGH")!);
    expect(byQuality.get("LOW")!).toBeGreaterThan(400);
  });
});

describe("full grid budget", () => {
  /**
   * What a whole field costs, measured rather than assumed.
   *
   * This is the assertion that decided the size of the grid. The field went from four karts to
   * eight, and the question "can it be twelve" has a numeric answer that nothing else in the project
   * could give: a kart and its driver cost 29 draw calls even at the lowest tier, so eleven
   * opponents would be over three hundred draw calls before a single piece of the world is drawn.
   * There is no browser in this environment to profile that in, so the field is the size the
   * measured budget supports and this test is where that budget lives.
   *
   * It prints the figures as well as asserting them, so the cost of adding "just one more detail" to
   * a kart shows up in the test output rather than in a frame rate nobody is watching.
   */
  const build = (scene: Scene, quality: "HIGH" | "MEDIUM" | "LOW", name: string) => {
    const kart = buildKart(scene, KartPresets[0]!, `grid-${name}`, quality);
    const driver = buildCharacter(scene, CharacterPresets[0]!, `grid-${name}-driver`, { pose: "DRIVING", quality });
    let triangles = 0;
    let drawCalls = 0;
    for (const part of [measure(scene, kart.root), measure(scene, driver.root)]) {
      triangles += part.triangles;
      drawCalls += part.drawCalls;
    }
    return { triangles, drawCalls };
  };

  /** The grid the runtime actually builds: the player one tier above the opponents. */
  const measureGrid = (size: number, botQuality: "MEDIUM" | "LOW") => {
    const scene = new Scene(new NullEngine());
    let triangles = 0;
    let drawCalls = 0;
    for (let slot = 0; slot < size; slot += 1) {
      const part = build(scene, slot === 0 ? "HIGH" : botQuality, `${botQuality}-${size}-${slot}`);
      triangles += part.triangles;
      drawCalls += part.drawCalls;
    }
    return { triangles, drawCalls };
  };

  it("keeps the configured field inside the frame's budget", () => {
    const desktop = measureGrid(RaceConfig.gridSize, "MEDIUM");
    const mobile = measureGrid(RaceConfig.gridSize, "LOW");

    console.table([
      { grid: `${RaceConfig.gridSize} · bots MEDIUM`, triangles: desktop.triangles, drawCalls: desktop.drawCalls },
      { grid: `${RaceConfig.gridSize} · bots LOW`, triangles: mobile.triangles, drawCalls: mobile.drawCalls },
    ]);

    /**
     * The ceilings, and where they come from.
     *
     * Triangles are cheap and plentiful: a modern integrated GPU does not notice a hundred thousand
     * of them. Draw calls are the real constraint on the web, where every one is a JavaScript-to-GL
     * boundary crossing, so that is the number with the tight bound. Two hundred and sixty leaves
     * room for the road, the terrain, the barriers, the props, the crowd and the posters — which
     * `assets.test.ts` budgets separately — inside a frame a phone can hold at 30 fps.
     */
    expect(desktop.triangles).toBeLessThan(140_000);
    expect(desktop.drawCalls).toBeLessThan(260);
    // The lowest tier has to be genuinely cheaper, not merely labelled so.
    expect(mobile.drawCalls).toBeLessThanOrEqual(desktop.drawCalls);
    expect(mobile.triangles).toBeLessThan(desktop.triangles);
  });

  it("shows why the grid is not twelve", () => {
    /**
     * Not an aspiration — a measurement, kept so the decision is reviewable.
     *
     * If a future change makes a distant bot cheap enough (instancing, a merged low-detail mesh, a
     * billboard past thirty metres) this assertion is where that shows up: it fails, and the grid can
     * be raised. Until then it documents the cost in the one place that cannot go stale.
     */
    const full = measureGrid(RaceConfig.maxGridSize, "LOW");
    console.log(`a field of ${RaceConfig.maxGridSize}: ${full.triangles.toLocaleString("en-GB")} triangles, ${full.drawCalls} draw calls`);
    expect(full.drawCalls).toBeGreaterThan(260);
  });
});
