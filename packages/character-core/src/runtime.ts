import { FALLBACK_APPEARANCE, FALLBACK_CHARACTER_ID } from "./presets.js";
import type { Character, CharacterRuntime, CharacterSummary } from "./types.js";

/**
 * The runtime projection.
 *
 * One function, and it is the privacy boundary of the whole feature. Everything a race client
 * receives about another player passes through here, so the rule is enforced in one place rather
 * than trusted to every endpoint: the original photograph and the pre-styling crop never leave the
 * studio. A rival gets the styled game texture and a thumbnail, which is all a rival needs.
 *
 * It is also the performance boundary. The brief is right that resolving a character across several
 * requests per player will stall a grid; this is what a single cacheable request returns.
 */
export function toRuntime(character: Character): CharacterRuntime {
  return {
    id: character.id,
    name: character.name,
    appearance: character.appearance,
    // Only a READY face is offered. A face still processing, or one that failed, resolves to null
    // and the renderer uses the fallback head — which is a driver with a helmet, so it reads as a
    // deliberate look rather than as a missing texture.
    faceTextureUrl: character.face?.state === "READY" ? character.face.gameTextureUrl : null,
    avatarThumbnailUrl: character.avatarThumbnailUrl,
    kartId: character.defaultKartId,
    version: character.version,
  };
}

/**
 * The runtime every failure falls back to.
 *
 * Carries no URLs at all, so it cannot itself fail to load. This is what the brief means by a race
 * that must not break: a 404 on a face texture, a character deleted while the lobby was open, or a
 * rival payload that never arrived all end up here.
 */
export const FALLBACK_RUNTIME: CharacterRuntime = {
  id: FALLBACK_CHARACTER_ID,
  name: "Piloto",
  appearance: FALLBACK_APPEARANCE,
  faceTextureUrl: null,
  avatarThumbnailUrl: null,
  kartId: null,
  version: 0,
};

/** The library row. Deliberately thin: a list of forty characters should not carry forty appearances. */
export function toSummary(character: Character): CharacterSummary {
  return {
    id: character.id,
    name: character.name,
    ownerId: character.ownerId,
    status: character.status,
    isActive: character.isActive,
    isFavourite: character.isFavourite,
    avatarThumbnailUrl: character.avatarThumbnailUrl,
    faceState: character.face?.state ?? null,
    defaultKartId: character.defaultKartId,
    createdAt: character.createdAt,
    updatedAt: character.updatedAt,
    lastUsedAt: character.lastUsedAt,
    deletedAt: character.deletedAt,
  };
}

/**
 * Whether a cached runtime is still the current one.
 *
 * Compared by version rather than by deep equality, which is the reason `version` is on the runtime
 * payload at all: a lobby can hold eight prepared characters and re-check them for the cost of eight
 * integer comparisons.
 */
export function isRuntimeStale(cached: CharacterRuntime, current: Pick<Character, "version">): boolean {
  return cached.version !== current.version;
}
