import type { NextRequest } from "next/server";
import { identify } from "@/server/auth";
import { readMedia } from "@/server/blobStore";
import { canManage } from "@/server/auth";
import { isRaceVisibleMedia, ownerOfMedia } from "@/server/characterRepository";
import { handle, jsonError } from "@/server/http";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * The one way character media is read.
 *
 * This route is the privacy boundary in operational form, and its whole job is to answer one
 * question before it streams a byte: is the caller allowed this file?
 *
 *  - A **styled game texture or thumbnail** is readable by anyone. Rivals in a lobby must be able to
 *    load each other, and these carry no photograph — they are the output of the styling pass.
 *  - An **original photograph or a pre-styling crop** requires the studio key *and* ownership of the
 *    character it belongs to. Nothing else reaches it, ever.
 *
 * The path is looked up in the database rather than parsed. That matters: a pathname that no row
 * references is not served at all, which closes both path traversal and the case of a caller
 * guessing at a blob that was orphaned by a failed write.
 */
export async function GET(request: NextRequest): Promise<Response> {
  return handle(async () => {
    const path = new URL(request.url).searchParams.get("path");
    if (!path || path.length > 300 || !path.startsWith("characters/")) {
      return jsonError(400, "BAD_PATH", "Ruta de archivo no válida.");
    }

    const raceVisible = await isRaceVisibleMedia(path);
    if (!raceVisible) {
      // Not a styled output, so it is a photograph or a crop: ownership required.
      const owner = await ownerOfMedia(path);
      if (!owner) return jsonError(404, "NOT_FOUND", "Ese archivo no existe.");
      const actor = identify(request);
      if (!canManage(actor, owner.ownerId)) {
        return jsonError(403, "FORBIDDEN", "Esa imagen es privada.");
      }
    }

    const media = await readMedia(path);
    if (!media) return jsonError(404, "NOT_FOUND", "Ese archivo ya no está disponible.");

    return new Response(media.body, {
      headers: {
        "Content-Type": media.contentType,
        /**
         * A year, immutable — safe because the pathname contains a fresh UUID per write, so a
         * restyled face is a different URL rather than the same URL with new bytes. `private` on the
         * non-race path keeps a shared proxy from caching a colleague photograph.
         */
        "Cache-Control": raceVisible
          ? "public, max-age=31536000, immutable"
          : "private, max-age=600",
        // A stored image is never markup, and this is the header that guarantees a browser agrees.
        "X-Content-Type-Options": "nosniff",
        "Content-Security-Policy": "default-src 'none'; sandbox",
      },
    });
  });
}
