import {
  Engine,
  Mesh,
  Scene,
  VertexBuffer,
  type AbstractMesh,
  type ShadowGenerator,
} from "@babylonjs/core";
import type { AssetManager, RaceAssetPlan } from "./AssetManager";

export type RaceReadiness = {
  catalogReady: boolean;
  assetsReady: boolean;
  geometryReady: boolean;
  texturesReady: boolean;
  shadersReady: boolean;
  physicsReady: boolean;
  audioReady: boolean;
  racersReady: boolean;
  trackReady: boolean;
  uiReady: boolean;
  gpuReady: boolean;
  raceReady: boolean;
};

export type PreloadProgress = {
  loaded: number;
  total: number;
  label: string;
  phase: "CATALOG" | "ASSETS" | "WORLD" | "SHADERS" | "GPU" | "READY";
  readiness: RaceReadiness;
};

const INITIAL_STATE: Omit<RaceReadiness, "raceReady"> = {
  catalogReady: false,
  assetsReady: false,
  geometryReady: false,
  texturesReady: false,
  shadersReady: false,
  physicsReady: false,
  audioReady: false,
  racersReady: false,
  trackReady: false,
  uiReady: false,
  gpuReady: false,
};

/**
 * The gate between "the constructor returned" and "3, 2, 1".
 *
 * Every expensive operation happens while the loading layer still covers the canvas. The first
 * visible race frame therefore reuses decoded textures, compiled material/shadow programs and GPU
 * buffers that were already exercised by hidden renders. The class deliberately owns readiness as
 * data so a caller cannot accidentally replace it with a cosmetic timer.
 */
export class RacePreloader {
  private state: Omit<RaceReadiness, "raceReady"> = { ...INITIAL_STATE };

  constructor(private readonly onProgress?: (progress: PreloadProgress) => void) {
    this.emit(0, "Iniciando motor", "CATALOG");
  }

  get readiness(): RaceReadiness {
    const state = { ...this.state };
    return { ...state, raceReady: Object.values(state).every(Boolean) };
  }

  markCatalogReady(): void {
    this.state.catalogReady = true;
    this.emit(5, "Catálogo visual preparado", "CATALOG");
  }

  async prepareAssets(
    scene: Scene,
    manager: AssetManager,
    plan: RaceAssetPlan,
    labelForAsset: (id: string) => string,
  ): Promise<void> {
    const assetsById = new Map(plan.all.map((asset) => [asset.id, asset]));
    const settled = new Set<string>();
    let settledBytes = 0;
    await manager.prepareRace(scene, plan, (loaded, total, id) => {
      const asset = assetsById.get(id);
      if (asset && !settled.has(id)) {
        settled.add(id);
        settledBytes += asset.bytes;
      }
      // Files complete out of order. Weighting by their manifest bytes makes 50% mean half the
      // transfer settled rather than half the file names, while the zero-byte fixture path remains
      // deterministic for tests and already-cached races.
      const ratio = plan.downloadBytes > 0
        ? settledBytes / plan.downloadBytes
        : total <= 0 ? 1 : loaded / total;
      this.emit(5 + ratio * 50, labelForAsset(id), "ASSETS");
    });
    this.state.assetsReady = true;
    this.emit(55, "Paquete del circuito completo", "ASSETS");
  }

  /** Called after the runtime built the track, all racers, pools, colliders and UI contract. */
  markWorldReady(): void {
    this.state.geometryReady = true;
    this.state.physicsReady = true;
    this.state.audioReady = true;
    this.state.racersReady = true;
    this.state.trackReady = true;
    this.state.uiReady = true;
    this.emit(66, "Montando la parrilla", "WORLD");
  }

  async warmup(scene: Scene, engine: Engine, shadows: ShadowGenerator | null): Promise<number[]> {
    await withTimeout(scene.whenReadyAsync(true), 45_000, "La escena no terminó de preparar sus texturas");
    this.state.texturesReady = true;
    this.emit(72, "Preparando materiales", "SHADERS");

    const representatives = shaderRepresentatives(scene);
    const batchSize = 12;
    for (let start = 0; start < representatives.length; start += batchSize) {
      const batch = representatives.slice(start, start + batchSize);
      await Promise.all(
        batch.map((mesh) =>
          mesh.material!.forceCompilationAsync(mesh, {
            useInstances: mesh instanceof Mesh && mesh.instances.length > 0,
          }),
        ),
      );
      const ratio = Math.min(1, (start + batch.length) / Math.max(1, representatives.length));
      this.emit(72 + ratio * 17, "Calentando iluminación", "SHADERS");
    }
    if (shadows) {
      await Promise.all([
        shadows.forceCompilationAsync({ useInstances: false }),
        shadows.forceCompilationAsync({ useInstances: true }),
      ]);
    }
    this.state.shadersReady = true;
    this.emit(91, "Afinando sombras", "SHADERS");

    // Three hidden frames exercise post-processing, render targets, particles, buffers and texture
    // uploads. Their costs feed the one-time warmup benchmark; no adaptive work happens in-race.
    const frameTimes: number[] = [];
    for (let frame = 0; frame < 3; frame += 1) {
      const started = performance.now();
      scene.render();
      frameTimes.push(performance.now() - started);
      this.emit(93 + frame * 2, "Dando temperatura a la pista", "GPU");
      await Promise.resolve();
    }
    // Render once more after every warmup path. Do not wipe the engine caches here: those compiled
    // programs are precisely what this gate exists to keep hot for the countdown.
    scene.render();
    this.state.gpuReady = true;
    this.emit(100, "Pista lista", "READY");
    this.assertReady();
    return frameTimes;
  }

  assertReady(): void {
    const readiness = this.readiness;
    if (!readiness.raceReady) {
      const missing = Object.entries(readiness)
        .filter(([key, value]) => key !== "raceReady" && !value)
        .map(([key]) => key);
      throw new Error(`Race readiness incomplete: ${missing.join(", ")}`);
    }
  }

  private emit(
    percent: number,
    label: string,
    phase: PreloadProgress["phase"],
  ): void {
    this.onProgress?.({
      loaded: Math.max(0, Math.min(100, percent)),
      total: 100,
      label,
      phase,
      readiness: this.readiness,
    });
  }
}

/**
 * One representative per shader define family, rather than one per material instance.
 *
 * The scene carries hundreds of colour variants for the eight karts and procedural props, but most
 * share the same compiled program. Compiling every material would turn loading into duplicated CPU
 * work; compiling only the current camera would leave first-use variants for later in the lap.
 */
export function shaderRepresentatives(scene: Scene): AbstractMesh[] {
  const representatives = new Map<string, AbstractMesh>();
  for (const mesh of scene.meshes) {
    const material = mesh.material;
    if (!material || mesh.getTotalVertices() === 0) continue;
    const useInstances = mesh instanceof Mesh && mesh.instances.length > 0;
    // Babylon's material object owns most shader defines, so material.uniqueId is the safe unit of
    // compilation. Mesh data still changes a program (UVs, vertex colours, skinning, morphs and
    // instances), hence the explicit geometry signature. Grouping only by material class/texture
    // count skipped clearcoat, bump, emissive and MultiMaterial variants that first appeared later
    // in a lap.
    const key = [
      material.uniqueId,
      material.getClassName(),
      mesh.isVerticesDataPresent(VertexBuffer.UVKind) ? "uv1" : "no-uv1",
      mesh.isVerticesDataPresent(VertexBuffer.UV2Kind) ? "uv2" : "no-uv2",
      mesh.isVerticesDataPresent(VertexBuffer.ColorKind) ? "color" : "no-color",
      mesh.isVerticesDataPresent(VertexBuffer.TangentKind) ? "tangent" : "no-tangent",
      mesh.skeleton ? "skin" : "rigid",
      mesh.morphTargetManager ? "morph" : "static",
      mesh.receiveShadows ? "receive" : "plain",
      useInstances ? "instances" : "mesh",
    ].join("|");
    if (!representatives.has(key)) representatives.set(key, mesh);
  }
  return [...representatives.values()];
}

async function withTimeout<T>(promise: Promise<T>, timeoutMs: number, message: string): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    return await Promise.race([
      promise,
      new Promise<never>((_, reject) => {
        timer = setTimeout(() => reject(new Error(message)), timeoutMs);
      }),
    ]);
  } finally {
    if (timer) clearTimeout(timer);
  }
}
