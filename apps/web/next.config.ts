import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  output: "export",
  transpilePackages: ["@print-rush/game-core", "@print-rush/3d-factory"],
  experimental: { optimizePackageImports: ["@babylonjs/core"] },
};

export default nextConfig;
