import { buildPrintFactorySet } from "./PrintFactorySet";
import { buildFlagshipSet, buildMangaSet, buildOfficeSet, buildWarehouseSet } from "./AuthoredThemeSets";
import type { Dressing, DressingContext, SetBuilder } from "./types";

export type { Animator, Dressing, DressingContext, Placement } from "./types";

/**
 * Which set dresses which theme.
 *
 * A theme without a set gets the generic dressing — the seeded scatter, the hero landmarks from
 * `HeroAssets`, the crate hazards — which is also the forward-compatible fallback for a custom
 * blueprint. Every built-in circuit now has an authored set registered here.
 */
const SETS: Record<string, SetBuilder> = {
  FLAGSHIP: buildFlagshipSet,
  WAREHOUSE: buildWarehouseSet,
  PRINT_FACTORY: buildPrintFactorySet,
  OFFICE: buildOfficeSet,
  MANGA: buildMangaSet,
};

export function hasSet(theme: string): boolean {
  return theme in SETS;
}

export function dressTrack(theme: string, context: DressingContext): Dressing | null {
  const builder = SETS[theme];
  return builder ? builder(context) : null;
}
