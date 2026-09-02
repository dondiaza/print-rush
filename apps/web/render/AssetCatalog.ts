import { Texture, type Scene } from "@babylonjs/core";

/**
 * ASSET CATALOG.
 *
 * The bridge between the baked image files in `public/assets` and the scene. Everything it can hand
 * out corresponds to a file that exists on disk and an entry in `assets.manifest.json`, which the
 * bake writes from the disk rather than from a list — so the catalog cannot name an asset that was
 * never produced. `apps/web/tests/assets.test.ts` asserts that correspondence in both directions.
 *
 * Three rules shape the API:
 *
 *  1. **A missing asset is never fatal.** Every lookup can return null and every caller has a
 *     procedural fallback. A texture that fails to download costs some fidelity, not the race.
 *  2. **Progress is measured, never simulated.** `preload` resolves one increment per texture that
 *     Babylon reports as loaded or failed. There is no timer and no fake ramp, because the loading
 *     screen it drives is the first thing a player sees and a lying progress bar is worse than none.
 *  3. **Ids are looked up, not constructed.** Callers pass the manifest id they want; if it is not
 *     in the manifest, `has` says so. Nothing here interpolates a filename and hopes.
 */

export type VisualAssetCategory = "material" | "decal" | "kart-wrap" | "backdrop";

/** One entry of `assets.manifest.json`. Mirrors what `tools/assetgen/index.mjs` writes. */
export type VisualAsset = {
  id: string;
  category: VisualAssetCategory;
  /** Present only for assets that belong to a single circuit. Absent means shared. */
  circuit?: string;
  /** Path relative to `public/`, e.g. `assets/common/materials/mat_asphalt_default_basecolor.png`. */
  sourceFile: string;
  generated: boolean;
  generator: string;
  width: number;
  height: number;
  hasAlpha: boolean;
  bytes: number;
  usage: string;
  status: string;
};

export type AssetManifest = {
  generatedAt: string;
  totalBytes: number;
  counts: Record<string, number>;
  assets: VisualAsset[];
};

/** The three maps a PBR material can take from the bake. Any of them may be absent. */
export type MaterialMaps = {
  baseColor: VisualAsset | null;
  normal: VisualAsset | null;
  roughness: VisualAsset | null;
};

export const MANIFEST_URL = "/assets/assets.manifest.json";

/**
 * Circuit theme to asset-folder key.
 *
 * The themes are the blueprint's own vocabulary and the folders are the bake's; they were named
 * independently and two of them disagree, so the mapping is explicit rather than a string transform.
 * `FLAGSHIP` is the T-Shirt Megastore and `PRINT_FACTORY` is the screenprinting workshop.
 */
export const CIRCUIT_KEY_BY_THEME: Record<string, string> = {
  FLAGSHIP: "store",
  WAREHOUSE: "warehouse",
  PRINT_FACTORY: "screenprinting",
  OFFICE: "office",
  MANGA: "manga",
  GREYBOX: "greybox",
};

export function circuitKeyForTheme(theme: string): string {
  return CIRCUIT_KEY_BY_THEME[theme] ?? "greybox";
}

export class AssetCatalog {
  private readonly byId = new Map<string, VisualAsset>();
  private readonly loaded = new Map<string, Texture>();
  /** Ids that were requested and failed to download. Reported, not retried. */
  private readonly failed = new Set<string>();

  private constructor(readonly manifest: AssetManifest) {
    for (const asset of manifest.assets) this.byId.set(asset.id, asset);
  }

  /**
   * Reads the manifest. Returns null rather than throwing if it cannot be read, because the game
   * runs without it — every material falls back to the procedural generator that shipped before the
   * bake existed.
   */
  static async load(fetchImpl: typeof fetch = fetch): Promise<AssetCatalog | null> {
    try {
      const response = await fetchImpl(MANIFEST_URL, { cache: "force-cache" });
      if (!response.ok) return null;
      const manifest = (await response.json()) as AssetManifest;
      if (!Array.isArray(manifest.assets) || manifest.assets.length === 0) return null;
      return new AssetCatalog(manifest);
    } catch {
      return null;
    }
  }

  /** For tests and tools, which already have the manifest in hand. */
  static fromManifest(manifest: AssetManifest): AssetCatalog {
    return new AssetCatalog(manifest);
  }

  has(id: string): boolean {
    return this.byId.has(id);
  }

  get(id: string): VisualAsset | null {
    return this.byId.get(id) ?? null;
  }

  url(id: string): string | null {
    const asset = this.byId.get(id);
    return asset ? `/${asset.sourceFile}` : null;
  }

  /**
   * Resolves the three maps of a baked material from its base id, e.g. `mat_asphalt_default`.
   * Returns nulls for the maps the bake did not produce, so a caller can use a base colour without
   * a normal map rather than refusing the material.
   */
  materialMaps(baseId: string): MaterialMaps {
    return {
      baseColor: this.get(`${baseId}_basecolor`),
      normal: this.get(`${baseId}_normal`),
      roughness: this.get(`${baseId}_roughness`),
    };
  }

  backdropFor(theme: string): VisualAsset | null {
    return this.get(`backdrop_${circuitKeyForTheme(theme)}_panorama`);
  }

  /**
   * The baked wrap for a livery, or null for `NONE` and for anything the bake does not carry.
   *
   * `LiveryId` is upper snake case and the files are lower snake case, which is the only transform
   * here; a test asserts every id in the union resolves, so this cannot quietly point at nothing.
   */
  wrap(livery: string): VisualAsset | null {
    if (!livery || livery === "NONE") return null;
    return this.get(`kart_wrap_${livery.toLowerCase()}_basecolor`);
  }

  /** The wrap texture for a livery, if it was preloaded. */
  wrapTexture(livery: string): Texture | null {
    const asset = this.wrap(livery);
    return asset ? this.texture(asset.id) : null;
  }

  /** Every decal of one family, e.g. `ink_splash`, in manifest order. */
  decals(family: string): VisualAsset[] {
    return this.manifest.assets.filter(
      (asset) => asset.category === "decal" && asset.id.startsWith(`decal_${family}_`),
    );
  }

  /** Total download weight of the shared set plus one circuit. What the budget check reports. */
  bytesFor(circuit: string): number {
    return this.manifest.assets
      .filter((asset) => asset.circuit === undefined || asset.circuit === circuit)
      .reduce((total, asset) => total + asset.bytes, 0);
  }

  /** A texture already preloaded, or null. Synchronous, so material creation stays synchronous. */
  texture(id: string): Texture | null {
    return this.loaded.get(id) ?? null;
  }

  get failures(): string[] {
    return [...this.failed];
  }

  get loadedCount(): number {
    return this.loaded.size;
  }

  /**
   * Downloads the given ids into GPU textures, reporting real progress.
   *
   * `onProgress` fires once per settled texture with the count so far, the total, and the id — so
   * the loading screen can say what it is actually waiting for. Ids not in the manifest are dropped
   * before the count is taken, so the total is the number of files that will really be fetched and
   * the bar cannot stall at 90 % waiting for something that does not exist.
   *
   * Failures resolve rather than reject: one unavailable texture must not stop a race from starting.
   */
  async preload(
    scene: Scene,
    ids: readonly string[],
    onProgress?: (loaded: number, total: number, id: string) => void,
  ): Promise<void> {
    const pending = [...new Set(ids)].filter((id) => this.has(id) && !this.loaded.has(id));
    const total = pending.length;
    if (total === 0) {
      onProgress?.(0, 0, "");
      return;
    }

    let settled = 0;
    await Promise.all(
      pending.map(
        (id) =>
          new Promise<void>((resolve) => {
            const url = this.url(id)!;
            const asset = this.get(id)!;
            const done = (): void => {
              settled += 1;
              onProgress?.(settled, total, id);
              resolve();
            };
            const texture = new Texture(
              url,
              scene,
              false,
              // `invertY` stays at Babylon's default, so these behave like any other image texture:
              // UV v = 1 samples the image's first row. The backdrop generators put the ceiling at
              // v = 0, which is that first row, so a panorama comes out the right way up.
              undefined,
              Texture.TRILINEAR_SAMPLINGMODE,
              () => {
                texture.wrapU = Texture.WRAP_ADDRESSMODE;
                texture.wrapV = Texture.WRAP_ADDRESSMODE;
                texture.hasAlpha = asset.hasAlpha;
                // A base colour or livery is colour data and wants sRGB decoding; a normal or
                // roughness map is linear data and must not be gamma-corrected, or the surface is
                // subtly wrong in a way that is very hard to attribute back to here later.
                texture.gammaSpace = !(id.endsWith("_normal") || id.endsWith("_roughness"));
                this.loaded.set(id, texture);
                done();
              },
              () => {
                texture.dispose();
                this.failed.add(id);
                done();
              },
            );
          }),
      ),
    );
  }

  dispose(): void {
    this.loaded.forEach((texture) => texture.dispose());
    this.loaded.clear();
  }
}
