import {
  CharacterPresets, KartPresets, createDefaultCharacter, createDefaultKart, migrateCharacter, migrateKart,
  type CharacterDefinition, type KartDefinition,
} from "@print-rush/3d-factory";

const CHARACTER_LIBRARY = "print-rush.characters.v2";
const KART_LIBRARY = "print-rush.karts.v2";
const ACTIVE_CHARACTER = "print-rush.active-character.v2";
const ACTIVE_KART = "print-rush.active-kart.v2";

function readArray<T>(key: string, migrate: (value: unknown) => T, fallback: readonly T[]): T[] {
  if (typeof window === "undefined") return [...fallback];
  try {
    const parsed = JSON.parse(localStorage.getItem(key) ?? "[]") as unknown;
    if (!Array.isArray(parsed) || parsed.length === 0) return [...fallback];
    return parsed.map(migrate);
  } catch { return [...fallback]; }
}

export function loadCharacters(): CharacterDefinition[] { return readArray(CHARACTER_LIBRARY, migrateCharacter, CharacterPresets); }
export function loadKarts(): KartDefinition[] { return readArray(KART_LIBRARY, migrateKart, KartPresets); }

export function saveCharacter(definition: CharacterDefinition): CharacterDefinition[] {
  const characters = loadCharacters().filter((entry) => entry.id !== definition.id);
  characters.unshift(definition);
  localStorage.setItem(CHARACTER_LIBRARY, JSON.stringify(characters.slice(0, 40)));
  localStorage.setItem(ACTIVE_CHARACTER, JSON.stringify(definition));
  return characters;
}

export function saveKart(definition: KartDefinition): KartDefinition[] {
  const karts = loadKarts().filter((entry) => entry.id !== definition.id);
  karts.unshift(definition);
  localStorage.setItem(KART_LIBRARY, JSON.stringify(karts.slice(0, 40)));
  localStorage.setItem(ACTIVE_KART, JSON.stringify(definition));
  return karts;
}

export function loadActiveCharacter(): CharacterDefinition {
  if (typeof window === "undefined") return createDefaultCharacter();
  try { return migrateCharacter(JSON.parse(localStorage.getItem(ACTIVE_CHARACTER) ?? "null")); } catch { return createDefaultCharacter(); }
}
export function loadActiveKart(): KartDefinition {
  if (typeof window === "undefined") return createDefaultKart();
  try { return migrateKart(JSON.parse(localStorage.getItem(ACTIVE_KART) ?? "null")); } catch { return createDefaultKart(); }
}

export function deleteAvatar(id: string): CharacterDefinition[] {
  const next = loadCharacters().filter((entry) => entry.id !== id);
  localStorage.setItem(CHARACTER_LIBRARY, JSON.stringify(next));
  const active = loadActiveCharacter();
  if (active.id === id) localStorage.removeItem(ACTIVE_CHARACTER);
  return next;
}

export function exportDefinition(filename: string, value: unknown): void {
  const blob = new Blob([JSON.stringify(value, null, 2)], { type: "application/json" });
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = filename;
  link.click();
  URL.revokeObjectURL(url);
}
