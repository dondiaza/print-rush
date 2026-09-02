import type { CharacterAppearance, CharacterRuntime } from "@print-rush/character-core";
import { createDefaultCharacter, type CharacterDefinition } from "@print-rush/3d-factory";

/**
 * FROM A SAVED CHARACTER TO THE RENDERER.
 *
 * Two models describe a person here, and that is not an accident to be tidied away later:
 *
 *  - `CharacterAppearance` is what a player *chooses* — twenty-odd slots with names like `top` and
 *    `accessoryHead`, designed to be edited, validated and versioned.
 *  - `CharacterDefinition` is what the mesh generator *needs* — a hundred continuous parameters like
 *    `jawRoundness` and `cheekVolume`, designed to build geometry.
 *
 * Collapsing them into one would mean either exposing `foreheadHeight` in the studio, which nobody
 * wants to set, or throwing away the detail the generator uses. So this maps one onto the other, and
 * the mapping is the only place that has to know both vocabularies.
 *
 * The direction is deliberately one-way. A saved character is the source of truth; the definition is
 * derived and disposable, rebuilt whenever the appearance changes.
 */

/** Appearance body presets to the generator's, which are named differently and are one fewer. */
const BODY_PRESET: Record<CharacterAppearance["bodyPreset"], CharacterDefinition["body"]["preset"]> = {
  BALANCED: "STANDARD",
  SLIM: "SLIM",
  // The generator has no separate athletic build, and `BROAD` with a narrower torso is closer to it
  // than `STANDARD` is — the shoulder multiplier below does the rest.
  ATHLETIC: "BROAD",
  BROAD: "BROAD",
  SHORT: "SHORT",
  TALL: "TALL",
};

const HAIR: Record<CharacterAppearance["hairStyle"], CharacterDefinition["hair"]["style"]> = {
  BALD: "BALD",
  SHORT_01: "SHORT",
  SHORT_02: "CREW",
  MEDIUM_01: "MEDIUM",
  MEDIUM_02: "WAVY_MEDIUM",
  LONG_01: "LONG",
  CURLY_01: "CURLY_MEDIUM",
  TIED_01: "PONYTAIL",
};

const BEARD: Record<CharacterAppearance["facialHair"], CharacterDefinition["facialHair"]["style"]> = {
  NONE: "NONE",
  STUBBLE: "STUBBLE",
  SHORT: "SHORT",
  FULL: "FULL",
  MOUSTACHE: "MUSTACHE",
};

const SHIRT: Record<CharacterAppearance["top"], CharacterDefinition["shirt"]["model"]> = {
  TEE: "TSHIRT",
  HOODIE: "HOODIE",
  SHIRT: "TSHIRT",
  // A racing suit is closest to a zipped jacket in the generator's wardrobe.
  RACING_SUIT: "JACKET",
  POLO: "TSHIRT",
};

const PANTS: Record<CharacterAppearance["bottom"], CharacterDefinition["pants"]["style"]> = {
  JEANS: "JEANS",
  CARGO: "CHINO",
  TRACK: "JOGGER",
  RACING_SUIT: "JOGGER",
  SHORTS: "CHINO",
};

const SHOES: Record<CharacterAppearance["shoes"], CharacterDefinition["shoes"]["style"]> = {
  TRAINERS: "RUNNER",
  BOOTS: "HIGH_TOP",
  RACING: "CLASSIC",
  CANVAS: "CLASSIC",
};

const DESIGN: Record<CharacterAppearance["shirtDesign"], CharacterDefinition["shirt"]["frontDesign"]> = {
  NONE: "NONE",
  BOLT: "INK_BOLT",
  WAVE: "THREAD_WAVE",
  HALFTONE: "PRINT_SKULL",
  SPLAT: "PACKAGE_CAT",
};

/** Which generator accessories an appearance's four slots imply. */
function accessoriesOf(appearance: CharacterAppearance): CharacterDefinition["accessories"] {
  const list: CharacterDefinition["accessories"] = [];
  if (appearance.accessoryHead === "CAP" || appearance.accessoryHead === "BEANIE") list.push("CAP");
  if (appearance.accessoryHead === "HEADSET") list.push("HEADPHONES");
  if (appearance.accessoryBack === "BACKPACK") list.push("BACKPACK");
  if (appearance.accessoryWrist === "WATCH") list.push("WATCH");
  return list;
}

/**
 * Builds a renderable definition from a saved appearance.
 *
 * Starts from the generator's own default so every parameter the studio does not express keeps a
 * sensible value — that is what stops a new field in `CharacterDefinition` from producing a
 * character with a zero-width jaw.
 *
 * The body multipliers are applied on top of the preset rather than replacing it, so a player who
 * picks `ATHLETIC` and then widens the shoulders gets both.
 */
export function toDefinition(
  runtime: Pick<CharacterRuntime, "id" | "name" | "appearance">,
): CharacterDefinition {
  const appearance = runtime.appearance;
  const base = createDefaultCharacter();

  return {
    ...base,
    id: runtime.id,
    name: runtime.name,
    // `PHOTO` when a face texture exists is tempting, but this field describes how the *geometry*
    // was authored, and it was authored from the studio's controls either way.
    source: "MANUAL",
    body: {
      ...base.body,
      preset: BODY_PRESET[appearance.bodyPreset],
      height: base.body.height * appearance.heightScale,
      shoulderWidth: base.body.shoulderWidth * appearance.shoulderWidth,
      torsoWidth: base.body.torsoWidth * appearance.bodyWidth,
      legLength: base.body.legLength * appearance.legLength,
      headScale: base.body.headScale * appearance.headScale,
    },
    face: {
      ...base.face,
      skinTone: appearance.skinTone,
      eyes: {
        ...base.face.eyes,
        // The four eye styles map to the two parameters that actually change the read at kart
        // distance: how open the eye is and how it is angled.
        height: base.face.eyes.height * (appearance.eyeStyle === "NARROW" ? 0.86 : appearance.eyeStyle === "WIDE" ? 1.14 : 1),
        angle: appearance.eyeStyle === "FOCUSED" ? base.face.eyes.angle - 4 : base.face.eyes.angle,
      },
      eyebrows: {
        ...base.face.eyebrows,
        preset:
          appearance.eyebrowStyle === "THICK"
            ? "THICK"
            : appearance.eyebrowStyle === "THIN"
              ? "THIN"
              : appearance.eyebrowStyle === "ANGLED"
                ? "ARCHED"
                : "STRAIGHT",
        color: appearance.hairColor,
      },
    },
    hair: { ...base.hair, style: HAIR[appearance.hairStyle], color: appearance.hairColor },
    facialHair: { ...base.facialHair, style: BEARD[appearance.facialHair], color: appearance.hairColor },
    glasses: {
      ...base.glasses,
      style:
        appearance.accessoryFace === "GLASSES"
          ? "RECTANGULAR"
          : appearance.accessoryFace === "SUNGLASSES"
            ? "SUNGLASSES"
            : appearance.accessoryFace === "VISOR"
              ? "LARGE"
              : "NONE",
      frameColor: appearance.accentColor,
    },
    shirt: {
      ...base.shirt,
      model: SHIRT[appearance.top],
      baseColor: appearance.primaryColor,
      sleeveColor: appearance.secondaryColor,
      collarColor: appearance.accentColor,
      frontDesign: DESIGN[appearance.shirtDesign],
    },
    pants: { ...base.pants, style: PANTS[appearance.bottom], color: appearance.secondaryColor },
    shoes: { ...base.shoes, style: SHOES[appearance.shoes], color: appearance.accentColor },
    accessories: accessoriesOf(appearance),
    /**
     * No photograph metadata.
     *
     * The generator's `photo` field describes an older pipeline that analysed landmarks. This one
     * does not: the face arrives as a finished texture and the geometry is built from the studio's
     * controls, so claiming a photo analysis happened would be a false record.
     */
    photo: null,
  };
}
