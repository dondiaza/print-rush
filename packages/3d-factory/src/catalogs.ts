import type { BeardStyle, BodyPreset, GlassesStyle, HairStyle, RuntimeQuality, ShirtDesignId } from "./types.js";

export const WorldScaleConfig = Object.freeze({
  characterHeight: 1.72,
  kartLength: 2.35,
  kartWidth: 1.55,
  wheelDiameter: 0.48,
  trackLaneWidth: 4.8,
  doorHeight: 2.2,
});

export const HairLibrary: readonly HairStyle[] = [
  "BALD", "BUZZ", "CREW", "SHORT", "PIXIE", "SIDE_PART", "SLICKED", "UNDERCUT", "MESSY_SHORT", "CURLY_SHORT",
  "WAVY_SHORT", "BOB", "MEDIUM", "MESSY_MEDIUM", "CURLY_MEDIUM", "WAVY_MEDIUM", "SHAG", "LONG", "LONG_WAVY",
  "LONG_CURLY", "PONYTAIL", "HIGH_PONYTAIL", "BUN", "DOUBLE_BUN", "BRAID", "AFRO", "AFRO_SHORT", "MOHAWK", "RECEDING", "LOCS",
] as const;

export const BeardLibrary: readonly BeardStyle[] = ["NONE", "STUBBLE", "MUSTACHE", "GOATEE", "SHORT", "MEDIUM", "FULL"];
export const GlassesLibrary: readonly GlassesStyle[] = ["NONE", "RECTANGULAR", "ROUND", "LARGE", "THIN", "SUNGLASSES"];
export const BodyPresets: readonly BodyPreset[] = ["SLIM", "STANDARD", "BROAD", "SHORT", "TALL"];
export const ShirtDesigns: readonly ShirtDesignId[] = ["NONE", "INK_BOLT", "THREAD_WAVE", "PRINT_SKULL", "PACKAGE_CAT", "CUSTOM"];

export const PrintRushPalettes = Object.freeze({
  flagship: ["#ff3da6", "#b9ff45", "#f7f2e8", "#15141b", "#4db7ff"],
  factory: ["#ff6a24", "#31d6c7", "#f6df8a", "#24232d", "#8f5cff"],
  warehouse: ["#f7c948", "#e95d52", "#edf2f4", "#1f2937", "#5cc8ff"],
});

export const QualityProfiles: Record<RuntimeQuality, {
  renderScale: number;
  shadows: number;
  particles: number;
  lodBias: number;
  maxLights: number;
  textureSize: number;
  targetFps: 30 | 60;
}> = {
  LOW: { renderScale: .68, shadows: 0, particles: .35, lodBias: .65, maxLights: 1, textureSize: 256, targetFps: 30 },
  MEDIUM: { renderScale: .82, shadows: 1, particles: .62, lodBias: .82, maxLights: 2, textureSize: 512, targetFps: 60 },
  HIGH: { renderScale: 1, shadows: 2, particles: 1, lodBias: 1, maxLights: 3, textureSize: 1024, targetFps: 60 },
  ULTRA: { renderScale: 1, shadows: 3, particles: 1.25, lodBias: 1.2, maxLights: 4, textureSize: 1024, targetFps: 60 },
};
