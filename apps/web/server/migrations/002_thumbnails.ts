/**
 * Migration 002 — every thumbnail size, not just one.
 *
 * The styling pipeline already produced 256, 128 and 64 px versions and threw two of them away,
 * because the face row had a single `thumbnail_path`. The brief asks for all three and gives the
 * reason: a 40 px avatar in a lobby list has no business downloading a 128 px image, let alone the
 * 512 px face texture.
 *
 * A JSONB map keyed by size rather than three columns. The set of sizes is a rendering decision that
 * will change — a retina list wants 96, a podium card wants 384 — and each change should not be a
 * migration. `thumbnail_path` stays as the default so nothing that reads it breaks.
 */
export const migration002 = {
  name: "002_thumbnails",
  sql: `
ALTER TABLE character_faces
  ADD COLUMN IF NOT EXISTS thumbnails jsonb NOT NULL DEFAULT '{}'::jsonb;

ALTER TABLE character_faces
  ADD COLUMN IF NOT EXISTS pending_thumbnails jsonb NOT NULL DEFAULT '{}'::jsonb;
`,
};
