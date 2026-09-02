import type { NextRequest } from "next/server";
import { NextResponse } from "next/server";
import { assertCanManage, requireOwner } from "@/server/auth";
import {
  deleteFace,
  getCharacter,
  softDeleteCharacter,
  updateCharacter,
} from "@/server/characterRepository";
import { deleteMedia } from "@/server/blobStore";
import { handle, readJson, requireId } from "@/server/http";
import { NotFoundError } from "@/server/characterRepository";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type Params = { params: Promise<{ id: string }> };

export async function GET(request: NextRequest, { params }: Params): Promise<Response> {
  return handle(async () => {
    const actor = requireOwner(request);
    const { id } = await params;
    const character = await getCharacter(requireId(id));
    if (!character) throw new NotFoundError(id);
    assertCanManage(actor, character.ownerId);
    return NextResponse.json({ character });
  });
}

/**
 * Updates a character.
 *
 * `expectedVersion` is optional but the studio always sends it. Without it the write is
 * last-one-wins, which is the behaviour the brief explicitly rules out for two tabs editing the same
 * character; with it, the second write gets a 409 and the studio can offer to reload.
 */
export async function PATCH(request: NextRequest, { params }: Params): Promise<Response> {
  return handle(async () => {
    const actor = requireOwner(request);
    const { id } = await params;
    const existing = await getCharacter(requireId(id));
    if (!existing) throw new NotFoundError(id);
    assertCanManage(actor, existing.ownerId);

    const body = await readJson(request);
    const character = await updateCharacter(id, actor.id, {
      ...(body.name !== undefined ? { name: body.name } : {}),
      ...(body.appearance !== undefined ? { appearance: body.appearance } : {}),
      ...(body.defaultKartId !== undefined
        ? { defaultKartId: typeof body.defaultKartId === "string" ? body.defaultKartId : null }
        : {}),
      ...(typeof body.isFavourite === "boolean" ? { isFavourite: body.isFavourite } : {}),
      ...(typeof body.expectedVersion === "number" ? { expectedVersion: body.expectedVersion } : {}),
    });
    return NextResponse.json({ character });
  });
}

/**
 * Soft-deletes a character, or — with `?face=1` — removes only its photograph.
 *
 * The second form is a privacy control, not a convenience: the brief requires that a photo can be
 * withdrawn without destroying the character built around it, and this is that operation.
 */
export async function DELETE(request: NextRequest, { params }: Params): Promise<Response> {
  return handle(async () => {
    const actor = requireOwner(request);
    const { id } = await params;
    const existing = await getCharacter(requireId(id));
    if (!existing) throw new NotFoundError(id);
    assertCanManage(actor, existing.ownerId);

    if (new URL(request.url).searchParams.get("face") === "1") {
      const paths = await deleteFace(id, actor.id);
      // The photograph goes immediately. A recovery window is right for a character; it is not right
      // for a colleague who has asked for their photo to be removed.
      await deleteMedia(paths);
      return NextResponse.json({ ok: true, removedFiles: paths.length });
    }

    await softDeleteCharacter(id, actor.id);
    return NextResponse.json({ ok: true });
  });
}
