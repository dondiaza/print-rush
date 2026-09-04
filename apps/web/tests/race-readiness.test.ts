import {
  FreeCamera,
  MeshBuilder,
  NullEngine,
  PBRMaterial,
  Scene,
  StandardMaterial,
  Vector3,
} from "@babylonjs/core";
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { FrameMonitor } from "@/performance/PerformanceManager";
import {
  AssetManager,
  AssetPreparationError,
  type RaceAssetPlan,
} from "@/render/AssetManager";
import type { AssetManifest, VisualAsset } from "@/render/AssetCatalog";
import { RacePreloader, shaderRepresentatives } from "@/render/RacePreloader";
import { hasSet } from "@/render/sets";

function asset(
  id: string,
  category: VisualAsset["category"],
  download: VisualAsset["download"],
  circuit?: string,
): VisualAsset {
  return {
    id,
    category,
    sourceFile: `assets/${id}.png`,
    generated: true,
    generator: "test",
    width: 64,
    height: 32,
    hasAlpha: category === "decal",
    bytes: 100,
    usage: "test",
    status: "ready",
    download,
    ...(circuit ? { circuit } : {}),
  };
}

const manifest: AssetManifest = {
  generatedAt: "2026-09-03T00:00:00.000Z",
  totalBytes: 900,
  counts: {},
  assets: [
    asset("mat_asphalt_default_basecolor", "material", "always"),
    asset("ui_icons", "ui", "always"),
    asset("backdrop_store_panorama", "backdrop", "track", "store"),
    asset("backdrop_warehouse_panorama", "backdrop", "track", "warehouse"),
    asset("kart_wrap_pampling_racing_basecolor", "kart-wrap", "kart"),
    asset("kart_wrap_cmyk_strike_basecolor", "kart-wrap", "kart"),
    asset("decal_floor_mark_0", "decal", "track", "store"),
    asset("decal_tape_0", "decal", "track", "store"),
    asset("poster_store_0", "poster", "track", "store"),
  ],
};

async function managerForFixture(): Promise<AssetManager> {
  const fetchFixture = (async () => new Response(JSON.stringify(manifest), {
    status: 200,
    headers: { "content-type": "application/json" },
  })) as typeof fetch;
  return AssetManager.create(fetchFixture);
}

describe("race asset plan", () => {
  it("selects only this circuit, its decal families and the grid liveries", async () => {
    const manager = await managerForFixture();
    const plan = manager.planRace({
      theme: "FLAGSHIP",
      liveries: ["PAMPLING_RACING"],
      decalFamilies: ["floor_mark"],
    });

    expect(plan.all.map((entry) => entry.id)).toEqual([
      "mat_asphalt_default_basecolor",
      "ui_icons",
      "backdrop_store_panorama",
      "kart_wrap_pampling_racing_basecolor",
      "decal_floor_mark_0",
      "poster_store_0",
    ]);
    expect(plan.required.map((entry) => entry.id)).toEqual([
      "mat_asphalt_default_basecolor",
      "ui_icons",
      "backdrop_store_panorama",
      "kart_wrap_pampling_racing_basecolor",
    ]);
    expect(plan.optional.map((entry) => entry.id)).toEqual(["decal_floor_mark_0", "poster_store_0"]);
    expect(plan.downloadBytes).toBe(600);
    expect(plan.estimatedGpuBytes).toBe(6 * Math.ceil(64 * 32 * 4 * (4 / 3)));
    manager.dispose();
  });

  it("rejects a manifest that cannot satisfy a requested grid livery", async () => {
    const manager = await managerForFixture();
    expect(() => manager.planRace({
      theme: "FLAGSHIP",
      liveries: ["MISSING_WRAP"],
      decalFamilies: [],
    })).toThrow(AssetPreparationError);
    manager.dispose();
  });

  it("counts decoded RGBA mip storage rather than compressed download bytes", () => {
    expect(AssetManager.estimateTextureBytes({ width: 1_024, height: 512 })).toBe(2_796_203);
  });
});

describe("manifest freshness", () => {
  /**
   * The regression this exists for: a browser served its stored manifest without asking, so a
   * deployment that renamed the panoramas from PNG to WebP left returning players requesting file
   * names that no longer existed. A required backdrop that 404s fails the whole bundle, which is
   * correct — reading a manifest older than the files it describes is what was not.
   */
  it("revalidates the manifest instead of trusting a stored copy", async () => {
    const modes: (RequestCache | undefined)[] = [];
    const fetchFixture = (async (_url: string, init?: RequestInit) => {
      modes.push(init?.cache);
      return new Response(JSON.stringify(manifest), {
        status: 200,
        headers: { "content-type": "application/json" },
      });
    }) as unknown as typeof fetch;

    (await AssetManager.create(fetchFixture)).dispose();
    (await AssetManager.create(fetchFixture, { refresh: true })).dispose();

    expect(modes).toEqual(["no-cache", "reload"]);
    expect(modes).not.toContain("force-cache");
  });

  /**
   * A second reader of the same manifest is how this came back. `IconAtlas` fetches it for the HUD
   * sprite sheet with its own copy of the cache mode, so fixing `AssetCatalog` alone left the same
   * defect one file away. The rule is about the manifest, not about one module, so it is checked
   * over the source rather than over a call.
   */
  it("has no reader left that pins a fetch to the browser cache", () => {
    const root = join(__dirname, "..");
    const skip = new Set(["node_modules", ".next", "public", "tests", "out"]);
    const pinned = /cache:\s*["']force-cache["']/;
    const offenders: string[] = [];
    const walk = (dir: string): void => {
      for (const entry of readdirSync(dir)) {
        if (skip.has(entry)) continue;
        const path = join(dir, entry);
        if (statSync(path).isDirectory()) walk(path);
        else if (/\.tsx?$/.test(entry) && pinned.test(readFileSync(path, "utf8"))) {
          offenders.push(path.slice(root.length + 1).replaceAll("\\", "/"));
        }
      }
    };
    walk(root);
    expect(offenders).toEqual([]);
  });

  it("sees the new bundle when a race retries with a refreshed manifest", async () => {
    const stale: AssetManifest = {
      ...manifest,
      assets: manifest.assets.map((entry) =>
        entry.id === "backdrop_store_panorama"
          ? { ...entry, sourceFile: "assets/backdrop_store_panorama.legacy.png" }
          : entry,
      ),
    };
    const fetchFixture = (async (_url: string, init?: RequestInit) => new Response(
      JSON.stringify(init?.cache === "reload" ? manifest : stale),
      { status: 200, headers: { "content-type": "application/json" } },
    )) as unknown as typeof fetch;

    const first = await AssetManager.create(fetchFixture);
    expect(first.catalog.url("backdrop_store_panorama")).toBe("/assets/backdrop_store_panorama.legacy.png");
    first.dispose();

    const refreshed = await AssetManager.create(fetchFixture, { refresh: true });
    expect(refreshed.catalog.url("backdrop_store_panorama")).toBe("/assets/backdrop_store_panorama.png");
    refreshed.dispose();
  });
});

describe("race readiness gate", () => {
  it("does not report ready until assets, world, shaders, textures and GPU all settled", async () => {
    const progress: number[] = [];
    const preloader = new RacePreloader((event) => progress.push(event.loaded));
    const engine = new NullEngine();
    const scene = new Scene(engine);
    scene.activeCamera = new FreeCamera("camera", new Vector3(0, 2, -8), scene);
    const mesh = MeshBuilder.CreateBox("box", undefined, scene);
    mesh.material = new StandardMaterial("paint", scene);

    preloader.markCatalogReady();
    const fakeManager = {
      prepareRace: async () => ({
        loaded: 0,
        optionalFailures: [],
        downloadBytes: 0,
        estimatedGpuBytes: 0,
      }),
    } as unknown as AssetManager;
    const emptyPlan: RaceAssetPlan = {
      required: [],
      optional: [],
      all: [],
      downloadBytes: 0,
      estimatedGpuBytes: 0,
    };
    await preloader.prepareAssets(scene, fakeManager, emptyPlan, (id) => id);
    preloader.markWorldReady();
    expect(preloader.readiness.raceReady).toBe(false);

    await preloader.warmup(scene, engine, null);
    expect(preloader.readiness).toMatchObject({
      assetsReady: true,
      geometryReady: true,
      texturesReady: true,
      shadersReady: true,
      gpuReady: true,
      raceReady: true,
    });
    expect(progress.at(-1)).toBe(100);
    scene.dispose();
    engine.dispose();
  });

  it("compiles one representative per material and mesh-define family", () => {
    const engine = new NullEngine();
    const scene = new Scene(engine);
    const first = MeshBuilder.CreateBox("first", undefined, scene);
    const second = MeshBuilder.CreateBox("second", undefined, scene);
    const third = MeshBuilder.CreateBox("third", undefined, scene);
    const shared = new StandardMaterial("standard", scene);
    first.material = shared;
    second.material = shared;
    third.material = new PBRMaterial("pbr", scene);

    expect(shaderRepresentatives(scene)).toHaveLength(2);
    scene.dispose();
    engine.dispose();
  });
});

describe("frame pacing telemetry", () => {
  it("reports tail latency and stutters, not just an average FPS", () => {
    const monitor = new FrameMonitor();
    for (const sample of [16, 17, 18, 120]) monitor.record(sample);
    expect(monitor.snapshot()).toMatchObject({
      p95Ms: 120,
      p99Ms: 120,
      worstMs: 120,
      samples: 4,
      stutters: 1,
    });
    monitor.dispose();
  });
});

describe("authored circuit registry", () => {
  it.each(["FLAGSHIP", "WAREHOUSE", "PRINT_FACTORY", "OFFICE", "MANGA"])("registers %s", (theme) => {
    expect(hasSet(theme)).toBe(true);
  });
});
