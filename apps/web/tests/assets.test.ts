import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
// @ts-expect-error — the asset pipeline is plain ESM JavaScript, deliberately dependency-free.
import { borderAlpha, decodePng, edgeDifference, interiorDifference, statistics } from "../../../tools/assetgen/decode.mjs";
// @ts-expect-error — same reason: the audit is plain ESM JavaScript, shared with the bake CLI.
import { auditIntegration, readSourceText } from "../../../tools/assetgen/audit.mjs";

/**
 * Baked asset validation.
 *
 * Nobody in this environment can look at these files, so every property that would normally be
 * checked by eye is checked by measurement instead. Each assertion corresponds to a specific defect
 * from the brief's visual QA list:
 *
 *  - a tileable texture with a visible seam        → wrap difference vs interior control
 *  - a sprite showing a white or black rectangle   → alpha at the border
 *  - a flat texture, i.e. a failed generator       → per-channel range
 *  - a normal map that is not a normal map         → z channel dominance
 *  - the manifest claiming assets that do not exist → disk cross-check
 *
 * If the pipeline is later replaced by illustrated assets, these tests keep applying: they are about
 * the files, not about how they were made.
 */

const ASSETS = join(__dirname, "..", "public", "assets");
const MANIFEST = join(ASSETS, "assets.manifest.json");

type ManifestAsset = {
  id: string;
  category: string;
  circuit?: string;
  sourceFile: string;
  generated: boolean;
  width: number;
  height: number;
  hasAlpha: boolean;
  bytes: number;
  usage: string;
  status: string;
  download: "always" | "track" | "kart";
  frames?: Record<string, { x: number; y: number; width: number; height: number; u0?: number; v0?: number; u1?: number; v1?: number; cell?: number }>;
  grid?: { cellWidth: number; cellHeight: number; columns: number; rows: number; count: number };
};

const manifest: { assets: ManifestAsset[]; totalBytes: number; counts: Record<string, number> } =
  JSON.parse(readFileSync(MANIFEST, "utf8"));

function load(asset: ManifestAsset) {
  const path = join(ASSETS, "..", asset.sourceFile);
  return decodePng(readFileSync(path));
}

/**
 * Per-channel statistics, typed.
 *
 * The decoder is plain ESM JavaScript, so everything it returns arrives as `any` and every callback
 * over it would be an implicit `any` that `tsc --noEmit` rejects. Naming the shape once here is
 * cheaper than annotating each use, and it means a change to the decoder's return value is a type
 * error in one place rather than silence in six.
 */
type ImageStatistics = { min: number[]; max: number[]; mean: number[] };

function statsOf(asset: ManifestAsset): ImageStatistics {
  return statistics(load(asset)) as ImageStatistics;
}

/** The widest per-channel spread. Zero means the generator returned a constant. */
function channelRange(stats: ImageStatistics): number {
  return Math.max(...stats.max.map((max, index) => max - stats.min[index]!));
}

const byCategory = (category: string) => manifest.assets.filter((asset) => asset.category === category);

describe("manifest", () => {
  it("exists and describes a non-trivial asset set", () => {
    expect(manifest.assets.length).toBeGreaterThan(80);
    expect(manifest.counts.materials).toBeGreaterThanOrEqual(20);
    expect(manifest.counts.decals).toBeGreaterThanOrEqual(15);
    expect(manifest.counts.wraps).toBeGreaterThanOrEqual(6);
    expect(manifest.counts.backdrops).toBeGreaterThanOrEqual(5);
  });

  /**
   * The brief's hardest rule: never claim an asset exists when it does not. The manifest is
   * generated from the disk, and this asserts the two have not drifted.
   */
  it("every entry points at a file that actually exists, with the stated size", () => {
    for (const asset of manifest.assets) {
      const path = join(ASSETS, "..", asset.sourceFile);
      expect(existsSync(path), `${asset.id} → ${asset.sourceFile}`).toBe(true);
      const decoded = decodePng(readFileSync(path));
      expect(decoded.width, `${asset.id} width`).toBe(asset.width);
      expect(decoded.height, `${asset.id} height`).toBe(asset.height);
      expect(decoded.channels === 4, `${asset.id} alpha`).toBe(asset.hasAlpha);
    }
  });

  it("uses descriptive names throughout", () => {
    for (const asset of manifest.assets) {
      expect(asset.id).not.toMatch(/^(image|final|new|generated|untitled)[\d-]*$/i);
      expect(asset.id.length).toBeGreaterThan(6);
      expect(asset.usage.length).toBeGreaterThan(10);
    }
  });

  /**
   * Every entry says when it is fetched.
   *
   * The budget itself is asserted in `catalog.test.ts`, against what a race actually downloads.
   * What matters here is that the tier is present and consistent with the asset's scope, because a
   * mislabelled tier would make that budget measure the wrong thing.
   */
  it("labels every asset with a download tier that matches its scope", () => {
    for (const asset of manifest.assets) {
      expect(["always", "track", "kart"], `${asset.id} tier`).toContain(asset.download);
      if (asset.download === "always") {
        // Fetched every session, so it cannot belong to one circuit.
        expect(asset.circuit, `${asset.id} is shared but circuit-scoped`).toBeUndefined();
      }
      if (asset.circuit !== undefined) {
        expect(asset.download, `${asset.id} belongs to ${asset.circuit}`).toBe("track");
      }
      if (asset.category === "kart-wrap") expect(asset.download).toBe("kart");
    }
  });
});

describe("materials tile seamlessly", () => {
  const materials = byCategory("material");

  it("covers every class the art bible defines as tileable", () => {
    const ids = materials.map((asset) => asset.id).join(" ");
    for (const expected of ["asphalt", "concrete", "floortile", "wood", "carpet", "cardboard", "paintedmetal", "rawmetal", "rubber", "fabric", "paper", "ink"]) {
      expect(ids, `${expected} present`).toContain(expected);
    }
  });

  /**
   * The seam test.
   *
   * A tileable texture's wrap difference is compared against the difference between two adjacent
   * interior lines, not against a fixed threshold — a fixed threshold either fails legitimately
   * noisy textures like asphalt or passes a smooth one that has a real seam. A wrap that is
   * statistically indistinguishable from an ordinary neighbouring line is seamless.
   */
  it.each(materials.map((asset) => [asset.id, asset] as const))("%s has no visible seam", (id, asset) => {
    const image = load(asset);
    for (const axis of ["horizontal", "vertical"] as const) {
      const wrap = edgeDifference(image, axis);
      const interior = interiorDifference(image, axis);
      // A generous factor: some variation at the wrap is inevitable at 8-bit precision, but a real
      // seam shows up as many times the local difference, not a fraction more.
      const allowed = Math.max(4, interior * 2.5);
      expect(wrap, `${id} ${axis} wrap=${wrap.toFixed(2)} interior=${interior.toFixed(2)}`).toBeLessThan(allowed);
    }
  });

  it.each(materials.filter((a) => a.id.endsWith("_basecolor")).map((a) => [a.id, a] as const))(
    "%s is not a flat colour",
    (id, asset) => {
      // A generator that silently returned a constant produces a zero range. That is the single
      // most likely failure and it is invisible without measuring.
      expect(channelRange(statsOf(asset)), `${id} channel range`).toBeGreaterThan(12);
    },
  );

  it.each(materials.filter((a) => a.id.endsWith("_normal")).map((a) => [a.id, a] as const))(
    "%s is a valid tangent-space normal map",
    (id, asset) => {
      const stats = statsOf(asset);
      // Z points out of the surface, so the blue channel must dominate and stay in the upper half.
      expect(stats.mean[2]!, `${id} z mean`).toBeGreaterThan(180);
      expect(stats.min[2]!, `${id} z min`).toBeGreaterThan(127);
      // X and Y are signed around the 128 midpoint.
      expect(stats.mean[0]!, `${id} x mean`).toBeGreaterThan(100);
      expect(stats.mean[0]!, `${id} x mean`).toBeLessThan(156);
      expect(stats.mean[1]!, `${id} y mean`).toBeGreaterThan(100);
      expect(stats.mean[1]!, `${id} y mean`).toBeLessThan(156);
    },
  );

  it("gives fabric a much rougher surface than raw metal", () => {
    const fabric = manifest.assets.find((a) => a.id === "mat_fabric_white_roughness")!;
    const metal = manifest.assets.find((a) => a.id === "mat_rawmetal_default_roughness")!;
    const fabricMean = statsOf(fabric).mean[0]!;
    const metalMean = statsOf(metal).mean[0]!;
    // The art bible's whole point about material differentiation, asserted on the actual pixels.
    expect(fabricMean).toBeGreaterThan(metalMean + 60);
  });

  /**
   * The printed cloth actually has a print on it.
   *
   * A motif generator that silently produced nothing would leave a texture that still passes every
   * other check here — it would tile, it would not be flat, its normal would be valid — and would
   * just be blank cloth. Comparing against the plain weave is what makes the print falsifiable:
   * measured, the range goes from 61 on plain fabric to between 164 and 236 with a graphic on it.
   */
  it("puts a real print on the printed fabrics", () => {
    const plain = channelRange(statsOf(manifest.assets.find((a) => a.id === "mat_fabric_white_basecolor")!));
    const printed = manifest.assets.filter((asset) => asset.id.startsWith("mat_fabricprint_") && asset.id.endsWith("_basecolor"));
    expect(printed.length, "no printed fabrics baked").toBe(4);
    for (const asset of printed) {
      expect(channelRange(statsOf(asset)), `${asset.id} ink contrast`).toBeGreaterThan(plain * 2);
    }
  });

  it("gives wet ink the smoothest surface of all, because that is why it has no grip", () => {
    const ink = manifest.assets.find((a) => a.id === "mat_ink_violet_roughness")!;
    const inkMean = statsOf(ink).mean[0]!;
    for (const other of ["mat_concrete_default_roughness", "mat_carpet_store_roughness", "mat_asphalt_default_roughness"]) {
      const asset = manifest.assets.find((a) => a.id === other);
      if (!asset) continue;
      expect(inkMean, `ink smoother than ${other}`).toBeLessThan(statistics(load(asset)).mean[0]!);
    }
  });
});

describe("decals", () => {
  const decals = byCategory("decal");

  /**
   * The brief lists "rectángulos blancos en sprites" as an explicit failure. A decal that does not
   * reach zero alpha at its border shows its own bounding box on the floor.
   */
  it.each(decals.map((asset) => [asset.id, asset] as const))("%s fades to nothing at its border", (id, asset) => {
    const image = load(asset);
    expect(image.channels, `${id} has alpha`).toBe(4);
    expect(borderAlpha(image, 2), `${id} border alpha`).toBeLessThan(8);
  });

  it.each(decals.map((asset) => [asset.id, asset] as const))("%s actually marks something", (id, asset) => {
    const stats = statsOf(asset);
    // An all-transparent decal is a generator that silently produced nothing.
    expect(stats.max[3]!, `${id} peak alpha`).toBeGreaterThan(90);
    // An all-opaque one is not a decal.
    expect(stats.mean[3]!, `${id} mean alpha`).toBeLessThan(200);
  });

  it("covers the wear library the art direction calls for", () => {
    const ids = decals.map((asset) => asset.id).join(" ");
    for (const family of ["ink_splash", "scratch", "dirt", "tape", "label", "sticker", "floor_mark"]) {
      expect(ids, `${family} present`).toContain(family);
    }
  });

  it("varies within a family rather than shipping the same mark repeatedly", () => {
    const splashes = decals.filter((asset) => asset.id.startsWith("decal_ink_splash"));
    expect(splashes.length).toBeGreaterThanOrEqual(3);
    // Byte length is a cheap proxy for content: identical generators produce identical files.
    const sizes = new Set(splashes.map((asset) => asset.bytes));
    expect(sizes.size, "ink splashes differ from each other").toBe(splashes.length);
  });
});

describe("kart wraps", () => {
  const wraps = byCategory("kart-wrap");

  it("ships six distinct liveries", () => {
    expect(wraps.length).toBeGreaterThanOrEqual(6);
    const sizes = new Set(wraps.map((asset) => asset.bytes));
    expect(sizes.size, "no two wraps are the same image").toBe(wraps.length);
  });

  /**
   * "No cambiar solamente el color" — a recolour of one design would produce near-identical
   * per-channel spreads. Real graphic differences show up as different colour distributions.
   */
  it("differs in design, not only in colour", () => {
    const signatures = wraps.map((asset) => {
      const stats = statsOf(asset);
      return stats.mean.map((_mean, index) => Math.round((stats.max[index]! - stats.min[index]!) / 16)).join("|");
    });
    expect(new Set(signatures).size).toBeGreaterThanOrEqual(4);
  });

  it("uses the full tonal range, so a livery reads at speed", () => {
    for (const wrap of wraps) {
      expect(channelRange(statsOf(wrap)), `${wrap.id} contrast`).toBeGreaterThan(120);
    }
  });
});

describe("backdrops", () => {
  const backdrops = byCategory("backdrop");

  it("ships one per circuit plus the grey box", () => {
    const circuits = backdrops.map((asset) => asset.circuit);
    for (const expected of ["store", "warehouse", "screenprinting", "office", "manga", "greybox"]) {
      expect(circuits, `${expected} backdrop`).toContain(expected);
    }
  });

  it.each(backdrops.map((asset) => [asset.id, asset] as const))("%s wraps horizontally", (id, asset) => {
    const image = load(asset);
    // A cylindrical panorama must join at the seam; vertically it does not, and must not be checked.
    const wrap = edgeDifference(image, "horizontal");
    const interior = interiorDifference(image, "horizontal");
    /**
     * This assertion earned its keep. It failed on four of the six backdrops at 9 to 17 against an
     * interior difference under 3, which traced to every periodic feature -- trusses, racking bays,
     * machine seams, silhouette steps -- placing a cell boundary exactly on u = 0, so the wrap was
     * the one column where all of them changed at once. See `cell()` in `tools/assetgen/backdrops.mjs`.
     */
    expect(wrap, `${id} wrap=${wrap.toFixed(2)} interior=${interior.toFixed(2)}`).toBeLessThan(
      Math.max(4, interior * 2.5),
    );
  });

  /**
   * A backdrop's job is depth. A vertical gradient from a bright ceiling to a dark floor is what
   * produces it, so the top and bottom thirds must differ substantially — a flat panorama is the
   * "fondo plano" the brief prohibits.
   */
  it.each(backdrops.map((asset) => [asset.id, asset] as const))("%s has real vertical depth", (id, asset) => {
    const image = load(asset);
    const { width, height, channels, pixels } = image;
    const bandMean = (fromRow: number, toRow: number) => {
      let total = 0;
      let samples = 0;
      for (let y = fromRow; y < toRow; y += 1) {
        for (let x = 0; x < width; x += 4) {
          for (let c = 0; c < 3; c += 1) {
            total += pixels[(y * width + x) * channels + c]!;
            samples += 1;
          }
        }
      }
      return total / samples;
    };
    const top = bandMean(0, Math.floor(height / 3));
    const bottom = bandMean(Math.floor((height * 2) / 3), height);
    expect(Math.abs(top - bottom), `${id} top=${top.toFixed(0)} bottom=${bottom.toFixed(0)}`).toBeGreaterThan(20);
  });
});

/**
 * The wiring, asserted from the app's side.
 *
 * The tests above prove the files are good. These prove the code that reaches for them is pointing
 * at files that exist — which is the brief's hardest rule and the failure mode that costs the most
 * to find later, because a texture that silently does not load looks exactly like a texture that was
 * never wired up. Every id the app can name is checked against the manifest, and the manifest is
 * checked against the disk by the suite above, so the chain runs from source to bytes.
 */
describe("asset integration", () => {
  const source: string = readSourceText([join(__dirname, ".."), join(__dirname, "..", "..", "..", "packages")]);
  const ids = new Set(manifest.assets.map((asset) => asset.id));
  const CIRCUIT_KEY_BY_THEME: Record<string, string> = {
    FLAGSHIP: "store",
    WAREHOUSE: "warehouse",
    PRINT_FACTORY: "screenprinting",
    OFFICE: "office",
    MANGA: "manga",
    GREYBOX: "greybox",
  };

  /**
   * The one that catches an invented filename.
   *
   * Any `texture: "mat_..."` a theme or a material default names must be a real baked material with a
   * real base colour on disk. A typo here would fall back to the procedural generator silently and
   * the circuit would just look slightly flatter than intended, with nothing in any log to say why.
   */
  it("names only baked materials in texture references", () => {
    const named = [...source.matchAll(/"(mat_[a-z0-9_]+)"/g)].map((match) => match[1]!);
    expect(named.length, "no material ids found in source — the scan is broken, not the assets").toBeGreaterThan(10);
    for (const id of new Set(named)) {
      // Source names the base id; the bake writes three maps under it.
      expect(ids.has(`${id}_basecolor`), `${id} referenced in source but not baked`).toBe(true);
    }
  });

  it("has a panorama for every circuit the app can select", () => {
    // Read out of the source rather than restated, so a sixth circuit fails this test rather than
    // silently racing against a flat colour.
    const body = source.slice(source.indexOf("const CIRCUIT_KEY_BY_THEME"));
    const keys = [...body.slice(0, body.indexOf("};")).matchAll(/:\s*"([a-z_]+)"/g)].map((match) => match[1]!);
    expect(keys.length).toBeGreaterThanOrEqual(6);
    for (const key of keys) {
      expect(ids.has(`backdrop_${key}_panorama`), `${key} has no backdrop`).toBe(true);
    }
  });

  it("has a wrap for every livery in the union", () => {
    const union = source.match(/export type LiveryId\s*=([^;]+);/);
    expect(union, "LiveryId not found").not.toBeNull();
    const liveries = [...union![1]!.matchAll(/"([A-Z_]+)"/g)].map((match) => match[1]!).filter((value) => value !== "NONE");
    expect(liveries.length).toBeGreaterThanOrEqual(7);
    for (const livery of liveries) {
      expect(ids.has(`kart_wrap_${livery.toLowerCase()}_basecolor`), `${livery} has no wrap`).toBe(true);
    }
  });

  it("has decals for every family a theme scatters", () => {
    const body = source.slice(source.indexOf("const FAMILIES_BY_THEME"));
    const families = new Set([...body.slice(0, body.indexOf("};")).matchAll(/"([a-z_]+)"/g)].map((match) => match[1]!));
    expect(families.size).toBeGreaterThanOrEqual(6);
    for (const family of families) {
      const pool = manifest.assets.filter((asset) => asset.id.startsWith(`decal_${family}_`));
      expect(pool.length, `${family} has no baked decals`).toBeGreaterThan(0);
    }
  });

  /**
   * The manifest states what it can establish and nothing more.
   *
   * It used to write `status: "integrated"` for all 121 entries while the game was still drawing
   * every surface procedurally. The bake knows it wrote a file; it does not know what anyone does
   * with it. Reachability is derived separately, below.
   */
  it("claims only that assets were baked, not that they are used", () => {
    for (const asset of manifest.assets) {
      expect(asset.status, `${asset.id} status`).toBe("baked");
      expect(asset.generated).toBe(true);
    }
  });

  /**
   * A theme may only name assets it will have.
   *
   * The trap this closes: `mat_paintedmetal_press` is a perfectly real file, and naming it from the
   * Manga theme would typecheck, pass the "no invented ids" test, and then silently fall back to the
   * procedural generator forever — because the factory's assets are never downloaded for a race in
   * the convention hall. Nothing would ever surface it. So the rule is checked directly: a theme's
   * textures must be in the shared set or in that theme's own circuit.
   */
  it("never lets a theme name another circuit's asset", () => {
    const scopeOf = new Map(manifest.assets.map((asset) => [asset.id, asset.circuit] as const));
    /**
     * Only the theme table itself. The source is every file concatenated, and the hall, barrier and
     * signage tables declare the same theme names — so a block has to end at the table's own closing
     * brace, not at the next theme name anywhere in the project.
     */
    const table = source.slice(source.indexOf("const THEME_VISUALS"));
    const block = table.slice(0, table.indexOf("\n};") + 3);
    const themes = [...block.matchAll(/^  ([A-Z_]+): \{$/gm)];
    expect(themes.length, "no themes parsed").toBeGreaterThanOrEqual(5);

    for (const [index, match] of themes.entries()) {
      const theme = match[1]!;
      const start = match.index!;
      const end = index + 1 < themes.length ? themes[index + 1]!.index! : block.indexOf("\n};", start);
      const circuit = CIRCUIT_KEY_BY_THEME[theme];
      expect(circuit, `${theme} has no circuit key`).toBeDefined();

      for (const named of block.slice(start, end).matchAll(/texture: "(mat_[a-z0-9_]+)"/g)) {
        const base = `${named[1]!}_basecolor`;
        expect(scopeOf.has(base), `${theme} names ${named[1]!}, which is not baked`).toBe(true);
        const scope = scopeOf.get(base);
        expect(
          scope === undefined || scope === circuit,
          `${theme} names ${named[1]!}, which belongs to ${scope} and is never downloaded here`,
        ).toBe(true);
      }
    }
  });

  /**
   * An atlas a circuit uses must be downloadable by that circuit.
   *
   * The same trap as the theme-texture rule, one level up, and it caught a real one: the hanging
   * garments were baked into the store's set while three circuits placed them, so two of the three
   * pointed at an atlas that is never fetched for them. Nothing would have surfaced it — the sprites
   * simply would not have appeared, in a scene busy enough that nobody would notice which dressing
   * was missing.
   *
   * A family placed by more than one theme therefore has to be shared.
   */
  it("never lets a circuit place a sprite family it cannot download", () => {
    const scopeOf = new Map(manifest.assets.map((asset) => [asset.id, asset.circuit] as const));

    // The placement tables, read out of the renderer rather than restated here.
    const crowdBody = source.slice(source.indexOf("const FAMILY_BY_THEME"));
    const crowdTable = crowdBody.slice(0, crowdBody.indexOf("};"));
    const dressingBody = source.slice(source.indexOf("const DRESSING_BY_THEME"));
    const dressingTable = dressingBody.slice(0, dressingBody.indexOf("};"));

    /** theme -> families it places. */
    const placed = new Map<string, string[]>();
    for (const match of crowdTable.matchAll(/^\s*([A-Z_]+):\s*"([a-z_]+)"/gm)) {
      placed.set(match[1]!, [...(placed.get(match[1]!) ?? []), match[2]!]);
    }
    for (const match of dressingTable.matchAll(/^\s{2}([A-Z_]+):\s*\[([\s\S]*?)\],?$/gm)) {
      const families = [...match[2]!.matchAll(/family: "([a-z_]+)"/g)].map((entry) => entry[1]!);
      placed.set(match[1]!, [...(placed.get(match[1]!) ?? []), ...families]);
    }
    expect(placed.size, "no sprite placement tables parsed").toBeGreaterThanOrEqual(4);

    for (const [theme, families] of placed) {
      const circuit = CIRCUIT_KEY_BY_THEME[theme];
      expect(circuit, `${theme} has no circuit key`).toBeDefined();
      for (const family of new Set(families)) {
        const id = `sprite_${family}_atlas`;
        expect(scopeOf.has(id), `${theme} places ${family}, which is not baked`).toBe(true);
        const scope = scopeOf.get(id);
        expect(
          scope === undefined || scope === circuit,
          `${theme} places ${family}, whose atlas belongs to ${scope} and is never downloaded here`,
        ).toBe(true);
      }
    }
  });

  /**
   * Every baked file is reachable.
   *
   * This started as a floor of 88 with thirty colour variants sitting unused, which was honest but
   * unsatisfying: an asset on disk that nothing can reach is weight without benefit. They all have
   * homes now — the four process inks on the factory's drums, the printed cloth on the Megastore's
   * displays, the tile on the columns and the carpet under the wheels — so the assertion is exact.
   * It also catches the reverse regression: a renamed constant that quietly unhooks the pipeline.
   */
  it("reaches most of the baked set from application code", () => {
    const { referenced, unreferenced } = auditIntegration(manifest, source) as {
      referenced: string[];
      unreferenced: string[];
    };
    expect(referenced.length + unreferenced.length).toBe(manifest.assets.length);
    // All of them. Every baked file has a surface it dresses; nothing is baked and left on disk.
    expect(
      unreferenced,
      `${unreferenced.length} baked files are unreachable from application code`,
    ).toEqual([]);
    expect(referenced.length).toBe(manifest.assets.length);
  });
});

/**
 * Atlases.
 *
 * Three properties decide whether an atlas is an asset or a liability, and none of them is visible
 * without reading the pixels back:
 *
 *  - **Every frame has content.** A generator that silently drew nothing produces a frame that is
 *    perfectly transparent, which looks identical to a frame that was never requested.
 *  - **No frame touches its own edge.** Alpha at a frame's border is the halo the brief names: under
 *    bilinear filtering it bleeds into the neighbour, and on a lone sprite it draws the bounding box.
 *  - **The frames differ from each other.** Twenty-two icons that are all the same picture would
 *    pass every other check here. This is the one that catches a broken shape composition.
 */
describe("atlases", () => {
  const atlases = manifest.assets.filter((asset) => asset.frames !== undefined);

  it("produced the icon, poster and sprite atlases", () => {
    expect(atlases.length).toBeGreaterThanOrEqual(10);
    expect(atlases.some((asset) => asset.id === "ui_icon_atlas")).toBe(true);
    expect(atlases.filter((asset) => asset.category === "poster").length).toBe(5);
    expect(atlases.filter((asset) => asset.category === "sprite").length).toBeGreaterThanOrEqual(4);
  });

  /** Pixel access into a frame, with the sheet's stride. */
  function reader(asset: ManifestAsset) {
    const image = load(asset);
    const at = (frameX: number, frameY: number, x: number, y: number, channel: number): number =>
      image.pixels[((frameY + y) * image.width + frameX + x) * image.channels + channel] as number;
    return { image, at };
  }

  it.each(atlases.map((asset) => [asset.id, asset] as const))("%s fills every frame", (id, asset) => {
    const { at } = reader(asset);
    for (const [name, frame] of Object.entries(asset.frames!)) {
      let opaque = 0;
      for (let y = 0; y < frame.height; y += 2) {
        for (let x = 0; x < frame.width; x += 2) {
          if (at(frame.x, frame.y, x, y, 3) > 12) opaque += 1;
        }
      }
      const coverage = opaque / ((frame.width / 2) * (frame.height / 2));
      expect(coverage, `${id}/${name} coverage`).toBeGreaterThan(0.02);
    }
  });

  /**
   * Border alpha, on the alpha-cut categories only.
   *
   * A poster is an opaque rectangle by design — it is a printed sheet on a wall — so its border is
   * legitimately solid. An icon or a sprite is a cut-out and must fade to nothing before its edge.
   */
  it.each(
    atlases.filter((asset) => asset.category !== "poster").map((asset) => [asset.id, asset] as const),
  )("%s keeps every frame clear of its own edge", (id, asset) => {
    const { at } = reader(asset);
    for (const [name, frame] of Object.entries(asset.frames!)) {
      let peak = 0;
      for (let x = 0; x < frame.width; x += 1) {
        peak = Math.max(peak, at(frame.x, frame.y, x, 0, 3), at(frame.x, frame.y, x, frame.height - 1, 3));
      }
      for (let y = 0; y < frame.height; y += 1) {
        peak = Math.max(peak, at(frame.x, frame.y, 0, y, 3), at(frame.x, frame.y, frame.width - 1, y, 3));
      }
      expect(peak, `${id}/${name} border alpha`).toBeLessThan(10);
    }
  });

  /**
   * Distinctness, measured over the covered region.
   *
   * Averaging over the whole frame was the wrong control and it hid two real defects: a crowd sprite
   * is ninety percent transparent, so a genuine difference across the figure came out as 0.4 out of
   * 255. Two families did turn out to be byte-identical — a poster layout that consumed no
   * randomness, and a shirt silhouette whose `index` never reached the generator.
   */
  it.each(atlases.map((asset) => [asset.id, asset] as const))("%s has no two identical frames", (id, asset) => {
    const { at } = reader(asset);
    const names = Object.keys(asset.frames!);
    let worst = { distance: Infinity, pair: "" };

    for (let i = 0; i < names.length; i += 1) {
      for (let j = i + 1; j < names.length; j += 1) {
        const a = asset.frames![names[i]!]!;
        const b = asset.frames![names[j]!]!;
        if (a.width !== b.width || a.height !== b.height) continue;
        let total = 0;
        let counted = 0;
        for (let y = 0; y < a.height; y += 2) {
          for (let x = 0; x < a.width; x += 2) {
            const alphaA = at(a.x, a.y, x, y, 3);
            const alphaB = at(b.x, b.y, x, y, 3);
            if (alphaA < 8 && alphaB < 8) continue;
            for (let c = 0; c < 4; c += 1) {
              total += Math.abs(at(a.x, a.y, x, y, c) - at(b.x, b.y, x, y, c));
              counted += 1;
            }
          }
        }
        const distance = counted > 0 ? total / counted : 0;
        if (distance < worst.distance) worst = { distance, pair: `${names[i]}/${names[j]}` };
      }
    }
    expect(worst.distance, `${id} closest pair ${worst.pair}`).toBeGreaterThan(1);
  });

  it("gives the sprite atlases a uniform grid, which is what a sprite manager needs", () => {
    for (const asset of atlases.filter((entry) => entry.category === "sprite")) {
      expect(asset.grid, `${asset.id} grid`).toBeDefined();
      const grid = asset.grid!;
      expect(grid.count).toBe(Object.keys(asset.frames!).length);
      // Every frame must sit exactly on the lattice, or `cellIndex` addresses the wrong picture.
      for (const [name, frame] of Object.entries(asset.frames!)) {
        expect(frame.width, `${name} width`).toBe(grid.cellWidth);
        expect(frame.height, `${name} height`).toBe(grid.cellHeight);
        expect(frame.x % grid.cellWidth, `${name} x`).toBe(0);
        expect(frame.y % grid.cellHeight, `${name} y`).toBe(0);
        expect(frame.cell, `${name} cell`).toBeTypeOf("number");
      }
    }
  });

  it("keeps every frame inside its sheet", () => {
    for (const asset of atlases) {
      for (const [name, frame] of Object.entries(asset.frames!)) {
        expect(frame.x + frame.width, `${asset.id}/${name} right edge`).toBeLessThanOrEqual(asset.width);
        expect(frame.y + frame.height, `${asset.id}/${name} bottom edge`).toBeLessThanOrEqual(asset.height);
      }
    }
  });
});

describe("the panorama is resolved for the screen it fills", () => {
  /**
   * The one assertion that would have prevented the blurriest thing in the game.
   *
   * The backdrop was 1536 px wide, and the comment in the generator justified it with the claim that
   * "a backdrop is never sampled at texel density". That claim is false and the arithmetic says so
   * plainly: the panorama wraps 360 degrees around a cylinder that fills the horizon, so its angular
   * resolution is what matters, and 1536 / 360 is 4.3 px per degree against a 1080p screen's 31. Seven
   * times magnified, across the band occupying the upper third of every frame.
   *
   * So this test is written in px-per-degree rather than in pixels. A future change that halves the
   * width to save bytes has to argue with the number a player actually sees.
   */
  const DEGREES = 360;
  /** 1920 px across a 62-degree field of view: what the race camera delivers on a desktop. */
  const SCREEN_PX_PER_DEGREE = 1920 / 62;

  const panoramas = manifest.assets.filter((asset) => asset.category === "backdrop");

  it("covers every circuit", () => {
    expect(panoramas.length).toBeGreaterThanOrEqual(6);
  });

  it.each(panoramas.map((asset) => [asset.id, asset] as const))("%s", (_id, asset) => {
    const pxPerDegree = asset.width / DEGREES;
    // At least a quarter of screen density. Not parity: the shell is 820 m away behind atmospheric
    // haze, and matching a screen would need 11,000 px, which no mobile GPU will sample.
    expect(pxPerDegree).toBeGreaterThan(SCREEN_PX_PER_DEGREE / 4);
    /**
     * And no wider than 4096.
     *
     * A ceiling, not a preference: 4096 is the maximum texture dimension WebGL 2 guarantees and the
     * practical limit on older mobile GPUs. A 8192-wide panorama would fail to upload on exactly the
     * devices that need the download budget most, and it would fail silently — a black sky.
     */
    expect(asset.width).toBeLessThanOrEqual(4096);
    // Two to one, because a cylindrical projection of 360 by 180 degrees is.
    expect(asset.width / asset.height).toBeCloseTo(2, 1);
  });
});
