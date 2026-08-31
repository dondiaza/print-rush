import type { KartDefinition, ValidationIssue } from "./types.js";
import { clamp, hashDefinition, isHexColor, pick, SeededFactoryRandom } from "./utils.js";

const defaultKart: KartDefinition = {
  schemaVersion: 2, generatorVersion: "2.0.0", id: "kart-press-01", name: "Press Runner", seed: 17,
  body: "CLASSIC", nose: "ROUND", spoiler: "WING", wheel: "CLASSIC", rim: "FIVE_SPOKE", antenna: "SHIRT",
  primaryColor: "#ff3da6", secondaryColor: "#b9ff45", rimColor: "#f7f2e8", decal: "BOLT", number: 7,
  finish: "GLOSS", compatibility: { driverScale: 1, seatHeight: .62, handTarget: .78 },
};

export function createDefaultKart(): KartDefinition { return structuredClone(defaultKart); }

export function normalizeKart(input: KartDefinition): KartDefinition {
  const result = structuredClone(input);
  result.name = result.name.replace(/[^\p{L}\p{N} _-]/gu, "").trim().slice(0, 24) || "Press Runner";
  result.number = Math.max(0, Math.min(99, Math.round(result.number)));
  result.compatibility.driverScale = clamp(result.compatibility.driverScale, .9, 1.1);
  result.compatibility.seatHeight = clamp(result.compatibility.seatHeight, .52, .76);
  result.compatibility.handTarget = clamp(result.compatibility.handTarget, .68, .9);
  return result;
}

export function validateKart(input: KartDefinition): ValidationIssue[] {
  const issues: ValidationIssue[] = [];
  if (input.schemaVersion !== 2) issues.push({ path: "schemaVersion", message: "Unsupported kart schema", severity: "ERROR" });
  if (![input.primaryColor, input.secondaryColor, input.rimColor].every(isHexColor)) issues.push({ path: "colors", message: "Kart colors must be valid hex colors", severity: "ERROR" });
  if (normalizeKart(input).number !== input.number) issues.push({ path: "number", message: "Kart number must be between 0 and 99", severity: "WARNING" });
  return issues;
}

export function randomKart(seed: number, name = "Factory Kart"): KartDefinition {
  const random = new SeededFactoryRandom(seed);
  const colors = ["#ff3da6", "#b9ff45", "#4db7ff", "#ff7b2f", "#8f5cff", "#f7f2e8"];
  const kart = createDefaultKart();
  kart.id = `kart-${hashDefinition({ seed, name })}`;
  kart.name = name;
  kart.seed = seed >>> 0;
  kart.body = pick(["CLASSIC", "PACKAGE", "SPRINT", "ROLLER", "INK_TANK"] as const, random);
  kart.nose = pick(["ROUND", "WEDGE", "BOX", "TWIN"] as const, random);
  kart.spoiler = pick(["NONE", "LOW", "WING", "DOUBLE"] as const, random);
  kart.wheel = pick(["CLASSIC", "CHUNKY", "SLICK", "OFFROAD", "ROLLER"] as const, random);
  kart.rim = pick(["DISC", "FIVE_SPOKE", "STAR", "INK_SPLAT"] as const, random);
  kart.antenna = pick(["NONE", "BALL", "SHIRT", "FLAG"] as const, random);
  kart.primaryColor = pick(colors, random);
  kart.secondaryColor = pick(colors.filter((color) => color !== kart.primaryColor), random);
  kart.rimColor = pick(colors, random);
  kart.decal = pick(["NONE", "BOLT", "STRIPES", "INK", "NUMBER"] as const, random);
  kart.number = Math.floor(random.range(1, 100));
  kart.finish = pick(["MATTE", "GLOSS", "METALLIC", "PEARL"] as const, random);
  return normalizeKart(kart);
}
