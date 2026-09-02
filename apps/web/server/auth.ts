import { timingSafeEqual } from "node:crypto";
import type { NextRequest } from "next/server";

/**
 * Access control for the studio.
 *
 * The project has no authentication system, and the brief says to adapt to the existing roles —
 * there are none. That leaves a choice, and leaving the endpoints open was not one of them: this
 * feature stores photographs of identifiable colleagues behind a public URL. An unauthenticated
 * write endpoint would be a personal-data incident waiting for a crawler.
 *
 * So: a shared studio key, required for everything that reads or writes a character's own data, and
 * checked in constant time. It is the smallest thing that is actually safe, and it is honest about
 * what it is — it identifies *the studio*, not a person, so `ownerId` is recorded from the request
 * rather than proven. When real authentication arrives, `identify` is the single function that
 * changes and every route keeps working.
 *
 * The race path is separate and deliberately weaker: a runtime payload carries no photograph, only
 * a styled game texture and a name, and rivals in a lobby need to read each other's. Requiring the
 * studio key there would mean shipping it to every player, which would make it worthless.
 */

export type Actor = {
  id: string;
  role: "ADMIN" | "OWNER" | "RACE";
};

/** The anonymous race client. Can read runtime payloads and nothing else. */
export const RACE_ACTOR: Actor = { id: "race", role: "RACE" };

export class UnauthorisedError extends Error {
  constructor(message = "Necesitas la clave del estudio para esto.") {
    super(message);
    this.name = "UnauthorisedError";
  }
}

export class ForbiddenError extends Error {
  constructor(message = "Este personaje no es tuyo.") {
    super(message);
    this.name = "ForbiddenError";
  }
}

function studioKey(): string | null {
  const key = process.env.CHARACTER_STUDIO_KEY;
  return typeof key === "string" && key.length >= 16 ? key : null;
}

/** Whether the studio is configured at all. A missing key locks writes rather than opening them. */
export function isStudioConfigured(): boolean {
  return studioKey() !== null;
}

function matches(provided: string, expected: string): boolean {
  const a = Buffer.from(provided);
  const b = Buffer.from(expected);
  // Length must be compared separately: `timingSafeEqual` throws on a mismatch rather than
  // returning false, and the throw would itself be a timing signal.
  if (a.length !== b.length) return false;
  return timingSafeEqual(a, b);
}

/**
 * Identifies the caller.
 *
 * Returns the race actor for an unauthenticated request, which is enough for runtime reads and
 * nothing else. Routes call `requireOwner` when they need more.
 */
export function identify(request: NextRequest): Actor {
  const expected = studioKey();
  if (!expected) return RACE_ACTOR;

  const header = request.headers.get("x-studio-key") ?? "";
  if (header.length === 0 || !matches(header, expected)) return RACE_ACTOR;

  /**
   * Who the caller says they are.
   *
   * Recorded, not trusted — the key does not prove an identity, so this is an attribution label for
   * the audit trail and for scoping a library, not a security boundary. Saying so plainly is better
   * than implying the header is authenticated.
   */
  const claimed = (request.headers.get("x-studio-owner") ?? "").trim();
  const owner = /^[a-z0-9][a-z0-9._-]{0,63}$/i.test(claimed) ? claimed.toLowerCase() : "studio";
  const admin = request.headers.get("x-studio-admin") === "1";
  return { id: owner, role: admin ? "ADMIN" : "OWNER" };
}

/** Requires a studio key. Throws `UnauthorisedError`, which the route layer maps to 401. */
export function requireOwner(request: NextRequest): Actor {
  if (!isStudioConfigured()) {
    // Refuses rather than allows. A deployment without a key can still race; it just cannot create
    // characters, which is the safe direction for this failure.
    throw new UnauthorisedError("El estudio de personajes no está configurado en este despliegue.");
  }
  const actor = identify(request);
  if (actor.role === "RACE") throw new UnauthorisedError();
  return actor;
}

/** Whether an actor may act on a character owned by `ownerId`. */
export function canManage(actor: Actor, ownerId: string): boolean {
  if (actor.role === "ADMIN") return true;
  return actor.role === "OWNER" && actor.id === ownerId;
}

export function assertCanManage(actor: Actor, ownerId: string): void {
  if (!canManage(actor, ownerId)) throw new ForbiddenError();
}
