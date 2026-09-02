import type { NextConfig } from "next";

/**
 * No longer a static export.
 *
 * `output: "export"` produced a pure static bundle, which is why the whole game shipped as files on
 * a CDN — and why characters had nowhere to live but `localStorage`. Route handlers cannot exist in
 * a static export, so persisting a character to Postgres and its photograph to object storage means
 * the app has a server side now.
 *
 * What that costs: the deploy stops being `--prebuilt` static output and becomes a Vercel build with
 * functions. What it buys is the entire point of the Character Studio — a character that exists
 * tomorrow, on another device, for another player.
 */
const nextConfig: NextConfig = {
  transpilePackages: ["@print-rush/game-core", "@print-rush/3d-factory", "@print-rush/character-core"],
  experimental: { optimizePackageImports: ["@babylonjs/core"] },
};

export default nextConfig;
