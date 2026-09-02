import { del, head, list, put } from "@vercel/blob";
import { randomUUID } from "node:crypto";

/**
 * Object storage for character media.
 *
 * The store is configured **private**, which is the whole reason this module is small and boring:
 * an anonymous GET against a blob URL returns 403, verified. That is the correct posture for
 * photographs of colleagues, and it means a pathname is not a capability — leaking one in a log or a
 * database dump does not expose the image.
 *
 * The consequence is that nothing can be linked directly from a page. Every read goes through the
 * media route, which checks who is asking and then streams the bytes. That costs a hop and buys
 * access control that cannot be forgotten.
 *
 * Layout follows the brief:
 *
 *   characters/<characterId>/original/<uuid>.<ext>
 *   characters/<characterId>/face/<uuid>.png
 *   characters/<characterId>/textures/<uuid>.png
 *   characters/<characterId>/previews/<uuid>.png
 *
 * Filenames are UUIDs, never names. A person's name in a storage path is both a privacy leak and a
 * cache-busting problem; a fresh UUID per write gives immutable URLs for free, so a restyled face
 * can never be served from a stale cache.
 */

export type MediaKind = "original" | "face" | "textures" | "previews";

export class StorageUnavailableError extends Error {
  constructor() {
    super("El almacenamiento de archivos no está configurado.");
    this.name = "StorageUnavailableError";
  }
}

export function isStorageConfigured(): boolean {
  return typeof process.env.BLOB_READ_WRITE_TOKEN === "string" && process.env.BLOB_READ_WRITE_TOKEN.length > 0;
}

function assertStorage(): void {
  if (!isStorageConfigured()) throw new StorageUnavailableError();
}

/** Extension from a content type, restricted to what we accept. Never taken from the filename. */
function extensionFor(contentType: string): string {
  switch (contentType) {
    case "image/png":
      return "png";
    case "image/jpeg":
      return "jpg";
    case "image/webp":
      return "webp";
    default:
      throw new Error(`unsupported content type: ${contentType}`);
  }
}

/**
 * Writes one file and returns its pathname.
 *
 * `addRandomSuffix` is off because the UUID already makes the name unique, and a predictable
 * pathname is what lets the database store it and the media route find it again.
 */
export async function putMedia(
  characterId: string,
  kind: MediaKind,
  body: Buffer,
  contentType: string,
): Promise<string> {
  assertStorage();
  const pathname = `characters/${characterId}/${kind}/${randomUUID()}.${extensionFor(contentType)}`;
  const blob = await put(pathname, body, {
    access: "private",
    addRandomSuffix: false,
    contentType,
    // A year, immutable: the pathname changes whenever the content does, so the only wrong answer
    // here would be a short cache that makes every avatar a fresh request.
    cacheControlMaxAge: 31_536_000,
  });
  return blob.pathname;
}

/**
 * Reads a stored file, server side.
 *
 * A private blob URL answers 403 to anyone, but 200 to a request carrying the store's read-write
 * token as a bearer — verified against the live store. So the media route reads with the token and
 * re-serves the bytes, and the token never leaves the server.
 *
 * The alternative was a presigned URL handed to the browser. It is rejected on purpose: a presigned
 * URL is a bearer capability with a lifetime, and once issued it can be forwarded, logged by a
 * proxy, or pasted into a chat. For photographs of colleagues, a route that checks the caller on
 * every single request is the property worth paying a hop for.
 */
export async function readMedia(pathname: string): Promise<{ body: ArrayBuffer; contentType: string } | null> {
  assertStorage();
  try {
    const meta = await head(pathname);
    const response = await fetch(meta.url, {
      headers: { Authorization: `Bearer ${process.env.BLOB_READ_WRITE_TOKEN ?? ""}` },
    });
    if (!response.ok) return null;
    return { body: await response.arrayBuffer(), contentType: meta.contentType ?? "application/octet-stream" };
  } catch {
    // A missing blob is a normal outcome — a face may have been deleted while a page still held its
    // URL — so this is null rather than an exception, and the caller answers 404.
    return null;
  }
}

/** Deletes files. Tolerant of already-gone paths, so a retried cleanup is not an error. */
export async function deleteMedia(pathnames: readonly string[]): Promise<void> {
  assertStorage();
  const present = pathnames.filter((path) => path.length > 0);
  if (present.length === 0) return;
  try {
    await del(present as string[]);
  } catch {
    // Cleanup is best-effort by design. Losing a blob deletion must never fail the user-facing
    // operation that triggered it; the orphan sweep below is what actually guarantees tidiness.
  }
}

/**
 * Every stored pathname for a character. Used by the hard-delete sweep after the recovery window.
 *
 * Listing by prefix rather than trusting the database is deliberate: if a write succeeded and the
 * row that would have recorded it did not, the file is an orphan that only a prefix listing can
 * find.
 */
export async function listCharacterMedia(characterId: string): Promise<string[]> {
  assertStorage();
  const paths: string[] = [];
  let cursor: string | undefined;
  do {
    // The cursor is omitted rather than passed as undefined: `exactOptionalPropertyTypes` treats
    // those as different things, and the SDK's option type does not accept the second.
    const page = await list(
      cursor === undefined
        ? { prefix: `characters/${characterId}/`, limit: 1000 }
        : { prefix: `characters/${characterId}/`, cursor, limit: 1000 },
    );
    for (const blob of page.blobs) paths.push(blob.pathname);
    cursor = page.hasMore ? page.cursor : undefined;
  } while (cursor);
  return paths;
}
