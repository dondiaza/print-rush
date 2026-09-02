import type { NextRequest } from "next/server";
import { NextResponse } from "next/server";
import { assertCanManage, requireOwner } from "@/server/auth";
import { duplicateCharacter, getCharacter } from "@/server/characterRepository";
import { NotFoundError } from "@/server/characterRepository";
import { handle, readJson, requireId } from "@/server/http";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * Duplicates a character.
 *
 * `withFace` defaults to **false**, which is the deliberate choice: the brief offers both, and
 * copying a colleague's likeness into a second record should be something you ask for rather than
 * something that happens because you wanted a variant with a different jacket.
 */
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

    const body = await readJson(request);
    const character = await duplicateCharacter(id, actor.id, {
      withFace: body.withFace === true,
      ...(typeof body.name === "string" ? { name: body.name } : {}),
    });
    return NextResponse.json({ character }, { status: 201 });
  });
}
