import {
  Color3,
  Color4,
  type CubeTexture,
  DefaultRenderingPipeline,
  DirectionalLight,
  HemisphericLight,
  ImageProcessingConfiguration,
  Scene,
  ShadowGenerator,
  SSAO2RenderingPipeline,
  Vector3,
  type AbstractMesh,
  type Camera,
} from "@babylonjs/core";
import { createEnvironment, environmentForTheme } from "./EnvironmentProbe";

/**
 * LIGHTING RIG V5.
 *
 * V4 lit every circuit with exactly two lights — one hemispheric at 0.7 and one directional at 2.7 —
 * and had no post-processing of any kind: no tone mapping, no exposure control, no ambient occlusion,
 * no grading. The whole track was lit identically from the shop window to the loading bay, which is
 * why nothing had volume.
 *
 * This rig implements the art bible's template: key, fill, bounce and rim, plus zones that
 * interpolate the whole lighting state along the lap, and an ACES-tonemapped pipeline with a
 * high-threshold bloom so only neons, boosts and screens glow.
 */

export type QualityLevel = "LOW" | "MEDIUM" | "HIGH" | "ULTRA";

/** One lighting zone. Zones are keyed by lap progress and blended across their transition. */
export type LightingZone = {
  /** Lap progress where this zone starts, 0..1. */
  from: number;
  name: string;
  keyColor: string;
  keyIntensity: number;
  fillColor: string
  fillIntensity: number;
  /** Bounce colour, taken from the floor of the space. Never black. */
  groundColor: string;
  fogColor: string;
  /** Exponential fog density. 0 disables fog in this zone. */
  fogDensity: number;
  exposure: number;
  /** Ambient (IBL substitute) strength for PBR materials in this zone. */
  environment: number;
};

export type LightingRigOptions = {
  quality: QualityLevel;
  zones: LightingZone[];
  /** Direction the key light points. Never straight down: 35 to 50 degrees of elevation. */
  keyDirection?: Vector3;
  clearColor?: string;
  /**
   * Theme name used to pick the procedural environment palette. Binding an environment is not
   * optional for a PBR scene: without one the specular term has no source and every material
   * responds to light identically, which was the single largest visual defect in the audit.
   */
  theme?: string;
};

/** Blend two hex colours into a Color3 without allocating. */
function mixInto(target: Color3, a: Color3, b: Color3, t: number): void {
  target.r = a.r + (b.r - a.r) * t;
  target.g = a.g + (b.g - a.g) * t;
  target.b = a.b + (b.b - a.b) * t;
}

type ResolvedZone = Omit<LightingZone, "keyColor" | "fillColor" | "groundColor" | "fogColor"> & {
  keyColor: Color3;
  fillColor: Color3;
  groundColor: Color3;
  fogColor: Color3;
};

export class LightingRig {
  readonly key: DirectionalLight;
  readonly fill: HemisphericLight;
  readonly rim: DirectionalLight | null;
  readonly shadows: ShadowGenerator | null;
  readonly pipeline: DefaultRenderingPipeline;
  /** The procedural IBL. Null only when there is no DOM to paint it on. */
  readonly environment: CubeTexture | null;
  private ssao: SSAO2RenderingPipeline | null = null;

  private readonly zones: ResolvedZone[];
  private readonly quality: QualityLevel;

  // Scratch colours so the per-frame blend never allocates.
  private readonly blendedKey = new Color3();
  private readonly blendedFill = new Color3();
  private readonly blendedGround = new Color3();
  private readonly blendedFog = new Color3();

  constructor(private readonly scene: Scene, options: LightingRigOptions) {
    this.quality = options.quality;
    this.zones = options.zones
      .slice()
      .sort((a, b) => a.from - b.from)
      .map((zone) => ({
        ...zone,
        keyColor: Color3.FromHexString(zone.keyColor),
        fillColor: Color3.FromHexString(zone.fillColor),
        groundColor: Color3.FromHexString(zone.groundColor),
        fogColor: Color3.FromHexString(zone.fogColor),
      }));

    const clear = Color3.FromHexString(options.clearColor ?? "#12101a");
    scene.clearColor = new Color4(clear.r, clear.g, clear.b, 1);
    scene.fogMode = Scene.FOGMODE_EXP2;

    // The environment is built before the lights so materials created afterwards pick it up.
    this.environment = createEnvironment(scene, environmentForTheme(options.theme ?? "FLAGSHIP"));

    // ---------------------------------------------------------------- key
    const direction = options.keyDirection ?? new Vector3(-0.45, -0.82, 0.36);
    this.key = new DirectionalLight("rig-key", direction.normalize(), scene);
    this.key.intensity = 2.4;
    this.key.shadowMinZ = 4;
    this.key.shadowMaxZ = 220;

    // ---------------------------------------------------------------- fill and bounce
    this.fill = new HemisphericLight("rig-fill", new Vector3(0, 1, 0), scene);
    this.fill.intensity = 0.45;

    // ---------------------------------------------------------------- rim
    // Separates the kart from the background. Cheap, and the single biggest readability win.
    if (options.quality === "HIGH" || options.quality === "ULTRA") {
      this.rim = new DirectionalLight("rig-rim", new Vector3(0.55, -0.35, -0.86).normalize(), scene);
      this.rim.intensity = 1.1;
      this.rim.diffuse = Color3.FromHexString("#c9e4ff");
      this.rim.specular = Color3.FromHexString("#ffffff");
    } else {
      this.rim = null;
    }

    // ---------------------------------------------------------------- shadows
    if (options.quality === "LOW") {
      this.shadows = null;
    } else {
      const resolution = options.quality === "MEDIUM" ? 1024 : 2048;
      this.shadows = new ShadowGenerator(resolution, this.key);
      this.shadows.usePercentageCloserFiltering = options.quality !== "MEDIUM";
      this.shadows.filteringQuality =
        options.quality === "ULTRA" ? ShadowGenerator.QUALITY_HIGH : ShadowGenerator.QUALITY_MEDIUM;
      this.shadows.useBlurExponentialShadowMap = options.quality === "MEDIUM";
      this.shadows.blurKernel = 16;
      this.shadows.bias = 0.0015;
      this.shadows.normalBias = 0.012;
      this.shadows.transparencyShadow = false;
    }

    // ---------------------------------------------------------------- post-processing
    const camera = scene.activeCamera ? [scene.activeCamera] : [];
    this.pipeline = new DefaultRenderingPipeline("rig-pipeline", true, scene, camera);

    this.pipeline.imageProcessingEnabled = true;
    const processing = this.pipeline.imageProcessing;
    processing.toneMappingEnabled = true;
    processing.toneMappingType = ImageProcessingConfiguration.TONEMAPPING_ACES;
    processing.exposure = 1;
    processing.contrast = 1.15;
    // Vignette is off by default: a permanent vignette reads as a filter, not as lighting.
    processing.vignetteEnabled = false;

    // Bloom with a high threshold and a short radius. The art bible is explicit that bloom is for
    // neon, boost, screens and lights — never a whole-scene glow, which is what the V4 GlowLayer did.
    this.pipeline.bloomEnabled = options.quality !== "LOW";
    this.pipeline.bloomThreshold = 0.86;
    this.pipeline.bloomWeight = 0.42;
    this.pipeline.bloomKernel = options.quality === "MEDIUM" ? 24 : 32;
    this.pipeline.bloomScale = 0.5;

    this.pipeline.fxaaEnabled = options.quality !== "LOW";
    this.pipeline.samples = options.quality === "ULTRA" ? 4 : 1;

    // Grain at a very low level hides banding in the large flat gradients of a lit interior.
    this.pipeline.grainEnabled = options.quality === "HIGH" || options.quality === "ULTRA";
    this.pipeline.grain.intensity = 3.5;
    this.pipeline.grain.animated = true;

    // Motion blur only in boost is driven from the runtime; the effect itself stays off here.
    this.pipeline.depthOfFieldEnabled = false;
    this.pipeline.chromaticAberrationEnabled = false;

    if (options.quality === "ULTRA" || options.quality === "HIGH") {
      this.enableAmbientOcclusion(scene.activeCamera);
    }

    // Apply the first zone immediately so frame one is already correct.
    this.update(0);
  }

  private enableAmbientOcclusion(camera: Camera | null): void {
    if (!camera) return;
    const ratio = this.quality === "ULTRA" ? { ssaoRatio: 1, blurRatio: 1 } : { ssaoRatio: 0.75, blurRatio: 0.5 };
    this.ssao = new SSAO2RenderingPipeline("rig-ssao", this.scene, ratio, [camera]);
    this.ssao.radius = 1.4;
    this.ssao.totalStrength = 1;
    this.ssao.expensiveBlur = this.quality === "ULTRA";
    this.ssao.samples = this.quality === "ULTRA" ? 16 : 8;
    this.ssao.maxZ = 120;
  }

  /**
   * Marks a mesh as casting shadows. Called explicitly rather than in bulk: the art bible limits
   * casters to karts, hero assets and near mid assets, and V4's approach of adding every kart mesh
   * put roughly 140 casters into a 1024 map.
   */
  addShadowCaster(mesh: AbstractMesh): void {
    this.shadows?.addShadowCaster(mesh, true);
  }

  /** Attaches the pipelines to a camera created after the rig. */
  attachCamera(camera: Camera): void {
    this.scene.postProcessRenderPipelineManager.attachCamerasToRenderPipeline("rig-pipeline", camera);
    if (this.ssao) {
      this.scene.postProcessRenderPipelineManager.attachCamerasToRenderPipeline("rig-ssao", camera);
    } else if (this.quality === "HIGH" || this.quality === "ULTRA") {
      this.enableAmbientOcclusion(camera);
    }
  }

  /**
   * Blends the lighting state for a position on the lap. Called every frame with the player's
   * progress, which is what makes the shop window, the stairwell and the loading bay feel like
   * different places rather than the same room with different props.
   */
  update(progress: number): void {
    if (this.zones.length === 0) return;

    const wrapped = ((progress % 1) + 1) % 1;
    let currentIndex = 0;
    for (let index = 0; index < this.zones.length; index += 1) {
      if (this.zones[index]!.from <= wrapped) currentIndex = index;
    }
    const current = this.zones[currentIndex]!;
    const next = this.zones[(currentIndex + 1) % this.zones.length]!;

    // Transition over the last 12 % of the zone, so the change lands as you arrive rather than
    // switching at a line on the floor.
    const end = next.from > current.from ? next.from : 1;
    const span = Math.max(0.02, end - current.from);
    const local = (wrapped - current.from) / span;
    const blend = Math.max(0, Math.min(1, (local - 0.78) / 0.22));
    const eased = blend * blend * (3 - 2 * blend);

    mixInto(this.blendedKey, current.keyColor, next.keyColor, eased);
    mixInto(this.blendedFill, current.fillColor, next.fillColor, eased);
    mixInto(this.blendedGround, current.groundColor, next.groundColor, eased);
    mixInto(this.blendedFog, current.fogColor, next.fogColor, eased);

    this.key.diffuse.copyFrom(this.blendedKey);
    this.key.intensity = current.keyIntensity + (next.keyIntensity - current.keyIntensity) * eased;
    this.fill.diffuse.copyFrom(this.blendedFill);
    this.fill.groundColor.copyFrom(this.blendedGround);
    this.fill.intensity = current.fillIntensity + (next.fillIntensity - current.fillIntensity) * eased;

    this.scene.fogColor.copyFrom(this.blendedFog);
    this.scene.fogDensity = current.fogDensity + (next.fogDensity - current.fogDensity) * eased;
    this.scene.environmentIntensity = current.environment + (next.environment - current.environment) * eased;

    this.pipeline.imageProcessing.exposure = current.exposure + (next.exposure - current.exposure) * eased;
  }

  /** Boost adds a short motion-blur-like emphasis without touching multiplayer timing. */
  setBoostEmphasis(amount: number): void {
    if (this.quality === "LOW") return;
    const clamped = Math.max(0, Math.min(1, amount));
    this.pipeline.chromaticAberrationEnabled = clamped > 0.02;
    this.pipeline.chromaticAberration.aberrationAmount = clamped * 14;
    this.pipeline.imageProcessing.vignetteEnabled = clamped > 0.02;
    this.pipeline.imageProcessing.vignetteWeight = clamped * 2.6;
    this.pipeline.imageProcessing.vignetteColor = new Color4(0, 0, 0, 1);
  }

  dispose(): void {
    this.environment?.dispose();
    this.ssao?.dispose();
    this.pipeline.dispose();
    this.shadows?.dispose();
    this.key.dispose();
    this.fill.dispose();
    this.rim?.dispose();
  }
}

/**
 * Zone presets per theme, following the art bible's palettes. The Megastore set is the normative
 * example from section 3.2: cold street light at the window, warm shop floor, a darker stairwell,
 * a cold fluorescent stockroom, and a warm branded run to the line.
 */
export const ThemeLightingZones: Record<string, LightingZone[]> = {
  FLAGSHIP: [
    { from: 0, name: "Escaparate", keyColor: "#d8e8ff", keyIntensity: 3, fillColor: "#b8ccea", fillIntensity: 0.55, groundColor: "#6e6259", fogColor: "#c9d8ea", fogDensity: 0.0018, exposure: 1.18, environment: 0.85 },
    { from: 0.16, name: "Planta baja", keyColor: "#ffd9a8", keyIntensity: 2.5, fillColor: "#e8dfd0", fillIntensity: 0.5, groundColor: "#6e6259", fogColor: "#e0cdb4", fogDensity: 0.0035, exposure: 1.02, environment: 0.7 },
    { from: 0.34, name: "Escalera", keyColor: "#e8c39a", keyIntensity: 1.6, fillColor: "#9d8f7f", fillIntensity: 0.34, groundColor: "#4e463f", fogColor: "#8a7a68", fogDensity: 0.008, exposure: 0.92, environment: 0.5 },
    { from: 0.46, name: "Planta alta", keyColor: "#fff0d4", keyIntensity: 2.7, fillColor: "#e8dfd0", fillIntensity: 0.52, groundColor: "#c98a52", fogColor: "#e6d6bd", fogDensity: 0.003, exposure: 1.08, environment: 0.78 },
    { from: 0.6, name: "Probadores", keyColor: "#ffcf9a", keyIntensity: 1.7, fillColor: "#a08a72", fillIntensity: 0.38, groundColor: "#57493d", fogColor: "#9a8168", fogDensity: 0.0085, exposure: 0.94, environment: 0.48 },
    { from: 0.7, name: "Almacén", keyColor: "#e6f0ff", keyIntensity: 2.9, fillColor: "#9fb0c4", fillIntensity: 0.42, groundColor: "#4a4e54", fogColor: "#8fa0b4", fogDensity: 0.0055, exposure: 1, environment: 0.6 },
    { from: 0.86, name: "Cajas y meta", keyColor: "#ffdbe8", keyIntensity: 2.8, fillColor: "#f0d8e4", fillIntensity: 0.56, groundColor: "#6e6259", fogColor: "#e8c4d8", fogDensity: 0.0025, exposure: 1.15, environment: 0.82 },
  ],
  WAREHOUSE: [
    { from: 0, name: "Muelle", keyColor: "#dff0ff", keyIntensity: 3.2, fillColor: "#a8c0d8", fillIntensity: 0.5, groundColor: "#4a4e54", fogColor: "#b8ccdd", fogDensity: 0.002, exposure: 1.2, environment: 0.9 },
    { from: 0.2, name: "Estanterías", keyColor: "#f0f4ff", keyIntensity: 2.4, fillColor: "#8fa0b0", fillIntensity: 0.4, groundColor: "#4a4e54", fogColor: "#7d8a98", fogDensity: 0.006, exposure: 0.98, environment: 0.55 },
    { from: 0.42, name: "Pasarelas", keyColor: "#ffe8c0", keyIntensity: 2.1, fillColor: "#9a9080", fillIntensity: 0.36, groundColor: "#5a6068", fogColor: "#8a8070", fogDensity: 0.0075, exposure: 0.94, environment: 0.5 },
    { from: 0.62, name: "Picking", keyColor: "#ffe0a0", keyIntensity: 2.3, fillColor: "#b98a57", fillIntensity: 0.44, groundColor: "#7a5e3c", fogColor: "#a8845c", fogDensity: 0.005, exposure: 1.02, environment: 0.62 },
    { from: 0.84, name: "Expedición", keyColor: "#e8f4ff", keyIntensity: 3, fillColor: "#a8bcd0", fillIntensity: 0.5, groundColor: "#4a4e54", fogColor: "#b0c4d8", fogDensity: 0.0022, exposure: 1.14, environment: 0.85 },
  ],
  PRINT_FACTORY: [
    { from: 0, name: "Diseño", keyColor: "#e8ecff", keyIntensity: 2.4, fillColor: "#9aa0c0", fillIntensity: 0.45, groundColor: "#2b2732", fogColor: "#6a6a90", fogDensity: 0.005, exposure: 1.05, environment: 0.65 },
    { from: 0.2, name: "Pantallas", keyColor: "#d8e0ff", keyIntensity: 2.2, fillColor: "#8f7cc0", fillIntensity: 0.42, groundColor: "#2b2732", fogColor: "#5c4c88", fogDensity: 0.007, exposure: 1, environment: 0.6 },
    { from: 0.42, name: "Tinta", keyColor: "#ffd0f0", keyIntensity: 2, fillColor: "#8f5cff", fillIntensity: 0.5, groundColor: "#3a2450", fogColor: "#5c3878", fogDensity: 0.009, exposure: 0.96, environment: 0.58 },
    { from: 0.62, name: "Secado", keyColor: "#ff9a52", keyIntensity: 2.6, fillColor: "#ff6b2c", fillIntensity: 0.48, groundColor: "#4a2a18", fogColor: "#a04c1c", fogDensity: 0.013, exposure: 0.9, environment: 0.5 },
    { from: 0.82, name: "Control", keyColor: "#e0f0ff", keyIntensity: 2.5, fillColor: "#9ab0c8", fillIntensity: 0.46, groundColor: "#3a3f49", fogColor: "#7a8898", fogDensity: 0.004, exposure: 1.08, environment: 0.7 },
  ],
  OFFICE: [
    { from: 0, name: "Recepción", keyColor: "#fff4e0", keyIntensity: 2.6, fillColor: "#e6e1d8", fillIntensity: 0.56, groundColor: "#8c8378", fogColor: "#ddd6c8", fogDensity: 0.0025, exposure: 1.12, environment: 0.82 },
    { from: 0.2, name: "Open office", keyColor: "#f4f8ff", keyIntensity: 2.4, fillColor: "#e6e1d8", fillIntensity: 0.52, groundColor: "#8c8378", fogColor: "#d4d8de", fogDensity: 0.003, exposure: 1.08, environment: 0.78 },
    { from: 0.44, name: "Escritorios", keyColor: "#fff0d8", keyIntensity: 2.2, fillColor: "#c8b898", fillIntensity: 0.46, groundColor: "#a2764b", fogColor: "#c4ae88", fogDensity: 0.0045, exposure: 1.02, environment: 0.68 },
    { from: 0.64, name: "Sala y cocina", keyColor: "#ffe8c8", keyIntensity: 1.9, fillColor: "#b8ac98", fillIntensity: 0.4, groundColor: "#7a7268", fogColor: "#a89c88", fogDensity: 0.007, exposure: 0.96, environment: 0.56 },
    { from: 0.84, name: "Pasillo final", keyColor: "#f8fcff", keyIntensity: 2.7, fillColor: "#e6e1d8", fillIntensity: 0.58, groundColor: "#8c8378", fogColor: "#dee4ea", fogDensity: 0.0022, exposure: 1.14, environment: 0.84 },
  ],
  MANGA: [
    { from: 0, name: "Entrada", keyColor: "#ffb8e0", keyIntensity: 1.6, fillColor: "#8f5cff", fillIntensity: 0.42, groundColor: "#252036", fogColor: "#3a2a58", fogDensity: 0.009, exposure: 1.05, environment: 0.5 },
    { from: 0.2, name: "Artist alley", keyColor: "#ffd0e8", keyIntensity: 1.4, fillColor: "#65d8ff", fillIntensity: 0.38, groundColor: "#1b1630", fogColor: "#2c2450", fogDensity: 0.011, exposure: 1.02, environment: 0.45 },
    { from: 0.42, name: "Cosplay", keyColor: "#e0c0ff", keyIntensity: 1.5, fillColor: "#ff3da6", fillIntensity: 0.44, groundColor: "#252036", fogColor: "#4a1c48", fogDensity: 0.012, exposure: 1, environment: 0.48 },
    { from: 0.62, name: "Escenario", keyColor: "#ffffff", keyIntensity: 2.4, fillColor: "#8f5cff", fillIntensity: 0.55, groundColor: "#302848", fogColor: "#5c3888", fogDensity: 0.008, exposure: 1.16, environment: 0.62 },
    { from: 0.84, name: "Merch y meta", keyColor: "#ffc0e0", keyIntensity: 1.7, fillColor: "#65d8ff", fillIntensity: 0.46, groundColor: "#252036", fogColor: "#3c2c60", fogDensity: 0.0095, exposure: 1.08, environment: 0.52 },
  ],
};

export function zonesForTheme(theme: string): LightingZone[] {
  return ThemeLightingZones[theme] ?? ThemeLightingZones.FLAGSHIP!;
}
