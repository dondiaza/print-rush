import { BeardLibrary, BodyPresets, GlassesLibrary, HairLibrary, PrintRushPalettes, ShirtDesigns } from "./catalogs.js";
import type { CharacterDefinition, ValidationIssue } from "./types.js";
import { clamp, hashDefinition, isHexColor, pick, SeededFactoryRandom } from "./utils.js";

const defaultCharacter: CharacterDefinition = {
  schemaVersion: 2,
  generatorVersion: "2.0.0",
  id: "avatar-rookie",
  name: "Rookie",
  source: "MANUAL",
  seed: 42,
  body: { preset: "STANDARD", height: 1, shoulderWidth: 1, torsoWidth: 1, torsoLength: 1, armLength: 1, legLength: 1, volume: 1, headScale: 1, handScale: 1, footScale: 1 },
  face: {
    width: 1, height: 1, jawWidth: 1, jawRoundness: .72, cheekVolume: .55, chinSize: .5, foreheadHeight: .52,
    skinTone: "#d99b72", undertone: "WARM", freckles: 0, blush: .08,
    eyes: { size: 1, spacing: 1, height: 0, angle: 0, roundness: .8, irisColor: "#563927" },
    eyebrows: { preset: "SOFT", thickness: .55, height: .52, angle: 0, color: "#38251f" },
    nose: { preset: "MEDIUM", width: .5, length: .5, tip: .5, height: .5 },
    mouth: { width: .52, lipThickness: .38, height: .46, curve: .12 },
    ears: { size: .5, height: .5, separation: .5 },
  },
  hair: { style: "MESSY_SHORT", color: "#38251f", scale: 1, volume: 1, roughness: .82 },
  facialHair: { style: "NONE", color: "#38251f", density: .7 },
  glasses: { style: "NONE", frameColor: "#17141b", lensTint: "#8fd8ff", size: 1 },
  shirt: { model: "TSHIRT", baseColor: "#f7f2e8", sleeveColor: "#f7f2e8", collarColor: "#15141b", frontDesign: "INK_BOLT", backDesign: "NONE", designScale: 1, designX: 0, designY: 0, designRotation: 0 },
  pants: { style: "JEANS", color: "#283a62" },
  shoes: { style: "RUNNER", color: "#ff3da6", soleColor: "#f7f2e8" },
  accessories: [], caricature: "NORMAL", personality: "ENERGETIC", photo: null,
};

export function createDefaultCharacter(): CharacterDefinition {
  return structuredClone(defaultCharacter);
}

export function normalizeCharacter(input: CharacterDefinition): CharacterDefinition {
  const result = structuredClone(input);
  result.name = result.name.replace(/[^\p{L}\p{N} _-]/gu, "").trim().slice(0, 24) || "Rookie";
  result.body.height = clamp(result.body.height, .9, 1.1);
  result.body.shoulderWidth = clamp(result.body.shoulderWidth, .82, 1.18);
  result.body.torsoWidth = clamp(result.body.torsoWidth, .84, 1.16);
  result.body.torsoLength = clamp(result.body.torsoLength, .9, 1.1);
  result.body.armLength = clamp(result.body.armLength, .9, 1.1);
  result.body.legLength = clamp(result.body.legLength, .9, 1.1);
  result.body.volume = clamp(result.body.volume, .82, 1.18);
  result.body.headScale = clamp(result.body.headScale, .9, 1.15);
  result.body.handScale = clamp(result.body.handScale, .9, 1.1);
  result.body.footScale = clamp(result.body.footScale, .9, 1.12);
  result.face.width = clamp(result.face.width, .82, 1.18);
  result.face.height = clamp(result.face.height, .86, 1.14);
  result.face.jawWidth = clamp(result.face.jawWidth, .78, 1.18);
  result.face.jawRoundness = clamp(result.face.jawRoundness, 0, 1);
  result.face.cheekVolume = clamp(result.face.cheekVolume, 0, 1);
  result.face.chinSize = clamp(result.face.chinSize, 0, 1);
  result.face.foreheadHeight = clamp(result.face.foreheadHeight, 0, 1);
  result.face.eyes.size = clamp(result.face.eyes.size, .72, 1.3);
  result.face.eyes.spacing = clamp(result.face.eyes.spacing, .78, 1.22);
  result.face.eyes.angle = clamp(result.face.eyes.angle, -.32, .32);
  result.hair.scale = clamp(result.hair.scale, .88, 1.12);
  result.hair.volume = clamp(result.hair.volume, .72, 1.3);
  result.glasses.size = clamp(result.glasses.size, .82, 1.18);
  result.shirt.designScale = clamp(result.shirt.designScale, .5, 1.5);
  if (result.photo) result.photo.strength = clamp(result.photo.strength, 0, 1);
  return result;
}

export function validateCharacter(input: CharacterDefinition): ValidationIssue[] {
  const issues: ValidationIssue[] = [];
  if (input.schemaVersion !== 2) issues.push({ path: "schemaVersion", message: "Unsupported character schema", severity: "ERROR" });
  if (!BodyPresets.includes(input.body.preset)) issues.push({ path: "body.preset", message: "Unknown body preset", severity: "ERROR" });
  if (!HairLibrary.includes(input.hair.style)) issues.push({ path: "hair.style", message: "Unknown hairstyle", severity: "ERROR" });
  if (!BeardLibrary.includes(input.facialHair.style)) issues.push({ path: "facialHair.style", message: "Unknown facial hair", severity: "ERROR" });
  if (!GlassesLibrary.includes(input.glasses.style)) issues.push({ path: "glasses.style", message: "Unknown glasses", severity: "ERROR" });
  for (const [path, value] of Object.entries({
    "face.skinTone": input.face.skinTone, "hair.color": input.hair.color, "shirt.baseColor": input.shirt.baseColor,
    "pants.color": input.pants.color, "shoes.color": input.shoes.color,
  })) if (!isHexColor(value)) issues.push({ path, message: "Expected a six-digit hex color", severity: "ERROR" });
  const normalized = normalizeCharacter(input);
  if (JSON.stringify(normalized.body) !== JSON.stringify(input.body)) issues.push({ path: "body", message: "Body values exceed safe rig bounds", severity: "WARNING" });
  if (input.accessories.length > 3) issues.push({ path: "accessories", message: "Race runtime supports at most three accessories", severity: "WARNING" });
  return issues;
}

export function randomCharacter(seed: number, name = "New Rider"): CharacterDefinition {
  const random = new SeededFactoryRandom(seed);
  const palette = PrintRushPalettes.flagship;
  const skin = ["#f3c6a5", "#dfa47d", "#bd7956", "#8c563b", "#5f3828"];
  const hairColors = ["#181316", "#38251f", "#6f422c", "#b9783e", "#d5b071", "#7a304d"];
  const result = createDefaultCharacter();
  result.id = `avatar-${hashDefinition({ seed, name })}`;
  result.name = name;
  result.source = "RANDOM";
  result.seed = seed >>> 0;
  result.body.preset = pick(BodyPresets, random);
  result.body.height = random.range(.92, 1.08);
  result.body.shoulderWidth = random.range(.88, 1.13);
  result.body.volume = random.range(.88, 1.14);
  result.body.headScale = random.range(.94, 1.1);
  result.face.width = random.range(.88, 1.14);
  result.face.height = random.range(.9, 1.1);
  result.face.jawWidth = random.range(.84, 1.12);
  result.face.jawRoundness = random.range(.28, .92);
  result.face.skinTone = pick(skin, random);
  result.face.undertone = pick(["COOL", "NEUTRAL", "WARM"] as const, random);
  result.face.eyes.size = random.range(.84, 1.2);
  result.face.eyes.spacing = random.range(.87, 1.14);
  result.face.eyes.irisColor = pick(["#563927", "#2d5b46", "#41658a", "#2b211d"], random);
  result.hair.style = pick(HairLibrary, random);
  result.hair.color = pick(hairColors, random);
  result.facialHair.style = random.next() > .58 ? pick(BeardLibrary, random) : "NONE";
  result.facialHair.color = result.hair.color;
  result.glasses.style = random.next() > .7 ? pick(GlassesLibrary.slice(1), random) : "NONE";
  result.shirt.baseColor = pick(palette, random);
  result.shirt.sleeveColor = result.shirt.baseColor;
  result.shirt.frontDesign = pick(ShirtDesigns, random);
  result.pants.style = pick(["JEANS", "CHINO", "JOGGER"] as const, random);
  result.pants.color = pick(["#283a62", "#27242f", "#695c43", "#4f315c"], random);
  result.shoes.style = pick(["CLASSIC", "RUNNER", "HIGH_TOP"] as const, random);
  result.shoes.color = pick(palette, random);
  result.personality = pick(["CALM", "ENERGETIC", "COOL", "FUNNY"] as const, random);
  return normalizeCharacter(result);
}

export function characterComplexityScore(definition: CharacterDefinition): number {
  let score = 1;
  if (definition.hair.style !== "BALD" && definition.hair.style !== "BUZZ") score += .35;
  if (definition.facialHair.style !== "NONE") score += .15;
  if (definition.glasses.style !== "NONE") score += .12;
  score += definition.accessories.length * .14;
  if (definition.photo?.mode === "PHOTO_FACE") score += .45;
  return Math.round(score * 100) / 100;
}
