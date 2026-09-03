import { buildPrintFactorySet } from "./PrintFactorySet";
import type { Dressing, DressingContext, SetBuilder } from "./types";

export type { Animator, Dressing, DressingContext, Placement } from "./types";

/**
 * Which set dresses which theme.
 *
 * A theme without a set gets the generic dressing — the seeded scatter, the hero landmarks from
 * `HeroAssets`, the crate hazards — which is what every circuit had before. The print factory is the
 * golden standard; the others are brought up to it one at a time, and this table is where that
 * shows.
 */
const SETS: Record<string, SetBuilder> = {
  PRINT_FACTORY: buildPrintFactorySet,
};

export function hasSet(theme: string): boolean {
  return theme in SETS;
}

export function dressTrack(theme: string, context: DressingContext): Dressing | null {
  const builder = SETS[theme];
  return builder ? builder(context) : null;
}
