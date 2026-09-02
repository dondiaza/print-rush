import type { Character, CharacterAppearance, CharacterSnapshot } from "./types.js";

/**
 * Versioning.
 *
 * The brief asks for a version per significant change so a character can be rolled back, and the
 * word doing the work is *significant*. With autosave on a two-second debounce, writing a version
 * for every keystroke would bury the useful history under hundreds of rows recording that someone
 * dragged a slider. So a version is written when the change is one a person would want back.
 *
 * The version number also does a second job: optimistic locking. Two tabs editing one character both
 * hold the version they loaded, and the second write to arrive is rejected rather than silently
 * overwriting the first. That is why it lives on the character rather than only on the history.
 */

/**
 * Fields whose change is worth a version.
 *
 * Everything identity-shaped, plus the choices a player would be upset to lose. The continuous
 * proportion sliders are absent on purpose — they are adjusted constantly during editing, they are
 * bounded, and a rollback to "the body was 2 % wider" is not something anyone asks for.
 */
const SIGNIFICANT_APPEARANCE_FIELDS: readonly (keyof CharacterAppearance)[] = [
  "hairStyle",
  "facialHair",
  "bodyPreset",
  "top",
  "shirtDesign",
  "bottom",
  "shoes",
  "gloves",
  "jacket",
  "accessoryHead",
  "accessoryFace",
  "accessoryBack",
  "accessoryWrist",
  "skinTone",
  "hairColor",
  "primaryColor",
  "secondaryColor",
  "accentColor",
];

/**
 * Whether the difference between two states deserves a stored version.
 *
 * Returns the reasons as well as the verdict, so the studio can tell the owner what was recorded and
 * a test can assert on cause rather than on a boolean.
 */
export function significantChanges(
  before: Pick<Character, "name" | "appearance" | "defaultKartId">,
  after: Pick<Character, "name" | "appearance" | "defaultKartId">,
): string[] {
  const reasons: string[] = [];
  if (before.name !== after.name) reasons.push("name");
  if (before.defaultKartId !== after.defaultKartId) reasons.push("defaultKartId");
  for (const field of SIGNIFICANT_APPEARANCE_FIELDS) {
    if (before.appearance[field] !== after.appearance[field]) reasons.push(field);
  }
  return reasons;
}

export function isSignificant(
  before: Pick<Character, "name" | "appearance" | "defaultKartId">,
  after: Pick<Character, "name" | "appearance" | "defaultKartId">,
): boolean {
  return significantChanges(before, after).length > 0;
}

/**
 * What a version stores.
 *
 * The face's *game texture* URL is included but the original photograph's is not. A rollback should
 * restore the face the character was wearing; it has no business carrying a second reference to a
 * colleague's photograph into the history table.
 */
export function snapshotOf(character: Character): CharacterSnapshot {
  return {
    name: character.name,
    appearance: { ...character.appearance },
    defaultKartId: character.defaultKartId,
    faceGameTextureUrl: character.face?.gameTextureUrl ?? null,
  };
}

/** Raised when a write is based on a version that is no longer current. */
export class VersionConflictError extends Error {
  constructor(readonly expected: number, readonly actual: number) {
    super(`El personaje ha cambiado en otra pestaña (versión ${actual}, esperabas ${expected}).`);
    this.name = "VersionConflictError";
  }
}
