import { NullEngine, Scene } from "@babylonjs/core";
import { CharacterPresets, KartPresets } from "@print-rush/3d-factory";
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
  it("keeps four karts with drivers inside a sane total", () => {
    const scene = new Scene(new NullEngine());
    let triangles = 0;
    let drawCalls = 0;

    // The player at full detail, three opponents at the reduced tier the runtime actually uses.
    const grid: Array<["HIGH" | "MEDIUM", string]> = [
      ["HIGH", "player"],
      ["MEDIUM", "bot-0"],
      ["MEDIUM", "bot-1"],
      ["MEDIUM", "bot-2"],
    ];
    for (const [quality, name] of grid) {
      const kart = buildKart(scene, KartPresets[0]!, `grid-${name}`, quality);
      const driver = buildCharacter(scene, CharacterPresets[0]!, `grid-${name}-driver`, {
        pose: "DRIVING",
        quality,
      });
      for (const part of [measure(scene, kart.root), measure(scene, driver.root)]) {
        triangles += part.triangles;
        drawCalls += part.drawCalls;
      }
    }

    console.log(`full grid: ${triangles.toLocaleString("en-GB")} triangles, ${drawCalls} draw calls`);
    // Karts and drivers are the foreground; the environment needs the rest of the frame budget.
    expect(triangles).toBeLessThan(70_000);
    expect(drawCalls).toBeLessThan(140);
  });
});
