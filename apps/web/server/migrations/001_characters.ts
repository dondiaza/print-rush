/**
 * Migration 001 — the Character Studio schema.
 *
 * The SQL lives in a TypeScript module rather than a `.sql` file, and that is a deliberate
 * correction rather than a preference. A `.sql` file has to be found on disk, which means resolving
 * a path against `process.cwd()` — and `cwd` is the app root under `next start`, the repo root under
 * vitest, and whatever the bundler decided inside a serverless function. The first version read
 * `server/migrations` relative to `cwd` and could not find itself when run from the test suite; in a
 * deployed function it would have failed the same way, later and less visibly.
 *
 * As a module it is bundled with the code that uses it and there is no path to get wrong.
 */
export const migration001 = {
  name: "001_characters",
  sql: `-- CHARACTER STUDIO — initial schema.
--
-- Design notes, because a few choices here are deliberate and would otherwise look arbitrary:
--
--  * Identity, lifecycle and anything queried or sorted on gets its own column. Appearance is a
--    single JSONB blob. Splitting appearance into thirty columns would buy nothing — nothing filters
--    on hair colour — and every new cosmetic slot would be a migration. Its shape is enforced by the
--    validator in \`@print-rush/character-core\`, which the race server shares, so there is one
--    definition rather than one per layer.
--
--  * \`version\` is on the character, not only on the history table, because it does double duty: it
--    numbers the snapshots and it is the optimistic lock. A write carries the version it read, and
--    the UPDATE only matches while that is still current.
--
--  * Photographs are not here. Only the object-storage pathnames are. The blob store is private, so
--    a pathname is not a capability, and the originals are served exclusively through an authorised
--    route that never hands them to a race client.
--
--  * Soft delete first. \`deleted_at\` plus a recovery window, per the brief; the files go later.

CREATE TABLE IF NOT EXISTS characters (
  id              uuid PRIMARY KEY,
  name            text        NOT NULL CHECK (char_length(name) BETWEEN 1 AND 50),
  slug            text        NOT NULL,
  owner_id        text        NOT NULL,
  status          text        NOT NULL DEFAULT 'DRAFT'
                    CHECK (status IN ('DRAFT', 'READY', 'ARCHIVED')),
  is_active       boolean     NOT NULL DEFAULT true,
  is_public       boolean     NOT NULL DEFAULT false,
  is_favourite    boolean     NOT NULL DEFAULT false,
  version         integer     NOT NULL DEFAULT 1 CHECK (version >= 1),
  appearance      jsonb       NOT NULL,
  default_kart_id text,
  avatar_thumb    text,
  render_preview  text,
  created_at      timestamptz NOT NULL DEFAULT now(),
  updated_at      timestamptz NOT NULL DEFAULT now(),
  last_used_at    timestamptz,
  deleted_at      timestamptz,
  deleted_by      text
);

-- The indexes the brief asks for, plus the one it implies: the library lists a person's own
-- characters, newest first, excluding deleted ones, and that is the query that runs on every visit.
CREATE INDEX IF NOT EXISTS characters_owner_idx      ON characters (owner_id) WHERE deleted_at IS NULL;
CREATE INDEX IF NOT EXISTS characters_owner_recent_idx ON characters (owner_id, updated_at DESC) WHERE deleted_at IS NULL;
CREATE INDEX IF NOT EXISTS characters_status_idx      ON characters (status);
CREATE INDEX IF NOT EXISTS characters_updated_idx     ON characters (updated_at DESC);
CREATE INDEX IF NOT EXISTS characters_last_used_idx   ON characters (last_used_at DESC NULLS LAST);
CREATE INDEX IF NOT EXISTS characters_deleted_idx     ON characters (deleted_at) WHERE deleted_at IS NOT NULL;
-- Case-insensitive name search for the library filter and the admin table.
CREATE INDEX IF NOT EXISTS characters_name_idx        ON characters (lower(name));

/*
 * One face per character, enforced by the primary key on character_id rather than by convention.
 *
 * A retry replaces the row instead of accumulating rows: the brief wants a failed photo to be
 * retryable without leaving debris, and "which of these four face rows is the live one" is exactly
 * the ambiguity that produces a character wearing an old face.
 */
CREATE TABLE IF NOT EXISTS character_faces (
  character_id       uuid PRIMARY KEY REFERENCES characters (id) ON DELETE CASCADE,
  id                 uuid        NOT NULL,
  state              text        NOT NULL DEFAULT 'UPLOADED'
                       CHECK (state IN ('UPLOADED', 'VALIDATING', 'PROCESSING', 'READY', 'FAILED')),
  failure_reason     text,
  original_path      text,
  cropped_path       text,
  game_texture_path  text,
  thumbnail_path     text,
  crop               jsonb       NOT NULL DEFAULT '{}'::jsonb,
  processing_version integer     NOT NULL DEFAULT 1,
  -- The pending face, while a restyle is being reviewed. The live one above stays untouched until
  -- the owner accepts, which is the brief's safe-regeneration rule expressed in the schema.
  pending_texture_path text,
  pending_thumb_path   text,
  created_at         timestamptz NOT NULL DEFAULT now(),
  updated_at         timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS character_faces_state_idx ON character_faces (state);

CREATE TABLE IF NOT EXISTS character_versions (
  id           uuid PRIMARY KEY,
  character_id uuid        NOT NULL REFERENCES characters (id) ON DELETE CASCADE,
  version      integer     NOT NULL,
  snapshot     jsonb       NOT NULL,
  created_at   timestamptz NOT NULL DEFAULT now(),
  created_by   text        NOT NULL,
  UNIQUE (character_id, version)
);

CREATE INDEX IF NOT EXISTS character_versions_character_idx
  ON character_versions (character_id, version DESC);

/*
 * The audit trail.
 *
 * Deliberately thin: an action, who did it, which character, and a small JSONB detail. These records
 * concern photographs of colleagues, so the rule is that the log says *what happened* and never
 * carries the image, the pathname of an original, or anything else that would make the log itself
 * a second copy of personal data.
 */
CREATE TABLE IF NOT EXISTS character_audit (
  id           bigserial PRIMARY KEY,
  character_id uuid REFERENCES characters (id) ON DELETE SET NULL,
  action       text        NOT NULL,
  actor        text        NOT NULL,
  detail       jsonb       NOT NULL DEFAULT '{}'::jsonb,
  created_at   timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS character_audit_character_idx ON character_audit (character_id, created_at DESC);
CREATE INDEX IF NOT EXISTS character_audit_action_idx    ON character_audit (action, created_at DESC);
`,
};
