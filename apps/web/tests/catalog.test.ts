import { readFileSync } from "node:fs";
import { join } from "node:path";
import { Color3, NullEngine, Scene, Texture } from "@babylonjs/core";
import { KartPresets } from "@print-rush/3d-factory";
import { describe, expect, it } from "vitest";
import { AssetCatalog, circuitKeyForTheme, type AssetManifest } from "@/render/AssetCatalog";
import { MaterialLibrary } from "@/render/MaterialLibrary";
import { buildKart } from "@/render/KartBuilder";
import { propSourceKey, propSourceSpecs } from "@/render/PropLibrary";
import { visualsForTheme } from "@/game/TrackBuilder";

/**
 * The catalog and the fallback path.
 *
 * These are the two things that decide whether the baked assets are an improvement or a liability.
 * The resolution logic has to point at real files — asserted here against the real manifest, not a
 * fixture, so a rename breaks the test rather than the game. And the fallback has to be genuine: if
 * a download fails, or the manifest is unreachable, every surface must still get a material. That
 * property is easy to claim and easy to lose, so it is asserted rather than assumed.
 *
 * Nothing here downloads anything. A `NullEngine` has no GL context and there is no server, so a
 * texture never becomes resident — which is exactly the condition the fallback exists for and the
 * reason these tests can check it honestly.
 */

const manifest: AssetManifest = JSON.parse(
  readFileSync(join(__dirname, "..", "public", "assets", "assets.manifest.json"), "utf8"),
);

const catalog = AssetCatalog.fromManifest(manifest);

describe("asset catalog resolution", () => {
  it("resolves urls under the public root", () => {
    const asset = manifest.assets.find((entry) => entry.category === "material")!;
    expect(catalog.url(asset.id)).toBe(`/${asset.sourceFile}`);
    expect(catalog.url("mat_does_not_exist_basecolor")).toBeNull();
  });

  it("maps every circuit theme to a panorama that exists", () => {
    for (const theme of ["FLAGSHIP", "WAREHOUSE", "PRINT_FACTORY", "OFFICE", "MANGA", "GREYBOX"]) {
      const backdrop = catalog.backdropFor(theme);
      expect(backdrop, `${theme} backdrop`).not.toBeNull();
      expect(backdrop!.circuit).toBe(circuitKeyForTheme(theme));
    }
  });

  it("falls back to the greybox panorama for an unknown theme", () => {
    // A theme added to a blueprint before its art exists must not crash the race, and must not
    // silently pick another circuit's backdrop either.
    expect(catalog.backdropFor("NOT_A_THEME")!.id).toBe("backdrop_greybox_panorama");
  });

  it("treats NONE as no livery rather than as a missing file", () => {
    expect(catalog.wrap("NONE")).toBeNull();
    expect(catalog.wrap("")).toBeNull();
    expect(catalog.wrap("PAMPLING_RACING")!.id).toBe("kart_wrap_pampling_racing_basecolor");
  });

  it("resolves the three maps of a material, and nulls for what was not baked", () => {
    const maps = catalog.materialMaps("mat_asphalt_default");
    expect(maps.baseColor).not.toBeNull();
    expect(maps.normal).not.toBeNull();
    expect(maps.roughness).not.toBeNull();
    expect(catalog.materialMaps("mat_nothing").baseColor).toBeNull();
  });

  /**
   * The declared download budget, verified against what a race actually fetches.
   *
   * `docs/ART_DIRECTION.md` §3 sets COMMON under 4 MB and TRACK under 3 MB. The first version of
   * this suite asserted 6 MB for the shared set, which is not the budget — it was the figure that
   * happened to pass, because the manifest counted all seven liveries and all twenty-one decals as
   * shared. A race pulls one circuit, that theme's decal families, and its own grid's liveries.
   */
  const FAMILIES: Record<string, string[]> = {
    FLAGSHIP: ["floor_mark", "dirt", "sticker", "scratch"],
    WAREHOUSE: ["dirt", "floor_mark", "tape", "label", "scratch"],
    PRINT_FACTORY: ["ink_splash", "floor_mark", "dirt", "scratch"],
    OFFICE: ["floor_mark", "label", "tape", "dirt"],
    MANGA: ["sticker", "floor_mark", "dirt", "ink_splash"],
  };

  /** Four karts on the grid, and the four heaviest liveries, which is the worst case. */
  const heaviestLiveries = manifest.assets
    .filter((asset) => asset.download === "kart")
    .sort((a, b) => b.bytes - a.bytes)
    .slice(0, 4)
    .map((asset) => asset.id.replace(/^kart_wrap_/, "").replace(/_basecolor$/, "").toUpperCase());

  it("keeps the shared set inside the 4 MB budget", () => {
    const always = manifest.assets
      .filter((asset) => asset.download === "always")
      .reduce((sum, asset) => sum + asset.bytes, 0);
    expect(always / 1048576).toBeLessThan(4);
  });

  it("keeps every circuit inside the 3 MB budget, and the whole race under 7", () => {
    for (const [theme, families] of Object.entries(FAMILIES)) {
      const weight = catalog.raceWeight(theme, heaviestLiveries, families);
      expect(weight.track / 1048576, `${theme} track`).toBeLessThan(3);
      expect(weight.total / 1048576, `${theme} race total`).toBeLessThan(7);
      // The tiers must account for everything, or the figure is not the download.
      expect(weight.always + weight.track + weight.kart).toBe(weight.total);
    }
  });

  it("charges a race only for the liveries on its own grid", () => {
    const one = catalog.raceWeight("FLAGSHIP", ["COMIC"], FAMILIES.FLAGSHIP!);
    const four = catalog.raceWeight("FLAGSHIP", heaviestLiveries, FAMILIES.FLAGSHIP!);
    const all = manifest.assets
      .filter((asset) => asset.download === "kart")
      .reduce((sum, asset) => sum + asset.bytes, 0);
    expect(one.kart).toBeGreaterThan(0);
    expect(one.kart).toBeLessThan(four.kart);
    // Never all seven, which is what the old scope sum charged.
    expect(four.kart).toBeLessThan(all);
    expect(catalog.raceWeight("FLAGSHIP", ["NONE"], FAMILIES.FLAGSHIP!).kart).toBe(0);
  });

  it("charges a race only for the decal families its theme scatters", () => {
    // The office scatters no ink, so it must not pay for the splashes — the heaviest family there is.
    const office = catalog.raceWeight("OFFICE", ["NONE"], FAMILIES.OFFICE!);
    const factory = catalog.raceWeight("PRINT_FACTORY", ["NONE"], FAMILIES.PRINT_FACTORY!);
    expect(office.track).toBeLessThan(factory.track);
  });

  it("reports no texture as resident until one is preloaded", () => {
    // The synchronous accessor the material library depends on. Returning a texture here before it
    // had loaded would bind a blank image, which is worse than falling back.
    expect(catalog.texture("mat_asphalt_default_basecolor")).toBeNull();
    expect(catalog.wrapTexture("COMIC")).toBeNull();
  });
});

describe("material library with a catalog", () => {
  /**
   * What can and cannot be tested here.
   *
   * The procedural generator draws into a `DynamicTexture`, which needs an `OffscreenCanvas`. Node
   * has none and neither does jsdom, so any class that generates a texture cannot be exercised in
   * this environment at all — stating that rather than quietly skipping it, because it means the
   * canvas drawing itself is verified only by the baked PNGs the same functions produced offline.
   *
   * `GLASS` and `NEON` are smooth with no bump, so `get` skips texture generation entirely for them
   * and the rest of the material path — caching, colour, the baked lookup — is reachable.
   */
  const CANVAS_FREE = ["GLASS", "NEON"] as const;

  it("binds nothing baked while no texture is resident, and keeps the colour", () => {
    const scene = new Scene(new NullEngine());
    const library = new MaterialLibrary(scene, "HIGH", catalog);

    for (const materialClass of CANVAS_FREE) {
      const material = library.get({ materialClass, color: "#ff3da6" });
      expect(material.albedoColor.r, `${materialClass} colour`).toBeCloseTo(
        Color3.FromHexString("#ff3da6").r,
        5,
      );
    }
    // The property that makes the bake safe to depend on: with the manifest read but nothing
    // downloaded, not one baked map is bound and every material is still complete.
    expect(library.bakedTextureCount).toBe(0);
    library.dispose();
  });

  it("caches one material per class, colour, tiling and named texture", () => {
    const scene = new Scene(new NullEngine());
    const library = new MaterialLibrary(scene, "HIGH", catalog);

    const first = library.get({ materialClass: "GLASS", color: "#65d8ff" });
    expect(library.get({ materialClass: "GLASS", color: "#65d8ff" })).toBe(first);
    expect(library.get({ materialClass: "GLASS", color: "#65d8ff", tile: 12 })).not.toBe(first);
    expect(library.get({ materialClass: "GLASS", color: "#8f5cff" })).not.toBe(first);
    // A named baked texture is part of the identity of a material, so it belongs in the key. Without
    // it, two surfaces asking for different baked materials would share the first one built.
    expect(library.get({ materialClass: "GLASS", color: "#65d8ff", texture: "mat_ink_violet" })).not.toBe(first);
    library.dispose();
  });
});

describe("kart livery", () => {
  it("lets the wrap define the colour and keeps flat paint without one", () => {
    const scene = new Scene(new NullEngine());
    const definition = { ...KartPresets[0]!, primaryColor: "#ff3da6", livery: "COMIC" as const };

    const plain = buildKart(scene, definition, "kart-plain", "MEDIUM", null);
    expect(plain.paint.albedoTexture).toBeNull();
    expect(plain.paint.albedoColor.r).toBeCloseTo(Color3.FromHexString("#ff3da6").r, 5);

    // A texture object is enough to exercise the path; it never becomes resident under NullEngine,
    // which does not matter here — what is asserted is that the material defers to it.
    const wrap = new Texture(null, scene);
    wrap.name = "kart_wrap_comic_basecolor";
    const wrapped = buildKart(scene, definition, "kart-wrapped", "MEDIUM", wrap);
    expect(wrapped.paint.albedoTexture).toBe(wrap);
    expect(wrapped.paint.albedoColor.r).toBeCloseTo(1, 5);

    // Two karts differing only by livery must not share a paint material.
    expect(wrapped.paint).not.toBe(plain.paint);
  });

  it("gives the presets that dress the grid more than one livery between them", () => {
    const liveries = new Set(KartPresets.map((preset) => preset.livery ?? "NONE"));
    expect(liveries.size, `grid liveries: ${[...liveries].join(", ")}`).toBeGreaterThan(1);
  });
});

describe("prop sources", () => {
  const THEMES = ["FLAGSHIP", "WAREHOUSE", "PRINT_FACTORY", "OFFICE", "MANGA"] as const;

  /**
   * The regression this exists for.
   *
   * The scatter looks a prop up by key every time it places one. When the key gained a print
   * component, every existing lookup still compiled and started returning `undefined` — so a
   * circuit would have been dressed with nothing at all, silently. Asserting that every spec
   * resolves is the cheapest possible guard against the whole class of mistake.
   */
  it.each(THEMES)("%s resolves every prop it scatters to a source", (theme) => {
    const visuals = visualsForTheme(theme);
    const keys = new Set(propSourceSpecs(visuals.props).map(([key]) => key));
    for (const spec of visuals.props) {
      expect(keys.has(propSourceKey(spec.kind, spec.texture)), `${theme} ${spec.kind} ${spec.texture ?? "plain"}`).toBe(true);
    }
  });

  it("shares a source between specs that differ only by colour", () => {
    const shared = propSourceSpecs([
      { materialClass: "CARDBOARD", color: "#aaaaaa", kind: "BOX", weight: 1 },
      { materialClass: "CARDBOARD", color: "#bbbbbb", kind: "BOX", weight: 1 },
    ]);
    expect(shared).toHaveLength(1);
  });

  it("splits sources between specs that differ by print", () => {
    // Two prints cannot share a mesh: the artwork is in the texture, not in the instance colour.
    const split = propSourceSpecs([
      { materialClass: "FABRIC", color: "#ffffff", kind: "SHELF", weight: 1, texture: "mat_fabricprint_bolt" },
      { materialClass: "FABRIC", color: "#ffffff", kind: "SHELF", weight: 1, texture: "mat_fabricprint_wave" },
      { materialClass: "FABRIC", color: "#ffffff", kind: "SHELF", weight: 1 },
    ]);
    expect(split).toHaveLength(3);
  });

  it("gives the Megastore four different shirt displays", () => {
    const displays = visualsForTheme("FLAGSHIP").props.filter((spec) => spec.kind === "SHELF");
    const prints = new Set(displays.map((spec) => spec.texture));
    expect(prints.size, `${[...prints].join(", ")}`).toBe(4);
  });
});
