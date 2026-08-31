import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  output: "export",
  transpilePackages: ["@print-rush/game-core"],
  experimental: { optimizePackageImports: ["@babylonjs/core"] },
};

export default nextConfig;
