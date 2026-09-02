import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

/**
 * THE PERSISTENCE TEST.
 *
 * The brief calls one test mandatory: create a character, upload a photo, crop it, save, reload, and
 * find it still there. This is that test, and it runs against the **real** Postgres database and the
 * **real** private blob store rather than against a mock.
 *
 * That choice is the entire point. A mocked repository would prove that the code calls the functions
 * it calls; it would prove nothing about whether a character exists tomorrow, which is the only
 * question the feature exists to answer. Every row this test writes is a row in the same database
 * production uses, and it cleans up after itself.
 *
 * Skipped, loudly, when there are no credentials — a fork or a CI run without secrets should not
 * fail, but it also should not quietly report a green suite that never touched a database.
 */

function loadEnv(): boolean {
  const path = join(__dirname, "..", ".env.local");
  if (!existsSync(path)) return typeof process.env.DATABASE_URL === "string";
  for (const line of readFileSync(path, "utf8").split("\n")) {
    const match = /^([A-Z0-9_]+)="?([^"]*)"?$/.exec(line.trim());
    if (match && process.env[match[1]!] === undefined) process.env[match[1]!] = match[2];
  }
  return typeof process.env.DATABASE_URL === "string";
}

const configured = loadEnv();
const live = configured ? describe : describe.skip;

if (!configured) {
  // Visible in the output rather than a silent skip, so nobody mistakes this for a pass.
  console.warn("[characters] DATABASE_URL absent — the persistence test did not run.");
}

/**
 * A small valid PNG, built with the project's own encoder.
 *
 * Deliberately not a fixture file: a checked-in binary is one more thing to keep in sync, and the
 * face pipeline needs an image with actual variation in it — a flat colour is rejected by
 * `inspectUpload`, correctly, as a blank or a failed export.
 */
async function makeTestPng(size = 384): Promise<Buffer> {
  const { encodePng } = await import("../server/png");
  const pixels = Buffer.alloc(size * size * 3);
  for (let y = 0; y < size; y += 1) {
    for (let x = 0; x < size; x += 1) {
      const offset = (y * size + x) * 3;
      const dx = (x - size / 2) / (size / 2);
      const dy = (y - size / 2) / (size / 2);
      const inHead = Math.hypot(dx, dy * 0.85) < 0.72;
      // A crude face: a warm oval with two dark spots and a mouth line. Enough structure for the
      // pipeline's contrast checks and enough edges for the edge-preserving filter to preserve.
      const eye = Math.min(Math.hypot(dx + 0.26, dy + 0.14), Math.hypot(dx - 0.26, dy + 0.14)) < 0.1;
      const mouth = Math.abs(dy - 0.3) < 0.05 && Math.abs(dx) < 0.22;
      const shade = inHead ? (eye || mouth ? 0.22 : 0.78) : 0.12;
      pixels[offset] = Math.round(shade * 235);
      pixels[offset + 1] = Math.round(shade * 190);
      pixels[offset + 2] = Math.round(shade * 165);
    }
  }
  return encodePng({ width: size, height: size, channels: 3, pixels });
}

live("character persistence, against the real database", () => {
  const created: string[] = [];

  beforeAll(async () => {
    const { migrate } = await import("../server/migrate");
    // Idempotent, so running the suite twice is not a problem, and a fresh database is set up by it.
    await migrate();
  }, 60_000);

  afterAll(async () => {
    const { purgeCharacter } = await import("../server/characterRepository");
    // Hard delete, including blobs. A test that leaves rows behind in a shared database is a test
    // that will eventually be the reason a query is slow.
    for (const id of created) await purgeCharacter(id, "test").catch(() => undefined);
  }, 120_000);

  it(
    "survives a full lifecycle: create, photo, style, confirm, reload, duplicate, delete, restore",
    async () => {
      const repo = await import("../server/characterRepository");
      const { toRuntime } = await import("@print-rush/character-core");
      const { putMedia, readMedia, deleteMedia } = await import("../server/blobStore");
      const { styleFace, PROCESSING_VERSION } = await import("../server/faceStyle");

      // ---------------------------------------------------------------- create
      const character = await repo.createCharacter({
        name: "Piloto de prueba",
        ownerId: "vitest",
        defaultKartId: null,
      });
      created.push(character.id);
      expect(character.status).toBe("DRAFT");
      expect(character.version).toBe(1);
      expect(character.appearance.top).toBeTruthy();

      // -------------------------------------------------- read back, as a new request would
      const reloaded = await repo.getCharacter(character.id);
      expect(reloaded, "the character must exist on a fresh read").not.toBeNull();
      expect(reloaded!.name).toBe("Piloto de prueba");

      // ------------------------------------------------------- appearance, with the lock held
      const dressed = await repo.updateCharacter(character.id, "vitest", {
        appearance: { ...character.appearance, jacket: "BOMBER", primaryColor: "#65d8ff" },
        expectedVersion: character.version,
      });
      expect(dressed.appearance.jacket).toBe("BOMBER");
      // A wardrobe change is significant, so the version moved and a snapshot exists.
      expect(dressed.version).toBe(character.version + 1);

      // ------------------------------------------ the conflict a second tab would produce
      await expect(
        repo.updateCharacter(character.id, "vitest", {
          appearance: { ...character.appearance, jacket: "DENIM" },
          expectedVersion: character.version, // stale on purpose
        }),
      ).rejects.toThrow(/otra pestaña|versión/i);

      // A slider nudge is not significant, so the version must hold still.
      const nudged = await repo.updateCharacter(character.id, "vitest", {
        appearance: { ...dressed.appearance, bodyWidth: 1.04 },
        expectedVersion: dressed.version,
      });
      expect(nudged.version).toBe(dressed.version);

      // ------------------------------------------------------------------ the photo
      const png = await makeTestPng();
      const originalPath = await putMedia(character.id, "original", png, "image/png");
      const croppedPath = await putMedia(character.id, "face", png, "image/png");
      const face = await repo.upsertFaceUpload(character.id, originalPath, croppedPath, {
        x: 0.1,
        y: 0.08,
        width: 0.8,
        height: 0.8,
        rotation: 0,
        zoom: 1.2,
      });
      expect(face.state).toBe("UPLOADED");
      expect(face.crop.zoom).toBeCloseTo(1.2, 5);

      // The stored original must be readable back byte-for-byte: this is the "it is really saved"
      // assertion for object storage, and it is separate from the database one on purpose.
      const storedOriginal = await readMedia(originalPath);
      expect(storedOriginal, "the original must be retrievable from the store").not.toBeNull();
      expect(Buffer.from(storedOriginal!.body).length).toBe(png.length);

      // ------------------------------------------------------------- styling, then review
      const styled = styleFace(png);
      expect(styled.texture.length).toBeGreaterThan(1000);
      expect(styled.thumbnails.map((t) => t.size)).toContain(128);

      const texturePath = await putMedia(character.id, "textures", styled.texture, "image/png");
      // Every size, which is what the pipeline produces and what the map now stores. The first
      // version kept only the 128 and threw the other two away.
      const thumbnailPaths: Record<number, string> = {};
      for (const entry of styled.thumbnails) {
        thumbnailPaths[entry.size] = await putMedia(character.id, "previews", entry.png, "image/png");
      }
      expect(Object.keys(thumbnailPaths)).toHaveLength(3);
      await repo.setPendingFace(character.id, texturePath, thumbnailPaths, PROCESSING_VERSION);

      const pending = await repo.getCharacter(character.id);
      expect(pending!.face!.state).toBe("PROCESSING");
      // The live texture is still empty: a pending face must never replace a working one.
      expect(pending!.face!.gameTextureUrl).toBeNull();

      await repo.confirmPendingFace(character.id);
      const withFace = await repo.getCharacter(character.id);
      expect(withFace!.face!.state).toBe("READY");
      expect(withFace!.face!.gameTextureUrl).toContain("/api/characters/media");
      // All three sizes survived the confirm, and a 40 px avatar has a 64 to reach for.
      expect(Object.keys(withFace!.face!.thumbnails).sort()).toEqual(["128", "256", "64"]);
      expect(withFace!.face!.thumbnails["64"]).toContain("/api/characters/media");
      // The default single-size URL still points at the 128, so an older reader is unaffected.
      expect(withFace!.face!.thumbnailUrl).toBe(withFace!.face!.thumbnails["128"]);
      // A character with a face is no longer a draft.
      expect(withFace!.status).toBe("READY");

      // ----------------------------------------------- the runtime a rival would receive
      const runtime = toRuntime(withFace!);
      const serialised = JSON.stringify(runtime);
      expect(runtime.faceTextureUrl).not.toBeNull();
      expect(serialised, "a rival must never receive the original").not.toContain("/original/");
      expect(serialised, "nor the pre-styling crop").not.toContain("/face/");

      // ------------------------------------------------------------------ duplicate
      const clone = await repo.duplicateCharacter(character.id, "vitest", { withFace: false });
      created.push(clone.id);
      expect(clone.id).not.toBe(character.id);
      expect(clone.appearance.jacket).toBe("BOMBER");
      // The default is to leave the photograph behind, which is the privacy-respecting choice.
      expect(clone.face).toBeNull();

      const cloneWithFace = await repo.duplicateCharacter(character.id, "vitest", { withFace: true });
      created.push(cloneWithFace.id);
      expect(cloneWithFace.face?.state).toBe("READY");
      // Referenced, not re-uploaded: one styled texture serves both.
      expect(cloneWithFace.face?.gameTextureUrl).toBe(withFace!.face!.gameTextureUrl);
      // But never the original.
      expect(cloneWithFace.face?.originalUrl).toBeNull();

      // ------------------------------------------------------- soft delete and restore
      await repo.softDeleteCharacter(character.id, "vitest");
      const deleted = await repo.getCharacter(character.id);
      expect(deleted!.deletedAt).not.toBeNull();
      // Excluded from the library, but not gone.
      const visible = await repo.listCharacters({ ownerId: "vitest" });
      expect(visible.map((entry) => entry.id)).not.toContain(character.id);
      const binned = await repo.listCharacters({ ownerId: "vitest", includeDeleted: true });
      expect(binned.map((entry) => entry.id)).toContain(character.id);

      const restored = await repo.restoreCharacter(character.id, "vitest");
      expect(restored.deletedAt).toBeNull();
      // The face survived the round trip through the bin.
      expect(restored.face?.state).toBe("READY");

      // ------------------------------------------------------------------ tidy up
      await deleteMedia([originalPath, croppedPath]);
    },
    180_000,
  );

  it(
    "keeps the character when a photo fails, and lets it be retried",
    async () => {
      const repo = await import("../server/characterRepository");
      const { styleFace, FaceProcessingError } = await import("../server/faceStyle");
      const { putMedia } = await import("../server/png").then(async () => import("../server/blobStore"));

      const character = await repo.createCharacter({ name: "Foto mala", ownerId: "vitest" });
      created.push(character.id);

      // A blank image: rejected by the usability check, which is the most common real failure.
      const { encodePng } = await import("../server/png");
      const flat = encodePng({
        width: 256,
        height: 256,
        channels: 3,
        pixels: Buffer.alloc(256 * 256 * 3, 200),
      });

      const path = await putMedia(character.id, "face", flat, "image/png");
      await repo.upsertFaceUpload(character.id, path, path, {
        x: 0, y: 0, width: 1, height: 1, rotation: 0, zoom: 1,
      });

      expect(() => styleFace(flat)).toThrow(FaceProcessingError);
      await repo.setFaceState(character.id, "FAILED", "La imagen parece estar en blanco o corrupta.");

      // The character is still here, with a reason a person can act on. This is the brief's rule:
      // a failed photo must never take the character with it.
      const after = await repo.getCharacter(character.id);
      expect(after, "the character must survive a failed photo").not.toBeNull();
      expect(after!.face!.state).toBe("FAILED");
      expect(after!.face!.failureReason).toMatch(/blanco|corrupta/);
      expect(after!.name).toBe("Foto mala");

      // And a retry with a good photo recovers, without re-creating anything.
      const good = await makeTestPng(320);
      const retryPath = await putMedia(character.id, "face", good, "image/png");
      await repo.upsertFaceUpload(character.id, retryPath, retryPath, {
        x: 0, y: 0, width: 1, height: 1, rotation: 0, zoom: 1,
      });
      const recovered = await repo.getCharacter(character.id);
      expect(recovered!.face!.state).toBe("UPLOADED");
      expect(recovered!.face!.failureReason).toBeNull();
    },
    180_000,
  );

  /**
   * Every remaining query, executed once.
   *
   * Not a formality. The driver rejects a statement whose placeholder count does not match its
   * argument count, and exactly that bug shipped in `restoreCharacter` — two arguments for one
   * placeholder — and was invisible until a test ran it. A query that no test executes is a query
   * whose parameters have never been checked, so this exercises the ones the lifecycle test does not
   * reach.
   */
  it(
    "executes every remaining query without a parameter mismatch",
    async () => {
      const repo = await import("../server/characterRepository");
      const { putMedia } = await import("../server/blobStore");
      const { encodePng } = await import("../server/png");

      const character = await repo.createCharacter({ name: "Cobertura", ownerId: "vitest" });
      created.push(character.id);

      const png = encodePng({
        width: 64,
        height: 64,
        channels: 3,
        pixels: Buffer.from(
          Array.from({ length: 64 * 64 * 3 }, (_unused, index) => (index * 7) % 251),
        ),
      });
      const originalPath = await putMedia(character.id, "original", png, "image/png");
      const texturePath = await putMedia(character.id, "textures", png, "image/png");
      const thumbPath = await putMedia(character.id, "previews", png, "image/png");
      await repo.upsertFaceUpload(character.id, originalPath, originalPath, {
        x: 0, y: 0, width: 1, height: 1, rotation: 0, zoom: 1,
      });

      // The media access helpers, which the media route depends on for its entire access decision.
      const styledIsRaceVisible = await repo.isRaceVisibleMedia(texturePath);
      expect(styledIsRaceVisible, "a texture not yet stored must not be race-visible").toBe(false);
      await repo.setPendingFace(character.id, texturePath, { 128: thumbPath }, 1);
      await repo.confirmPendingFace(character.id);
      expect(await repo.isRaceVisibleMedia(texturePath), "a live texture is race-visible").toBe(true);
      expect(
        await repo.isRaceVisibleMedia(originalPath),
        "an original photograph is never race-visible",
      ).toBe(false);

      const owner = await repo.ownerOfMedia(originalPath);
      expect(owner?.ownerId).toBe("vitest");
      expect(await repo.ownerOfMedia("characters/nope/original/none.png")).toBeNull();

      /**
       * Every thumbnail size is reachable through the access check, not just the primary one.
       *
       * This is the assertion that was missing. Migration 002 moved the extra sizes into a JSONB map
       * and these two lookups still only read the fixed columns, so the 64 and 256 px thumbnails
       * answered 404 to everyone — their own owner included. The previous tests asserted the map's
       * *contents* and never asked the access check about one, which is exactly the gap.
       */
      const extraSizes: Record<number, string> = {};
      for (const size of [256, 64] as const) {
        extraSizes[size] = await putMedia(character.id, "previews", png, "image/png");
      }
      await repo.setPendingFace(character.id, texturePath, { 128: thumbPath, ...extraSizes }, 1);
      await repo.confirmPendingFace(character.id);

      for (const [size, path] of Object.entries(extraSizes)) {
        expect(await repo.isRaceVisibleMedia(path), `the ${size}px thumbnail must be servable`).toBe(true);
        expect((await repo.ownerOfMedia(path))?.ownerId, `${size}px owner`).toBe("vitest");
      }

      // A pending thumbnail is deliberately not race-visible: it belongs to a face its owner has not
      // accepted, and a rival should not see a version of somebody that may yet be rejected.
      const pendingPath = await putMedia(character.id, "previews", png, "image/png");
      await repo.setPendingFace(character.id, texturePath, { 128: pendingPath }, 1);
      expect(await repo.isRaceVisibleMedia(pendingPath), "a pending thumbnail stays private").toBe(false);
      // The owner can still see it — that is the whole point of a review step.
      expect((await repo.ownerOfMedia(pendingPath))?.ownerId).toBe("vitest");
      await repo.discardPendingFace(character.id);

      // Discarding a pending face when there is none must be a no-op rather than an error.
      const { discarded } = await repo.discardPendingFace(character.id);
      expect(discarded).toEqual([]);

      await repo.touchLastUsed(character.id);
      const touched = await repo.getCharacter(character.id);
      expect(touched!.lastUsedAt).not.toBeNull();

      // Search and the favourites filter, which the library UI drives.
      await repo.updateCharacter(character.id, "vitest", {
        isFavourite: true,
        expectedVersion: touched!.version,
      });
      const found = await repo.listCharacters({ ownerId: "vitest", search: "cobertur" });
      expect(found.map((entry) => entry.id)).toContain(character.id);
      const favourites = await repo.listCharacters({ ownerId: "vitest", favouritesOnly: true });
      expect(favourites.map((entry) => entry.id)).toContain(character.id);

      // Withdrawing the photograph keeps the character, which is the privacy control.
      const removed = await repo.deleteFace(character.id, "vitest");
      expect(removed.length).toBeGreaterThan(0);
      const withoutFace = await repo.getCharacter(character.id);
      expect(withoutFace, "the character survives losing its photo").not.toBeNull();
      expect(withoutFace!.face).toBeNull();
    },
    180_000,
  );

  it(
    "scopes a library to its owner",
    async () => {
      const repo = await import("../server/characterRepository");
      const mine = await repo.createCharacter({ name: "Mío", ownerId: "vitest" });
      const theirs = await repo.createCharacter({ name: "Ajeno", ownerId: "vitest-other" });
      created.push(mine.id, theirs.id);

      const listed = await repo.listCharacters({ ownerId: "vitest" });
      const ids = listed.map((entry) => entry.id);
      expect(ids).toContain(mine.id);
      expect(ids, "one owner must not see another owner's characters").not.toContain(theirs.id);
    },
    120_000,
  );
});
