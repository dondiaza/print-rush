import { neon, type NeonQueryFunction } from "@neondatabase/serverless";

/**
 * The database handle.
 *
 * `@neondatabase/serverless` over HTTP rather than a pooled TCP client, because these queries run in
 * Vercel functions: a serverless invocation that opens a Postgres connection either pays the
 * handshake every time or leaks connections across warm instances until the pool is exhausted. The
 * HTTP driver has no connection to leak, and Neon's pooler handles the rest.
 *
 * Created lazily and cached per module instance. A warm function reuses it; a cold one pays nothing
 * until the first query.
 */

let cached: NeonQueryFunction<false, false> | null = null;

/** Raised when the database is not configured, so callers can answer 503 rather than crash. */
export class DatabaseUnavailableError extends Error {
  constructor() {
    super("La base de datos no está configurada.");
    this.name = "DatabaseUnavailableError";
  }
}

export function databaseUrl(): string | null {
  // `DATABASE_URL` is what the Neon integration sets; `POSTGRES_URL` is the same value under
  // Vercel's own name. Either is fine, and accepting both means a project connected through the
  // marketplace works without a manual alias.
  return process.env.DATABASE_URL ?? process.env.POSTGRES_URL ?? null;
}

export function isDatabaseConfigured(): boolean {
  return databaseUrl() !== null;
}

export function sql(): NeonQueryFunction<false, false> {
  if (cached) return cached;
  const url = databaseUrl();
  if (!url) throw new DatabaseUnavailableError();
  cached = neon(url);
  return cached;
}

/**
 * Runs a set of statements in order, stopping at the first failure.
 *
 * Not a transaction: the HTTP driver issues one statement per request, so a multi-statement
 * transaction would need the WebSocket driver and a connection to hold it open. That trade is worth
 * naming rather than hiding — every write in this feature is a single statement precisely so it does
 * not need one, and the only multi-statement path is migration, where each statement is idempotent
 * (`IF NOT EXISTS`) and a partial run is safe to repeat.
 */
export async function runStatements(statements: readonly string[]): Promise<void> {
  const query = sql();
  for (const statement of statements) {
    const trimmed = statement.trim();
    if (trimmed.length === 0) continue;
    await query.query(trimmed);
  }
}
