import { afterEach, describe, expect, it, vi } from "vitest";
import { FALLBACK_RUNTIME } from "@print-rush/character-core";
import { clearRuntimeCache, resolveRuntime } from "../src/characters.js";

/**
 * Server-side character resolution.
 *
 * The room used to broadcast whatever `CharacterDefinition` the joining client put in its options,
 * which meant a client described itself to every rival as fact. These tests pin the replacement: an
 * id goes in, a validated runtime comes out, and every failure path lands on the fallback driver
 * rather than on a broken lobby.
 */

const ORIGINAL_FETCH = globalThis.fetch;
const VALID_ID = "11111111-2222-4333-8444-555555555555";

function stubStudio(body: unknown, status = 200): void {
  process.env.CHARACTER_API_URL = "https://studio.test";
  globalThis.fetch = vi.fn(async () =>
    new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json" } }),
  ) as unknown as typeof fetch;
}

afterEach(() => {
  globalThis.fetch = ORIGINAL_FETCH;
  delete process.env.CHARACTER_API_URL;
  clearRuntimeCache();
  vi.restoreAllMocks();
});

describe("resolveRuntime", () => {
  it("refuses a malformed id without going near the network", async () => {
    let called = false;
    process.env.CHARACTER_API_URL = "https://studio.test";
    globalThis.fetch = (async () => {
      called = true;
      return new Response("{}");
    }) as unknown as typeof fetch;

    for (const bad of ["", "not-a-uuid", "../../etc/passwd", 42, null, undefined]) {
      expect(await resolveRuntime(bad)).toBe(FALLBACK_RUNTIME);
    }
    expect(called, "a malformed id must not produce a request").toBe(false);
  });

  it("returns the studio's character when it resolves", async () => {
    stubStudio({
      runtime: {
        id: VALID_ID,
        name: "Carlos",
        appearance: { top: "HOODIE", primaryColor: "#65d8ff" },
        faceTextureUrl: "/api/characters/media?path=characters/x/textures/y.png",
        avatarThumbnailUrl: "/api/characters/media?path=characters/x/previews/y.png",
        kartId: "kart-1",
        version: 7,
      },
    });

    const runtime = await resolveRuntime(VALID_ID);
    expect(runtime.name).toBe("Carlos");
    expect(runtime.appearance.top).toBe("HOODIE");
    expect(runtime.version).toBe(7);
    // Completed by the validator, not trusted as sent: the studio only supplied two fields.
    expect(Object.keys(runtime.appearance).length).toBeGreaterThan(20);
  });

  /**
   * The face URL is broadcast to every client in the room.
   *
   * So an absolute URL from anywhere else would turn one edited character into a request that every
   * player makes to a host of somebody else's choosing. Only a studio media path is accepted.
   */
  it("rejects a face URL that is not a studio media path", async () => {
    stubStudio({
      runtime: {
        id: VALID_ID,
        name: "Sospechoso",
        appearance: {},
        faceTextureUrl: "https://elsewhere.example/track.png",
        avatarThumbnailUrl: "//evil.example/pixel.gif",
        kartId: null,
        version: 1,
      },
    });
    const runtime = await resolveRuntime(VALID_ID);
    expect(runtime.faceTextureUrl).toBeNull();
    expect(runtime.avatarThumbnailUrl).toBeNull();
  });

  it("clamps an out-of-range appearance rather than relaying it", async () => {
    stubStudio({
      runtime: {
        id: VALID_ID,
        name: "Gigante",
        // A proportion far outside the limits that keep a driver in the kart.
        appearance: { heightScale: 9, headScale: 0.01 },
        faceTextureUrl: null,
        avatarThumbnailUrl: null,
        kartId: null,
        version: 1,
      },
    });
    const runtime = await resolveRuntime(VALID_ID);
    expect(runtime.appearance.heightScale).toBeLessThanOrEqual(1.12);
    expect(runtime.appearance.headScale).toBeGreaterThanOrEqual(0.92);
  });

  it("caps a name and never returns an empty one", async () => {
    stubStudio({
      runtime: { id: VALID_ID, name: "x".repeat(400), appearance: {}, faceTextureUrl: null, avatarThumbnailUrl: null, kartId: null, version: 1 },
    });
    expect((await resolveRuntime(VALID_ID)).name).toHaveLength(50);

    clearRuntimeCache();
    stubStudio({
      runtime: { id: VALID_ID, name: "   ", appearance: {}, faceTextureUrl: null, avatarThumbnailUrl: null, kartId: null, version: 1 },
    });
    expect((await resolveRuntime(VALID_ID)).name).toBe("Piloto");
  });

  it("falls back on a deleted character, a broken studio and a bad payload", async () => {
    stubStudio({ error: "gone" }, 404);
    expect(await resolveRuntime(VALID_ID)).toBe(FALLBACK_RUNTIME);

    clearRuntimeCache();
    process.env.CHARACTER_API_URL = "https://studio.test";
    globalThis.fetch = (async () => {
      throw new Error("network down");
    }) as unknown as typeof fetch;
    expect(await resolveRuntime(VALID_ID)).toBe(FALLBACK_RUNTIME);

    clearRuntimeCache();
    stubStudio({ runtime: { name: "sin id" } });
    expect(await resolveRuntime(VALID_ID)).toBe(FALLBACK_RUNTIME);
  });

  it("falls back when no studio is configured, without erroring", async () => {
    delete process.env.CHARACTER_API_URL;
    delete process.env.NEXT_PUBLIC_SITE_URL;
    expect(await resolveRuntime(VALID_ID)).toBe(FALLBACK_RUNTIME);
  });

  it("collapses a lobby's worth of joins into one request", async () => {
    stubStudio({
      runtime: { id: VALID_ID, name: "Cacheado", appearance: {}, faceTextureUrl: null, avatarThumbnailUrl: null, kartId: null, version: 2 },
    });
    for (let i = 0; i < 8; i += 1) await resolveRuntime(VALID_ID);
    // Eight players, one fetch. Without the cache a full lobby is eight identical requests.
    expect(globalThis.fetch).toHaveBeenCalledTimes(1);
  });
});
