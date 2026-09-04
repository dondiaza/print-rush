import {
  Color3,
  Color4,
  type CubeTexture,
  ColorCurves,
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
    /**
     * The grade.
     *
     * ACES is kept — it is what stops the boost pads and the screens from clipping to white — but
     * everything around it moved toward the genre this game is actually in.
     *
     * `contrast` was 1.15, which on top of an ACES curve that already rolls the shadows off pulls
     * the darker half of every frame together into mush. It is now slightly *under* one: the frame
     * is opened up, and the modelling is carried by the fill light's hue instead of by darkness.
     *
     * `exposure` is up so the mid tones sit where a bright racer's do. Zones still push it around;
     * this is the base they multiply.
     */
    processing.toneMappingEnabled = true;
    processing.toneMappingType = ImageProcessingConfiguration.TONEMAPPING_ACES;
    processing.exposure = 1.12;
    processing.contrast = 0.96;
    // Vignette is off by default: a permanent vignette reads as a filter, not as lighting.
    processing.vignetteEnabled = false;

    /**
     * Saturation, and specifically saturation *in the shadows*.
     *
     * The single most recognisable property of a bright kart racer's image is that nothing in it is
     * grey. A shadow is a cooler, more saturated version of the surface, not a darker one. ACES pulls
     * chroma out of both ends of the range, so this puts it back where the eye reads it as "painted"
     * rather than "photographed": a global lift, more in the shadows, slightly less in the highlights
     * so bright surfaces stay clean instead of going lurid.
     *
     * These are the curve's own units — ±100 around a neutral zero, not multipliers.
     */
    const curves = new ColorCurves();
    curves.globalSaturation = 26;
    curves.shadowsSaturation = 38;
    curves.highlightsSaturation = 12;
    processing.colorCurves = curves;
    processing.colorCurvesEnabled = true;

    // Bloom with a high threshold and a short radius. The art bible is explicit that bloom is for
    // neon, boost, screens and lights — never a whole-scene glow, which is what the V4 GlowLayer did.
    this.pipeline.bloomEnabled = options.quality !== "LOW";
    // The threshold comes down a little to catch the brighter zone key lights and the rumble strip's
    // light stripe, and the weight comes down with it so more sources glow less each — a broad soft
    // sheen rather than a few hot points, which is what a sunlit racer looks like.
    this.pipeline.bloomThreshold = 0.78;
    this.pipeline.bloomWeight = 0.3;
    this.pipeline.bloomKernel = options.quality === "MEDIUM" ? 24 : 32;
    this.pipeline.bloomScale = 0.5;

    this.pipeline.fxaaEnabled = options.quality !== "LOW";
    this.pipeline.samples = options.quality === "ULTRA" ? 4 : 1;

    /**
     * Grain: off.
     *
     * It was on at the top two tiers to hide banding in large flat gradients. That was the wrong
     * trade. Animated grain is a *film* cue — it says photographed, handheld, real — and it is
     * directly at odds with the clean painted surfaces this restyling is after. The banding it was
     * covering is better handled by the saturation lift above, which gives those gradients chroma to
     * vary across instead of luminance alone.
     */
    this.pipeline.grainEnabled = false;

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
    /**
     * Contact shadow, not dirt.
     *
     * At full strength ambient occlusion darkens every crease and corner, which fights the open
     * shadows the rest of this grade is built on — it was putting grey back exactly where the fill
     * light had just removed it. Half strength keeps what occlusion is actually for: telling the eye
     * that a box is *resting on* the floor rather than hovering above it.
     */
    this.ssao.totalStrength = 0.5;
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
    // Already attached at construction when the camera existed first; attaching twice makes Babylon
    // re-add every post process and log "trying to reuse a post process not defined as reusable".
    if (!this.pipeline.cameras.includes(camera)) {
      this.scene.postProcessRenderPipelineManager.attachCamerasToRenderPipeline("rig-pipeline", camera);
    }
    if (this.ssao) {
      if (!this.ssao.cameras.includes(camera)) {
        this.scene.postProcessRenderPipelineManager.attachCamerasToRenderPipeline("rig-ssao", camera);
      }
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
 * Zone presets per theme.
 *
 * The hue of every zone is unchanged — it is the art bible's, and it is what makes the Megastore's
 * lap read as a journey through one building: cold street light at the window, warm shop floor, a
 * dimmer stairwell, cold fluorescent in the stockroom, a warm branded run to the line. What changed
 * is the *grade*, and it changed for a specific reported reason: "background elements come out
 * half-invisible" and "there are parts where things disappear".
 *
 * Three numbers were doing that.
 *
 * **Fog was the main culprit and it was not close.** Densities ran up to 0.013 with `FOGMODE_EXP2`,
 * whose visibility is `exp(-(distance * density)^2)`. At 0.013 that is 65% at fifty metres, 18% at a
 * hundred, and 2% at a hundred and fifty — against a camera far plane of nine hundred. Every
 * spectator, poster and prop past the next corner was being erased by the atmosphere. The authored
 * band 0.0018–0.013 is remapped onto 0.00055–0.0021, which keeps each zone's *relative* haze (a
 * stairwell is still thicker than a shop window) while putting the far side of a circuit at roughly
 * 85% visible instead of gone.
 *
 * **Fill was too weak to model anything.** At 0.34–0.58 against a key of 1.6–3.2, everything facing
 * away from the key light fell to near-black. That is a photographic look, and it is the opposite of
 * what a kart racer needs: the reference for this genre models form with *hue* — warm key, cool
 * fill — and keeps the whole frame legible, because the player is reading the track at speed and
 * cannot afford a dark side of anything. Fill is up by 85%, the fill colours are lifted and given a
 * touch more chroma, and the ground bounce is lifted too.
 *
 * **No zone is gloomy any more.** The key floor is 2.15, so the stairwell and the fitting rooms are
 * still the darker part of the lap in relative terms without becoming a place you cannot see.
 *
 * Fog colour is saturated and lifted to match: coloured haze at low density reads as air and depth,
 * which is the thing worth keeping from fog. Grey haze at high density just reads as a missing world.
 */
export const ThemeLightingZones: Record<string, LightingZone[]> = {
  FLAGSHIP: [
    { from: 0, name: "Escaparate", keyColor: "#d5e8ff", keyIntensity: 2.45, fillColor: "#9ebce8", fillIntensity: 0.52, groundColor: "#65584f", fogColor: "#a9bfd8", fogDensity: 0.00055, exposure: 0.94, environment: 0.7 },
    { from: 0.16, name: "Planta baja", keyColor: "#ffdaa1", keyIntensity: 2.35, fillColor: "#c9c3bb", fillIntensity: 0.5, groundColor: "#69594d", fogColor: "#c9b396", fogDensity: 0.00079, exposure: 0.96, environment: 0.66 },
    { from: 0.34, name: "Escalera", keyColor: "#eec394", keyIntensity: 2.1, fillColor: "#8d8074", fillIntensity: 0.46, groundColor: "#65574d", fogColor: "#927e69", fogDensity: 0.00141, exposure: 0.9, environment: 0.5 },
    { from: 0.46, name: "Planta alta", keyColor: "#fff1d0", keyIntensity: 2.5, fillColor: "#c9c3bb", fillIntensity: 0.52, groundColor: "#a56536", fogColor: "#c9b99e", fogDensity: 0.00072, exposure: 0.98, environment: 0.72 },
    { from: 0.6, name: "Probadores", keyColor: "#ffcf92", keyIntensity: 2.1, fillColor: "#927a63", fillIntensity: 0.46, groundColor: "#695444", fogColor: "#927458", fogDensity: 0.00148, exposure: 0.9, environment: 0.48 },
    { from: 0.7, name: "Almacén", keyColor: "#e4f0ff", keyIntensity: 2.45, fillColor: "#849ab4", fillIntensity: 0.5, groundColor: "#59616d", fogColor: "#7389a3", fogDensity: 0.00106, exposure: 0.94, environment: 0.62 },
    { from: 0.86, name: "Cajas y meta", keyColor: "#ffd9e8", keyIntensity: 2.55, fillColor: "#d2b8c6", fillIntensity: 0.54, groundColor: "#69594d", fogColor: "#c89eb6", fogDensity: 0.00065, exposure: 1.02, environment: 0.72 },
  ],
  WAREHOUSE: [
    { from: 0, name: "Muelle", keyColor: "#ddf0ff", keyIntensity: 2.55, fillColor: "#8ea9c4", fillIntensity: 0.54, groundColor: "#59616d", fogColor: "#94adc3", fogDensity: 0.00058, exposure: 1, environment: 0.72 },
    { from: 0.2, name: "Estanterías", keyColor: "#eff4ff", keyIntensity: 2.3, fillColor: "#788b9d", fillIntensity: 0.5, groundColor: "#59616d", fogColor: "#718295", fogDensity: 0.00113, exposure: 0.94, environment: 0.58 },
    { from: 0.42, name: "Pasarelas", keyColor: "#ffe9bb", keyIntensity: 2.1, fillColor: "#887e70", fillIntensity: 0.46, groundColor: "#57616d", fogColor: "#90816e", fogDensity: 0.00134, exposure: 0.9, environment: 0.5 },
    { from: 0.62, name: "Picking", keyColor: "#ffe298", keyIntensity: 2.4, fillColor: "#a5703d", fillIntensity: 0.5, groundColor: "#6d4f2a", fogColor: "#936a3f", fogDensity: 0.00099, exposure: 0.95, environment: 0.62 },
    { from: 0.84, name: "Expedición", keyColor: "#e6f4ff", keyIntensity: 2.55, fillColor: "#8ea5bd", fillIntensity: 0.54, groundColor: "#59616d", fogColor: "#8fa7bf", fogDensity: 0.00061, exposure: 1, environment: 0.72 },
  ],
  /**
   * The print works: industrial neutral with the process colours as accents, as the brief asks. The
   * first table was violet from end to end — key, fill, ground and fog all in one hue — which made
   * the whole lap one colour and left the CMYK nothing to stand against. Now the design and control
   * ends are clean cool-white workshop light, the screen hall goes bluer and dimmer, the ink hall
   * alone leans magenta-violet, and the dryer is the one hot zone. Five different rooms.
   */
  PRINT_FACTORY: [
    { from: 0, name: "Diseño", keyColor: "#fff3e2", keyIntensity: 2.95, fillColor: "#a4adc2", fillIntensity: 0.9, groundColor: "#6e6a78", fogColor: "#8f90aa", fogDensity: 0.00088, exposure: 1.14, environment: 0.92 },
    { from: 0.2, name: "Pantallas", keyColor: "#e4eeff", keyIntensity: 2.6, fillColor: "#8e93b4", fillIntensity: 0.82, groundColor: "#666277", fogColor: "#7c7fa4", fogDensity: 0.0012, exposure: 1.08, environment: 0.8 },
    { from: 0.42, name: "Tinta", keyColor: "#ffe4f4", keyIntensity: 2.45, fillColor: "#9d82d6", fillIntensity: 0.9, groundColor: "#67588a", fogColor: "#8a70b2", fogDensity: 0.0014, exposure: 1.06, environment: 0.78 },
    { from: 0.62, name: "Secado", keyColor: "#ffb36a", keyIntensity: 2.9, fillColor: "#ff8d4d", fillIntensity: 0.88, groundColor: "#8b5a30", fogColor: "#b2622a", fogDensity: 0.0019, exposure: 1.04, environment: 0.66 },
    { from: 0.82, name: "Control", keyColor: "#eaf5ff", keyIntensity: 2.85, fillColor: "#a3b6ca", fillIntensity: 0.88, groundColor: "#6c7482", fogColor: "#8c9db2", fogDensity: 0.0009, exposure: 1.14, environment: 0.92 },
  ],
  OFFICE: [
    { from: 0, name: "Recepción", keyColor: "#fff4dd", keyIntensity: 2.45, fillColor: "#c5c0b8", fillIntensity: 0.54, groundColor: "#73695d", fogColor: "#c2b9a7", fogDensity: 0.00065, exposure: 1, environment: 0.72 },
    { from: 0.2, name: "Open office", keyColor: "#f3f8ff", keyIntensity: 2.35, fillColor: "#c2c5ca", fillIntensity: 0.52, groundColor: "#73695d", fogColor: "#b4bac2", fogDensity: 0.00072, exposure: 0.98, environment: 0.68 },
    { from: 0.44, name: "Escritorios", keyColor: "#fff0d5", keyIntensity: 2.2, fillColor: "#aa9877", fillIntensity: 0.48, groundColor: "#875a31", fogColor: "#aa9067", fogDensity: 0.00092, exposure: 0.94, environment: 0.58 },
    { from: 0.64, name: "Sala y cocina", keyColor: "#ffe8c4", keyIntensity: 2.1, fillColor: "#998c78", fillIntensity: 0.46, groundColor: "#685e53", fogColor: "#8f806d", fogDensity: 0.00127, exposure: 0.9, environment: 0.5 },
    { from: 0.84, name: "Pasillo final", keyColor: "#f7fcff", keyIntensity: 2.55, fillColor: "#c5c3bf", fillIntensity: 0.54, groundColor: "#73695d", fogColor: "#bdc5cc", fogDensity: 0.00061, exposure: 1.02, environment: 0.72 },
  ],
  MANGA: [
    { from: 0, name: "Entrada", keyColor: "#ffb2e0", keyIntensity: 2.15, fillColor: "#8b4eff", fillIntensity: 0.78, groundColor: "#554687", fogColor: "#6944ad", fogDensity: 0.00155, exposure: 1.11, environment: 0.65 },
    { from: 0.2, name: "Artist alley", keyColor: "#ffcce8", keyIntensity: 2.15, fillColor: "#53ddff", fillIntensity: 0.7, groundColor: "#44348a", fogColor: "#5440ad", fogDensity: 0.00182, exposure: 1.08, environment: 0.59 },
    { from: 0.42, name: "Cosplay", keyColor: "#e0bbff", keyIntensity: 2.15, fillColor: "#ff29a7", fillIntensity: 0.81, groundColor: "#554687", fogColor: "#ad2ca9", fogDensity: 0.00196, exposure: 1.06, environment: 0.62 },
    { from: 0.62, name: "Escenario", keyColor: "#ffffff", keyIntensity: 2.69, fillColor: "#8b4eff", fillIntensity: 1.02, groundColor: "#534188", fogColor: "#6c37ad", fogDensity: 0.00141, exposure: 1.23, environment: 0.81 },
    { from: 0.84, name: "Merch y meta", keyColor: "#ffbbe0", keyIntensity: 2.15, fillColor: "#53ddff", fillIntensity: 0.85, groundColor: "#554687", fogColor: "#6240ad", fogDensity: 0.00162, exposure: 1.14, environment: 0.68 },
  ],
};

export function zonesForTheme(theme: string): LightingZone[] {
  return ThemeLightingZones[theme] ?? ThemeLightingZones.FLAGSHIP!;
}
