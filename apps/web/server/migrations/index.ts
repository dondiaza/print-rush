import { migration001 } from "./001_characters";
import { migration002 } from "./002_thumbnails";

/**
 * Every migration, in the order they must run.
 *
 * An explicit list rather than a directory scan: the order is load-bearing, and a list makes it
 * reviewable in a diff instead of dependent on how a filesystem sorts.
 */
export const MIGRATIONS: ReadonlyArray<{ name: string; sql: string }> = [migration001, migration002];
