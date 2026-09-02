import {
  FALLBACK_RUNTIME,
  validateAppearance,
  type CharacterRuntime,
} from "@print-rush/character-core";

/**
 * RESOLVING A CHARACTER, AUTHORITATIVELY.
 *
 * What this replaces: the room took a whole `CharacterDefinition` from the joining client's options
 * and broadcast it to everyone. Two things were wrong with that. A client could send anything —
 * proportions outside the limits, a name of any length, a face URL pointing anywhere — and the
 * server would relay it to every rival as fact. And it meant a character existed only for as long
 * as the browser that described it, which is the problem the whole studio exists to solve.
 *
 * Now the client sends an **id**. The server fetches that character's runtime payload from the
 * studio API, validates the appearance with the same validator the studio uses, and distributes the
 * result. A client cannot describe another player, and cannot describe itself either.
 *
 * The payload is deliberately the runtime projection and not the full character: it carries the
 * styled face texture and a thumbnail, never the original photograph. That boundary is enforced in
 * `toRuntime` on the studio side; this side simply never asks for anything else.
 */

/** Where the studio lives. Unset means id-based characters are unavailable, not that joining fails. */
function studioBase(): string | null {
  const url = process.env.CHARACTER_API_URL ?? process.env.NEXT_PUBLIC_SITE_URL ?? null;
  if (!url) return null;
  return url.replace(/\/+$/, "");
}

export function isStudioReachable(): boolean {
  return studioBase() !== null;
}

type CacheEntry = { runtime: CharacterRuntime; at: number };

/**
 * A short cache.
 *
 * Eight players joining one room is eight requests for what is usually a handful of distinct
 * characters, and a rejoin after a disconnect asks again. Thirty seconds is long enough to collapse
 * a lobby's worth of joins and short enough that an edit made mid-session is picked up on the next
 * race rather than the next deploy.
 */
const cache = new Map<string, CacheEntry>();
const CACHE_MS = 30_000;

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * Fetches and validates one character's runtime payload.
 *
 * Never rejects. Every failure — a malformed id, an unreachable studio, a deleted character, a
 * response that does not parse — resolves to the fallback driver, because the brief is explicit that
 * a race must start regardless and because a lobby that cannot begin is worse than a lobby with one
 * generic helmet in it.
 */
export async function resolveRuntime(characterId: unknown): Promise<CharacterRuntime> {
  if (typeof characterId !== "string" || !UUID.test(characterId)) return FALLBACK_RUNTIME;

  const cached = cache.get(characterId);
  if (cached && Date.now() - cached.at < CACHE_MS) return cached.runtime;

  const base = studioBase();
  if (!base) return FALLBACK_RUNTIME;

  try {
    // A tight timeout: a slow studio must not hold a join open. The fallback is right there.
    const response = await fetch(`${base}/api/characters/${characterId}/runtime`, {
      signal: AbortSignal.timeout(4000),
    });
    if (!response.ok) return FALLBACK_RUNTIME;
    const body = (await response.json()) as { runtime?: unknown };
    const runtime = sanitise(body.runtime);
    if (!runtime) return FALLBACK_RUNTIME;
    cache.set(characterId, { runtime, at: Date.now() });
    return runtime;
  } catch {
    return FALLBACK_RUNTIME;
  }
}

/**
 * Re-validates what the studio returned.
 *
 * The studio is trusted more than a client, but it is still across a network boundary and it is
 * still the source of data that will be broadcast to every player. Running the same validator here
 * costs microseconds and means a schema change on one side cannot put an out-of-range proportion or
 * an unknown preset into a room.
 */
function sanitise(input: unknown): CharacterRuntime | null {
  if (typeof input !== "object" || input === null) return null;
  const raw = input as Record<string, unknown>;
  if (typeof raw.id !== "string" || raw.id.length === 0) return null;

  const name = typeof raw.name === "string" ? raw.name.slice(0, 50).trim() : "";
  const appearance = validateAppearance(raw.appearance).value;

  return {
    id: raw.id,
    name: name.length > 0 ? name : "Piloto",
    appearance,
    // Only a same-origin studio path is accepted. A face URL is broadcast to every client, so an
    // absolute URL from anywhere else would turn one edited character into a request every player
    // makes to a host of somebody else's choosing.
    faceTextureUrl: safeMediaPath(raw.faceTextureUrl),
    avatarThumbnailUrl: safeMediaPath(raw.avatarThumbnailUrl),
    kartId: typeof raw.kartId === "string" ? raw.kartId : null,
    version: typeof raw.version === "number" && Number.isFinite(raw.version) ? raw.version : 0,
  };
}

function safeMediaPath(value: unknown): string | null {
  if (typeof value !== "string") return null;
  return value.startsWith("/api/characters/media?") ? value : null;
}

/** Clears the cache. For tests, and for an operator who has just fixed a character. */
export function clearRuntimeCache(): void {
  cache.clear();
}
