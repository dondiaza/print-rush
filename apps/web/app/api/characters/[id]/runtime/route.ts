import { toRuntime } from "@print-rush/character-core";
import type { NextRequest } from "next/server";
import { NextResponse } from "next/server";
import { getCharacter, touchLastUsed } from "@/server/characterRepository";
import { NotFoundError } from "@/server/characterRepository";
import { handle, requireId } from "@/server/http";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * What a race needs about one character.
 *
 * Deliberately the only character endpoint a race client can reach without the studio key, because
 * rivals in a lobby have to be able to load each other. `toRuntime` is what makes that safe: it is
 * the single function that decides what leaves the studio, and it omits the original photograph and
 * the pre-styling crop by construction rather than by each caller remembering to.
 */
export async function GET(
  _request: NextRequest,
  { params }: { params: Promise<{ id: string }> },
): Promise<Response> {
  return handle(async () => {
    const { id } = await params;
    const character = await getCharacter(requireId(id));
    if (!character || character.deletedAt) throw new NotFoundError(id);
    // Fire-and-forget: the library sorts by last use, and a race must not wait on a bookkeeping
    // write to put a kart on the grid.
    void touchLastUsed(id).catch(() => undefined);
    return NextResponse.json(
      { runtime: toRuntime(character) },
      // Short public cache: eight clients in a lobby ask for the same payload at the same moment,
      // and the version field is what lets them detect a change rather than poll for one.
      { headers: { "Cache-Control": "public, max-age=15, stale-while-revalidate=60" } },
    );
  });
}
