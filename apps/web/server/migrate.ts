import { runStatements, sql } from "./db";
import { MIGRATIONS } from "./migrations";

/**
 * Migrations.
 *
 * A deliberately small runner rather than a migration framework: this schema is three tables and an
 * audit log, every statement is written `IF NOT EXISTS`, and a dependency that owns the schema would
 * be more machinery than the problem needs.
 *
 * What it does guarantee is that a file runs once and is recorded, so a later migration can assume
 * the earlier one happened, and so a partially-applied run is safe to repeat.
 */

/**
 * Splits a SQL file into statements.
 *
 * Not `split(";")`. A semicolon inside a string literal or a comment is not a statement boundary,
 * and this schema contains both — the block comments explaining the design would each be chopped in
 * half, producing statements that are pure gibberish and an error message that points nowhere near
 * the cause. So the splitter tracks the three contexts where a semicolon is just a character.
 */
export function splitStatements(source: string): string[] {
  const statements: string[] = [];
  let current = "";
  let inSingle = false;
  let inLineComment = false;
  let inBlockComment = false;

  for (let index = 0; index < source.length; index += 1) {
    const char = source[index]!;
    const next = source[index + 1];

    if (inLineComment) {
      if (char === "\n") inLineComment = false;
      current += char;
      continue;
    }
    if (inBlockComment) {
      current += char;
      if (char === "*" && next === "/") {
        current += next;
        index += 1;
        inBlockComment = false;
      }
      continue;
    }
    if (inSingle) {
      current += char;
      // Two quotes in a row is an escaped quote, not the end of the literal.
      if (char === "'" && next === "'") {
        current += next;
        index += 1;
      } else if (char === "'") {
        inSingle = false;
      }
      continue;
    }

    if (char === "-" && next === "-") {
      inLineComment = true;
      current += char;
      continue;
    }
    if (char === "/" && next === "*") {
      inBlockComment = true;
      current += char;
      continue;
    }
    if (char === "'") {
      inSingle = true;
      current += char;
      continue;
    }
    if (char === ";") {
      statements.push(current);
      current = "";
      continue;
    }
    current += char;
  }

  if (current.trim().length > 0) statements.push(current);
  // A file of nothing but comments contributes no statements.
  return statements.filter((statement) => stripComments(statement).trim().length > 0);
}

/** Whether anything is left once comments are removed. Used only to skip comment-only chunks. */
function stripComments(statement: string): string {
  return statement.replace(/\/\*[\s\S]*?\*\//g, "").replace(/--[^\n]*/g, "");
}

export type MigrationResult = {
  applied: string[];
  skipped: string[];
};

/**
 * Applies every pending migration, in filename order.
 *
 * Idempotent: calling it twice applies nothing the second time. That is what lets it be safe to call
 * from a route on demand as well as from the command line, which matters because a serverless
 * deployment has no obvious place to hang a deploy hook.
 */
export async function migrate(): Promise<MigrationResult> {
  const query = sql();
  await query.query(`
    CREATE TABLE IF NOT EXISTS schema_migrations (
      name       text PRIMARY KEY,
      applied_at timestamptz NOT NULL DEFAULT now()
    )
  `);

  const done = new Set(
    ((await query.query("SELECT name FROM schema_migrations")) as { name: string }[]).map(
      (row) => row.name,
    ),
  );

  const applied: string[] = [];
  const skipped: string[] = [];

  for (const migration of MIGRATIONS) {
    // Both the module name and the legacy filename count as applied, so a database migrated before
    // the SQL moved into a module is not migrated a second time.
    if (done.has(migration.name) || done.has(`${migration.name}.sql`)) {
      skipped.push(migration.name);
      continue;
    }
    await runStatements(splitStatements(migration.sql));
    // Recorded only after every statement succeeded, so a failure part-way leaves it pending and the
    // next run repeats it — which the `IF NOT EXISTS` clauses make safe.
    await query.query("INSERT INTO schema_migrations (name) VALUES ($1)", [migration.name]);
    applied.push(migration.name);
  }

  return { applied, skipped };
}

/**
 * Which migrations have run and which are pending, without applying anything.
 *
 * Split out so the health check can be a pure read. Tolerates the bookkeeping table not existing
 * yet, which is the state a brand-new database is in.
 */
export async function migrationState(): Promise<{ applied: string[]; pending: string[] }> {
  const query = sql();
  let applied: string[] = [];
  try {
    const rows = (await query.query("SELECT name FROM schema_migrations ORDER BY name")) as {
      name: string;
    }[];
    applied = rows.map((row) => row.name);
  } catch {
    // No bookkeeping table means nothing has been applied, which is a valid answer rather than an
    // error — it is exactly what a fresh database looks like.
    applied = [];
  }
  const done = new Set(applied);
  const pending = MIGRATIONS.filter(
    (migration) => !done.has(migration.name) && !done.has(`${migration.name}.sql`),
  ).map((migration) => migration.name);
  return { applied, pending };
}
