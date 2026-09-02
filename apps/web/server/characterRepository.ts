import { randomUUID } from "node:crypto";
import {
  DEFAULT_APPEARANCE,
  slugify,
  snapshotOf,
  significantChanges,
  validateAppearance,
  validateName,
  VersionConflictError,
  type Character,
  type CharacterAppearance,
  type CharacterFace,
  type CharacterStatus,
  type FaceCrop,
  type FaceProcessingState,
} from "@print-rush/character-core";
import { deleteMedia, listCharacterMedia } from "./blobStore";
import { sql } from "./db";

/**
 * Character persistence.
 *
 * Every write is a single statement. That is not an accident of style: the HTTP database driver
 * issues one statement per request and cannot hold a transaction, so anything needing two writes to
 * be atomic would need a different driver and a held connection. Rather than pretend, the schema and
 * these queries are shaped so that no user-facing operation needs a transaction — the one place two
 * writes are genuinely related (an update plus its version snapshot) is ordered so that a failure
 * between them leaves the character correct and the history one row short, which is the harmless
 * direction.
 *
 * The optimistic lock lives in the WHERE clause. `UPDATE ... WHERE id = $1 AND version = $2` either
 * matches and bumps, or matches nothing — and matching nothing is how a second browser tab finds out
 * it was working from a stale copy, instead of silently discarding the first tab's work.
 */

export class NotFoundError extends Error {
  constructor(id: string) {
    super(`No existe el personaje ${id}.`);
    this.name = "NotFoundError";
  }
}

type CharacterRow = {
  id: string;
  name: string;
  slug: string;
  owner_id: string;
  status: CharacterStatus;
  is_active: boolean;
  is_public: boolean;
  is_favourite: boolean;
  version: number;
  appearance: unknown;
  default_kart_id: string | null;
  avatar_thumb: string | null;
  render_preview: string | null;
  created_at: string;
  updated_at: string;
  last_used_at: string | null;
  deleted_at: string | null;
  deleted_by: string | null;
};

type FaceRow = {
  character_id: string;
  id: string;
  state: FaceProcessingState;
  failure_reason: string | null;
  original_path: string | null;
  cropped_path: string | null;
  game_texture_path: string | null;
  thumbnail_path: string | null;
  crop: unknown;
  processing_version: number;
  pending_texture_path: string | null;
  pending_thumb_path: string | null;
  thumbnails: unknown;
  pending_thumbnails: unknown;
  created_at: string;
  updated_at: string;
};

const DEFAULT_CROP: FaceCrop = { x: 0, y: 0, width: 1, height: 1, rotation: 0, zoom: 1 };

/**
 * The stored thumbnail map, as media URLs keyed by pixel size.
 *
 * Tolerates an absent or malformed column: a face written before migration 002 has an empty map and
 * the caller falls back to `thumbnailUrl`. Returning an empty object rather than throwing is what
 * keeps an older row openable.
 */
function thumbnailMap(value: unknown): Record<string, string> {
  if (typeof value !== "object" || value === null) return {};
  const out: Record<string, string> = {};
  for (const [size, path] of Object.entries(value as Record<string, unknown>)) {
    if (typeof path === "string" && path.length > 0 && /^[0-9]+$/.test(size)) {
      const url = mediaUrl(path);
      if (url) out[size] = url;
    }
  }
  return out;
}

/** Every string value in a JSONB object column, for the cleanup paths. */
function storedPaths(value: unknown): string[] {
  if (typeof value !== "object" || value === null) return [];
  return Object.values(value as Record<string, unknown>).filter(
    (entry): entry is string => typeof entry === "string" && entry.length > 0,
  );
}

/**
 * Turns a stored pathname into the URL a client should use.
 *
 * Always the media route, never the blob URL. The store is private so a blob URL would 403 anyway,
 * but routing every read through here is also what makes the access check impossible to bypass by
 * accident, and what gives the URL a stable shape the browser can cache.
 */
function mediaUrl(pathname: string | null): string | null {
  return pathname ? `/api/characters/media?path=${encodeURIComponent(pathname)}` : null;
}

function toFace(row: FaceRow | undefined): CharacterFace | null {
  if (!row) return null;
  const crop = (typeof row.crop === "object" && row.crop !== null ? row.crop : {}) as Partial<FaceCrop>;
  return {
    id: row.id,
    characterId: row.character_id,
    state: row.state,
    failureReason: row.failure_reason,
    originalUrl: mediaUrl(row.original_path),
    croppedUrl: mediaUrl(row.cropped_path),
    gameTextureUrl: mediaUrl(row.game_texture_path),
    thumbnailUrl: mediaUrl(row.thumbnail_path),
    thumbnails: thumbnailMap(row.thumbnails),
    crop: { ...DEFAULT_CROP, ...crop },
    processingVersion: row.processing_version,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

function toCharacter(row: CharacterRow, face: FaceRow | undefined): Character {
  // The stored appearance is revalidated on read, not trusted. A schema that gained a field, or a
  // renamed preset, would otherwise surface as a crash in the renderer rather than as a filled-in
  // default here.
  const appearance = validateAppearance(row.appearance).value;
  return {
    id: row.id,
    name: row.name,
    slug: row.slug,
    ownerId: row.owner_id,
    status: row.status,
    isActive: row.is_active,
    isPublic: row.is_public,
    isFavourite: row.is_favourite,
    version: row.version,
    appearance,
    face: toFace(face),
    defaultKartId: row.default_kart_id,
    avatarThumbnailUrl: mediaUrl(row.avatar_thumb) ?? toFace(face)?.thumbnailUrl ?? null,
    renderPreviewUrl: mediaUrl(row.render_preview),
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    lastUsedAt: row.last_used_at,
    deletedAt: row.deleted_at,
    deletedBy: row.deleted_by,
  };
}

export type ListOptions = {
  ownerId?: string;
  /** Include soft-deleted characters. The recycle bin, and admin only. */
  includeDeleted?: boolean;
  search?: string;
  favouritesOnly?: boolean;
  limit?: number;
};

export async function listCharacters(options: ListOptions = {}): Promise<Character[]> {
  const query = sql();
  const limit = Math.min(200, Math.max(1, options.limit ?? 60));
  const rows = (await query.query(
    `SELECT * FROM characters
      WHERE ($1::text IS NULL OR owner_id = $1)
        AND ($2::boolean OR deleted_at IS NULL)
        AND ($3::text IS NULL OR lower(name) LIKE '%' || lower($3) || '%')
        AND ($4::boolean = false OR is_favourite = true)
      ORDER BY (last_used_at IS NULL), last_used_at DESC, updated_at DESC
      LIMIT ${limit}`,
    [options.ownerId ?? null, options.includeDeleted ?? false, options.search ?? null, options.favouritesOnly ?? false],
  )) as CharacterRow[];

  if (rows.length === 0) return [];
  const faces = (await query.query(
    `SELECT * FROM character_faces WHERE character_id = ANY($1::uuid[])`,
    [rows.map((row) => row.id)],
  )) as FaceRow[];
  const byCharacter = new Map(faces.map((face) => [face.character_id, face]));
  return rows.map((row) => toCharacter(row, byCharacter.get(row.id)));
}

export async function getCharacter(id: string): Promise<Character | null> {
  const query = sql();
  const rows = (await query.query("SELECT * FROM characters WHERE id = $1", [id])) as CharacterRow[];
  const row = rows[0];
  if (!row) return null;
  const faces = (await query.query("SELECT * FROM character_faces WHERE character_id = $1", [id])) as FaceRow[];
  return toCharacter(row, faces[0]);
}

export type CreateInput = {
  name: unknown;
  appearance?: unknown;
  defaultKartId?: string | null;
  ownerId: string;
};

export async function createCharacter(input: CreateInput): Promise<Character> {
  const name = validateName(input.name);
  if (!name.ok) throw new ValidationError(name.issues.map((issue) => issue.message));
  const appearance = validateAppearance(input.appearance ?? DEFAULT_APPEARANCE);
  if (!appearance.ok) throw new ValidationError(appearance.issues.map((issue) => issue.message));

  const id = randomUUID();
  const query = sql();
  const rows = (await query.query(
    `INSERT INTO characters (id, name, slug, owner_id, status, appearance, default_kart_id)
       VALUES ($1, $2, $3, $4, 'DRAFT', $5::jsonb, $6)
       RETURNING *`,
    [id, name.value, slugify(name.value), input.ownerId, JSON.stringify(appearance.value), input.defaultKartId ?? null],
  )) as CharacterRow[];

  await audit(id, "CHARACTER_CREATED", input.ownerId, { name: name.value });
  return toCharacter(rows[0]!, undefined);
}

export class ValidationError extends Error {
  constructor(readonly messages: readonly string[]) {
    super(messages.join(" "));
    this.name = "ValidationError";
  }
}

export type UpdateInput = {
  name?: unknown;
  appearance?: unknown;
  defaultKartId?: string | null;
  isFavourite?: boolean;
  /** Deactivating hides a character from selection without deleting it. Admin tooling uses this. */
  isActive?: boolean;
  status?: CharacterStatus;
  /** The version the caller last read. Omit to skip the lock, which only the admin tools do. */
  expectedVersion?: number;
};

/**
 * Updates a character, bumping its version and recording a snapshot when the change is significant.
 *
 * The order is: read current, write, then snapshot the *previous* state. Snapshotting after the
 * write means a crash between the two loses a history row rather than leaving history that claims a
 * change which did not happen — and a missing snapshot is recoverable, a lying one is not.
 */
export async function updateCharacter(
  id: string,
  actorId: string,
  input: UpdateInput,
): Promise<Character> {
  const before = await getCharacter(id);
  if (!before || before.deletedAt) throw new NotFoundError(id);

  const messages: string[] = [];
  let name = before.name;
  if (input.name !== undefined) {
    const validated = validateName(input.name);
    if (!validated.ok) messages.push(...validated.issues.map((issue) => issue.message));
    name = validated.value;
  }
  let appearance: CharacterAppearance = before.appearance;
  if (input.appearance !== undefined) {
    const validated = validateAppearance(input.appearance);
    if (!validated.ok) messages.push(...validated.issues.filter((i) => i.severity === "ERROR").map((i) => i.message));
    appearance = validated.value;
  }
  if (messages.length > 0) throw new ValidationError(messages);

  const defaultKartId = input.defaultKartId !== undefined ? input.defaultKartId : before.defaultKartId;
  const isFavourite = input.isFavourite ?? before.isFavourite;
  const isActive = input.isActive ?? before.isActive;
  const status = input.status ?? before.status;

  const after = { name, appearance, defaultKartId };
  const reasons = significantChanges(before, after);
  const nextVersion = reasons.length > 0 ? before.version + 1 : before.version;

  const query = sql();
  const rows = (await query.query(
    `UPDATE characters
        SET name = $3, slug = $4, appearance = $5::jsonb, default_kart_id = $6,
            is_favourite = $7, status = $8, version = $9, is_active = $10, updated_at = now()
      WHERE id = $1
        AND deleted_at IS NULL
        AND ($2::integer IS NULL OR version = $2)
      RETURNING *`,
    [
      id,
      input.expectedVersion ?? null,
      name,
      slugify(name),
      JSON.stringify(appearance),
      defaultKartId,
      isFavourite,
      status,
      nextVersion,
      isActive,
    ],
  )) as CharacterRow[];

  if (rows.length === 0) {
    // Nothing matched. Either it was deleted underneath us, or the version moved — and the caller
    // needs to be told which, because one is a dead end and the other is a merge.
    const current = await getCharacter(id);
    if (!current || current.deletedAt) throw new NotFoundError(id);
    throw new VersionConflictError(input.expectedVersion ?? -1, current.version);
  }

  if (reasons.length > 0) {
    await query.query(
      `INSERT INTO character_versions (id, character_id, version, snapshot, created_by)
         VALUES ($1, $2, $3, $4::jsonb, $5)
         ON CONFLICT (character_id, version) DO NOTHING`,
      [randomUUID(), id, before.version, JSON.stringify(snapshotOf(before)), actorId],
    );
    await audit(id, "CHARACTER_UPDATED", actorId, { fields: reasons });
  }

  const faces = (await query.query("SELECT * FROM character_faces WHERE character_id = $1", [id])) as FaceRow[];
  return toCharacter(rows[0]!, faces[0]);
}

/** Marks a character used, so the library can sort by it. Not versioned — it is not a change. */
export async function touchLastUsed(id: string): Promise<void> {
  await sql().query("UPDATE characters SET last_used_at = now() WHERE id = $1", [id]);
}

/** Soft delete. Files stay, per the brief's recovery window. */
export async function softDeleteCharacter(id: string, actorId: string): Promise<void> {
  const rows = (await sql().query(
    `UPDATE characters SET deleted_at = now(), deleted_by = $2, is_active = false, updated_at = now()
      WHERE id = $1 AND deleted_at IS NULL RETURNING id`,
    [id, actorId],
  )) as { id: string }[];
  if (rows.length === 0) throw new NotFoundError(id);
  await audit(id, "CHARACTER_DELETED", actorId, {});
}

export async function restoreCharacter(id: string, actorId: string): Promise<Character> {
  const rows = (await sql().query(
    `UPDATE characters SET deleted_at = NULL, deleted_by = NULL, is_active = true, updated_at = now()
      WHERE id = $1 AND deleted_at IS NOT NULL RETURNING *`,
    // Only the id: `deleted_by` is cleared to NULL rather than set, so there is no second
    // placeholder. Passing `actorId` here made the driver reject the statement outright.
    [id],
  )) as CharacterRow[];
  if (rows.length === 0) throw new NotFoundError(id);
  await audit(id, "CHARACTER_RESTORED", actorId, {});
  const faces = (await sql().query("SELECT * FROM character_faces WHERE character_id = $1", [id])) as FaceRow[];
  return toCharacter(rows[0]!, faces[0]);
}

/**
 * Permanently removes a character and its files.
 *
 * Only after the recovery window, and the files go by prefix listing rather than by the paths in the
 * database — an upload whose row never landed is exactly the orphan a database-driven cleanup would
 * miss forever.
 */
export async function purgeCharacter(id: string, actorId: string): Promise<void> {
  const media = await listCharacterMedia(id).catch(() => [] as string[]);
  await deleteMedia(media);
  await sql().query("DELETE FROM characters WHERE id = $1", [id]);
  await audit(null, "CHARACTER_PURGED", actorId, { characterId: id, files: media.length });
}

export type DuplicateOptions = {
  /** Copy the face too. False produces the brief's "same look, no photograph" clone. */
  withFace: boolean;
  name?: string;
};

/**
 * Duplicates a character.
 *
 * The face is *referenced*, not copied, when `withFace` is set: the same styled texture serves both,
 * which avoids a second copy of a colleague's likeness in storage for what is meant to be a quick
 * variation. The original photograph is never carried over — a duplicate has no business holding a
 * second reference to it.
 */
export async function duplicateCharacter(
  id: string,
  actorId: string,
  options: DuplicateOptions,
): Promise<Character> {
  const source = await getCharacter(id);
  if (!source || source.deletedAt) throw new NotFoundError(id);

  const name = validateName(options.name ?? `${source.name} (copia)`);
  const newId = randomUUID();
  const query = sql();
  const rows = (await query.query(
    `INSERT INTO characters (id, name, slug, owner_id, status, appearance, default_kart_id, is_public)
       VALUES ($1, $2, $3, $4, $5, $6::jsonb, $7, false)
       RETURNING *`,
    [
      newId,
      name.value,
      slugify(name.value),
      actorId,
      source.status === "READY" ? "READY" : "DRAFT",
      JSON.stringify(source.appearance),
      source.defaultKartId,
    ],
  )) as CharacterRow[];

  let face: FaceRow | undefined;
  if (options.withFace && source.face?.state === "READY") {
    const sourceFace = (await query.query("SELECT * FROM character_faces WHERE character_id = $1", [id])) as FaceRow[];
    const original = sourceFace[0];
    if (original) {
      const inserted = (await query.query(
        `INSERT INTO character_faces
           (character_id, id, state, game_texture_path, thumbnail_path, crop, processing_version, thumbnails)
         VALUES ($1, $2, 'READY', $3, $4, $5::jsonb, $6, $7::jsonb)
         RETURNING *`,
        [
          newId,
          randomUUID(),
          original.game_texture_path,
          original.thumbnail_path,
          JSON.stringify(original.crop ?? {}),
          original.processing_version,
          // The map is referenced, not re-uploaded: one styled set serves both characters.
          JSON.stringify(original.thumbnails ?? {}),
        ],
      )) as FaceRow[];
      face = inserted[0];
    }
  }

  await audit(newId, "CHARACTER_DUPLICATED", actorId, { from: id, withFace: options.withFace });
  return toCharacter(rows[0]!, face);
}

// ---------------------------------------------------------------------------- faces

export async function upsertFaceUpload(
  characterId: string,
  originalPath: string,
  croppedPath: string,
  crop: FaceCrop,
): Promise<CharacterFace> {
  const rows = (await sql().query(
    `INSERT INTO character_faces
       (character_id, id, state, original_path, cropped_path, crop, failure_reason, updated_at)
     VALUES ($1, $2, 'UPLOADED', $3, $4, $5::jsonb, NULL, now())
     ON CONFLICT (character_id) DO UPDATE
       SET id = EXCLUDED.id,
           state = 'UPLOADED',
           original_path = EXCLUDED.original_path,
           cropped_path = EXCLUDED.cropped_path,
           crop = EXCLUDED.crop,
           failure_reason = NULL,
           updated_at = now()
     RETURNING *`,
    [characterId, randomUUID(), originalPath, croppedPath, JSON.stringify(crop)],
  )) as FaceRow[];
  return toFace(rows[0])!;
}

export async function setFaceState(
  characterId: string,
  state: FaceProcessingState,
  failureReason: string | null = null,
): Promise<void> {
  await sql().query(
    "UPDATE character_faces SET state = $2, failure_reason = $3, updated_at = now() WHERE character_id = $1",
    [characterId, state, failureReason],
  );
}

/**
 * Stores a freshly styled face as *pending*, leaving the live one alone.
 *
 * This is the brief's safe-regeneration rule, and it is a schema-level guarantee rather than a
 * convention: there is nowhere for this write to put a texture that would become live, so a restyle
 * cannot replace a working face by accident.
 */
export async function setPendingFace(
  characterId: string,
  texturePath: string,
  thumbnails: Record<number, string>,
  processingVersion: number,
): Promise<void> {
  // The 128 px one stays in `pending_thumb_path` as the default a caller gets from `thumbnailUrl`;
  // the whole set goes in the map. Writing both means an older reader and a newer one agree.
  const primary = thumbnails[128] ?? Object.values(thumbnails)[0] ?? null;
  await sql().query(
    `UPDATE character_faces
        SET pending_texture_path = $2, pending_thumb_path = $3, pending_thumbnails = $4::jsonb,
            processing_version = $5, state = 'PROCESSING', failure_reason = NULL, updated_at = now()
      WHERE character_id = $1`,
    [characterId, texturePath, primary, JSON.stringify(thumbnails), processingVersion],
  );
}

/**
 * Promotes the pending face to live, and returns the paths that are now unused.
 *
 * The old files are returned rather than deleted here so the caller can delete them *after* the
 * database says the swap happened. Deleting first would mean a failed update leaves a character
 * pointing at a texture that no longer exists.
 */
export async function confirmPendingFace(characterId: string): Promise<{ replaced: string[] }> {
  const rows = (await sql().query("SELECT * FROM character_faces WHERE character_id = $1", [characterId])) as FaceRow[];
  const face = rows[0];
  if (!face?.pending_texture_path) throw new NotFoundError(characterId);

  const replaced = [face.game_texture_path, face.thumbnail_path, ...storedPaths(face.thumbnails)].filter(
    (path): path is string => typeof path === "string" && path.length > 0,
  );

  await sql().query(
    `UPDATE character_faces
        SET game_texture_path = pending_texture_path,
            thumbnail_path = pending_thumb_path,
            thumbnails = pending_thumbnails,
            pending_texture_path = NULL,
            pending_thumb_path = NULL,
            pending_thumbnails = '{}'::jsonb,
            state = 'READY',
            failure_reason = NULL,
            updated_at = now()
      WHERE character_id = $1`,
    [characterId],
  );
  // A character with a face is no longer a draft.
  await sql().query("UPDATE characters SET status = 'READY', updated_at = now() WHERE id = $1 AND status = 'DRAFT'", [
    characterId,
  ]);
  return { replaced };
}

/** Discards a pending face. Returns its paths so the caller can clean them up. */
export async function discardPendingFace(characterId: string): Promise<{ discarded: string[] }> {
  const rows = (await sql().query("SELECT * FROM character_faces WHERE character_id = $1", [characterId])) as FaceRow[];
  const face = rows[0];
  const discarded = [
    face?.pending_texture_path,
    face?.pending_thumb_path,
    ...storedPaths(face?.pending_thumbnails),
  ].filter((path): path is string => typeof path === "string" && path.length > 0);
  await sql().query(
    `UPDATE character_faces
        SET pending_texture_path = NULL, pending_thumb_path = NULL, pending_thumbnails = '{}'::jsonb,
            state = CASE WHEN game_texture_path IS NULL THEN 'UPLOADED' ELSE 'READY' END,
            updated_at = now()
      WHERE character_id = $1`,
    [characterId],
  );
  return { discarded };
}

/** Removes the photograph and everything derived from it, keeping the character. */
export async function deleteFace(characterId: string, actorId: string): Promise<string[]> {
  const rows = (await sql().query("SELECT * FROM character_faces WHERE character_id = $1", [characterId])) as FaceRow[];
  const face = rows[0];
  if (!face) return [];
  const paths = [
    face.original_path,
    face.cropped_path,
    face.game_texture_path,
    face.thumbnail_path,
    face.pending_texture_path,
    face.pending_thumb_path,
    ...storedPaths(face.thumbnails),
    ...storedPaths(face.pending_thumbnails),
  ].filter((path): path is string => typeof path === "string" && path.length > 0);
  await sql().query("DELETE FROM character_faces WHERE character_id = $1", [characterId]);
  await audit(characterId, "FACE_DELETED", actorId, {});
  return paths;
}

/**
 * Resolves a stored pathname back to the character that owns it, for the media route's check.
 *
 * The JSONB thumbnail maps are searched as well as the fixed columns. That is not thoroughness for
 * its own sake: when migration 002 moved the extra sizes into a map, these two queries still only
 * looked at the columns, so the 64 and 256 px thumbnails answered 404 to *everyone* — including their
 * own owner. It failed closed, so it was a broken feature rather than a leak, and it was invisible
 * because the tests asserted the map's contents without ever fetching one through the route.
 */
export async function ownerOfMedia(pathname: string): Promise<{ characterId: string; ownerId: string } | null> {
  const rows = (await sql().query(
    `SELECT c.id AS character_id, c.owner_id
       FROM character_faces f
       JOIN characters c ON c.id = f.character_id
      WHERE $1 IN (f.original_path, f.cropped_path, f.game_texture_path, f.thumbnail_path,
                   f.pending_texture_path, f.pending_thumb_path)
         OR EXISTS (SELECT 1 FROM jsonb_each_text(f.thumbnails) AS t(size, path) WHERE t.path = $1)
         OR EXISTS (SELECT 1 FROM jsonb_each_text(f.pending_thumbnails) AS p(size, path) WHERE p.path = $1)
      LIMIT 1`,
    [pathname],
  )) as { character_id: string; owner_id: string }[];
  const row = rows[0];
  return row ? { characterId: row.character_id, ownerId: row.owner_id } : null;
}

/**
 * Whether a pathname is safe to hand to a race client: only styled output, never a photograph.
 *
 * Includes the live thumbnail map — a lobby avatar is styled output by definition — but deliberately
 * *not* the pending one. A pending thumbnail belongs to a face its owner has not accepted yet, and
 * a rival has no business seeing a version of somebody that they may be about to reject.
 */
export async function isRaceVisibleMedia(pathname: string): Promise<boolean> {
  const rows = (await sql().query(
    `SELECT 1 FROM character_faces
      WHERE $1 IN (game_texture_path, thumbnail_path)
         OR EXISTS (SELECT 1 FROM jsonb_each_text(thumbnails) AS t(size, path) WHERE t.path = $1)
      LIMIT 1`,
    [pathname],
  )) as unknown[];
  return rows.length > 0;
}

// ---------------------------------------------------------------------------- audit

export async function audit(
  characterId: string | null,
  action: string,
  actor: string,
  detail: Record<string, unknown>,
): Promise<void> {
  try {
    await sql().query(
      "INSERT INTO character_audit (character_id, action, actor, detail) VALUES ($1, $2, $3, $4::jsonb)",
      [characterId, action, actor, JSON.stringify(detail)],
    );
  } catch {
    // The audit trail must never be the reason a user-facing action fails. A lost log line is worth
    // less than a lost character.
  }
}
