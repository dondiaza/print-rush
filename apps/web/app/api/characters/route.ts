import { toSummary } from "@print-rush/character-core";
import type { NextRequest } from "next/server";
import { NextResponse } from "next/server";
import { identify, requireOwner } from "@/server/auth";
import { createCharacter, listCharacters } from "@/server/characterRepository";
import { handle, readJson } from "@/server/http";

/**
 * The library, and creating a character.
 *
 * `GET` returns summaries, never appearances. A person with forty characters would otherwise
 * download forty appearance blobs to render forty cards showing a name and a thumbnail.
 *
 * Runs on the Node runtime rather than the edge: the face pipeline needs `node:zlib` for PNG, and
 * splitting the routes across two runtimes to save a few milliseconds on the list endpoint would
 * buy nothing and cost a second deployment target to reason about.
 */
export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(request: NextRequest): Promise<Response> {
  return handle(async () => {
    const actor = identify(request);
    const url = new URL(request.url);
    const includeDeleted = url.searchParams.get("deleted") === "1";

    // The recycle bin is admin-only. Everyone else never sees a deleted character at all.
    if (includeDeleted && actor.role !== "ADMIN") {
      const characters = await listCharacters({ ownerId: actor.id, includeDeleted: false });
      return NextResponse.json({ characters: characters.map(toSummary) });
    }

    const characters = await listCharacters({
      // An admin sees everything; an owner sees their own. A race client has no library.
      ...(actor.role === "ADMIN" ? {} : { ownerId: actor.id }),
      includeDeleted,
      ...(url.searchParams.get("q") ? { search: url.searchParams.get("q")! } : {}),
      favouritesOnly: url.searchParams.get("favourites") === "1",
    });
    return NextResponse.json({ characters: characters.map(toSummary) });
  });
}

export async function POST(request: NextRequest): Promise<Response> {
  return handle(async () => {
    const actor = requireOwner(request);
    const body = await readJson(request);
    const character = await createCharacter({
      name: body.name,
      appearance: body.appearance,
      defaultKartId: typeof body.defaultKartId === "string" ? body.defaultKartId : null,
      ownerId: actor.id,
    });
    // 201 with the full character: the studio needs its id and version immediately to start
    // autosaving, and a second round trip to fetch what we just wrote would be wasted.
    return NextResponse.json({ character }, { status: 201 });
  });
}
