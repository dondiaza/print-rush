import { readdirSync, readFileSync, statSync } from "node:fs";
import { extname, join } from "node:path";

/**
 * INTEGRATION AUDIT.
 *
 * Answers one question that the bake itself cannot: of the assets on disk, which ones can the app
 * actually reach?
 *
 * The manifest used to record `status: "integrated"` for every entry, which was written by hand and
 * was simply not true — 121 files claimed to be in use while the game was still drawing every
 * surface from the procedural generator. The manifest now records `status: "baked"`, which is a fact
 * about the file, and this module derives reachability from the source instead of asserting it.
 *
 * Reachability is established two ways, both from the real source text:
 *
 *  1. **Named directly.** The id, or its material base id, appears as a string literal — a theme's
 *     `texture: "mat_concrete_factory"`, an entry in `BAKED_DEFAULT`.
 *  2. **Named by pattern.** The app builds a handful of ids from an enumerated key: a `LiveryId`
 *     becomes `kart_wrap_<lower>_basecolor`, a circuit key becomes `backdrop_<key>_panorama`, a
 *     decal family becomes `decal_<family>_<n>`. The keys are read out of the source too, so adding
 *     a livery or a circuit updates the audit without touching this file.
 *
 * An unreferenced asset is not a bug — a variant baked ahead of the circuit that will use it is
 * reasonable. Claiming it is integrated when it is not, is. This is what keeps the report honest.
 */

const SOURCE_EXTENSIONS = new Set([".ts", ".tsx", ".mjs", ".js"]);
/**
 * Directories with no bearing on what the app references.
 *
 * `tests` is in here for a reason worth stating: a test that names an asset does not integrate it.
 * Leaving it in produced exactly one false positive — the carpet roughness map, named only by an
 * assertion — and a reachability audit that counts its own tests as usage is measuring nothing.
 */
const SKIP = new Set(["node_modules", ".next", "out", "dist", "public", ".git", "tests"]);

/** Every source file's text, concatenated. One string is enough — this is a reachability question. */
export function readSourceText(roots) {
  const chunks = [];
  const walk = (directory) => {
    for (const entry of readdirSync(directory)) {
      if (SKIP.has(entry)) continue;
      const path = join(directory, entry);
      if (statSync(path).isDirectory()) walk(path);
      else if (SOURCE_EXTENSIONS.has(extname(entry))) chunks.push(readFileSync(path, "utf8"));
    }
  };
  for (const root of roots) walk(root);
  return chunks.join("\n");
}

/** All values of a string-literal union, e.g. `export type LiveryId = "NONE" | "COMIC" ...`. */
function unionValues(source, typeName) {
  const match = source.match(new RegExp(`export type ${typeName}\\s*=([^;]+);`));
  if (!match) return [];
  return [...match[1].matchAll(/"([A-Z_]+)"/g)].map((entry) => entry[1]);
}

/**
 * The body of a `const` object literal, found by its declaration.
 *
 * Anchoring on the bare name is wrong, and was: in the concatenated source the *import* of a
 * constant can come before its declaration, and the next `{` after an import name belongs to
 * something else entirely. That silently found no decal families at all, which made twenty-one real,
 * wired assets look unreferenced. Searching for `const <name>` is what makes the match the
 * declaration — and it is a plain string search rather than a built regex, because a pattern
 * assembled into a template literal loses its backslashes and fails the same way, quietly.
 */
function declarationBody(source, constName) {
  const declaration = source.indexOf(`const ${constName}`);
  if (declaration === -1) return "";
  const open = source.indexOf("{", declaration);
  const close = source.indexOf("};", open);
  return open === -1 || close === -1 ? "" : source.slice(open, close);
}

/** The values of a `Record<string, string>` literal, e.g. `CIRCUIT_KEY_BY_THEME`. */
function recordValues(source, constName) {
  const body = declarationBody(source, constName);
  return [...body.matchAll(/:\s*"([a-z_]+)"/g)].map((entry) => entry[1]);
}

/** Every decal family named in `FAMILIES_BY_THEME`, across all themes. */
function decalFamilies(source) {
  const body = declarationBody(source, "FAMILIES_BY_THEME");
  return [...new Set([...body.matchAll(/"([a-z_]+)"/g)].map((entry) => entry[1]))];
}

/**
 * Splits the manifest into what the app can reach and what it cannot.
 *
 * Returns `{ referenced, unreferenced, reasons }`, where `reasons` maps an id to how it was reached.
 * Knowing *why* an asset counts as integrated matters as much as the count: "reached by the livery
 * pattern" and "named by the office theme" are different kinds of confidence.
 */
export function auditIntegration(manifest, source) {
  const liveries = unionValues(source, "LiveryId").filter((value) => value !== "NONE");
  const circuits = recordValues(source, "CIRCUIT_KEY_BY_THEME");
  const families = decalFamilies(source);
  /**
   * Sprite families named by the renderer.
   *
   * Read out of both tables that place them — the crowd table and the dressing table — so adding a
   * family to either makes its atlas count as reachable without touching this file, and baking one
   * that neither table mentions correctly shows up as unreferenced. It did: plants and hanging
   * garments were baked with nothing placing them until the dressing table existed.
   */
  const spriteFamilies = [
    ...new Set([
      ...[...declarationBody(source, "FAMILY_BY_THEME").matchAll(/"([a-z_]+)"/g)].map((m) => m[1]),
      ...[...declarationBody(source, "DRESSING_BY_THEME").matchAll(/family: "([a-z_]+)"/g)].map((m) => m[1]),
    ]),
  ];

  const referenced = [];
  const unreferenced = [];
  const reasons = {};

  for (const asset of manifest.assets) {
    const id = asset.id;
    const base = id.replace(/_(basecolor|normal|roughness)$/, "");
    let reason = null;

    if (source.includes(`"${id}"`)) reason = "named directly";
    else if (source.includes(`"${base}"`)) reason = `named as ${base}`;
    else if (asset.category === "kart-wrap") {
      const livery = liveries.find((value) => base === `kart_wrap_${value.toLowerCase()}`);
      if (livery) reason = `livery ${livery}`;
    } else if (asset.category === "backdrop") {
      const circuit = circuits.find((key) => id === `backdrop_${key}_panorama`);
      if (circuit) reason = `circuit ${circuit}`;
    } else if (asset.category === "decal") {
      const family = families.find((value) => id.startsWith(`decal_${value}_`));
      if (family) reason = `decal family ${family}`;
    } else if (asset.category === "poster") {
      // `poster_<circuit>_atlas`, from the same circuit keys the backdrops use.
      const circuit = circuits.find((key) => id === `poster_${key}_atlas`);
      if (circuit) reason = `poster wall ${circuit}`;
    } else if (asset.category === "sprite") {
      // `sprite_<family>_atlas`, where the families are named in the placement tables.
      const family = spriteFamilies.find((value) => id === `sprite_${value}_atlas`);
      if (family) reason = `sprite family ${family}`;
    }

    if (reason) {
      referenced.push(id);
      reasons[id] = reason;
    } else {
      unreferenced.push(id);
    }
  }

  return { referenced, unreferenced, reasons };
}
