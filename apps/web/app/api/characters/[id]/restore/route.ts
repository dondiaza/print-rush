import type { NextRequest } from "next/server";
import { NextResponse } from "next/server";
import { assertCanManage, requireOwner } from "@/server/auth";
import { getCharacter, restoreCharacter } from "@/server/characterRepository";
import { NotFoundError } from "@/server/characterRepository";
import { handle, requireId } from "@/server/http";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** Brings a soft-deleted character back. The reason files are not deleted on delete. */
export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> },
): Promise<Response> {
  return handle(async () => {
    const actor = requireOwner(request);
    const { id } = await params;
    const existing = await getCharacter(requireId(id));
    if (!existing) throw new NotFoundError(id);
    assertCanManage(actor, existing.ownerId);
    const character = await restoreCharacter(id, actor.id);
    return NextResponse.json({ character });
  });
}
