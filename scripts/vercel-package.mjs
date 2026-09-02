import { copyFileSync, existsSync, mkdirSync, readdirSync, rmSync, statSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

/**
 * Packages the Next.js static export into the Vercel Build Output API v3 layout, so the deploy can
 * go up with `--prebuilt` and no cloud build step.
 *
 * This is adapted from the team template, which assumes a Vite `dist/`. Two differences matter:
 *
 *  - the export lives in `apps/web/out`, not `dist`;
 *  - Next writes `about.html` for a route rather than `about/index.html`, so the SPA-style catch-all
 *    the template used would serve the home page for every sub-route. The routes below try the exact
 *    file, then `<path>.html`, before falling back — which is what makes `/dev/handling` resolve.
 */

const root = join(fileURLToPath(new URL(".", import.meta.url)), "..");
const exportDir = join(root, "apps", "web", "out");
const output = join(root, ".vercel", "output");
const staticDir = join(output, "static");

if (!existsSync(exportDir)) {
  console.error("apps/web/out not found — run `npm run build -w @print-rush/web` first");
  process.exit(1);
}

try {
  rmSync(output, { recursive: true, force: true });
} catch {
  // Nothing to clean on a first run.
}
mkdirSync(staticDir, { recursive: true });

function copyDir(source, destination) {
  mkdirSync(destination, { recursive: true });
  for (const entry of readdirSync(source)) {
    const from = join(source, entry);
    const to = join(destination, entry);
    if (statSync(from).isDirectory()) copyDir(from, to);
    else copyFileSync(from, to);
  }
}
copyDir(exportDir, staticDir);

writeFileSync(
  join(output, "config.json"),
  `${JSON.stringify(
    {
      version: 3,
      routes: [
        // Serve anything that exists on disk as-is: assets, _next, the manifest, the service worker.
        { handle: "filesystem" },
        // A clean URL maps to the sibling .html file Next emitted for that route.
        { src: "/(.*)", dest: "/$1.html", check: true },
        { handle: "error" },
        // Every route in the error phase needs an explicit `src`. Omitting it fails the deploy with
        // `invalid_routes` at the process-and-upload-routes step, with no message.
        { src: "/(.*)", status: 404, dest: "/404.html" },
      ],
      overrides: {},
      crons: [],
    },
    null,
    2,
  )}\n`,
);

console.log(`vercel/output ready — packaged ${readdirSync(staticDir).length} top-level entries`);
