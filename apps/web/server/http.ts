import { VersionConflictError } from "@print-rush/character-core";
import { NextResponse } from "next/server";
import { ForbiddenError, UnauthorisedError } from "./auth";
import { DatabaseUnavailableError } from "./db";
import { FaceProcessingError } from "./faceStyle";
import { NotFoundError, ValidationError } from "./characterRepository";
import { StorageUnavailableError } from "./blobStore";

/**
 * One place where an exception becomes a response.
 *
 * The brief asks for errors a person can act on rather than "500 processing failed", and the only
 * way to actually get that is to map them once, centrally, from typed errors the domain throws.
 * Every route wraps its body in `handle`, so a new failure mode is impossible to forget.
 *
 * The status codes matter as much as the messages: a version conflict is a 409 so the studio can
 * offer to reload rather than retry, and a missing database is a 503 so a monitor can tell "not
 * configured" apart from "broken".
 */

export type ApiError = {
  error: string;
  /** Machine-readable, for the client to branch on. Messages are for people. */
  code: string;
  detail?: unknown;
};

export function jsonError(status: number, code: string, error: string, detail?: unknown): NextResponse<ApiError> {
  return NextResponse.json<ApiError>(detail === undefined ? { error, code } : { error, code, detail }, { status });
}

export async function handle<T>(body: () => Promise<NextResponse<T> | Response>): Promise<Response> {
  try {
    return await body();
  } catch (error) {
    if (error instanceof UnauthorisedError) return jsonError(401, "UNAUTHORISED", error.message);
    if (error instanceof ForbiddenError) return jsonError(403, "FORBIDDEN", error.message);
    if (error instanceof NotFoundError) return jsonError(404, "NOT_FOUND", error.message);
    if (error instanceof ValidationError) {
      return jsonError(422, "INVALID", error.message, error.messages);
    }
    if (error instanceof VersionConflictError) {
      // 409, with both versions, so the editor can say what happened instead of guessing.
      return jsonError(409, "VERSION_CONFLICT", error.message, {
        expected: error.expected,
        actual: error.actual,
      });
    }
    if (error instanceof FaceProcessingError) {
      // 422 rather than 500: the request was fine, the photograph was not, and the character is
      // still there. That distinction is exactly what the brief asks the message to convey.
      return jsonError(422, "FACE_FAILED", error.message);
    }
    if (error instanceof DatabaseUnavailableError || error instanceof StorageUnavailableError) {
      return jsonError(503, "NOT_CONFIGURED", error.message);
    }
    // Anything unrecognised is logged with its real shape and answered with a message that does not
    // leak it. The log is the only place the stack belongs.
    console.error("[characters] unhandled", error);
    return jsonError(500, "INTERNAL", "Algo ha fallado por nuestra parte. Vuelve a intentarlo.");
  }
}

/** Reads and parses a JSON body, tolerating an empty one. */
export async function readJson(request: Request): Promise<Record<string, unknown>> {
  const text = await request.text();
  if (text.trim().length === 0) return {};
  try {
    const parsed: unknown = JSON.parse(text);
    return typeof parsed === "object" && parsed !== null ? (parsed as Record<string, unknown>) : {};
  } catch {
    throw new ValidationError(["El cuerpo de la petición no es JSON válido."]);
  }
}

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * Validates an id before it reaches a query.
 *
 * Postgres rejects a malformed uuid with an error that would surface as a 500; checking here turns
 * that into a 404, which is both the truthful answer and the one that does not leak whether a
 * malformed id was ever a real one.
 */
export function requireId(id: string): string {
  if (!UUID.test(id)) throw new NotFoundError(id);
  return id;
}
