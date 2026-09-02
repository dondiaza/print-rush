import type { NextRequest } from "next/server";
import { NextResponse } from "next/server";
import { assertCanManage, requireOwner } from "@/server/auth";
import { deleteMedia, putMedia } from "@/server/blobStore";
import {
  audit,
  getCharacter,
  NotFoundError,
  setFaceState,
  upsertFaceUpload,
  ValidationError,
} from "@/server/characterRepository";
import { handle, requireId } from "@/server/http";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** 8 MB. Generous for a phone photo, small enough that a bad request cannot exhaust a function. */
const MAX_UPLOAD_BYTES = 8 * 1024 * 1024;
/** The normalised crop the studio produces is always a PNG and always at most this. */
const MAX_CROP_BYTES = 4 * 1024 * 1024;

/**
 * Magic-byte signatures for the formats we accept.
 *
 * The brief is right that an extension proves nothing, and so does a `Content-Type` — both are
 * attacker-controlled. These are read from the bytes themselves. Note what is *not* here: no SVG,
 * because an SVG is a script container, and no GIF, because it buys nothing and adds a decoder.
 */
const SIGNATURES: ReadonlyArray<{ type: string; test: (bytes: Uint8Array) => boolean }> = [
  {
    type: "image/png",
    test: (b) => b[0] === 0x89 && b[1] === 0x50 && b[2] === 0x4e && b[3] === 0x47,
  },
  { type: "image/jpeg", test: (b) => b[0] === 0xff && b[1] === 0xd8 && b[2] === 0xff },
  {
    type: "image/webp",
    test: (b) =>
      b[0] === 0x52 && b[1] === 0x49 && b[2] === 0x46 && b[3] === 0x46 &&
      b[8] === 0x57 && b[9] === 0x45 && b[10] === 0x42 && b[11] === 0x50,
  },
];

function sniff(bytes: Uint8Array): string | null {
  if (bytes.length < 16) return null;
  return SIGNATURES.find((signature) => signature.test(bytes))?.type ?? null;
}

/**
 * Receives a photograph and the crop the owner chose.
 *
 * The split is the security design, not an implementation detail. The client sends two things:
 *
 *  - the **original file, verbatim**, which the server stores without ever decoding. An untrusted
 *    JPEG parsed on the server is an attack surface; an untrusted JPEG written to private storage
 *    and never opened is a file.
 *  - a **normalised PNG** that the browser produced by drawing the photo into a canvas at the
 *    owner's chosen crop, zoom and rotation. The browser already has hardened decoders for every
 *    format a person might upload; the server only ever parses this PNG, with its own codec.
 *
 * So the original survives — the brief requires it, and a restyle later needs it — without the
 * server ever having to trust it.
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

    const form = await request.formData();
    const original = form.get("original");
    const cropped = form.get("cropped");
    if (!(original instanceof File) || !(cropped instanceof File)) {
      throw new ValidationError(["Faltan la foto original o el recorte."]);
    }
    if (original.size > MAX_UPLOAD_BYTES) {
      throw new ValidationError(["La foto pesa más de 8 MB. Prueba con una más ligera."]);
    }
    if (cropped.size > MAX_CROP_BYTES) throw new ValidationError(["El recorte es demasiado grande."]);

    const originalBytes = Buffer.from(await original.arrayBuffer());
    const croppedBytes = Buffer.from(await cropped.arrayBuffer());

    const originalType = sniff(originalBytes);
    if (!originalType) {
      throw new ValidationError(["Ese archivo no es una imagen JPEG, PNG o WebP."]);
    }
    if (sniff(croppedBytes) !== "image/png") {
      throw new ValidationError(["El recorte debe ser PNG."]);
    }

    const crop = {
      x: Number(form.get("cropX") ?? 0),
      y: Number(form.get("cropY") ?? 0),
      width: Number(form.get("cropWidth") ?? 1),
      height: Number(form.get("cropHeight") ?? 1),
      rotation: Number(form.get("rotation") ?? 0),
      zoom: Number(form.get("zoom") ?? 1),
    };
    for (const [key, value] of Object.entries(crop)) {
      if (!Number.isFinite(value)) throw new ValidationError([`El parámetro de recorte ${key} no es válido.`]);
    }

    /**
     * Old files are collected before the row is overwritten, and deleted after.
     *
     * A second photo replaces the first. Deleting before the write would mean a failed insert leaves
     * a character pointing at files that are gone; deleting after means the worst case is an orphan,
     * which the purge sweep collects.
     */
    const superseded = [
      character.face?.originalUrl,
      character.face?.croppedUrl,
    ].filter((value): value is string => typeof value === "string");

    const originalPath = await putMedia(id, "original", originalBytes, originalType);
    const croppedPath = await putMedia(id, "face", croppedBytes, "image/png");
    const face = await upsertFaceUpload(id, originalPath, croppedPath, crop);
    await setFaceState(id, "UPLOADED");
    await audit(id, "FACE_UPLOADED", actor.id, { bytes: originalBytes.length, type: originalType });

    // Best-effort, and only the paths that the media URLs encoded.
    void deleteMedia(
      superseded
        .map((url) => new URL(url, "http://local").searchParams.get("path"))
        .filter((path): path is string => typeof path === "string"),
    ).catch(() => undefined);

    return NextResponse.json({ face }, { status: 201 });
  });
}
