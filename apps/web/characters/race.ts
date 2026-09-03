"use client";

import { FALLBACK_RUNTIME, type CharacterRuntime } from "@print-rush/character-core";
import { KartPresets, type CharacterDefinition, type KartDefinition } from "@print-rush/3d-factory";
import { loadActiveCharacter, loadActiveKart } from "@/factory/storage";
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
  /**
   * The kart, resolved from the same source as the driver.
   *
   * It is on this type rather than fetched separately, and that is the point. Before this, the home
   * screen drew `loadActiveKart()` from local storage while the race drew whatever the studio
   * character had chosen, so the kart on the menu was routinely not the kart you drove. Two calls
   * that must agree are better expressed as one call that cannot disagree.
   */
  kart: KartDefinition;
  /** Where it came from, for the debug overlay and for an honest console line. */
  source: "STUDIO" | "LOCAL" | "FALLBACK";
};

/**
 * The kart a saved character chose, or the locally selected one.
 *
 * `kartId` is a preset id and the presets are seeded, so the ids are stable across builds and a
 * character saved months ago still resolves. An id that no longer exists — a preset removed, a row
 * written by an older schema — falls through to the local choice rather than failing, because a
 * missing kart must never be the reason a race does not start.
 */
function kartFor(kartId: string | null): KartDefinition {
  if (kartId) {
    const preset = KartPresets.find((entry) => entry.id === kartId);
    if (preset) return preset;
  }
  try {
    return loadActiveKart();
  } catch {
    return KartPresets[0]!;
  }
}

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
        kart: kartFor(runtime.kartId),
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
    if (local) return { definition: local, faceTextureUrl: null, kart: kartFor(null), source: "LOCAL" };
  } catch (error) {
    console.warn("[characters] no local character either; using the fallback driver", error);
  }

  return {
    definition: toDefinition(FALLBACK_RUNTIME),
    faceTextureUrl: null,
    kart: KartPresets[0]!,
    source: "FALLBACK",
  };
}
