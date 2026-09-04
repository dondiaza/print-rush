import type { Scene } from "@babylonjs/core";
import {
  AssetCatalog,
  circuitKeyForTheme,
  type VisualAsset,
  type VisualAssetCategory,
} from "./AssetCatalog";

/** Categories whose absence would make the circuit or a racer visibly incomplete. */
const REQUIRED_CATEGORIES = new Set<VisualAssetCategory>([
  "material",
  "kart-wrap",
  "backdrop",
  "ui",
]);

export type RaceAssetRequest = {
  theme: string;
  liveries: readonly string[];
  decalFamilies: readonly string[];
};

export type RaceAssetPlan = {
  required: VisualAsset[];
  optional: VisualAsset[];
  all: VisualAsset[];
  downloadBytes: number;
  estimatedGpuBytes: number;
};

export type AssetPreparationReport = {
  loaded: number;
  optionalFailures: string[];
  downloadBytes: number;
  estimatedGpuBytes: number;
};

export class AssetPreparationError extends Error {
  constructor(
    readonly code: "MANIFEST_UNAVAILABLE" | "REQUIRED_ASSET_MISSING" | "REQUIRED_ASSET_FAILED",
    message: string,
    readonly failedIds: readonly string[] = [],
  ) {
    super(message);
    this.name = "AssetPreparationError";
  }
}

/**
 * Owns the complete visual bundle for one race.
 *
 * `AssetCatalog` remains the low-level texture cache. This class is the policy layer that was
 * missing: it decides exactly which files a race needs, separates required files from graceful
 * decoration, estimates their real GPU footprint, and refuses to hand a broken required bundle to
 * the runtime. Nothing is requested from this manager after the countdown starts.
 */
export class AssetManager {
  private constructor(readonly catalog: AssetCatalog) {}

  /** `refresh` re-reads the manifest past every cache. See `AssetCatalog.load`. */
  static async create(
    fetchImpl: typeof fetch = fetch,
    options: { refresh?: boolean } = {},
  ): Promise<AssetManager> {
    const catalog = await AssetCatalog.load(fetchImpl, options);
    if (!catalog) {
      throw new AssetPreparationError(
        "MANIFEST_UNAVAILABLE",
        "No se ha podido leer el paquete visual del circuito.",
      );
    }
    return new AssetManager(catalog);
  }

  planRace(request: RaceAssetRequest): RaceAssetPlan {
    const circuit = circuitKeyForTheme(request.theme);
    const families = new Set(request.decalFamilies);
    const requestedLiveries = [...new Set(request.liveries.filter((livery) => livery && livery !== "NONE"))];
    const missingLiveries = requestedLiveries.filter((livery) => !this.catalog.wrap(livery));
    const wantedLiveries = new Set(
      requestedLiveries
        .map((livery) => this.catalog.wrap(livery)?.id)
        .filter((id): id is string => id !== undefined),
    );

    const selected = this.catalog.manifest.assets.filter((asset) => {
      if (asset.download === "kart") return wantedLiveries.has(asset.id);
      if (asset.category === "decal") {
        return [...families].some((family) => asset.id.startsWith(`decal_${family}_`));
      }
      return asset.circuit === undefined || asset.circuit === circuit;
    });

    const byId = new Map(selected.map((asset) => [asset.id, asset]));
    const all = [...byId.values()];
    const required = all.filter((asset) => REQUIRED_CATEGORIES.has(asset.category));
    const optional = all.filter((asset) => !REQUIRED_CATEGORIES.has(asset.category));
    const expectedBackdrop = this.catalog.backdropFor(request.theme);
    const missing: string[] = missingLiveries.map((livery) => `kart-wrap:${livery}`);
    if (!expectedBackdrop || expectedBackdrop.circuit !== circuit || !byId.has(expectedBackdrop.id)) {
      missing.push(`backdrop:${circuit}`);
    }
    for (const category of ["material", "ui"] as const) {
      if (!required.some((asset) => asset.category === category)) missing.push(`${category}:shared`);
    }
    if (missing.length > 0) {
      throw new AssetPreparationError(
        "REQUIRED_ASSET_MISSING",
        "El paquete visual no declara todos los recursos esenciales de la carrera.",
        missing,
      );
    }
    return {
      required,
      optional,
      all,
      downloadBytes: all.reduce((sum, asset) => sum + asset.bytes, 0),
      estimatedGpuBytes: all.reduce((sum, asset) => sum + AssetManager.estimateTextureBytes(asset), 0),
    };
  }

  async prepareRace(
    scene: Scene,
    plan: RaceAssetPlan,
    onProgress?: (loaded: number, total: number, id: string) => void,
  ): Promise<AssetPreparationReport> {
    const ids = plan.all.map((asset) => asset.id);
    await this.catalog.preload(scene, ids, onProgress);

    const failures = new Set(this.catalog.failures);
    const requiredFailures = plan.required
      .map((asset) => asset.id)
      .filter((id) => failures.has(id));
    if (requiredFailures.length > 0) {
      throw new AssetPreparationError(
        "REQUIRED_ASSET_FAILED",
        "Uno o más recursos esenciales no se han podido preparar.",
        requiredFailures,
      );
    }

    return {
      loaded: plan.all.filter((asset) => !failures.has(asset.id)).length,
      optionalFailures: plan.optional.map((asset) => asset.id).filter((id) => failures.has(id)),
      downloadBytes: plan.downloadBytes,
      estimatedGpuBytes: plan.estimatedGpuBytes,
    };
  }

  dispose(): void {
    this.catalog.dispose();
  }

  /** RGBA8 plus a complete mip chain. Compressed PNG bytes are not GPU memory. */
  static estimateTextureBytes(asset: Pick<VisualAsset, "width" | "height">): number {
    return Math.ceil(asset.width * asset.height * 4 * (4 / 3));
  }

}
