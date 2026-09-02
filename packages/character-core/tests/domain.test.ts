import { describe, expect, it } from "vitest";
import {
  APPEARANCE_LIMITS,
  DEFAULT_APPEARANCE,
  FALLBACK_RUNTIME,
  isRuntimeStale,
  significantChanges,
  slugify,
  snapshotOf,
  toRuntime,
  toSummary,
  validateAppearance,
  validateName,
  type Character,
} from "../src/index.js";

/**
 * The domain rules.
 *
 * These are the rules the studio and the race server both depend on, so they are tested here rather
 * than through an endpoint: a validator that only fails inside an HTTP handler is a validator whose
 * behaviour nobody can pin down.
 */

function character(overrides: Partial<Character> = {}): Character {
  return {
    id: "11111111-1111-4111-8111-111111111111",
    name: "Carlos",
    slug: "carlos",
    ownerId: "studio",
    status: "READY",
    isActive: true,
    isPublic: false,
    isFavourite: false,
    version: 3,
    appearance: { ...DEFAULT_APPEARANCE },
    face: null,
    defaultKartId: null,
    avatarThumbnailUrl: null,
    renderPreviewUrl: null,
    createdAt: "2026-09-01T00:00:00.000Z",
    updatedAt: "2026-09-01T00:00:00.000Z",
    lastUsedAt: null,
    deletedAt: null,
    deletedBy: null,
    ...overrides,
  };
}

describe("names", () => {
  it("rejects an empty name and accepts a real one", () => {
    expect(validateName("").ok).toBe(false);
    expect(validateName("   ").ok).toBe(false);
    expect(validateName("María").ok).toBe(true);
    expect(validateName("María").value).toBe("María");
  });

  it("strips paste artefacts instead of refusing them", () => {
    // A zero-width space from a copied cell is not something a person typed, and refusing the name
    // over a character they cannot see is the worst possible error message.
    const result = validateName("Antoine​");
    expect(result.ok).toBe(true);
    expect(result.value).toBe("Antoine");
  });

  it("caps the length at fifty", () => {
    const result = validateName("x".repeat(80));
    expect(result.ok).toBe(false);
    expect(result.value).toHaveLength(50);
  });

  it("slugifies without carrying accents or spaces into a URL", () => {
    expect(slugify("María José")).toBe("maria-jose");
    expect(slugify("!!!")).toBe("piloto");
  });
});

describe("appearance validation", () => {
  it("returns a complete appearance from nothing at all", () => {
    const result = validateAppearance(undefined);
    expect(result.ok).toBe(true);
    expect(result.value.top).toBe(DEFAULT_APPEARANCE.top);
    expect(Object.keys(result.value)).toHaveLength(Object.keys(DEFAULT_APPEARANCE).length);
  });

  /**
   * The property that keeps a character openable forever.
   *
   * A preset that is renamed or removed must not make an existing character unloadable — that is a
   * character its owner can never edit again. Unknown values become the default and are reported.
   */
  it("falls back on an unknown preset rather than failing", () => {
    const result = validateAppearance({ ...DEFAULT_APPEARANCE, hairStyle: "MULLET_99" });
    expect(result.ok).toBe(true);
    expect(result.value.hairStyle).toBe(DEFAULT_APPEARANCE.hairStyle);
    expect(result.issues.some((issue) => issue.path === "hairStyle" && issue.severity === "WARNING")).toBe(true);
  });

  it("refuses a malformed colour, because that is data corruption rather than drift", () => {
    const result = validateAppearance({ ...DEFAULT_APPEARANCE, primaryColor: "rojo" });
    expect(result.ok).toBe(false);
    expect(result.issues.some((issue) => issue.severity === "ERROR")).toBe(true);
  });

  it("clamps a proportion to the range that keeps the driver in the kart", () => {
    const result = validateAppearance({ ...DEFAULT_APPEARANCE, heightScale: 4 });
    expect(result.value.heightScale).toBe(APPEARANCE_LIMITS.heightScale.max);
    expect(result.ok).toBe(true);
  });

  it("resolves a helmet-and-sunglasses clash by clearing the face slot", () => {
    const result = validateAppearance({
      ...DEFAULT_APPEARANCE,
      accessoryHead: "HELMET",
      accessoryFace: "SUNGLASSES",
    });
    expect(result.value.accessoryHead).toBe("HELMET");
    expect(result.value.accessoryFace).toBe("NONE");
  });

  it("treats a racing suit as one garment", () => {
    const top = validateAppearance({ ...DEFAULT_APPEARANCE, top: "RACING_SUIT", bottom: "JEANS" });
    expect(top.value.bottom).toBe("RACING_SUIT");
    const bottom = validateAppearance({ ...DEFAULT_APPEARANCE, top: "HOODIE", bottom: "RACING_SUIT" });
    expect(bottom.value.top).toBe("RACING_SUIT");
  });

  it("only prints on something printable", () => {
    const result = validateAppearance({ ...DEFAULT_APPEARANCE, top: "HOODIE", shirtDesign: "BOLT" });
    expect(result.value.shirtDesign).toBe("NONE");
  });
});

describe("versioning", () => {
  it("counts a wardrobe change as significant and a slider nudge as not", () => {
    const before = character();
    expect(
      significantChanges(before, { ...before, appearance: { ...before.appearance, jacket: "BOMBER" } }),
    ).toContain("jacket");
    // Proportion sliders move constantly during editing. A version per pixel of drag would bury the
    // history that matters under noise.
    expect(
      significantChanges(before, { ...before, appearance: { ...before.appearance, bodyWidth: 1.03 } }),
    ).toEqual([]);
  });

  it("counts a rename and a kart change", () => {
    const before = character();
    expect(significantChanges(before, { ...before, name: "Ricardo" })).toContain("name");
    expect(significantChanges(before, { ...before, defaultKartId: "kart-9" })).toContain("defaultKartId");
  });

  /**
   * A snapshot must not become a second copy of a photograph.
   *
   * It carries the styled game texture, because a rollback should restore the face the character was
   * wearing. It must never carry the original.
   */
  it("snapshots the styled face and nothing more private than that", () => {
    const snapshot = snapshotOf(
      character({
        face: {
          id: "f",
          characterId: "c",
          state: "READY",
          failureReason: null,
          originalUrl: "/api/characters/media?path=characters/c/original/x.jpg",
          croppedUrl: "/api/characters/media?path=characters/c/face/x.png",
          gameTextureUrl: "/api/characters/media?path=characters/c/textures/x.png",
          thumbnailUrl: null,
          crop: { x: 0, y: 0, width: 1, height: 1, rotation: 0, zoom: 1 },
          processingVersion: 1,
          createdAt: "",
          updatedAt: "",
        },
      }),
    );
    expect(snapshot.faceGameTextureUrl).toContain("/textures/");
    expect(JSON.stringify(snapshot)).not.toContain("/original/");
  });
});

describe("runtime projection", () => {
  /**
   * The privacy boundary, asserted.
   *
   * Everything a rival client learns about another player goes through `toRuntime`, so this is the
   * test that has to hold: no original photograph, no pre-styling crop, ever.
   */
  it("never carries the original photograph or the crop", () => {
    const runtime = toRuntime(
      character({
        face: {
          id: "f",
          characterId: "c",
          state: "READY",
          failureReason: null,
          originalUrl: "/api/characters/media?path=characters/c/original/secret.jpg",
          croppedUrl: "/api/characters/media?path=characters/c/face/secret.png",
          gameTextureUrl: "/api/characters/media?path=characters/c/textures/ok.png",
          thumbnailUrl: "/api/characters/media?path=characters/c/previews/ok.png",
          crop: { x: 0.1, y: 0.2, width: 0.5, height: 0.5, rotation: 0, zoom: 2 },
          processingVersion: 1,
          createdAt: "",
          updatedAt: "",
        },
      }),
    );
    const serialised = JSON.stringify(runtime);
    expect(serialised).not.toContain("/original/");
    expect(serialised).not.toContain("/face/");
    expect(serialised).not.toContain("secret");
    expect(runtime.faceTextureUrl).toContain("/textures/");
  });

  it("offers no texture while a face is still processing or has failed", () => {
    const base = character();
    for (const state of ["UPLOADED", "VALIDATING", "PROCESSING", "FAILED"] as const) {
      const runtime = toRuntime(
        character({
          face: {
            id: "f",
            characterId: base.id,
            state,
            failureReason: null,
            originalUrl: null,
            croppedUrl: null,
            gameTextureUrl: "/api/characters/media?path=characters/c/textures/half.png",
            thumbnailUrl: null,
            crop: { x: 0, y: 0, width: 1, height: 1, rotation: 0, zoom: 1 },
            processingVersion: 1,
            createdAt: "",
            updatedAt: "",
          },
        }),
      );
      expect(runtime.faceTextureUrl, state).toBeNull();
    }
  });

  it("has a fallback that cannot itself fail to load", () => {
    // No URLs at all: this is what a race falls back to, so it must need no network.
    expect(FALLBACK_RUNTIME.faceTextureUrl).toBeNull();
    expect(FALLBACK_RUNTIME.avatarThumbnailUrl).toBeNull();
    expect(FALLBACK_RUNTIME.appearance.accessoryHead).toBe("HELMET");
  });

  it("detects a stale cached runtime by version alone", () => {
    const runtime = toRuntime(character({ version: 3 }));
    expect(isRuntimeStale(runtime, { version: 3 })).toBe(false);
    expect(isRuntimeStale(runtime, { version: 4 })).toBe(true);
  });

  it("keeps the library row thin", () => {
    const summary = toSummary(character());
    expect(summary).not.toHaveProperty("appearance");
    expect(summary).not.toHaveProperty("face");
    expect(summary.name).toBe("Carlos");
  });
});
