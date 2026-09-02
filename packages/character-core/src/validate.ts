import {
  ACCESSORY_CONFLICTS,
  APPEARANCE_LIMITS,
  BACK_ACCESSORIES,
  BODY_PRESETS,
  BOTTOMS,
  DEFAULT_APPEARANCE,
  EYEBROW_STYLES,
  EYE_STYLES,
  FACE_ACCESSORIES,
  FACIAL_HAIR,
  GLOVES,
  HAIR_COLORS,
  HAIR_STYLES,
  HEADWEAR,
  JACKETS,
  KIT_COLORS,
  SHIRT_DESIGNS,
  SHOES,
  SKIN_TONES,
  TOPS,
  WRIST_ACCESSORIES,
} from "./presets.js";
import type { CharacterAppearance } from "./types.js";

/**
 * Validation, and the normalisation that goes with it.
 *
 * Two rules shape this file:
 *
 *  1. **Never reject a character over a cosmetic field.** A stored appearance from an older schema,
 *     or a client that sent `hairStyle: "SHORT_03"` after a rename, must not make a character
 *     unopenable. Unknown enum values fall back to the default and are *reported*, so the editor can
 *     say what it changed rather than silently losing the choice.
 *  2. **Do reject what would corrupt data or break the game.** An empty name, a malformed colour, a
 *     proportion outside the limits that keep the driver in the kart — those are errors.
 *
 * The distinction matters because this runs on the server, where the alternative to normalising is a
 * 500 and a character the owner can no longer edit.
 */

export type ValidationIssue = {
  path: string;
  message: string;
  severity: "ERROR" | "WARNING";
};

export type ValidationResult<T> = {
  value: T;
  issues: ValidationIssue[];
  ok: boolean;
};

const HEX = /^#[0-9a-f]{6}$/i;

/** Names are shown to other players, so they are trimmed, length-bounded and stripped of controls. */
export function validateName(input: unknown): ValidationResult<string> {
  const issues: ValidationIssue[] = [];
  const raw = typeof input === "string" ? input : "";
  // Control characters and zero-width joiners are removed rather than rejected: they are almost
  // always a paste artefact, not something a person typed on purpose.
  const cleaned = raw.replace(/[\u0000-\u001f\u007f\u200b-\u200f\u2028\u2029\ufeff]/g, "").trim();

  if (cleaned.length === 0) {
    issues.push({ path: "name", message: "El personaje necesita un nombre.", severity: "ERROR" });
  }
  if (cleaned.length > 50) {
    issues.push({ path: "name", message: "El nombre no puede pasar de 50 caracteres.", severity: "ERROR" });
  }
  return { value: cleaned.slice(0, 50), issues, ok: issues.every((issue) => issue.severity !== "ERROR") };
}

/**
 * A URL-safe slug.
 *
 * Derived from the name but never used as a storage path — the brief is explicit that a person's
 * name must not end up in a public file path, and this is only for readable URLs in the studio.
 */
export function slugify(name: string): string {
  const base = name
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 40);
  return base.length > 0 ? base : "piloto";
}

function pickEnum<T extends string>(
  value: unknown,
  allowed: readonly T[],
  fallback: T,
  path: string,
  issues: ValidationIssue[],
): T {
  if (typeof value === "string" && (allowed as readonly string[]).includes(value)) return value as T;
  if (value !== undefined && value !== null) {
    issues.push({
      path,
      message: `"${String(value)}" ya no existe; se ha usado ${fallback}.`,
      severity: "WARNING",
    });
  }
  return fallback;
}

function pickColor(
  value: unknown,
  palette: readonly string[] | null,
  fallback: string,
  path: string,
  issues: ValidationIssue[],
): string {
  if (typeof value !== "string" || !HEX.test(value)) {
    if (value !== undefined && value !== null) {
      issues.push({ path, message: "El color debe ser un hex de seis dígitos.", severity: "ERROR" });
    }
    return fallback;
  }
  const normalised = value.toLowerCase();
  /**
   * Palette membership is a warning, not an error.
   *
   * The editor only offers palette colours, so an off-palette value means either an older character
   * or a hand-edited payload. Neither is worth refusing — the colour is still valid and renderable,
   * and rejecting it would lock the owner out of their own character.
   */
  if (palette && !palette.map((entry) => entry.toLowerCase()).includes(normalised)) {
    issues.push({ path, message: "Color fuera de la paleta del juego.", severity: "WARNING" });
  }
  return normalised;
}

function pickNumber(
  value: unknown,
  limit: { min: number; max: number; default: number },
  path: string,
  issues: ValidationIssue[],
): number {
  if (typeof value !== "number" || !Number.isFinite(value)) {
    if (value !== undefined && value !== null) {
      issues.push({ path, message: "Debe ser un número.", severity: "ERROR" });
    }
    return limit.default;
  }
  if (value < limit.min || value > limit.max) {
    // Clamped, not rejected. The limits exist so the driver fits the kart; a value outside them is
    // corrected to the nearest one that does, and the owner is told.
    issues.push({
      path,
      message: `Fuera del rango permitido (${limit.min}–${limit.max}); ajustado.`,
      severity: "WARNING",
    });
    return Math.min(limit.max, Math.max(limit.min, value));
  }
  // Two decimals: these are multipliers, and storing 1.0000000000000002 helps nobody.
  return Math.round(value * 100) / 100;
}

/**
 * Validates and normalises an appearance.
 *
 * Always returns a complete, renderable appearance. `ok` is false only when something was genuinely
 * wrong rather than merely unknown, and `issues` explains every change that was made.
 */
export function validateAppearance(input: unknown): ValidationResult<CharacterAppearance> {
  const issues: ValidationIssue[] = [];
  const raw = (typeof input === "object" && input !== null ? input : {}) as Record<string, unknown>;
  const d = DEFAULT_APPEARANCE;

  const value: CharacterAppearance = {
    skinTone: pickColor(raw.skinTone, SKIN_TONES, d.skinTone, "skinTone", issues),
    hairStyle: pickEnum(raw.hairStyle, HAIR_STYLES, d.hairStyle, "hairStyle", issues),
    hairColor: pickColor(raw.hairColor, HAIR_COLORS, d.hairColor, "hairColor", issues),
    eyeStyle: pickEnum(raw.eyeStyle, EYE_STYLES, d.eyeStyle, "eyeStyle", issues),
    eyebrowStyle: pickEnum(raw.eyebrowStyle, EYEBROW_STYLES, d.eyebrowStyle, "eyebrowStyle", issues),
    facialHair: pickEnum(raw.facialHair, FACIAL_HAIR, d.facialHair, "facialHair", issues),

    bodyPreset: pickEnum(raw.bodyPreset, BODY_PRESETS, d.bodyPreset, "bodyPreset", issues),
    heightScale: pickNumber(raw.heightScale, APPEARANCE_LIMITS.heightScale, "heightScale", issues),
    bodyWidth: pickNumber(raw.bodyWidth, APPEARANCE_LIMITS.bodyWidth, "bodyWidth", issues),
    shoulderWidth: pickNumber(raw.shoulderWidth, APPEARANCE_LIMITS.shoulderWidth, "shoulderWidth", issues),
    headScale: pickNumber(raw.headScale, APPEARANCE_LIMITS.headScale, "headScale", issues),
    legLength: pickNumber(raw.legLength, APPEARANCE_LIMITS.legLength, "legLength", issues),

    top: pickEnum(raw.top, TOPS, d.top, "top", issues),
    shirtDesign: pickEnum(raw.shirtDesign, SHIRT_DESIGNS, d.shirtDesign, "shirtDesign", issues),
    bottom: pickEnum(raw.bottom, BOTTOMS, d.bottom, "bottom", issues),
    shoes: pickEnum(raw.shoes, SHOES, d.shoes, "shoes", issues),
    gloves: pickEnum(raw.gloves, GLOVES, d.gloves, "gloves", issues),
    jacket: pickEnum(raw.jacket, JACKETS, d.jacket, "jacket", issues),

    accessoryHead: pickEnum(raw.accessoryHead, HEADWEAR, d.accessoryHead, "accessoryHead", issues),
    accessoryFace: pickEnum(raw.accessoryFace, FACE_ACCESSORIES, d.accessoryFace, "accessoryFace", issues),
    accessoryBack: pickEnum(raw.accessoryBack, BACK_ACCESSORIES, d.accessoryBack, "accessoryBack", issues),
    accessoryWrist: pickEnum(raw.accessoryWrist, WRIST_ACCESSORIES, d.accessoryWrist, "accessoryWrist", issues),

    primaryColor: pickColor(raw.primaryColor, KIT_COLORS, d.primaryColor, "primaryColor", issues),
    secondaryColor: pickColor(raw.secondaryColor, KIT_COLORS, d.secondaryColor, "secondaryColor", issues),
    accentColor: pickColor(raw.accentColor, KIT_COLORS, d.accentColor, "accentColor", issues),
  };

  /**
   * Clipping conflicts, resolved rather than refused.
   *
   * A helmet plus sunglasses is two meshes in one space. The head slot wins because it is the larger
   * silhouette and the more deliberate choice; the face slot is cleared and the owner is told.
   */
  for (const [head, face] of ACCESSORY_CONFLICTS) {
    if (value.accessoryHead === head && value.accessoryFace === face) {
      issues.push({
        path: "accessoryFace",
        message: `${face} no cabe con ${head}; se ha quitado.`,
        severity: "WARNING",
      });
      value.accessoryFace = "NONE";
    }
  }

  /**
   * A racing suit is one garment.
   *
   * Choosing it as a top and leaving jeans below produces a driver wearing half a suit. Rather than
   * refuse the combination, the other half follows — which is what the player meant.
   */
  if (value.top === "RACING_SUIT" && value.bottom !== "RACING_SUIT") {
    value.bottom = "RACING_SUIT";
    issues.push({ path: "bottom", message: "El mono de piloto es una sola pieza.", severity: "WARNING" });
  }
  if (value.bottom === "RACING_SUIT" && value.top !== "RACING_SUIT") {
    value.top = "RACING_SUIT";
    issues.push({ path: "top", message: "El mono de piloto es una sola pieza.", severity: "WARNING" });
  }
  // A print needs something to print on.
  if (value.shirtDesign !== "NONE" && value.top !== "TEE" && value.top !== "POLO") {
    value.shirtDesign = "NONE";
    issues.push({
      path: "shirtDesign",
      message: "El estampado sólo va en camiseta o polo.",
      severity: "WARNING",
    });
  }

  return { value, issues, ok: issues.every((issue) => issue.severity !== "ERROR") };
}

/** Only the errors. Handy where a caller wants to reject rather than normalise. */
export function errorsOf(issues: readonly ValidationIssue[]): ValidationIssue[] {
  return issues.filter((issue) => issue.severity === "ERROR");
}
