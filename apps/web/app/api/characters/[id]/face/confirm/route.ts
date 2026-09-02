import type { NextRequest } from "next/server";
import { NextResponse } from "next/server";
import { assertCanManage, requireOwner } from "@/server/auth";
import { deleteMedia } from "@/server/blobStore";
import {
  audit,
  confirmPendingFace,
  discardPendingFace,
  getCharacter,
  NotFoundError,
} from "@/server/characterRepository";
import { handle, requireId } from "@/server/http";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** Accepts the pending face. The old texture is deleted only after the swap has committed. */
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

    const { replaced } = await confirmPendingFace(id);
    void deleteMedia(replaced).catch(() => undefined);
    await audit(id, "FACE_CHANGED", actor.id, {});

    const updated = await getCharacter(id);
    return NextResponse.json({ character: updated });
  });
}

/** Rejects the pending face, keeping whatever was already live. */
export async function DELETE(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> },
): Promise<Response> {
  return handle(async () => {
    const actor = requireOwner(request);
    const { id } = await params;
    const character = await getCharacter(requireId(id));
    if (!character) throw new NotFoundError(id);
    assertCanManage(actor, character.ownerId);

    const { discarded } = await discardPendingFace(id);
    void deleteMedia(discarded).catch(() => undefined);
    const updated = await getCharacter(id);
    return NextResponse.json({ character: updated });
  });
}
