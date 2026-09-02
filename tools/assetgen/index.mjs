import { mkdirSync, rmSync, statSync, writeFileSync } from "node:fs";
import { dirname, join, relative } from "node:path";
import { fileURLToPath } from "node:url";
import { encodePng } from "./png.mjs";
import { renderGrey, renderNormalFromHeight, renderRgb, renderRgba } from "./raster.mjs";
import { MATERIAL_VARIANTS, buildVariant } from "./materials.mjs";
import { DECALS, DECAL_COLORS } from "./decals.mjs";
import { WRAPS } from "./wraps.mjs";
import { BACKDROPS } from "./backdrops.mjs";

/**
 * Asset baking pipeline.
 *
 * Writes real image files to `apps/web/public/assets` and a manifest describing every one of them.
 *
 * Why files rather than the runtime canvas generation this replaces: the brief requires that every
 * asset exist physically in the project, and it is right to. A texture baked to disk can be
 * inspected, replaced by an artist or an image model without touching code, cached by the CDN, and
 * costs nothing at startup. The runtime generator stays as the fallback.
 *
 * Everything here is procedural — deterministic maths, not AI generation, which is not available in
 * this environment. See `docs/ART_DIRECTION.md` §0 for what that does and does not cover.
 *
 * Run with `npm run assets:build`. Deterministic: a rebuild produces byte-identical files.
 */

const root = join(fileURLToPath(new URL(".", import.meta.url)), "..", "..");
const outputRoot = join(root, "apps", "web", "public", "assets");

const MATERIAL_SIZE = 512;
/**
 * Normal and roughness at half the basecolour's resolution.
 *
 * This is standard practice and it is the single biggest lever on download weight: relief and
 * gloss are low-frequency compared to colour detail, so halving them is imperceptible at driving
 * distance while cutting each map to a quarter of its bytes. The first bake came in at 9.16 MB for
 * the shared set against a 6 MB budget, almost all of it normals and roughness.
 */
const MATERIAL_MAP_SIZE = 256;
const WRAP_SIZE = 1024;
/** 1536 x 768 rather than 2048 x 1024: a backdrop is never sampled at texel density. */
const BACKDROP = { width: 1536, height: 768 };

const manifest = [];
let bytesWritten = 0;

function write(relativePath, image, meta) {
  const absolute = join(outputRoot, relativePath);
  mkdirSync(dirname(absolute), { recursive: true });
  const png = encodePng(image.pixels, image.width, image.height, image.channels);
  writeFileSync(absolute, png);
  bytesWritten += png.length;

  manifest.push({
    id: meta.id,
    category: meta.category,
    ...(meta.circuit ? { circuit: meta.circuit } : {}),
    sourceFile: `assets/${relativePath.split("\\").join("/")}`,
    generated: true,
    generator: "procedural",
    width: image.width,
    height: image.height,
    hasAlpha: image.channels === 4,
    bytes: png.length,
    usage: meta.usage,
    // What this file is, not what anyone does with it. An earlier version wrote "integrated" here
    // for all 121 entries, which was a claim the bake is in no position to make and was false at the
    // time — the game was still drawing every surface procedurally. Whether an asset is reachable
    // from the app is a separate, derived question: see `audit.mjs`, which reads the real source.
    status: "baked",
  });
  return png.length;
}

// ------------------------------------------------------------------ materials

function bakeMaterials() {
  let count = 0;
  for (const variant of MATERIAL_VARIANTS) {
    const built = buildVariant(variant);
    const scope = variant.scope === "common" ? "common" : `tracks/${variant.scope}`;
    const folder = join(scope.split("/").join("/"), "materials");
    const name = `mat_${variant.id}`;

    const basecolor = renderRgb(MATERIAL_SIZE, (u, v) => built.color(u, v));
    write(join(folder, `${name}_basecolor.png`), basecolor, {
      id: `${name}_basecolor`,
      category: "material",
      circuit: variant.scope === "common" ? undefined : variant.scope,
      usage: `${built.class} basecolour, tiles every ${built.tile} m`,
    });

    // Derived from the height function, not from the basecolour's luminance — a stain is not a bump.
    const normal = renderNormalFromHeight(MATERIAL_MAP_SIZE, (u, v) => built.height(u, v), 1);
    write(join(folder, `${name}_normal.png`), normal, {
      id: `${name}_normal`,
      category: "material",
      circuit: variant.scope === "common" ? undefined : variant.scope,
      usage: `${built.class} tangent-space normal`,
    });

    const roughness = renderGrey(MATERIAL_MAP_SIZE, (u, v) => built.roughness(u, v));
    write(join(folder, `${name}_roughness.png`), roughness, {
      id: `${name}_roughness`,
      category: "material",
      circuit: variant.scope === "common" ? undefined : variant.scope,
      usage: `${built.class} roughness`,
    });

    count += 1;
  }
  return count;
}

// ------------------------------------------------------------------ decals

function bakeDecals() {
  let count = 0;
  for (const [family, definition] of Object.entries(DECALS)) {
    for (let index = 0; index < definition.count; index += 1) {
      // A stable seed per family and index, so a rebuild reproduces the same mark.
      let seed = index * 7919 + 13;
      for (let c = 0; c < family.length; c += 1) seed = (seed * 31 + family.charCodeAt(c)) >>> 0;
      const color = DECAL_COLORS[index % DECAL_COLORS.length];
      const shade = definition.build({ seed, color });
      const image = renderRgba(definition.size, (u, v) => shade(u, v));
      const name = `decal_${family}_${String(index + 1).padStart(2, "0")}`;
      write(join("common", "decals", `${name}.png`), image, {
        id: name,
        category: "decal",
        usage: `${family} wear decal, alpha-blended onto surfaces`,
      });
      count += 1;
    }
  }
  return count;
}

// ------------------------------------------------------------------ kart wraps

function bakeWraps() {
  let count = 0;
  for (const [name, definition] of Object.entries(WRAPS)) {
    let seed = 977;
    for (let c = 0; c < name.length; c += 1) seed = (seed * 31 + name.charCodeAt(c)) >>> 0;
    const shade = definition.build({ seed });
    const image = renderRgb(WRAP_SIZE, (u, v) => shade(u, v));
    const id = `kart_wrap_${name}_basecolor`;
    write(join("common", "wraps", `${id}.png`), image, {
      id,
      category: "kart-wrap",
      usage: `kart livery "${name}", mapped to the hull UV (U around, V nose to tail)`,
    });
    count += 1;
  }
  return count;
}

// ------------------------------------------------------------------ backdrops

function bakeBackdrops() {
  let count = 0;
  for (const [circuit, definition] of Object.entries(BACKDROPS)) {
    let seed = 4231;
    for (let c = 0; c < circuit.length; c += 1) seed = (seed * 31 + circuit.charCodeAt(c)) >>> 0;
    const shade = definition.build({ seed });
    const image = renderRgb(BACKDROP, (u, v) => shade(u, v));
    const id = `backdrop_${circuit}_panorama`;
    const folder = join("tracks", circuit);
    write(join(folder, `${id}.png`), image, {
      id,
      category: "backdrop",
      circuit,
      usage: `cylindrical panorama for ${circuit}, 360 degrees, wraps horizontally`,
    });
    count += 1;
  }
  return count;
}

// ------------------------------------------------------------------ main

function formatBytes(bytes) {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(0)} KB`;
  return `${(bytes / 1024 / 1024).toFixed(2)} MB`;
}

console.log("baking assets to", relative(root, outputRoot));
try {
  rmSync(outputRoot, { recursive: true, force: true });
} catch {
  // First run.
}

const materials = bakeMaterials();
const decals = bakeDecals();
const wraps = bakeWraps();
const backdrops = bakeBackdrops();

// Per-circuit weight, which is the number the loading budget in ART_DIRECTION.md §3 is about.
const byScope = new Map();
for (const asset of manifest) {
  const scope = asset.circuit ?? "common";
  byScope.set(scope, (byScope.get(scope) ?? 0) + asset.bytes);
}

const manifestPath = join(outputRoot, "assets.manifest.json");
writeFileSync(
  manifestPath,
  `${JSON.stringify(
    {
      generatedAt: new Date().toISOString().slice(0, 10),
      generator: "tools/assetgen — procedural, deterministic",
      note:
        "No AI image generation is available in this environment; every asset here is generated by "
        + "deterministic code. Illustration-class assets (posters, crowd sprites, avatar portraits) "
        + "are listed as pending in docs/ART_DIRECTION.md and are not present.",
      counts: { materials, decals, wraps, backdrops, files: manifest.length },
      bytesByScope: Object.fromEntries([...byScope].map(([scope, bytes]) => [scope, bytes])),
      totalBytes: bytesWritten,
      assets: manifest.sort((a, b) => a.id.localeCompare(b.id)),
    },
    null,
    2,
  )}\n`,
);

console.table(
  [...byScope].map(([scope, bytes]) => ({ scope, files: manifest.filter((a) => (a.circuit ?? "common") === scope).length, size: formatBytes(bytes) })),
);
console.log(
  `\n${manifest.length} files — ${materials} materials (x3 maps), ${decals} decals, ${wraps} wraps, ${backdrops} backdrops`,
);
console.log(`total ${formatBytes(bytesWritten)}, manifest at ${relative(root, manifestPath)}`);

// A hard budget check, so an asset change cannot quietly blow the download target.
const commonBytes = byScope.get("common") ?? 0;
const worstTrack = Math.max(...[...byScope].filter(([scope]) => scope !== "common").map(([, bytes]) => bytes));
const COMMON_LIMIT = 6 * 1024 * 1024;
const TRACK_LIMIT = 4 * 1024 * 1024;
let failed = false;
if (commonBytes > COMMON_LIMIT) {
  console.error(`\nFAIL common set is ${formatBytes(commonBytes)}, over the ${formatBytes(COMMON_LIMIT)} budget`);
  failed = true;
}
if (worstTrack > TRACK_LIMIT) {
  console.error(`FAIL heaviest circuit is ${formatBytes(worstTrack)}, over the ${formatBytes(TRACK_LIMIT)} budget`);
  failed = true;
}
if (failed) process.exit(1);

void statSync;
console.log("\nwithin budget");
