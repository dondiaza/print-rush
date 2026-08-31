import { createDefaultCharacter, normalizeCharacter } from "./character.js";
import { createDefaultKart, normalizeKart } from "./kart.js";
import type { CharacterDefinition, KartDefinition } from "./types.js";

export function migrateCharacter(value: unknown): CharacterDefinition {
  if (!value || typeof value !== "object") return createDefaultCharacter();
  const candidate = value as Partial<CharacterDefinition> & { schemaVersion?: number };
  if (candidate.schemaVersion === 2) return normalizeCharacter(candidate as CharacterDefinition);
  const fallback = createDefaultCharacter();
  if (typeof candidate.name === "string") fallback.name = candidate.name;
  if (typeof candidate.id === "string") fallback.id = candidate.id;
  return normalizeCharacter(fallback);
}

export function migrateKart(value: unknown): KartDefinition {
  if (!value || typeof value !== "object") return createDefaultKart();
  const candidate = value as Partial<KartDefinition> & { schemaVersion?: number };
  if (candidate.schemaVersion === 2) return normalizeKart(candidate as KartDefinition);
  const fallback = createDefaultKart();
  if (typeof candidate.name === "string") fallback.name = candidate.name;
  if (typeof candidate.id === "string") fallback.id = candidate.id;
  return normalizeKart(fallback);
}
