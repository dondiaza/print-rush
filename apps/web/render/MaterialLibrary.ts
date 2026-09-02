import { Color3, DynamicTexture, PBRMaterial, Scene, StandardMaterial, Texture } from "@babylonjs/core";

/**
 * MATERIAL LIBRARY V5.
 *
 * The audit found zero image textures and zero normal maps in the entire V4 project: every surface
 * was a `PBRMaterial` with a flat `albedoColor` and, with no environment texture bound, nothing to
 * reflect. Metal, fabric, cardboard and floor all responded to light identically. That is the single
 * largest reason the game read as a prototype.
 *
 * Every texture here is generated procedurally into a canvas at startup and cached. That choice is
 * deliberate: the project ships as a static export, so downloading a texture set would add megabytes
 * and a loading screen. Procedural generation costs a few milliseconds per class, produces real
 * albedo, normal and roughness maps, and means a material can be re-tuned by changing a number.
 *
 * The fifteen classes and their parameters are normative — see `docs/ART_BIBLE_V5.md` section 4.
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
};

/**
 * Builds and caches materials for one scene. Cached by class, colour and tiling, which is what keeps
 * the unique-material count inside the 40-material budget the art bible sets: a hundred cardboard
 * boxes in six colours share six materials and vary per instance.
 */
export class MaterialLibrary {
  private readonly cache = new Map<string, PBRMaterial>();
  private readonly textures = new Map<string, { albedo: DynamicTexture; normal: DynamicTexture | null }>();

  constructor(private readonly scene: Scene, private readonly quality: MaterialQuality = "HIGH") {}

  get size(): number {
    return this.cache.size;
  }

  /** Number of generated textures. Reported by the performance lab. */
  get textureCount(): number {
    return this.textures.size;
  }

  get(request: MaterialRequest): PBRMaterial {
    const spec = SPECS[request.materialClass];
    const tile = request.tile ?? spec.tile;
    const key = `${request.materialClass}|${request.color}|${tile}|${request.seed ?? 0}|${request.emissive ?? ""}`;
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
      const maps = this.textureFor(request.materialClass, request.seed ?? 0);
      if (maps) {
        const scale = 1 / tile;
        maps.albedo.uScale = scale;
        maps.albedo.vScale = scale;
        material.albedoTexture = maps.albedo;
        // The albedo texture is greyscale variation; the colour still comes from albedoColor.
        material.useAlphaFromAlbedoTexture = false;
        if (maps.normal && this.quality !== "LOW") {
          maps.normal.uScale = scale;
          maps.normal.vScale = scale;
          material.bumpTexture = maps.normal;
          material.invertNormalMapY = true;
        }
      }
    }

    this.cache.set(key, material);
    return material;
  }

  /** Textures are shared across every colour of a class, which is where most of the saving is. */
  private textureFor(materialClass: MaterialClass, seed: number): { albedo: DynamicTexture; normal: DynamicTexture | null } | null {
    const key = `${materialClass}|${seed}`;
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
    albedo.anisotropicFilteringLevel = this.quality === "LOW" ? 1 : 4;

    const normal =
      spec.bump > 0 && this.quality !== "LOW"
        ? deriveNormal(this.scene, albedo, size, spec.bump * 2.4, `nrm-${key}`)
        : null;
    if (normal) {
      normal.wrapU = Texture.WRAP_ADDRESSMODE;
      normal.wrapV = Texture.WRAP_ADDRESSMODE;
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
    this.cache.clear();
    this.textures.clear();
  }
}
