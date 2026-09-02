import type { NextRequest } from "next/server";
import { NextResponse } from "next/server";
import { assertCanManage, requireOwner } from "@/server/auth";
import { putMedia, readMedia } from "@/server/blobStore";
import {
  audit,
  getCharacter,
  NotFoundError,
  setFaceState,
  setPendingFace,
  ValidationError,
} from "@/server/characterRepository";
import { PROCESSING_VERSION, styleFace } from "@/server/faceStyle";
import { handle, requireId } from "@/server/http";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
/** The bilateral pass over a 512² image is the slow part; 60 s is ample and bounded. */
export const maxDuration = 60;

/**
 * Runs the styling pipeline and stores the result as **pending**.
 *
 * Pending, not live. That is the brief's safe-regeneration rule and the reason it is worth the extra
 * round trip: a working face is never replaced by an unreviewed one. The owner sees the original
 * beside the styled version and accepts or regenerates.
 *
 * Idempotent in the sense that matters: running it twice produces two pending textures and the
 * second replaces the first in the row, so a retried request cannot leave the character in a state
 * that depends on how many times it was retried. It does leave an orphan blob, which the purge
 * sweep collects — the alternative, deleting the previous pending file first, would risk deleting
 * one that a concurrent request had just promoted.
 */
export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> },
): Promise<Response> {
  return handle(async () => {
    const actor = requireOwner(request);
    const { id } = await params;
    const character = await getCharacter(requireId(id));
    if (!character) throw new NotFoundError(id);
    assertCanManage(actor, character.ownerId);

    const croppedUrl = character.face?.croppedUrl;
    if (!croppedUrl) throw new ValidationError(["Sube una foto antes de generar el rostro."]);

    const path = new URL(croppedUrl, "http://local").searchParams.get("path");
    if (!path) throw new ValidationError(["El recorte guardado no es accesible."]);

    await setFaceState(id, "PROCESSING");
    try {
      const stored = await readMedia(path);
      if (!stored) throw new ValidationError(["El recorte ya no está en el almacenamiento."]);

      const styled = styleFace(Buffer.from(stored.body));
      const texturePath = await putMedia(id, "textures", styled.texture, "image/png");
      // The 128 px thumbnail is the one the library and the lobby use; the others are derived from
      // the same styled image and can be added when a surface actually needs them.
      const thumb = styled.thumbnails.find((entry) => entry.size === 128) ?? styled.thumbnails[0]!;
      const thumbPath = await putMedia(id, "previews", thumb.png, "image/png");

      await setPendingFace(id, texturePath, thumbPath, PROCESSING_VERSION);
      await audit(id, "FACE_PROCESSED", actor.id, { processingVersion: PROCESSING_VERSION });

      const updated = await getCharacter(id);
      return NextResponse.json({
        face: updated?.face ?? null,
        warnings: styled.warnings,
        preview: `/api/characters/media?path=${encodeURIComponent(texturePath)}`,
      });
    } catch (error) {
      // The character survives a failed photo, with a reason attached. This is the state the brief
      // insists on: retry or upload another, never a lost character.
      const message = error instanceof Error ? error.message : "No hemos podido procesar la imagen.";
      await setFaceState(id, "FAILED", message);
      await audit(id, "FACE_FAILED", actor.id, {});
      throw error;
    }
  });
}
