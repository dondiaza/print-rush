import { Color3, DynamicTexture, PBRMaterial, Scene, StandardMaterial, Texture } from "@babylonjs/core";
import type { AssetCatalog } from "./AssetCatalog";

/**
 * MATERIAL LIBRARY V5.
 *
 * The audit found zero image textures and zero normal maps in the entire V4 project: every surface
 * was a `PBRMaterial` with a flat `albedoColor` and, with no environment texture bound, nothing to
 * reflect. Metal, fabric, cardboard and floor all responded to light identically. That is the single
 * largest reason the game read as a prototype.
 *
 * Textures come from two places now, in this order:
 *
 *  1. **The baked files** in `public/assets`, via `AssetCatalog`. Real PNGs on disk, validated for
 *     seams and for not being flat, and replaceable by an artist or an image model without touching
 *     code. Normal and roughness maps are taken from the bake for *every* class, because those two
 *     maps are colour-independent — the surface behaviour is the same whether the wall is magenta or
 *     grey. A baked *base colour* is used only when a caller names one, so a theme's own `color`
 *     never becomes dead configuration.
 *  2. **The procedural generator** below, unchanged, as the fallback. If the manifest is missing or a
 *     download fails, every surface still gets albedo variation and a derived normal map. Losing the
 *     bake costs fidelity, not the race.
 *
 * The fifteen classes and their parameters are normative — see `docs/ART_BIBLE_V5.md` section 4, and
 * `docs/ART_DIRECTION.md` for how the baked set maps onto them.
 */

export type MaterialClass =
  | "FABRIC"
  | "CARDBOARD"
  | "PAINTED_METAL"
  | "RAW_METAL"
  | "RUBBER"
  | "PLASTIC"
  | "GLASS"
  | "WOOD"
  | "CONCRETE"
  | "INK"
  | "PAPER"
  | "SCREEN"
  | "NEON"
  | "ASPHALT"
  | "FLOOR_TILE";

export type MaterialQuality = "LOW" | "MEDIUM" | "HIGH" | "ULTRA";

type ClassSpec = {
  roughness: number;
  metallic: number;
  /** Strength of the generated normal map, 0 disables it. */
  bump: number;
  /** Metres covered by one texture tile. */
  tile: number;
  /** How the albedo pattern is drawn. */
  pattern: PatternKind;
  alpha?: number;
  emissive?: number;
};

type PatternKind =
  | "WEAVE"
  | "FIBRE"
  | "BRUSHED"
  | "SPECKLE"
  | "GRAIN"
  | "TILE"
  | "WET"
  | "SMOOTH"
  | "SCREEN"
  | "COARSE";

const SPECS: Record<MaterialClass, ClassSpec> = {
  // Fabric matters more than anything else here: t-shirts are the subject of the game, and a shirt
  // that reads as plastic undermines the whole premise. High roughness, zero metallic, strong weave.
  FABRIC: { roughness: 0.92, metallic: 0, bump: 1, tile: 0.35, pattern: "WEAVE" },
  CARDBOARD: { roughness: 0.88, metallic: 0, bump: 0.7, tile: 0.9, pattern: "FIBRE" },
  PAINTED_METAL: { roughness: 0.42, metallic: 0.85, bump: 0.28, tile: 1.6, pattern: "SPECKLE" },
  RAW_METAL: { roughness: 0.28, metallic: 1, bump: 0.45, tile: 1.1, pattern: "BRUSHED" },
  RUBBER: { roughness: 0.95, metallic: 0, bump: 0.85, tile: 0.4, pattern: "SPECKLE" },
  PLASTIC: { roughness: 0.35, metallic: 0, bump: 0.12, tile: 1.4, pattern: "SMOOTH" },
  GLASS: { roughness: 0.08, metallic: 0, bump: 0, tile: 4, pattern: "SMOOTH", alpha: 0.18 },
  WOOD: { roughness: 0.72, metallic: 0, bump: 0.5, tile: 2.2, pattern: "GRAIN" },
  CONCRETE: { roughness: 0.9, metallic: 0, bump: 0.8, tile: 3.2, pattern: "COARSE" },
  INK: { roughness: 0.22, metallic: 0, bump: 0, tile: 2.4, pattern: "WET", emissive: 0.08 },
  PAPER: { roughness: 0.86, metallic: 0, bump: 0.18, tile: 0.8, pattern: "FIBRE" },
  SCREEN: { roughness: 0.18, metallic: 0, bump: 0, tile: 1, pattern: "SCREEN", emissive: 0.9 },
  NEON: { roughness: 0.3, metallic: 0, bump: 0, tile: 1, pattern: "SMOOTH", emissive: 1 },
  ASPHALT: { roughness: 0.94, metallic: 0, bump: 1, tile: 4.5, pattern: "COARSE" },
  FLOOR_TILE: { roughness: 0.55, metallic: 0, bump: 0.55, tile: 2.4, pattern: "TILE" },
};

function resolutionFor(quality: MaterialQuality, pattern: PatternKind): number {
  if (pattern === "SMOOTH") return 64;
  switch (quality) {
    case "LOW":
      return 128;
    case "MEDIUM":
      return 256;
    case "HIGH":
      return 512;
    default:
      return 512;
  }
}

/** Deterministic value noise so a material looks the same on every device and every reload. */
function hash(x: number, y: number, seed: number): number {
  let h = x * 374_761_393 + y * 668_265_263 + seed * 1_442_695_040;
  h = (h ^ (h >>> 13)) * 1_274_126_177;
  return ((h ^ (h >>> 16)) >>> 0) / 4_294_967_295;
}

/**
 * Babylon types its canvas as `ICanvasRenderingContext`, a documented subset of the DOM 2D context.
 * Every call below is inside that subset except `createImageData`/`putImageData`, so the context is
 * narrowed once here rather than cast at each use.
 */
type Canvas2D = CanvasRenderingContext2D;

function drawPattern(
  context: Canvas2D,
  size: number,
  pattern: PatternKind,
  base: Color3,
  seed: number,
): void {
  const hex = base.toHexString();
  context.fillStyle = hex;
  context.fillRect(0, 0, size, size);

  const shade = (amount: number): string => {
    const clamp = (value: number): number => Math.max(0, Math.min(255, Math.round(value * 255)));
    return `rgb(${clamp(base.r * amount)},${clamp(base.g * amount)},${clamp(base.b * amount)})`;
  };

  switch (pattern) {
    case "WEAVE": {
      // Warp and weft drawn as alternating threads. At 512 over 0.35 m this is visible up close and
      // dissolves into a soft micro-mottle at distance, which is what fabric does.
      const thread = Math.max(2, Math.floor(size / 64));
      for (let y = 0; y < size; y += thread * 2) {
        for (let x = 0; x < size; x += thread * 2) {
          const jitter = hash(x, y, seed) * 0.12 - 0.06;
          context.fillStyle = shade(1.06 + jitter);
          context.fillRect(x, y, thread, thread);
          context.fillRect(x + thread, y + thread, thread, thread);
          context.fillStyle = shade(0.9 + jitter);
          context.fillRect(x + thread, y, thread, thread);
          context.fillRect(x, y + thread, thread, thread);
        }
      }
      break;
    }
    case "FIBRE": {
      // Short random strokes: paper and cardboard pulp.
      for (let index = 0; index < size * 5; index += 1) {
        const x = hash(index, 1, seed) * size;
        const y = hash(index, 2, seed) * size;
        const length = 2 + hash(index, 3, seed) * (size / 40);
        const angle = hash(index, 4, seed) * Math.PI;
        context.strokeStyle = shade(0.86 + hash(index, 5, seed) * 0.3);
        context.lineWidth = 1;
        context.beginPath();
        context.moveTo(x, y);
        context.lineTo(x + Math.cos(angle) * length, y + Math.sin(angle) * length);
        context.stroke();
      }
      break;
    }
    case "BRUSHED": {
      // Directional scratches. Metal has to be anisotropic or it reads as plastic.
      for (let index = 0; index < size * 3; index += 1) {
        const y = hash(index, 7, seed) * size;
        context.strokeStyle = shade(0.82 + hash(index, 8, seed) * 0.42);
        context.lineWidth = hash(index, 9, seed) * 1.6;
        context.beginPath();
        context.moveTo(0, y);
        context.lineTo(size, y + (hash(index, 10, seed) - 0.5) * 4);
        context.stroke();
      }
      break;
    }
    case "SPECKLE": {
      for (let index = 0; index < size * 8; index += 1) {
        const x = hash(index, 11, seed) * size;
        const y = hash(index, 12, seed) * size;
        const radius = 0.5 + hash(index, 13, seed) * (size / 200);
        context.fillStyle = shade(0.84 + hash(index, 14, seed) * 0.34);
        context.beginPath();
        context.arc(x, y, radius, 0, Math.PI * 2);
        context.fill();
      }
      break;
    }
    case "GRAIN": {
      // Wood grain as stretched sine bands with knots.
      for (let y = 0; y < size; y += 1) {
        const wave = Math.sin(y / size * Math.PI * 7 + hash(y, 15, seed) * 0.9) * 0.5 + 0.5;
        context.fillStyle = shade(0.82 + wave * 0.3);
        context.fillRect(0, y, size, 1);
      }
      for (let index = 0; index < 5; index += 1) {
        const x = hash(index, 16, seed) * size;
        const y = hash(index, 17, seed) * size;
        context.strokeStyle = shade(0.68);
        context.lineWidth = 1.5;
        context.beginPath();
        context.ellipse(x, y, size / 26, size / 12, hash(index, 18, seed) * Math.PI, 0, Math.PI * 2);
        context.stroke();
      }
      break;
    }
    case "TILE": {
      const cells = 4;
      const cell = size / cells;
      const grout = Math.max(2, size / 128);
      context.fillStyle = shade(0.6);
      context.fillRect(0, 0, size, size);
      for (let row = 0; row < cells; row += 1) {
        for (let column = 0; column < cells; column += 1) {
          // Every tile is a slightly different shade. Identical tiles are what makes a floor read
          // as a texture rather than as a floor.
          context.fillStyle = shade(0.94 + hash(row, column, seed) * 0.16);
          context.fillRect(column * cell + grout, row * cell + grout, cell - grout * 2, cell - grout * 2);
        }
      }
      break;
    }
    case "WET": {
      // Ink: broad pooling with a few brighter highlights.
      for (let index = 0; index < 40; index += 1) {
        const x = hash(index, 19, seed) * size;
        const y = hash(index, 20, seed) * size;
        const radius = size / 12 + hash(index, 21, seed) * (size / 6);
        const gradient = context.createRadialGradient(x, y, 0, x, y, radius);
        gradient.addColorStop(0, shade(1.18));
        gradient.addColorStop(1, hex);
        context.fillStyle = gradient;
        context.beginPath();
        context.arc(x, y, radius, 0, Math.PI * 2);
        context.fill();
      }
      break;
    }
    case "SCREEN": {
      const line = Math.max(2, size / 96);
      for (let y = 0; y < size; y += line * 2) {
        context.fillStyle = shade(0.72);
        context.fillRect(0, y, size, line);
      }
      break;
    }
    case "COARSE": {
      for (let index = 0; index < size * 14; index += 1) {
        const x = hash(index, 22, seed) * size;
        const y = hash(index, 23, seed) * size;
        context.fillStyle = shade(0.74 + hash(index, 24, seed) * 0.46);
        context.fillRect(x, y, 1 + hash(index, 25, seed) * 2, 1 + hash(index, 26, seed) * 2);
      }
      // Low-frequency staining, so the surface is not uniform at a distance either.
      for (let index = 0; index < 14; index += 1) {
        const x = hash(index, 27, seed) * size;
        const y = hash(index, 28, seed) * size;
        const radius = size / 8 + hash(index, 29, seed) * (size / 4);
        const gradient = context.createRadialGradient(x, y, 0, x, y, radius);
        gradient.addColorStop(0, shade(0.88));
        gradient.addColorStop(1, "rgba(0,0,0,0)");
        context.fillStyle = gradient;
        context.beginPath();
        context.arc(x, y, radius, 0, Math.PI * 2);
        context.fill();
      }
      break;
    }
    case "SMOOTH":
    default: {
      // Even a smooth surface gets a whisper of noise. Perfectly flat colour is the prototype tell.
      for (let index = 0; index < size * 2; index += 1) {
        const x = hash(index, 30, seed) * size;
        const y = hash(index, 31, seed) * size;
        context.fillStyle = shade(0.97 + hash(index, 32, seed) * 0.06);
        context.fillRect(x, y, 2, 2);
      }
      break;
    }
  }
}

/** Derives a tangent-space normal map from the albedo's luminance via a Sobel gradient. */
function deriveNormal(
  scene: Scene,
  albedo: DynamicTexture,
  size: number,
  strength: number,
  name: string,
): DynamicTexture {
  const source = (albedo.getContext() as unknown as Canvas2D).getImageData(0, 0, size, size).data;
  const normal = new DynamicTexture(name, { width: size, height: size }, scene, false);
  const context = normal.getContext() as unknown as Canvas2D;
  const output = context.createImageData(size, size);

  const luminance = (x: number, y: number): number => {
    const px = ((y + size) % size) * size + ((x + size) % size);
    const offset = px * 4;
    return (source[offset]! * 0.2126 + source[offset + 1]! * 0.7152 + source[offset + 2]! * 0.0722) / 255;
  };

  for (let y = 0; y < size; y += 1) {
    for (let x = 0; x < size; x += 1) {
      const dx =
        luminance(x - 1, y - 1) + 2 * luminance(x - 1, y) + luminance(x - 1, y + 1) -
        luminance(x + 1, y - 1) - 2 * luminance(x + 1, y) - luminance(x + 1, y + 1);
      const dy =
        luminance(x - 1, y - 1) + 2 * luminance(x, y - 1) + luminance(x + 1, y - 1) -
        luminance(x - 1, y + 1) - 2 * luminance(x, y + 1) - luminance(x + 1, y + 1);
      const nx = dx * strength;
      const ny = dy * strength;
      const nz = 1;
      const length = Math.hypot(nx, ny, nz) || 1;
      const offset = (y * size + x) * 4;
      output.data[offset] = Math.round((nx / length * 0.5 + 0.5) * 255);
      output.data[offset + 1] = Math.round((ny / length * 0.5 + 0.5) * 255);
      output.data[offset + 2] = Math.round((nz / length * 0.5 + 0.5) * 255);
      output.data[offset + 3] = 255;
    }
  }
  context.putImageData(output, 0, 0);
  normal.update(false);
  return normal;
}

export type MaterialRequest = {
  materialClass: MaterialClass;
  color: string;
  /** Metres per texture tile. Defaults to the class value. */
  tile?: number;
  /** Deterministic variation so two walls of the same class do not look identical. */
  seed?: number;
  /** Overrides the class emissive strength. */
  emissive?: number;
  /**
   * Base id of a baked material whose *base colour* should be used, e.g. `mat_concrete_warehouse`.
   *
   * When the catalog has it, the file defines the colour and `color` becomes the fallback for when
   * it does not. Leave it unset to keep the procedural grey-and-tint path, which is what props want:
   * a hundred cardboard boxes in six colours share one texture and six materials.
   */
  texture?: string;
};

/**
 * Class to baked material base id, for the normal and roughness maps that apply regardless of colour.
 *
 * Explicit rather than a lowercase transform of the class name, because it is a mapping between two
 * independently chosen vocabularies and three of them do not line up (`PAINTED_METAL` to
 * `paintedmetal`, `FLOOR_TILE` to `floortile`). `null` means the bake has no such class: GLASS and
 * NEON are smooth and emissive respectively, so a surface map would only add cost.
 */
const BAKED_DEFAULT: Record<MaterialClass, string | null> = {
  FABRIC: "mat_fabric_white",
  CARDBOARD: "mat_cardboard_default",
  RAW_METAL: "mat_rawmetal_default",
  RUBBER: "mat_rubber_default",
  CONCRETE: "mat_concrete_default",
  PAPER: "mat_paper_default",
  ASPHALT: "mat_asphalt_default",
  // Every entry above is in the shared set. These five are not, and that is why they are null:
  // the only baked variants of these classes belong to one circuit each — the press metal to the
  // factory, the pallet plastic to the warehouse, the desk oak to the office — and another
  // circuit's assets are never downloaded. Naming one here would point the default at a file that
  // cannot be resident, which is indistinguishable from a typo and just as useless. Surfaces of
  // these classes take their relief from the texture their own theme names, and the procedural
  // generator where it names none.
  PAINTED_METAL: null,
  PLASTIC: null,
  WOOD: null,
  INK: null,
  FLOOR_TILE: null,
  // Smooth and emissive respectively: a surface map would only add cost.
  GLASS: null,
  SCREEN: null,
  NEON: null,
};

/**
 * Builds and caches materials for one scene. Cached by class, colour and tiling, which is what keeps
 * the unique-material count inside the 40-material budget the art bible sets: a hundred cardboard
 * boxes in six colours share six materials and vary per instance.
 */
export class MaterialLibrary {
  private readonly cache = new Map<string, PBRMaterial>();
  private readonly textures = new Map<string, { albedo: DynamicTexture; normal: DynamicTexture | null }>();
  /**
   * Baked textures re-scaled for one tiling.
   *
   * `uScale` lives on the texture, not on the material, so two materials that share a texture cannot
   * tile it differently — the second one to be created silently retunes the first. Cloning a
   * `Texture` reuses the already-uploaded GPU image and only allocates a new sampler wrapper, so
   * this is cheap and it is the only correct answer.
   */
  private readonly scaled = new Map<string, Texture>();
  /** Counts baked textures actually bound, so the performance lab can report bake vs fallback. */
  private bakedBindings = 0;

  constructor(
    private readonly scene: Scene,
    private readonly quality: MaterialQuality = "HIGH",
    private readonly catalog: AssetCatalog | null = null,
  ) {}

  get size(): number {
    return this.cache.size;
  }

  /** Number of procedurally generated textures. Reported by the performance lab. */
  get textureCount(): number {
    return this.textures.size;
  }

  /** How many baked maps were bound. Zero means every surface fell back to the generator. */
  get bakedTextureCount(): number {
    return this.bakedBindings;
  }

  get(request: MaterialRequest): PBRMaterial {
    const spec = SPECS[request.materialClass];
    const tile = request.tile ?? spec.tile;
    const key = `${request.materialClass}|${request.color}|${tile}|${request.seed ?? 0}|${request.emissive ?? ""}|${request.texture ?? ""}`;
    const cached = this.cache.get(key);
    if (cached) return cached;

    const base = Color3.FromHexString(request.color);
    const material = new PBRMaterial(`mat-${key}`, this.scene);
    material.albedoColor = base;
    material.roughness = spec.roughness;
    material.metallic = spec.metallic;
    // Without an IBL the PBR shader has nothing to reflect, so a modest ambient floor keeps the
    // material from going black in shadow. The lighting rig raises this once an IBL is bound.
    material.environmentIntensity = 0.6;

    const emissive = request.emissive ?? spec.emissive ?? 0;
    if (emissive > 0) {
      material.emissiveColor = base.scale(emissive);
      if (request.materialClass === "NEON" || request.materialClass === "SCREEN") {
        material.unlit = request.materialClass === "NEON";
        material.disableLighting = request.materialClass === "NEON";
      }
    }

    if (spec.alpha !== undefined) {
      material.alpha = spec.alpha;
      material.transparencyMode = PBRMaterial.PBRMATERIAL_ALPHABLEND;
    }

    // NEON and SMOOTH classes gain nothing from a texture, so they stay untextured and cheap.
    if (spec.pattern !== "SMOOTH" || spec.bump > 0) {
      const scale = 1 / tile;
      const bakedId = request.texture ?? BAKED_DEFAULT[request.materialClass];
      const bakedBase = request.texture ? this.bakedMap(`${request.texture}_basecolor`, scale) : null;
      const bakedNormal = bakedId ? this.bakedMap(`${bakedId}_normal`, scale) : null;
      const bakedRoughness = bakedId ? this.bakedMap(`${bakedId}_roughness`, scale) : null;

      if (bakedBase) {
        // The file is authoritative for colour, so the tint goes to white rather than multiplying
        // the two together and darkening everything twice.
        material.albedoColor = Color3.White();
        material.albedoTexture = bakedBase;
        material.useAlphaFromAlbedoTexture = false;
      }

      /**
       * Roughness and normal maps apply at every tier now.
       *
       * They were gated off at LOW, so the cheapest devices got flat untextured surfaces — and since
       * most phones were being classed LOW, that was the "bad texturing on mobile" report. The cost
       * is a texture fetch per pixel on already-drawn geometry, not extra draw calls, and the maps
       * are 256 px. Dropping them saved almost nothing and cost the entire material read.
       */
      if (bakedRoughness) {
        // A greyscale PNG arrives with R = G = B, so the green channel carries roughness. Metalness
        // stays the scalar from the class spec — the bake writes no metalness map, and pretending a
        // roughness map is an ORM would put roughness into the metalness slot.
        material.metallicTexture = bakedRoughness;
        material.useRoughnessFromMetallicTextureAlpha = false;
        material.useRoughnessFromMetallicTextureGreen = true;
        material.useMetallnessFromMetallicTextureBlue = false;
        material.useAmbientOcclusionFromMetallicTextureRed = false;
      }

      // A procedural albedo still earns its place when no baked base colour was named: it is grey
      // variation that the theme's own colour tints, which is how one texture serves many props.
      const needsProcedural = !bakedBase || !bakedNormal;
      const maps = needsProcedural ? this.textureFor(request.materialClass, request.seed ?? 0, tile) : null;
      if (maps && !bakedBase) {
        material.albedoTexture = maps.albedo;
        material.useAlphaFromAlbedoTexture = false;
      }

      {
        const normal = bakedNormal ?? maps?.normal ?? null;
        if (normal) {
          material.bumpTexture = normal;
          // The baked maps are written in the OpenGL convention (green up); the derived ones invert.
          material.invertNormalMapY = normal === bakedNormal ? false : true;
        }
      }
    }

    this.cache.set(key, material);
    return material;
  }

  /**
   * A baked texture, cloned and scaled for this tiling, or null if it was never loaded.
   *
   * Null is the normal case for anything the bake does not cover and for a failed download, and it
   * is why every caller keeps its procedural path.
   */
  private bakedMap(id: string, scale: number): Texture | null {
    if (!this.catalog) return null;
    const key = `${id}|${scale}`;
    const cached = this.scaled.get(key);
    if (cached) return cached;

    const source = this.catalog.texture(id);
    if (!source) return null;

    const clone = source.clone();
    clone.uScale = scale;
    clone.vScale = scale;
    clone.wrapU = Texture.WRAP_ADDRESSMODE;
    clone.wrapV = Texture.WRAP_ADDRESSMODE;
    clone.gammaSpace = source.gammaSpace;
    this.scaled.set(key, clone);
    this.bakedBindings += 1;
    return clone;
  }

  /**
   * Textures are shared across every colour of a class, which is where most of the saving is.
   *
   * Keyed by tiling as well, because `uScale` is a property of the texture: a road at 6 m per tile
   * and a wall at 3 m per tile cannot share one `DynamicTexture` without the second silently
   * retuning the first. A class is normally used at one or two tilings, so this costs little.
   */
  private textureFor(
    materialClass: MaterialClass,
    seed: number,
    tile: number,
  ): { albedo: DynamicTexture; normal: DynamicTexture | null } | null {
    const key = `${materialClass}|${seed}|${tile}`;
    const cached = this.textures.get(key);
    if (cached) return cached;

    const spec = SPECS[materialClass];
    if (spec.pattern === "SMOOTH" && spec.bump === 0) return null;

    const size = resolutionFor(this.quality, spec.pattern);
    const albedo = new DynamicTexture(`tex-${key}`, { width: size, height: size }, this.scene, true);
    const context = albedo.getContext() as unknown as Canvas2D;
    // Patterns are drawn in mid grey and tinted by albedoColor, so one texture serves every colour.
    drawPattern(context, size, spec.pattern, new Color3(0.72, 0.72, 0.72), seed + 1);
    albedo.update(true);
    albedo.wrapU = Texture.WRAP_ADDRESSMODE;
    albedo.wrapV = Texture.WRAP_ADDRESSMODE;
    /**
     * Anisotropic filtering, on every tier.
     *
     * This was 1 at LOW, and it is the direct cause of "the texturing looks bad on mobile": a road
     * surface is viewed at an extreme grazing angle for the entire race, which is precisely the case
     * isotropic filtering cannot handle — the tarmac smears into grey mush a few metres ahead. It is
     * a sampler setting, not geometry or fill rate, and on the one surface that fills half the screen
     * it is the cheapest visual win available.
     */
    albedo.anisotropicFilteringLevel = this.quality === "LOW" ? 4 : 8;
    albedo.uScale = 1 / tile;
    albedo.vScale = 1 / tile;

    /**
     * Derived at every tier.
     *
     * This was skipped at LOW, which combined with the baked maps also being gated meant a
     * low-tier device rendered every surface as flat colour. It is generated once during load and
     * costs a texture fetch per pixel afterwards — the gate bought a few milliseconds of startup and
     * lost the entire material read of the game.
     */
    const normal =
      spec.bump > 0 ? deriveNormal(this.scene, albedo, size, spec.bump * 2.4, `nrm-${key}`) : null;
    if (normal) {
      normal.wrapU = Texture.WRAP_ADDRESSMODE;
      normal.wrapV = Texture.WRAP_ADDRESSMODE;
      normal.uScale = 1 / tile;
      normal.vScale = 1 / tile;
    }

    const maps = { albedo, normal };
    this.textures.set(key, maps);
    return maps;
  }

  /** Unlit emissive material, for neon tubes, boost arrows and HUD-adjacent world markers. */
  glow(name: string, color: string, intensity = 1): StandardMaterial {
    const material = new StandardMaterial(`glow-${name}`, this.scene);
    const base = Color3.FromHexString(color);
    material.diffuseColor = base.scale(0.2);
    material.emissiveColor = base.scale(intensity);
    material.specularColor = Color3.Black();
    material.disableLighting = true;
    return material;
  }

  dispose(): void {
    this.cache.forEach((material) => material.dispose());
    this.textures.forEach((maps) => {
      maps.albedo.dispose();
      maps.normal?.dispose();
    });
    // The clones are disposed; the catalog owns the sources and disposes those itself.
    this.scaled.forEach((texture) => texture.dispose());
    this.cache.clear();
    this.textures.clear();
    this.scaled.clear();
  }
}
