"use client";

import { FALLBACK_RUNTIME, type CharacterRuntime } from "@print-rush/character-core";
import type { CharacterDefinition } from "@print-rush/3d-factory";
import { loadActiveCharacter } from "@/factory/storage";
import { getRuntime } from "./api";
import { toDefinition } from "./bridge";

/**
 * WHICH CHARACTER RACES.
 *
 * Three sources, tried in order, and every step down is a deliberate degradation rather than an
 * error:
 *
 *  1. **The character selected in the studio**, fetched from the server. This is the one the player
 *     built, and it is the same on every device because it lives in Postgres.
 *  2. **The locally authored character**, from the older garage editor. Nothing was migrated away,
 *     so anyone who built a character before the studio existed still races with it.
 *  3. **The fallback driver**, which carries no URLs at all and therefore cannot fail to load.
 *
 * The brief is explicit that a race must never break over a character, and this is where that is
 * guaranteed. A deleted character, an unreachable database, a face texture that 404s, a browser with
 * storage disabled — each one lands one step further down this list and the race still starts.
 */

const LAST_SELECTED = "print-rush.last-character";

export type RaceCharacter = {
  definition: CharacterDefinition;
  /** The styled face texture, or null to use the geometry's own colours. */
  faceTextureUrl: string | null;
  /** Where it came from, for the debug overlay and for an honest console line. */
  source: "STUDIO" | "LOCAL" | "FALLBACK";
};

function selectedId(): string | null {
  try {
    return window.localStorage.getItem(LAST_SELECTED);
  } catch {
    return null;
  }
}

/** Remembers the choice, so the next race starts with the same driver. */
export function rememberCharacter(id: string): void {
  try {
    window.localStorage.setItem(LAST_SELECTED, id);
  } catch {
    // Storage blocked: the selection lasts for this session only, which is not worth failing over.
  }
}

export async function resolveRaceCharacter(): Promise<RaceCharacter> {
  const id = selectedId();

  if (id) {
    try {
      const runtime: CharacterRuntime = await getRuntime(id);
      return {
        definition: toDefinition(runtime),
        faceTextureUrl: runtime.faceTextureUrl,
        source: "STUDIO",
      };
    } catch (error) {
      // Worth a line: "my character looks wrong" is otherwise unattributable, and the answer is
      // usually that it was deleted or the network was down.
      console.warn("[characters] the selected character could not be loaded; using the local one", error);
    }
  }

  try {
    const local = loadActiveCharacter();
    if (local) return { definition: local, faceTextureUrl: null, source: "LOCAL" };
  } catch (error) {
    console.warn("[characters] no local character either; using the fallback driver", error);
  }

  return {
    definition: toDefinition(FALLBACK_RUNTIME),
    faceTextureUrl: null,
    source: "FALLBACK",
  };
}
