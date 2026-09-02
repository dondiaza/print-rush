import type {
  BackAccessoryId,
  BodyPresetId,
  BottomId,
  CharacterAppearance,
  EyebrowStyleId,
  EyeStyleId,
  FaceAccessoryId,
  FacialHairId,
  GlovesId,
  HairStyleId,
  HeadwearId,
  JacketId,
  ShirtDesignId,
  ShoesId,
  TopId,
  WristAccessoryId,
} from "./types.js";

/**
 * The catalogues, and the limits on what a player can do to a body.
 *
 * Every option list here is the single source of truth for three things at once: what the editor
 * offers, what the validator accepts, and what the renderer knows how to build. Keeping them in one
 * place is what stops the classic drift where the editor offers a hairstyle the renderer ignores —
 * which reads to a player as the control being broken.
 */

export const BODY_PRESETS: readonly BodyPresetId[] = [
  "BALANCED",
  "SLIM",
  "ATHLETIC",
  "BROAD",
  "SHORT",
  "TALL",
];

export const HAIR_STYLES: readonly HairStyleId[] = [
  "BALD",
  "SHORT_01",
  "SHORT_02",
  "MEDIUM_01",
  "MEDIUM_02",
  "LONG_01",
  "CURLY_01",
  "TIED_01",
];

export const FACIAL_HAIR: readonly FacialHairId[] = ["NONE", "STUBBLE", "SHORT", "FULL", "MOUSTACHE"];
export const EYE_STYLES: readonly EyeStyleId[] = ["NEUTRAL", "WIDE", "NARROW", "FOCUSED"];
export const EYEBROW_STYLES: readonly EyebrowStyleId[] = ["NEUTRAL", "THICK", "THIN", "ANGLED"];

export const TOPS: readonly TopId[] = ["TEE", "HOODIE", "SHIRT", "RACING_SUIT", "POLO"];
export const SHIRT_DESIGNS: readonly ShirtDesignId[] = ["NONE", "BOLT", "WAVE", "HALFTONE", "SPLAT"];
export const BOTTOMS: readonly BottomId[] = ["JEANS", "CARGO", "TRACK", "RACING_SUIT", "SHORTS"];
export const SHOES: readonly ShoesId[] = ["TRAINERS", "BOOTS", "RACING", "CANVAS"];
export const GLOVES: readonly GlovesId[] = ["NONE", "RACING", "WORK"];
export const JACKETS: readonly JacketId[] = ["NONE", "BOMBER", "HIVIS", "DENIM"];

export const HEADWEAR: readonly HeadwearId[] = ["NONE", "CAP", "HELMET", "BEANIE", "HEADSET"];
export const FACE_ACCESSORIES: readonly FaceAccessoryId[] = ["NONE", "GLASSES", "SUNGLASSES", "VISOR"];
export const BACK_ACCESSORIES: readonly BackAccessoryId[] = ["NONE", "BACKPACK", "TUBE", "FLAG"];
export const WRIST_ACCESSORIES: readonly WristAccessoryId[] = ["NONE", "WATCH", "BAND"];

/**
 * Accessory pairs that clip badly enough to be worth refusing.
 *
 * Not a style opinion — these are combinations where two meshes occupy the same space and the result
 * looks broken rather than eccentric. A helmet over a beanie is the obvious one; a visor under a
 * full helmet is the same problem on the face slot.
 */
export const ACCESSORY_CONFLICTS: ReadonlyArray<readonly [HeadwearId, FaceAccessoryId]> = [
  ["HELMET", "VISOR"],
  ["HELMET", "SUNGLASSES"],
];

/**
 * Bounds on the body proportions.
 *
 * Chosen against three hard constraints, not aesthetics: the driver has to sit in the kart, the
 * hands have to reach the wheel that kart actually has, and the head must not pass through the roll
 * bar. Outside these the model is not stylised, it is broken. Since the collider is identical for
 * everyone, a wider range would give a player nothing but a worse-looking driver.
 */
export const APPEARANCE_LIMITS = {
  heightScale: { min: 0.88, max: 1.12, default: 1 },
  bodyWidth: { min: 0.85, max: 1.2, default: 1 },
  shoulderWidth: { min: 0.85, max: 1.18, default: 1 },
  headScale: { min: 0.92, max: 1.1, default: 1 },
  legLength: { min: 0.9, max: 1.1, default: 1 },
} as const;

/** The proportion multipliers a preset applies before the player's own adjustments. */
export const BODY_PRESET_SHAPE: Record<
  BodyPresetId,
  Pick<CharacterAppearance, "heightScale" | "bodyWidth" | "shoulderWidth" | "legLength">
> = {
  BALANCED: { heightScale: 1, bodyWidth: 1, shoulderWidth: 1, legLength: 1 },
  SLIM: { heightScale: 1.01, bodyWidth: 0.89, shoulderWidth: 0.93, legLength: 1.03 },
  ATHLETIC: { heightScale: 1.02, bodyWidth: 1.02, shoulderWidth: 1.12, legLength: 1.01 },
  BROAD: { heightScale: 0.99, bodyWidth: 1.16, shoulderWidth: 1.15, legLength: 0.96 },
  SHORT: { heightScale: 0.9, bodyWidth: 1.04, shoulderWidth: 1, legLength: 0.92 },
  TALL: { heightScale: 1.1, bodyWidth: 0.96, shoulderWidth: 1.03, legLength: 1.08 },
};

/**
 * Skin tones offered by the editor.
 *
 * A fixed, deliberately broad list rather than a free colour picker. A free picker on skin tone
 * invites results that look like a mistake, and a short list makes the range explicit and even.
 */
export const SKIN_TONES: readonly string[] = [
  "#f7dcc0",
  "#f0c8a8",
  "#e6b48c",
  "#d99b72",
  "#c98a5e",
  "#a9714a",
  "#8d5a3b",
  "#6b4228",
  "#4e2f1c",
];

export const HAIR_COLORS: readonly string[] = [
  "#1b1622",
  "#2b2118",
  "#4a3423",
  "#6b4a2a",
  "#8a6a3f",
  "#c9a45e",
  "#e0d3b8",
  "#9aa0ab",
  "#ff3da6",
  "#65d8ff",
  "#b9ff45",
  "#8f5cff",
];

/** The brand palette. Kit colours come from here so a grid never clashes with the circuits. */
export const KIT_COLORS: readonly string[] = [
  "#ff3da6",
  "#65d8ff",
  "#b9ff45",
  "#ffd43b",
  "#8f5cff",
  "#ff6b2c",
  "#f7f2e8",
  "#2b2732",
  "#3e6e9e",
  "#c9563f",
];

/**
 * The appearance a quick creation produces.
 *
 * The brief's fast path asks for name plus photo and nothing else, so this has to be a complete,
 * good-looking character on its own — not a grey mannequin waiting to be finished.
 */
export const DEFAULT_APPEARANCE: CharacterAppearance = {
  skinTone: "#e6b48c",
  hairStyle: "SHORT_01",
  hairColor: "#2b2118",
  eyeStyle: "NEUTRAL",
  eyebrowStyle: "NEUTRAL",
  facialHair: "NONE",

  bodyPreset: "BALANCED",
  heightScale: 1,
  bodyWidth: 1,
  shoulderWidth: 1,
  headScale: 1,
  legLength: 1,

  top: "TEE",
  shirtDesign: "BOLT",
  bottom: "JEANS",
  shoes: "TRAINERS",
  gloves: "NONE",
  jacket: "NONE",

  accessoryHead: "NONE",
  accessoryFace: "NONE",
  accessoryBack: "NONE",
  accessoryWrist: "NONE",

  primaryColor: "#ff3da6",
  secondaryColor: "#65d8ff",
  accentColor: "#ffd43b",
};

/**
 * The character every failure falls back to.
 *
 * Required by the brief and by common sense: a race must start even when a face texture 404s, a
 * character was deleted mid-lobby, or a rival's payload never arrived. It carries no face, so it
 * needs no network at all.
 */
export const FALLBACK_CHARACTER_ID = "fallback-driver";

export const FALLBACK_APPEARANCE: CharacterAppearance = {
  ...DEFAULT_APPEARANCE,
  hairStyle: "SHORT_02",
  hairColor: "#4a3423",
  top: "RACING_SUIT",
  shirtDesign: "NONE",
  bottom: "RACING_SUIT",
  shoes: "RACING",
  gloves: "RACING",
  accessoryHead: "HELMET",
  primaryColor: "#8f5cff",
  secondaryColor: "#f7f2e8",
  accentColor: "#ff6b2c",
};
