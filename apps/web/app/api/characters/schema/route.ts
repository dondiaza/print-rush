import type { NextRequest } from "next/server";
import { NextResponse } from "next/server";
import { identify, isStudioConfigured, requireOwner } from "@/server/auth";
import { isDatabaseConfigured } from "@/server/db";
import { handle, jsonError } from "@/server/http";
import { migrate, migrationState } from "@/server/migrate";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 60;

/**
 * Reports whether the schema is in place. Reads only, and behind the key.
 *
 * Two corrections live in this handler. The first version ran `migrate()` from `GET` — idempotent or
 * not, applying a schema is a write, and an unauthenticated endpoint that performs one is one
 * anybody can invoke. The second version was read-only but still public, which handed out migration
 * names and therefore table names to anyone who asked. Neither is a secret, and neither is anyone
 * else's business either.
 *
 * The unauthenticated answer is a bare boolean: enough for a monitor to tell "ready" from "not",
 * with nothing internal attached.
 */
export async function GET(request: NextRequest): Promise<Response> {
  return handle(async () => {
    if (!isDatabaseConfigured()) {
      return jsonError(503, "NOT_CONFIGURED", "La base de datos no está configurada.");
    }
    const { pending, applied } = await migrationState();
    const ready = pending.length === 0;

    const actor = identify(request);
    if (actor.role === "RACE") {
      return NextResponse.json({ ok: ready });
    }
    return NextResponse.json({
      ok: ready,
      applied,
      pending,
      studioConfigured: isStudioConfigured(),
    });
  });
}

/**
 * Applies pending migrations. Behind the studio key, because it changes the schema.
 *
 * A serverless deployment has no natural place to hang a deploy hook, so the schema is applied on
 * demand. `migrate` is idempotent — it records what it has run and every statement is
 * `IF NOT EXISTS` — so calling it twice is a no-op, and calling it after a partial failure repeats
 * only what is still pending.
 */
export async function POST(request: NextRequest): Promise<Response> {
  return handle(async () => {
    requireOwner(request);
    const result = await migrate();
    return NextResponse.json({ ok: true, ...result });
  });
}
